// The Telegram bridge: the bell, mirrored into each member's pocket.
// Configured by ONE secret — the TELEGRAM_BOT_TOKEN environment variable
// (Vercel → Settings → Environment Variables, or the local shell). It is
// never written to the repo or the database; with no token the whole bridge
// is inert and invisible. Messages are plain text on purpose — task titles
// need no escaping rules.
import { createHash } from 'crypto'
import { all, get, run, dayISO } from './db.js'
// Namespace import on purpose: config.js may or may not export the token
// (the public mirror's placeholder doesn't) — a missing name reads as
// undefined instead of breaking the module graph.
import * as cfg from './config.js'

// The token: the environment always wins (an empty TELEGRAM_BOT_TOKEN= is an
// explicit off-switch); the config.js value only counts on the real
// deployment (Vercel), so local dev stacks and the QA gate can never ring a
// real bot by accident.
export const tgToken = () => {
  if (process.env.TELEGRAM_BOT_TOKEN !== undefined) return process.env.TELEGRAM_BOT_TOKEN
  return process.env.VERCEL ? (cfg.TELEGRAM_BOT_TOKEN || '') : ''
}
export const tgEnabled = () => !!tgToken()

// Where the dashboard lives publicly — learned the day the admin presses
// "Activate webhook" and remembered, so messages can carry task links.
export async function tgPublicUrl() {
  return (await get("SELECT value FROM meta WHERE key = 'public_url'"))?.value || ''
}
export const tgRememberUrl = (origin) =>
  run("INSERT INTO meta (key, value) VALUES ('public_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", origin)
// api.telegram.org, unless the QA mock points elsewhere.
const base = () => process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'

// The webhook proves itself with a secret derived from the token — Telegram
// echoes it back in a header on every update, and there is nothing extra to
// configure, store or rotate separately.
export const tgWebhookSecret = () =>
  createHash('sha256').update(`satashkent:${tgToken()}`).digest('hex').slice(0, 40)

export async function tgApi(method, payload) {
  if (!tgEnabled()) return null
  const r = await fetch(`${base()}/bot${tgToken()}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  return r.json().catch(() => null)
}

// The bot's public @username (for the t.me deep link) — asked once, then kept.
let botName = null
export async function tgBotUsername() {
  if (!tgEnabled()) return null
  if (!botName) botName = (await tgApi('getMe', {}).catch(() => null))?.result?.username || null
  return botName
}

// Telegram refuses messages over 4096 characters — a runaway task title or
// pasted essay must never silence the whole notification.
export const tgClip = (s) => {
  const t = String(s ?? '')
  return t.length > 4000 ? `${t.slice(0, 4000)}…` : t
}

// One message to one linked member. A Telegram hiccup must never break the
// request that triggered it — the bell row is already written; this is a mirror.
export async function tgSendTo(userId, text) {
  if (!tgEnabled() || !userId) return
  try {
    const u = await get('SELECT telegram_chat_id FROM users WHERE id = ?', userId)
    if (!u?.telegram_chat_id) return
    await tgApi('sendMessage', { chat_id: u.telegram_chat_id, text: tgClip(text), disable_web_page_preview: true })
  } catch (e) { console.error('telegram send failed:', e.message) }
}
// Where a message's task link should point: the remembered public address
// when the admin has activated the webhook, otherwise the address the
// triggering request itself arrived on — so links work from the very first
// notification, not only after Activate.
export const tgOriginFrom = (req) => {
  const h = req?.get?.('host') || ''
  if (!h) return ''
  return `${/^(localhost|127\.)/.test(h) ? 'http' : 'https'}://${h}`
}

// The bell's fan-out, with a tap-to-open task link — immediately.
export async function tgMirror(userIds, text, contentId = null, fallbackOrigin = '') {
  if (!tgEnabled()) return
  let line = text
  if (contentId) {
    const origin = (await tgPublicUrl().catch(() => '')) || fallbackOrigin
    if (origin) line += `\n${origin}/todo?task=${contentId}`
  }
  await Promise.allSettled([...new Set(userIds)].map((id) => tgSendTo(id, line)))
}

// The nightly half of the bell, pushed instead of waited for: deadlines
// standing exactly a day and exactly a week away (Tashkent days), per the hat
// each linked member holds — the same rules the in-app reminders use.
export async function tgDailyReminders() {
  if (!tgEnabled()) return 0
  const linked = await all('SELECT id, telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL')
  if (linked.length === 0) return 0
  const tomorrow = dayISO(1)
  const week = dayISO(7)
  const statuses = await all('SELECT id, label FROM statuses')
  const dead = new Set(statuses.filter((s) => /^deleted$/i.test(s.label || '')).map((s) => s.id))
  const rows = await all(`SELECT id, title, assignee_id, assignees, operator_id, editor_id, designer_id,
    recording_date, edit_ready_date, design_ready_date, release_date, status_id FROM content WHERE done_at IS NULL`)
  const origin = await tgPublicUrl().catch(() => '')
  let sent = 0
  for (const u of linked) {
    const lines = []
    const push = (t, date, what) => {
      if (date !== tomorrow && date !== week) return
      // each line carries its own tap-to-open link when the address is known
      lines.push(`«${t.title}» — ${what} ${date === tomorrow ? 'tomorrow' : 'in a week'}${origin ? `\n${origin}/todo?task=${t.id}` : ''}`)
    }
    for (const t of rows) {
      if (dead.has(t.status_id)) continue
      let assignees = []
      try { assignees = JSON.parse(t.assignees || '[]') } catch { assignees = [] }
      const owns = assignees.includes(u.id) || t.assignee_id === u.id
      if ((owns || t.operator_id === u.id) && t.recording_date) push(t, t.recording_date, 'the shoot')
      if (t.editor_id === u.id && t.edit_ready_date) push(t, t.edit_ready_date, 'the cut is due')
      if (t.designer_id === u.id && t.design_ready_date) push(t, t.design_ready_date, 'the artwork is due')
      if (owns && t.release_date) push(t, t.release_date, 'the release')
    }
    if (lines.length) {
      await tgSendTo(u.id, `⏰ Deadlines:\n${lines.join('\n')}`)
      sent++
    }
  }
  return sent
}
