// The Telegram bridge: the bell, mirrored into each member's pocket.
// Configured by ONE secret — the TELEGRAM_BOT_TOKEN environment variable
// (Vercel → Settings → Environment Variables, or the local shell). It is
// never written to the repo or the database; with no token the whole bridge
// is inert and invisible. Messages are Telegram-HTML — titles read bold and
// links hide behind words — so every scrap of user-typed text (titles,
// names, notes) walks through tgEsc before joining a message.
import { createHash } from 'crypto'
import { all, get, run, dayISO } from './db.js'
import { resolveGates, phasePassed } from './deadlines.js'
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
// Cached in-process for a minute: the address basically never changes, and a
// burst of notifications should not pay a database read per message.
let urlCache = { v: null, at: 0 }
export async function tgPublicUrl() {
  if (urlCache.v !== null && Date.now() - urlCache.at < 60000) return urlCache.v
  const v = (await get("SELECT value FROM meta WHERE key = 'public_url'"))?.value || ''
  urlCache = { v, at: Date.now() }
  return v
}
export const tgRememberUrl = (origin) => {
  urlCache = { v: origin, at: Date.now() }
  return run("INSERT INTO meta (key, value) VALUES ('public_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", origin)
}
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

// Telegram-HTML knows four special characters; everything a person typed
// passes through here before joining a message, so a title like "A <b> tag"
// can never break (or style) the notification.
export const tgEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Dates the way people read them: 2026-08-12 → "Wed, 12 Aug".
export const tgDate = (iso) => {
  const s = String(iso ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return iso || ''
  return new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  })
}

// Telegram refuses messages over 4096 characters — a runaway task title or
// pasted essay must never silence the whole notification.
export const tgClip = (s) => {
  const t = String(s ?? '')
  return t.length > 4000 ? `${t.slice(0, 4000)}…` : t
}

// One message to one linked member. A Telegram hiccup must never break the
// request that triggered it — the bell row is already written; this is a
// mirror. If the HTML ever fails to parse (a clipped tag), the same words go
// out plain rather than not at all.
export async function tgSendTo(userId, text) {
  if (!tgEnabled() || !userId) return
  try {
    const u = await get('SELECT telegram_chat_id FROM users WHERE id = ?', userId)
    if (!u?.telegram_chat_id) return
    const r = await tgApi('sendMessage', {
      chat_id: u.telegram_chat_id, text: tgClip(text), parse_mode: 'HTML', disable_web_page_preview: true,
    })
    if (r && r.ok === false) {
      // Blocking the bot, or deleting the chat, is a decision — not a hiccup.
      // Telegram will refuse every future message the same way, so the link
      // is dropped: the person stops being told they are connected when they
      // are not, the admin panel tells the truth, and nobody keeps calling an
      // API that has already said no. Profile → Connect brings it back.
      if (r.error_code === 403 || /chat not found|user is deactivated|bot was blocked/i.test(r.description || '')) {
        await run('UPDATE users SET telegram_chat_id = NULL WHERE id = ?', userId)
        console.error(`telegram: ${u.telegram_chat_id} refuses messages (${r.description || r.error_code}) — link dropped`)
        return
      }
      await tgApi('sendMessage', { chat_id: u.telegram_chat_id, text: tgClip(text), disable_web_page_preview: true })
    }
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
    if (origin) line += `\n<a href="${origin}/brief?task=${contentId}">Open the task ↗</a>`
  }
  await Promise.allSettled([...new Set(userIds)].map((id) => tgSendTo(id, line)))
}

// ---- the admin's own nudges -------------------------------------------------
// Who a template speaks to. Everything resolves to plain user ids; whoever
// hasn't connected Telegram simply hears nothing.
export async function tgAudience(audience) {
  const a = String(audience || 'linked')
  if (a.startsWith('users:')) {
    const ids = a.slice(6).split(',').map(Number).filter(Boolean)
    return ids
  }
  if (a.startsWith('role:')) {
    const role = a.slice(5)
    return (await all('SELECT id FROM users WHERE role = ? AND telegram_chat_id IS NOT NULL', role)).map((u) => u.id)
  }
  if (a.startsWith('channel:')) {
    const key = a.slice(8)
    return (await all('SELECT id, departments FROM users WHERE telegram_chat_id IS NOT NULL'))
      .filter((u) => { try { return JSON.parse(u.departments || '[]').includes(key) } catch { return false } })
      .map((u) => u.id)
  }
  return (await all('SELECT id FROM users WHERE telegram_chat_id IS NOT NULL')).map((u) => u.id)
}

// Send one template. The words are the admin's, so they go out escaped —
// nobody should have to think about angle brackets to write a reminder.
export async function tgSendTemplate(tpl, userIds = null) {
  const ids = userIds && userIds.length ? userIds : await tgAudience(tpl.audience)
  if (!ids.length) return 0
  const origin = await tgPublicUrl().catch(() => '')
  const body = `<b>${tgEsc(tpl.title)}</b>\n${tgEsc(tpl.text)}` +
    (origin ? `\n\n<a href="${origin}/brief">Open your day ↗</a>` : '')
  await Promise.allSettled([...new Set(ids)].map((id) => tgSendTo(id, body)))
  return new Set(ids).size
}

// The hour, and the weekday, as Tashkent sees them.
const tashkentHour = () => Number(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tashkent', hour: '2-digit', hour12: false,
}).format(new Date()))
const tashkentWeekday = () => new Date(`${dayISO(0)}T12:00:00Z`).getUTCDay() // 0 = Sunday

// Fire whatever is due. Each template claims its day in the same breath as
// it is chosen, so a schedule goes out ONCE however many times this is
// called — and it is called often, because the host's cron only runs nightly
// and a Monday-morning nudge should not wait for midnight.
export async function tgRunSchedules() {
  if (!tgEnabled()) return 0
  const today = dayISO(0)
  const hour = tashkentHour()
  const weekday = tashkentWeekday()
  const due = (await all('SELECT * FROM tg_templates WHERE enabled = 1')).filter((t) => {
    if (t.last_sent === today) return false
    if (Number(t.hour) > hour) return false
    let days = []
    try { days = JSON.parse(t.days || '[]') } catch { days = [] }
    return Array.isArray(days) && days.includes(weekday)
  })
  let sent = 0
  for (const t of due) {
    // claim first: two instances waking at the same minute must not both send
    const claim = await run('UPDATE tg_templates SET last_sent = ? WHERE id = ? AND (last_sent IS NULL OR last_sent <> ?)',
      today, t.id, today)
    if (!claim?.changes) continue
    try { sent += await tgSendTemplate(t) } catch (e) { console.error('template send failed:', e.message) }
  }
  return sent
}

// The nightly half of the bell, pushed instead of waited for: deadlines
// standing exactly a day and exactly a week away (Tashkent days), per the hat
// each linked member holds — the same rules the in-app reminders use.
// The day is claimed in meta before anything goes out, so a retried cron, a
// second server instance or a curious visitor on the cron URL can never make
// the team's phones ring twice.
// How many overdue items are named before the rest become a count.
const LATE_SHOWN = 6
export async function tgDailyReminders() {
  if (!tgEnabled()) return 0
  const today = dayISO(0)
  const claimed = await run("INSERT INTO meta (key, value) VALUES ('digest_day', ?) ON CONFLICT(key) DO NOTHING", today)
  if (!claimed?.changes) {
    const turn = await run("UPDATE meta SET value = ? WHERE key = 'digest_day' AND value <> ?", today, today)
    if (!turn?.changes) return 0 // today's digest already went out
  }
  const linked = await all('SELECT id, telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL')
  if (linked.length === 0) return 0
  const tomorrow = dayISO(1)
  const week = dayISO(7)
  const statuses = await all('SELECT id, label, sort, is_final FROM statuses')
  const dead = new Set(statuses.filter((s) => /^deleted$/i.test(s.label || '')).map((s) => s.id))
  // Which stage means which phase is behind us. Without this the digest called
  // a shoot nineteen days late on a piece that had been filmed, cut and was
  // sitting in review — the dates were in the past, and nothing ever asked
  // whether the work they belonged to had actually happened.
  const gates = resolveGates(statuses)
  const rows = await all(`SELECT id, title, assignee_id, assignees, operator_id, editor_id, designer_id,
    shot_at, edited_at, done_at, ready_at,
    recording_date, edit_ready_date, design_ready_date, release_date, status_id FROM content WHERE done_at IS NULL`)
  const origin = await tgPublicUrl().catch(() => '')
  const link = (t) => (origin ? ` · <a href="${origin}/brief?task=${t.id}">open ↗</a>` : '')
  const daysAgo = (iso) =>
    Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / 86400000)
  let sent = 0
  for (const u of linked) {
    // TODAY was missing: a deadline you were handed this morning, or one moved
    // onto today, was never mentioned at all — yesterday's digest is the only
    // place it had ever appeared. LATE was missing too, which mattered more:
    // the message ended with "Nothing is late yet" no matter how much was, so
    // the one line people would actually act on was the one line that lied.
    const soon = { [today]: [], [tomorrow]: [], [week]: [] }
    const late = []
    // `phase` names which part of the pipeline the date belongs to, so a date
    // in the past can be checked against whether that part is finished. Work
    // that is done is never late, however long ago its day was.
    const push = (t, date, what, phase) => {
      if (!date) return
      if (soon[date]) soon[date].push({ t, what })
      else if (date < today && !(phase && phasePassed(t, phase, gates))) late.push({ t, what, date })
    }
    for (const t of rows) {
      if (dead.has(t.status_id)) continue
      let assignees = []
      try { assignees = JSON.parse(t.assignees || '[]') } catch { assignees = [] }
      const owns = assignees.includes(u.id) || t.assignee_id === u.id
      // Plain nouns, because each one has to read in both directions now:
      // "— the cut" ahead of time, "— the cut, 3 days late" after.
      if ((owns || t.operator_id === u.id) && t.recording_date) push(t, t.recording_date, 'the shoot', 'shoot')
      if (t.editor_id === u.id && t.edit_ready_date) push(t, t.edit_ready_date, 'the cut', 'edit')
      if (t.designer_id === u.id && t.design_ready_date) push(t, t.design_ready_date, 'the artwork', 'design')
      if (owns && t.release_date) push(t, t.release_date, 'the release', 'review')
    }
    const lines = []
    for (const [label, list] of [['Today', soon[today]], ['Tomorrow', soon[tomorrow]], ['In a week', soon[week]]]) {
      if (!list.length) continue
      lines.push(`<b>${label}</b>`)
      for (const { t, what } of list) lines.push(`• «${tgEsc(t.title)}» — ${what}${link(t)}`)
    }
    if (late.length) {
      // Oldest first — the thing that has been waiting longest is the thing
      // most likely to have been forgotten. Long lists are capped rather than
      // sent whole: a wall of overdue work is read as noise and scrolled past,
      // which is the same as not sending it.
      late.sort((a, b) => a.date.localeCompare(b.date))
      lines.push('<b>Late</b>')
      for (const { t, what, date } of late.slice(0, LATE_SHOWN)) {
        const d = daysAgo(date)
        lines.push(`• «${tgEsc(t.title)}» — ${what}, ${d === 1 ? 'a day' : `${d} days`} late${link(t)}`)
      }
      if (late.length > LATE_SHOWN) lines.push(`…and ${late.length - LATE_SHOWN} more`)
    }
    if (lines.length) {
      const head = late.length ? 'Your deadlines — and what has slipped' : 'A friendly heads-up on your deadlines'
      // The cheerful sign-off is a claim, so it is only made when it is true.
      const close = late.length ? '' : '\n\nNothing is late — a good moment to get ahead of it 💪'
      await tgSendTo(u.id, `⏰ ${head}\n${lines.join('\n')}${close}`)
      sent++
    }
  }
  return sent
}
