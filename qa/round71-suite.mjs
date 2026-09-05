// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 71: late work chases the person carrying it.
//
// Fifty overdue pieces had piled into one strip above an admin's calendar,
// going back a month, to be dragged back onto days one at a time by somebody
// who did not know why any of them had slipped. That is the wrong person
// doing the wrong job, and every one of those fifty had a reason nobody ever
// wrote down.
//
// So each person is asked about THEIR OWN late work, with the three answers
// that exist: a new day (which, for a promised one, means asking), what is in
// the way, or finishing it. A piece somebody has spoken for stops asking.
//
// AND SILENCE RAISES ITS OWN HAND. Work days past its day with no ask in
// flight and nothing said is invisible to everybody but the strip nobody
// reads, so the nightly tick raises a hand for it — once per piece, because a
// queue that refills itself every night is one people stop looking at.
// Self-contained: 4110.
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4110'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
boot([ROOT + '/server/index.js'], { DATA_DIR: SP + 'r71-' + Date.now(), PORT: '4110' })
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(B + '/health')).ok) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500))
}

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (n) => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) } // Tashkent day, like the server
const ch = (await req('/channels')).data[0].key
const stages = (await req('/statuses')).data
const sid = (re) => stages.find((s) => re.test(s.label)).id

const op = (await req('/users', 'POST', {
  name: 'R71 Olim', username: 'r71op', password: 'probe123', role: 'operator', departments: [ch],
})).data
const ed = (await req('/users', 'POST', {
  name: 'R71 Eldor', username: 'r71ed', password: 'probe123', role: 'editor', departments: [ch],
})).data
const opT = await login('r71op', 'probe123')
const edT = await login('r71ed', 'probe123')

const mk = (over) => req('/content', 'POST', {
  channels: [ch], type: 'reel', status_id: sid(/to shoot/i), operator_id: op.id, editor_id: ed.id,
  reference_links: ['https://example.com/reference'], ...over,
})
// One piece: the shoot is six days gone, the cut two. Two different people
// are late on the SAME task, for different reasons, which is the case the old
// strip could not express at all.
const t = (await mk({
  title: 'r71 the slipped piece',
  recording_date: day(-6), edit_ready_date: day(-2), release_date: day(5),
})).data
ok('a piece exists with two phases past their day', !!t.id, JSON.stringify(t.error || ''))

// ===================== everybody sees only their own =====================
let mine = await req('/content/late/mine', 'GET', null, opT)
ok('the operator is asked about the shoot', mine.data.length === 1 && mine.data[0].phase === 'shoot',
  JSON.stringify(mine.data.map((r) => r.phase)))
ok('…with how late it is, so it can be sorted oldest-first', mine.data[0].days_late === 6,
  String(mine.data[0].days_late))
mine = await req('/content/late/mine', 'GET', null, edT)
ok('the editor is asked about the cut, not the shoot', mine.data.length === 1 && mine.data[0].phase === 'edit',
  JSON.stringify(mine.data.map((r) => r.phase)))
ok('…and is told which day it was', mine.data[0].due === day(-2), String(mine.data[0].due))

// The admin holds no hat on it, and is not asked about somebody else's work.
mine = await req('/content/late/mine')
ok('nobody is handed another person’s late work', !mine.data.some((r) => r.content_id === t.id && r.phase !== 'release'),
  JSON.stringify(mine.data.map((r) => `${r.phase}`)))

// ===================== answering makes it stop asking =====================
let r = await req(`/content/${t.id}/flags`, 'POST',
  { kind: 'at_risk', reason: 'My other shoot overran and I need one more day' }, opT)
ok('the operator says what is in the way', r.status === 201, `${r.status} ${r.data.error || ''}`)
mine = await req('/content/late/mine', 'GET', null, opT)
ok('…and the row stops asking them', mine.data[0]?.flagged === true, JSON.stringify(mine.data[0]))
ok('…while still being listed, because it is still late', mine.data.length === 1, String(mine.data.length))

// Asking for a new day is the other answer, and it goes through the same
// machinery an admin already answers — nothing new to learn.
const smm = (await req('/users', 'POST', {
  name: 'R71 Sami', username: 'r71smm', password: 'probe123', role: 'member', departments: [ch],
  permissions: { manage_content: true, move_tasks: true },
})).data
const smmT = await login('r71smm', 'probe123')
r = await req(`/content/${t.id}/date-requests`, 'POST',
  { field: 'edit_ready_date', to_date: day(2), reason: 'The colour pass took two days longer than planned' }, smmT)
ok('a new day can be asked for on a late deadline', r.status === 201, `${r.status} ${r.data.error || ''}`)
mine = await req('/content/late/mine', 'GET', null, edT)
ok('…and the editor’s row shows it is already asked', mine.data[0]?.asked === true, JSON.stringify(mine.data[0]))

// ===================== silence raises its own hand =====================
// A second piece nobody says anything about.
const quiet = (await mk({
  title: 'r71 the quiet one', recording_date: day(-9), edit_ready_date: day(-8), release_date: day(-7),
})).data
let cron = await req('/cron/daily')
ok('the nightly tick raises a hand for work nobody has spoken about', cron.data.flagged >= 1,
  JSON.stringify(cron.data))
let hands = await req('/content/flags/open')
const auto = hands.data.find((f) => f.content_id === quiet.id)
ok('…and it lands on the planners’ queue', !!auto, JSON.stringify(hands.data.map((f) => f.title)))
ok('…saying how late it is and that nothing was said',
  /days past it/.test(auto?.reason || '') && /nothing said/.test(auto?.reason || ''), auto?.reason)
ok('…in the board’s name, not somebody else’s', auto?.raised_name === 'The board', String(auto?.raised_name))

// The piece somebody DID speak for is left alone — it is already answered.
ok('work already spoken for is not flagged over the top',
  hands.data.filter((f) => f.content_id === t.id).length === 1,
  JSON.stringify(hands.data.filter((f) => f.content_id === t.id).map((f) => f.raised_name)))

// And it never does it twice, however long the piece stays late.
cron = await req('/cron/daily')
ok('a second night raises nothing new', cron.data.flagged === 0, JSON.stringify(cron.data))
hands = await req('/content/flags/open')
ok('…so the queue does not refill itself', hands.data.filter((f) => f.content_id === quiet.id).length === 1,
  String(hands.data.filter((f) => f.content_id === quiet.id).length))

// Putting the hand down and letting it go quiet again does not restart the
// nagging either — one hand per piece is one hand per piece.
await req(`/content/flags/${auto.id}/clear`, 'POST', {})
cron = await req('/cron/daily')
ok('clearing the hand does not invite another', cron.data.flagged === 0, JSON.stringify(cron.data))

// ===================== finished work is not late =====================
const done = (await mk({ title: 'r71 already out', recording_date: day(-9), edit_ready_date: day(-8), release_date: day(-7) })).data
await req(`/content/${done.id}`, 'PATCH', { done: true, post_link: 'https://instagram.com/p/qa' })
mine = await req('/content/late/mine', 'GET', null, opT)
ok('work that is finished is nobody’s late work', !mine.data.some((x) => x.content_id === done.id),
  JSON.stringify(mine.data.map((x) => x.title)))

// Neither is work that was killed.
const deadStage = stages.find((s) => /^deleted$/i.test(s.label))
if (deadStage) {
  const killed = (await mk({ title: 'r71 killed', recording_date: day(-9), edit_ready_date: day(-8), release_date: day(-7) })).data
  await req(`/content/${killed.id}`, 'PATCH', { status_id: deadStage.id })
  mine = await req('/content/late/mine', 'GET', null, opT)
  ok('…nor is work that was killed', !mine.data.some((x) => x.content_id === killed.id),
    JSON.stringify(mine.data.map((x) => x.title)))
}

// Work whose phase has already been handed on is not late in that phase —
// a shoot that happened is not still an overdue shoot.
const handed = (await mk({ title: 'r71 shot, cut still due', recording_date: day(-5), edit_ready_date: day(-1), release_date: day(6) })).data
await req(`/content/${handed.id}`, 'PATCH', { milestone: 'shot' }, opT)
mine = await req('/content/late/mine', 'GET', null, opT)
ok('a shoot that has happened is not an overdue shoot',
  !mine.data.some((x) => x.content_id === handed.id && x.phase === 'shoot'),
  JSON.stringify(mine.data.map((x) => `${x.title}:${x.phase}`)))
mine = await req('/content/late/mine', 'GET', null, edT)
ok('…but the cut it was handed to still is', mine.data.some((x) => x.content_id === handed.id && x.phase === 'edit'),
  JSON.stringify(mine.data.map((x) => `${x.title}:${x.phase}`)))

stop()
console.log(fails === 0 ? '\nRound-71 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
