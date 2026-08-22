// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 72: work that is DONE is not late, however long ago its day was.
//
// The digest went out saying
//
//     • «Bahrom student result» — the shoot, 19 days late
//     • «Bahrom student result» — the cut, 17 days late
//
// about a piece that had been filmed, cut, and was sitting in review with the
// cut attached. Both dates were in the past and nothing anywhere asked whether
// the work they belonged to had actually happened.
//
// Every part of the board answered "is this phase behind us?" differently, and
// two of them answered it with a timestamp that does not mean what it looks
// like: shot_at is stamped when footage reaches the EDITOR, so a card sitting
// on Shot — filmed, nothing handed over yet — has none. Rows older than the
// stamping have none at all, whatever happened to them.
//
// So it is one function now, in deadlines.js, and it takes the STAGE as well:
// a card that has reached Shot has finished its shoot whatever its timestamps
// say. Either signal is enough; they can only disagree by one being absent.
// Self-contained: 4111 + mock 9973.
import { spawn } from 'child_process'
import { createHash } from 'crypto'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4111'
const B = BASE + '/api'
const MOCK = 'http://localhost:9973'
const TOKEN = 'x72-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
boot([SP + 'mock-tg.mjs'], { MOCK_PORT: '9973' })
boot([ROOT + '/server/index.js'], {
  DATA_DIR: SP + 'r72-' + Date.now(), PORT: '4111',
  TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: MOCK,
})
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('mock + stack are up', (await up(MOCK + '/__sent')) && (await up(B + '/health')))

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const sentTo = async (chat) => (await (await fetch(MOCK + '/__sent')).json())
  .filter((m) => String(m.chat_id) === String(chat) && m.method === 'sendMessage')
  .map((m) => m.text).join('\n')
const reset = () => fetch(MOCK + '/__reset', { method: 'POST' })
const hook = (update) => fetch(B + '/telegram/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
  body: JSON.stringify(update),
})
const day = (n) => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) } // Tashkent day, like the server
const ch = (await req('/channels')).data[0].key
const stages = (await req('/statuses')).data
const sid = (re) => stages.find((s) => re.test(s.label)).id

const mkUser = async (name, username, role) => (await req('/users', 'POST', {
  name, username, password: 'probe123', role, departments: [ch],
})).data
const op = await mkUser('R72 Olim', 'r72op', 'operator')
const ed = await mkUser('R72 Eldor', 'r72ed', 'editor')
const opT = await login('r72op', 'probe123')
const edT = await login('r72ed', 'probe123')
for (const [u, tok, chat] of [[op, opT, 7201], [ed, edT, 7202]]) {
  const l = (await req('/telegram/link', 'POST', {}, tok)).data
  await hook({ message: { chat: { id: chat }, text: `/start ${l.code}` } })
}

const mk = (over) => req('/content', 'POST', {
  channels: [ch], type: 'reel', status_id: sid(/to shoot/i), operator_id: op.id, editor_id: ed.id,
  reference_links: ['https://example.com/reference'], ...over,
})

// ===================== the piece from the report =====================
// Filmed, cut, sitting in review — and both its days long gone.
const done = (await mk({
  title: 'r72 Bahrom student result',
  recording_date: day(-19), edit_ready_date: day(-17), release_date: day(3),
})).data
await req(`/content/${done.id}`, 'PATCH', { milestone: 'shot' }, opT)
await req(`/content/${done.id}`, 'PATCH',
  { milestone: 'edited', ready_link: 'https://drive.google.com/the-cut' }, edT)
const full = (await req(`/content/${done.id}`)).data
ok('the piece really is filmed and cut', !!full.shot_at && !!full.edited_at,
  JSON.stringify({ shot_at: full.shot_at, edited_at: full.edited_at }))
ok('…and sitting in review', full.status_id === sid(/^ready$/i))


// The same question, asked the other three ways the board asks it.
ok('the operator’s own list does not carry it',
  !(await req('/content/late/mine', 'GET', null, opT)).data.some((r) => r.content_id === done.id),
  JSON.stringify((await req('/content/late/mine', 'GET', null, opT)).data.map((r) => r.title)))
ok('the editor’s own list does not carry it',
  !(await req('/content/late/mine', 'GET', null, edT)).data.some((r) => r.content_id === done.id))
// The RECORD is a different question from the NAG, and both have to keep
// their own answer. This piece was delivered nineteen days after the day it
// promised — that is a true thing about the past, and the Missed page exists
// to say it. What was wrong was being chased for it as though it were still
// owed. So the warning stands, and it stands as DELIVERED.
const warn = await req('/warnings/me', 'GET', null, opT)
const mine = (warn.data.warnings || []).find((w) => w.content_id === done.id)
ok('the record still says the shoot came in late, because it did', !!mine, JSON.stringify(warn.data.warnings || []))
ok('…and says when it actually landed, so it reads as history not homework',
  !!mine?.delivered && mine?.open === false, JSON.stringify({ delivered: mine?.delivered, open: mine?.open }))

// ===================== a card parked on Shot =====================
// The case the timestamp cannot answer: filmed, sitting on Shot, nothing
// handed over — so shot_at is still null and the day has gone by.
const parked = (await mk({
  title: 'r72 filmed and parked', recording_date: day(-8), edit_ready_date: day(4), release_date: day(9),
})).data
await req(`/content/${parked.id}`, 'PATCH', { status_id: sid(/^shot$/i) })
const p2 = (await req(`/content/${parked.id}`)).data
ok('it sits on Shot with nothing handed over', p2.status_id === sid(/^shot$/i) && !p2.shot_at,
  JSON.stringify({ status: p2.status_id, shot_at: p2.shot_at }))
ok('…and its shoot is not late, because the filming happened',
  !(await req('/content/late/mine', 'GET', null, opT)).data.some((r) => r.content_id === parked.id && r.phase === 'shoot'),
  JSON.stringify((await req('/content/late/mine', 'GET', null, opT)).data.map((r) => `${r.title}:${r.phase}`)))

// ===================== work that really IS late still is =====================
// The whole point is that this keeps working — a fix that silences everything
// is not a fix, it is a mute button.
const truly = (await mk({
  title: 'r72 genuinely overdue', recording_date: day(-5), edit_ready_date: day(-3), release_date: day(6),
})).data
ok('a shoot that has NOT happened is still late',
  (await req('/content/late/mine', 'GET', null, opT)).data.some((r) => r.content_id === truly.id && r.phase === 'shoot'),
  JSON.stringify((await req('/content/late/mine', 'GET', null, opT)).data.map((r) => `${r.title}:${r.phase}`)))
ok('…and a cut that has not been delivered is too',
  (await req('/content/late/mine', 'GET', null, edT)).data.some((r) => r.content_id === truly.id && r.phase === 'edit'))

// Published work is not late either, whatever its dates said.
const out = (await mk({
  title: 'r72 already published', recording_date: day(-12), edit_ready_date: day(-10), release_date: day(-9),
})).data
await req(`/content/${out.id}`, 'PATCH', { milestone: 'shot' }, opT)
await req(`/content/${out.id}`, 'PATCH', { milestone: 'edited', ready_link: 'https://drive.google.com/out' }, edT)
await req(`/content/${out.id}`, 'PATCH', { status_id: sid(/published/i) })

// ===================== ONE morning, one digest =====================
// The digest claims its day the first time it runs, so it is asked once, with
// every fixture already in place — which is also how it actually goes out.
await reset()
await req('/cron/daily')
const toOp = await sentTo(7201)
const toEd = await sentTo(7202)
ok('the shoot is not called late on a piece that was filmed',
  !/Bahrom student result».*the shoot,.*late/.test(toOp), toOp)
ok('the cut is not called late on a piece that was cut',
  !/Bahrom student result».*the cut,.*late/.test(toEd), toEd)
ok('a piece parked on Shot is not an overdue shoot either',
  !/filmed and parked».*late/.test(toOp), toOp)
ok('published work is nobody’s overdue work', !/already published/.test(toEd), toEd)
// And the part that must keep working: a fix that silences everything is a
// mute button, not a fix.
ok('work that really IS late is still named', /genuinely overdue».*the shoot, 5 days late/.test(toOp), toOp)
ok('…under a heading that says work has slipped', /has slipped/.test(toOp), toOp.split('\n')[0])

stop()
console.log(fails === 0 ? '\nRound-72 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
