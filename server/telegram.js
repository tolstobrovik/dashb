// The Telegram bridge: the bell, mirrored into each member's pocket.
// Configured by ONE secret — the TELEGRAM_BOT_TOKEN environment variable
// (Vercel → Settings → Environment Variables, or the local shell). It is
// never written to the repo or the database; with no token the whole bridge
// is inert and invisible. Messages are plain text on purpose — task titles
// need no escaping rules.
import { createHash } from 'crypto'
import { all, get, dayISO } from './db.js'

export const tgToken = () => process.env.TELEGRAM_BOT_TOKEN || ''
export const tgEnabled = () => !!tgToken()
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

// One message to one linked member. A Telegram hiccup must never break the
// request that triggered it — the bell row is already written; this is a mirror.
export async function tgSendTo(userId, text) {
  if (!tgEnabled() || !userId) return
  try {
    const u = await get('SELECT telegram_chat_id FROM users WHERE id = ?', userId)
    if (!u?.telegram_chat_id) return
    await tgApi('sendMessage', { chat_id: u.telegram_chat_id, text, disable_web_page_preview: true })
  } catch (e) { console.error('telegram send failed:', e.message) }
}
export const tgMirror = (userIds, text) =>
  Promise.allSettled([...new Set(userIds)].map((id) => tgSendTo(id, text)))

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
  let sent = 0
  for (const u of linked) {
    const lines = []
    const push = (t, date, what) => {
      if (date !== tomorrow && date !== week) return
      lines.push(`«${t.title}» — ${what} ${date === tomorrow ? 'tomorrow' : 'in a week'}`)
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
