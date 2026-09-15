// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 64: the morning digest is gone — and stays gone.
//
// The nightly Telegram digest listed deadlines exactly a day and exactly a
// week out, and then closed — every time, unconditionally — with
//
//     Nothing is late yet — a good moment to get ahead of it 💪
//
// It never looked. Somebody three days past a delivery got that sentence with
// their name on it, which is worse than silence: silence sends you to check
// the board, and this sends you back to work reassured. The function had no
// assertions of any kind, which is how the line survived being written.
//
// It now carries LATE (oldest first, because the thing that has waited longest
// is the thing most likely forgotten) and TODAY, which was missing outright —
// work handed to you this morning, or moved onto today, appeared in no digest
// at all, yesterday's having been its only mention.
//
// Three people in ONE run, because the digest claims its day and goes out
// once: one behind, one clear, one buried. Self-contained: 4103 + mock 9986.
import { spawn } from 'child_process'
import { createHash } from 'crypto'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4103'
const B = BASE + '/api'
const MOCK = 'http://localhost:9986'
const TOKEN = 'x64-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

boot([SP + 'mock-tg.mjs'], { MOCK_PORT: '9986' })
boot([ROOT + '/server/index.js'], {
  DATA_DIR: SP + 'tg64-' + Date.now(), PORT: '4103',
  TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: MOCK,
})
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('mock + stack are up', (await up(MOCK + '/__sent')) && (await up(BASE + '/api/health')))

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const sentList = async () => (await (await fetch(MOCK + '/__sent')).json())
const reset = () => fetch(MOCK + '/__reset', { method: 'POST' })
const hook = async (update) => fetch(B + '/telegram/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
  body: JSON.stringify(update),
})

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const day = (off) => {
  const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + off)
  return d.toISOString().slice(0, 10)
}

const chKey = (await req('/channels')).data[0]?.key
// Fixtures park on Shot, not To shoot: since round 66 the shooting stage is a
// BOOKING and demands a crew, three days and a brief. Shot is what this suite
// actually wants — real work past the Idea stage — without pretending to book
// a shoot these tests are not about.
const shotId = (await req('/statuses')).data.find((s) => /^editing$/i.test(s.label)).id
const mkUser = async (name, username) => (await req('/users', 'POST', {
  name, username, password: 'probe123', role: 'member', departments: [chKey],
})).data
// behind: has overdue work.   clear: only future work.   buried: more late than fits.
const behind = await mkUser('Behind One', 'x64a')
const clear = await mkUser('Clear Two', 'x64b')
const buried = await mkUser('Buried Three', 'x64c')
for (const [u, chat] of [[behind, 641], [clear, 642], [buried, 643]]) {
  const tok = await login(u.username, 'probe123')
  const l = (await req('/telegram/link', 'POST', {}, tok)).data
  await hook({ message: { chat: { id: chat }, text: `/start ${l.code}` } })
}

const mk = (over) => req('/content', 'POST', {
  channels: [chKey], type: 'video', status_id: shotId, ...over,
}).then((r) => r.data)

// ---- what each person is carrying ----
await mk({ title: 'x64 shoot today', assignee_ids: [behind.id], recording_date: today })
await mk({ title: 'x64 release tomorrow', assignee_ids: [behind.id], release_date: day(1) })
await mk({ title: 'x64 release in a week', assignee_ids: [behind.id], release_date: day(7) })
await mk({ title: 'x64 release three days ago', assignee_ids: [behind.id], release_date: day(-3) })
await mk({ title: 'x64 cut due yesterday', editor_id: behind.id, edit_ready_date: day(-1) })
// Work that is over, and work that was killed, is not late — it is finished.
// done_at is DERIVED from the stage (a move into the final one stamps it), so
// this marks it done the way a person does, rather than posting the column.
const finalId = (await req('/statuses')).data.find((s) => s.is_final)?.id
const doneOne = await mk({ title: 'x64 done but overdue', assignee_ids: [behind.id], release_date: day(-4) })
// Reaching the final stage now records WHERE it went — publishing without
// saying where is refused, so the fixture publishes the way a person does.
await req(`/content/${doneOne.id}`, 'PATCH', { status_id: finalId, post_link: 'https://instagram.com/p/x64done' })
ok('the fixture really is finished', !!(await req(`/content/${doneOne.id}`)).data.done_at,
  String((await req(`/content/${doneOne.id}`)).data.done_at))
const deadStatus = (await req('/statuses')).data.find((s) => /^deleted$/i.test(s.label))
if (deadStatus) await mk({ title: 'x64 killed and overdue', assignee_ids: [behind.id], release_date: day(-5), status_id: deadStatus.id })

await mk({ title: 'x64 clear tomorrow', assignee_ids: [clear.id], release_date: day(1) })

for (let i = 1; i <= 8; i++) {
  await mk({ title: `x64 buried ${i}`, assignee_ids: [buried.id], release_date: day(-i) })
}

// The nightly tick sends NO digest. It used to: every linked member's phone
// rang at midnight with their deadlines whether or not anything had changed,
// and the team asked for it to stop — a board that speaks every day is a board
// people mute. The planned-update notice (Admin → Settings) took its place.
// The tick itself still runs, for the admin's own schedules and the auto-flag;
// nothing about deadlines leaves it, and the answer no longer carries a
// `reminded` count at all, so a client reading one is reading an old build.
await reset()
const cron = await req('/cron/daily')
ok('the nightly tick runs, and carries no digest count', cron.status === 200 && cron.data.reminded === undefined, JSON.stringify(cron.data))
const msgs = await sentList()
const to = (chat) => msgs.filter((m) => String(m.chat_id) === String(chat) && m.method === 'sendMessage').map((m) => m.text).join('\n---\n')
// The auto-flag may still speak — one nudge about ONE piece that has gone
// silently late, once ever. That is an event, not a digest: no headings, no
// list of the week, no cheerful line.
const DIGEST = /Your deadlines|heads-up on your deadlines|has slipped|Nothing is late|<b>Today<\/b>|<b>Tomorrow<\/b>|<b>In a week<\/b>|<b>Late<\/b>/i
ok('the person who is behind gets no digest', !DIGEST.test(to(641)), to(641).slice(0, 160))
ok('the person who is clear hears nothing at all', !to(642), to(642).slice(0, 120))
ok('the one who is buried gets no digest either', !DIGEST.test(to(643)), to(643).slice(0, 160))
ok('nothing in the outbox is a digest', !msgs.some((m) => DIGEST.test(m.text || '')))

stop()
console.log(fails === 0 ? '\nRound-64 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
