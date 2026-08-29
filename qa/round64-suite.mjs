// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 64: the morning digest stops lying about late work.
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
await req(`/content/${doneOne.id}`, 'PATCH', { status_id: finalId })
ok('the fixture really is finished', !!(await req(`/content/${doneOne.id}`)).data.done_at,
  String((await req(`/content/${doneOne.id}`)).data.done_at))
const deadStatus = (await req('/statuses')).data.find((s) => /^deleted$/i.test(s.label))
if (deadStatus) await mk({ title: 'x64 killed and overdue', assignee_ids: [behind.id], release_date: day(-5), status_id: deadStatus.id })

await mk({ title: 'x64 clear tomorrow', assignee_ids: [clear.id], release_date: day(1) })

for (let i = 1; i <= 8; i++) {
  await mk({ title: `x64 buried ${i}`, assignee_ids: [buried.id], release_date: day(-i) })
}

// ---- the morning tick ----
await reset()
const cron = await req('/cron/daily')
ok('the nightly tick runs and reports who it reminded', cron.status === 200 && cron.data.reminded >= 3,
  JSON.stringify(cron.data))

const msgs = await sentList()
const to = (chat) => msgs.filter((m) => String(m.chat_id) === String(chat) && m.method === 'sendMessage')
  .map((m) => m.text).join('\n---\n')
const A = to(641), C = to(642), Z = to(643)
ok('everybody with something on carries a message', !!A && !!C && !!Z,
  `behind=${A.length} clear=${C.length} buried=${Z.length}`)

// ================= the person who is behind =================
ok('the digest names what is LATE', /<b>Late<\/b>/.test(A), A.slice(0, 400))
ok('…the release three days gone is named, with its age',
  /x64 release three days ago».{0,40}3 days late/.test(A), A)
ok('…a single day reads as “a day”, not “1 days”',
  /x64 cut due yesterday».{0,30}a day late/.test(A), A)
ok('…and the late lines say which hat it was',
  /x64 cut due yesterday» — the cut/.test(A), A)
ok('the oldest thing comes first', A.indexOf('three days ago') < A.indexOf('cut due yesterday'), 'order')

// The line this round exists for.
ok('it NO LONGER claims nothing is late while something is', !/Nothing is late/.test(A), A)
ok('…and the heading says work has slipped', /has slipped/.test(A), A.split('\n')[0])

// TODAY, which was never mentioned at all.
ok('work due TODAY is in the digest', /<b>Today<\/b>/.test(A) && /x64 shoot today»/.test(A), A)
ok('…still alongside tomorrow and the week out',
  /<b>Tomorrow<\/b>/.test(A) && /x64 release tomorrow»/.test(A)
  && /<b>In a week<\/b>/.test(A) && /x64 release in a week»/.test(A), A)

// Finished and killed work is not late.
ok('work already done is not called late', !/x64 done but overdue/.test(A), A)
ok('killed work is not called late', !/x64 killed and overdue/.test(A), A)

// ================= the person who is clear =================
ok('somebody with nothing overdue gets no Late section', !/<b>Late<\/b>/.test(C), C)
ok('…and DOES get the cheerful line, because now it is true', /Nothing is late/.test(C), C)
ok('…their own work is the only work they hear about',
  /x64 clear tomorrow»/.test(C) && !/x64 release three days ago/.test(C), C)

// ================= the person who is buried =================
// Count the late ROWS, not every occurrence of the word: the sign-off
// contains "late" too, so a looser count answers a different question.
const lateRows = (Z.match(/^• .*(a day|\d+ days) late/gm) || []).length
ok('a long list of late work is capped, not dumped whole', lateRows === 6, `${lateRows} rows`)
ok('…and the remainder is counted rather than dropped', /…and 2 more/.test(Z), Z)
// Both of these are inside the cap; 'buried 1' and 'buried 2' are the two the
// count stands in for, so they are deliberately absent.
ok('…starting from the oldest', Z.indexOf('x64 buried 8') < Z.indexOf('x64 buried 3'), 'order')
ok('…and the newest late ones are the ones summarised away',
  !/x64 buried 1»/.test(Z) && !/x64 buried 2»/.test(Z), Z)

// ---- the message is still valid Telegram HTML ----
ok('nothing was rejected by the API', !msgs.some((m) => m.rejected), JSON.stringify(msgs.filter((m) => m.rejected).slice(0, 2)))

// ---- and it stays a once-a-day thing ----
await reset()
await req('/cron/daily')
ok('a second tick on the same day sends nothing again', (await sentList()).length === 0,
  JSON.stringify((await sentList()).slice(0, 2)))

stop()
console.log(fails === 0 ? '\nRound-64 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
