// The Telegram bridge's front door. The webhook is the one route Telegram
// itself calls (proved by the derived secret header, no session); everything
// else is a signed-in member managing their own link, plus the admin's
// one-press webhook activation after a deploy.
import { Router } from 'express'
import { randomBytes } from 'crypto'
import { all, get, run } from '../db.js'
import { authRequired, wrap } from '../auth.js'
import { tgEnabled, tgApi, tgBotUsername, tgWebhookSecret, tgSendTo, tgPublicUrl, tgRememberUrl, tgClip } from '../telegram.js'

const router = Router()

router.post('/webhook', wrap(async (req, res) => {
  if (!tgEnabled()) return res.status(503).json({ error: 'Telegram is not configured' })
  if (req.get('X-Telegram-Bot-Api-Secret-Token') !== tgWebhookSecret())
    return res.status(403).json({ error: 'Wrong secret' })
  const msg = req.body?.message
  const chatId = msg?.chat?.id
  const text = String(msg?.text || '')
  if (chatId && /^\/start\b/.test(text)) {
    // The deep link carries a one-time code minted on the Profile page —
    // pressing Start hands it back here and ties the accounts together.
    const code = text.split(/\s+/)[1] || ''
    const u = code ? await get('SELECT id, name FROM users WHERE telegram_code = ?', code) : null
    if (u) {
      await run('UPDATE users SET telegram_chat_id = ?, telegram_code = NULL WHERE id = ?', String(chatId), u.id)
      await tgApi('sendMessage', { chat_id: chatId, text: `Connected, ${u.name}! Dashboard notifications now land here too. Send /stop to turn them off.` })
    } else {
      await tgApi('sendMessage', { chat_id: chatId, text: 'Open Profile → Telegram in the dashboard and press Connect — that button brings you here with the right code.' })
    }
  } else if (chatId && /^\/stop\b/.test(text)) {
    await run('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ?', String(chatId))
    await tgApi('sendMessage', { chat_id: chatId, text: 'Disconnected. Profile → Telegram → Connect brings it back.' })
  }
  res.json({ ok: true })
}))

router.use(authRequired)

// Is the bridge configured, am I linked, and what's the bot called?
router.get('/status', wrap(async (req, res) => {
  const u = await get('SELECT telegram_chat_id FROM users WHERE id = ?', req.user.id)
  res.json({ enabled: tgEnabled(), linked: !!u?.telegram_chat_id, bot: await tgBotUsername() })
}))

// Mint a fresh one-time code and the t.me deep link that carries it.
router.post('/link', wrap(async (req, res) => {
  if (!tgEnabled()) return res.status(503).json({ error: 'The bot isn’t configured yet — the admin sets TELEGRAM_BOT_TOKEN first' })
  const code = randomBytes(8).toString('hex')
  await run('UPDATE users SET telegram_code = ? WHERE id = ?', code, req.user.id)
  const bot = await tgBotUsername()
  res.json({ code, bot, url: bot ? `https://t.me/${bot}?start=${code}` : null })
}))

router.post('/unlink', wrap(async (req, res) => {
  const u = await get('SELECT telegram_chat_id FROM users WHERE id = ?', req.user.id)
  await run('UPDATE users SET telegram_chat_id = NULL, telegram_code = NULL WHERE id = ?', req.user.id)
  if (u?.telegram_chat_id) await tgApi('sendMessage', { chat_id: u.telegram_chat_id, text: 'Disconnected. Profile → Telegram → Connect brings it back.' })
  res.json({ ok: true })
}))

// Admin, once after the token lands in the environment: tell Telegram where
// the webhook lives. Defaults to this deployment's own public address.
router.post('/set-webhook', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  if (!tgEnabled()) return res.status(503).json({ error: 'Set TELEGRAM_BOT_TOKEN in the environment first' })
  const url = String(req.body?.url || `https://${req.get('host')}/api/telegram/webhook`)
  if (!/^https:\/\//.test(url)) return res.status(400).json({ error: 'The webhook needs a public https:// URL' })
  const out = await tgApi('setWebhook', { url, secret_token: tgWebhookSecret(), allowed_updates: ['message'] })
  // Remember where we live — from now on messages carry task links.
  if (out?.ok) await tgRememberUrl(url.replace(/\/api\/telegram\/webhook$/, ''))
  res.json({ ok: !!out?.ok, url, telegram: out })
}))

// ---- the admin panel ----
// One picture for the admin: is the bridge alive, where the webhook points
// (straight from Telegram, errors included), and who of the team is wired up.
router.get('/admin', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const members = (await all('SELECT id, name, username, role, telegram_chat_id FROM users ORDER BY role DESC, name'))
    .map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, linked: !!u.telegram_chat_id }))
  const webhook = tgEnabled() ? (await tgApi('getWebhookInfo', {}))?.result || null : null
  res.json({
    enabled: tgEnabled(), bot: await tgBotUsername(), webhook,
    public_url: await tgPublicUrl(), members,
  })
}))

// The admin untangles someone who left the team or lost the phone.
router.post('/admin/unlink', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const uid = Number(req.body?.user_id)
  if (!uid) return res.status(400).json({ error: 'user_id required' })
  const u = await get('SELECT telegram_chat_id FROM users WHERE id = ?', uid)
  await run('UPDATE users SET telegram_chat_id = NULL, telegram_code = NULL WHERE id = ?', uid)
  if (u?.telegram_chat_id) await tgApi('sendMessage', { chat_id: u.telegram_chat_id, text: 'The admin disconnected this chat from the dashboard. Profile → Telegram → Connect brings it back.' })
  res.json({ ok: true })
}))

// One announcement to everyone who is wired up — planning changes, "планёрка
// в 15:00", a released video worth celebrating.
router.post('/broadcast', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  if (!tgEnabled()) return res.status(503).json({ error: 'Set the bot token first' })
  const text = String(req.body?.text ?? '').trim().slice(0, 3000)
  if (!text) return res.status(400).json({ error: 'Write the announcement first' })
  const linked = await all('SELECT id, telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL')
  await Promise.allSettled(linked.map((u) =>
    tgApi('sendMessage', { chat_id: u.telegram_chat_id, text: tgClip(`📢 ${req.user.name}: ${text}`), disable_web_page_preview: true })))
  res.json({ ok: true, sent: linked.length })
}))

// A signed-in sanity check: send myself a test line through the bridge.
router.post('/test', wrap(async (req, res) => {
  if (!tgEnabled()) return res.status(503).json({ error: 'Set TELEGRAM_BOT_TOKEN in the environment first' })
  await tgSendTo(req.user.id, '👋 The bridge works — this is your dashboard talking.')
  res.json({ ok: true })
}))

export default router
