// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 67: a promised day moves on a reason, or it does not move.
//
// Round 65 locked promised days to admins, which was right and left everyone
// else at a dead end: "only an admin can move it" is true and useless — it
// does not tell you how to reach one, and the reason a day slipped ended up
// in a Telegram thread nobody can find a fortnight later.
//
// So a locked day is now ASKED for, in writing. Which day, to which day, and
// why. The ask goes to every admin, the day does not move until one of them
// says yes, and the whole exchange stays on the task — which is the only copy
// of "why did this slip" that is still there when somebody needs it.
//
// A reason has to BE one. "—" in that box would leave the record saying a day
// moved for no reason, which is worse than no record at all.
//
// And the answer has to still be about the question: if the day moves while
// the ask is waiting, approving would apply an answer to a question nobody
// asked, so it is refused and the asker asks again against what the task says
// now.
// Self-contained: 4106.
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4106'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
boot([ROOT + '/server/index.js'], { DATA_DIR: SP + 'r67-' + Date.now(), PORT: '4106' })
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
const shootId = (await req('/statuses')).data.find((s) => /to shoot/i.test(s.label)).id
const shooter = (await req('/users', 'POST', {
  name: 'R67 Shooter', username: 'r67op', password: 'probe123', role: 'operator', departments: [ch],
})).data
// Somebody who may move tasks and dates but is not an admin — the person the
// whole round is for.
const smm = (await req('/users', 'POST', {
  name: 'R67 SMM', username: 'r67smm', password: 'probe123', role: 'member', departments: [ch],
  permissions: { manage_content: true, move_tasks: true },
})).data
const smmT = await login('r67smm', 'probe123')
// A second admin, so "every admin hears it" is a claim with more than one name
// behind it.
const admin2 = (await req('/users', 'POST', {
  name: 'R67 Second Admin', username: 'r67adm', password: 'probe123', role: 'admin', departments: [ch],
})).data
const adm2T = await login('r67adm', 'probe123')

const booked = {
  operator_id: shooter.id, status_id: shootId,
  recording_date: day(1), edit_ready_date: day(3), release_date: day(5),
  reference_links: ['https://example.com/reference'],
}
const mk = (over) => req('/content', 'POST', { channels: [ch], ...over })
const task = (await mk({ title: 'r67 the promised piece', type: 'video', ...booked })).data
ok('a booked piece exists', !!task.id, JSON.stringify(task.error || ''))

// ===================== the refusal points somewhere =====================
let r = await req(`/content/${task.id}`, 'PATCH', { release_date: day(9) }, smmT)
ok('a promised day still cannot be moved by whoever fancies it', r.status === 403, String(r.status))
ok('…and the refusal now carries the ask, not just a no',
  r.data.ask_to_move?.field === 'release_date' && r.data.ask_to_move?.from === day(5) && r.data.ask_to_move?.to === day(9),
  JSON.stringify(r.data.ask_to_move))

// ===================== a reason has to be one =====================
for (const junk of ['', '.', 'N/A', 'нет', 'no']) {
  const rr = await req(`/content/${task.id}/date-requests`, 'POST',
    { field: 'release_date', to_date: day(9), reason: junk }, smmT)
  ok(`a reason of “${junk || '(nothing)'}” is refused`, rr.status === 400, `${rr.status} ${rr.data.error || ''}`)
}
// Three words is the bar: enough to be a sentence, not enough to be a chore.
r = await req(`/content/${task.id}/date-requests`, 'POST',
  { field: 'release_date', to_date: day(9), reason: 'rain' }, smmT)
ok('…and so is a single real word — that is a note, not an explanation', r.status === 400, String(r.status))

r = await req(`/content/${task.id}/date-requests`, 'POST',
  { field: 'release_date', to_date: day(9), reason: 'The location cancelled on us this morning' }, smmT)
ok('an actual explanation is accepted', r.status === 201, `${r.status} ${r.data.error || ''}`)
const ask = r.data
ok('…and it records the day it is asking to leave behind', ask.from_date === day(5), String(ask.from_date))

// The day has NOT moved. That is the whole point of asking.
ok('the day does not move on the asking', (await req(`/content/${task.id}`)).data.release_date === day(5))

// ===================== every admin hears it =====================
const bell = async (tok) => ((await req('/notifications', 'GET', null, tok)).data.events || [])
for (const [who, tok] of [['the admin who owns the board', T], ['a second admin', adm2T]]) {
  const list = await bell(tok)
  ok(`${who} is told about the ask`, list.some((n) => /asks to move/i.test(n.text || '')),
    JSON.stringify(list.slice(0, 2).map((n) => n.text)))
}

// ===================== one conversation at a time =====================
r = await req(`/content/${task.id}/date-requests`, 'POST',
  { field: 'release_date', to_date: day(11), reason: 'Asking again about the very same day' }, smmT)
ok('a second ask on the same day is the same conversation, not a new one', r.status === 409,
  `${r.status} ${r.data.error || ''}`)
// A DIFFERENT deadline is a different conversation, though.
r = await req(`/content/${task.id}/date-requests`, 'POST',
  { field: 'recording_date', to_date: day(2), reason: 'The crew is on another shoot that morning' }, smmT)
ok('…but another deadline is', r.status === 201, `${r.status} ${r.data.error || ''}`)
const shootAsk = r.data

// ===================== only an admin answers =====================
r = await req(`/content/date-requests/${ask.id}/decide`, 'POST', { approve: true }, smmT)
ok('the asker cannot wave their own ask through', r.status === 403, `${r.status} ${r.data.error || ''}`)
ok('…and the day is still where it was', (await req(`/content/${task.id}`)).data.release_date === day(5))

// A no leaves the day exactly where it was, and says why.
r = await req(`/content/date-requests/${shootAsk.id}/decide`, 'POST',
  { approve: false, note: 'The crew can shoot in the afternoon instead' }, T)
ok('an admin can say no', r.status === 200, `${r.status} ${r.data.error || ''}`)
ok('…and the day did not move', (await req(`/content/${task.id}`)).data.recording_date === day(1))
ok('…and the refusal keeps its reason on the task',
  /afternoon/.test((await req(`/content/${task.id}`)).data.date_requests?.find((x) => x.id === shootAsk.id)?.decided_note || ''),
  JSON.stringify((await req(`/content/${task.id}`)).data.date_requests?.[0]))

// A yes moves it — and only then.
r = await req(`/content/date-requests/${ask.id}/decide`, 'POST', { approve: true }, adm2T)
ok('any admin can say yes, not only the one who set it', r.status === 200, `${r.status} ${r.data.error || ''}`)
ok('…and THAT is when the day moves', (await req(`/content/${task.id}`)).data.release_date === day(9))
ok('…the asker is told', (await bell(smmT)).some((n) => /as you asked/i.test(n.text || '')),
  JSON.stringify((await bell(smmT)).slice(0, 2).map((n) => n.text)))

// An answered ask is answered.
r = await req(`/content/date-requests/${ask.id}/decide`, 'POST', { approve: false }, T)
ok('an answered ask is not answered twice', r.status === 409, `${r.status} ${r.data.error || ''}`)

// ===================== the answer stays about the question ==============
// The admin moved the day directly while an ask sat waiting on it. Approving
// now would apply an answer to a question nobody asked.
r = await req(`/content/${task.id}/date-requests`, 'POST',
  { field: 'edit_ready_date', to_date: day(8), reason: 'The editor is away that whole week' }, smmT)
const stale = r.data
ok('an ask is waiting on the cut deadline', r.status === 201, String(r.status))
await req(`/content/${task.id}`, 'PATCH', { edit_ready_date: day(6) })   // admin moves it themselves
r = await req(`/content/date-requests/${stale.id}/decide`, 'POST', { approve: true }, T)
ok('approving an ask the task has moved past is refused', r.status === 409, `${r.status} ${r.data.error || ''}`)
ok('…and the day the admin actually set is the one that stands',
  (await req(`/content/${task.id}`)).data.edit_ready_date === day(6))
r = await req(`/content/${task.id}/date-requests`, 'POST',
  { field: 'edit_ready_date', to_date: day(8), reason: 'Asking again against the day it has now' }, smmT)
ok('…and the asker may ask again, the stale one no longer being open', r.status === 201,
  `${r.status} ${r.data.error || ''}`)

// ===================== what is not a promise =====================
// An EMPTY day is not a promise — it is made by filling it in, and asking to
// move something nobody promised would be a strange thing to be told to do.
const fresh = (await mk({ title: 'r67 a post with no days', type: 'post' })).data
r = await req(`/content/${fresh.id}`, 'PATCH', { release_date: day(4) }, smmT)
ok('filling an empty day needs no permission from anyone', r.status === 200, `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${fresh.id}/date-requests`, 'POST',
  { field: 'design_ready_date', to_date: day(7), reason: 'This day was never promised at all' }, smmT)
ok('asking to move a day that was never set is refused as nonsense', r.status === 400,
  `${r.status} ${r.data.error || ''}`)

// An admin never has to ask themselves.
r = await req(`/content/${fresh.id}`, 'PATCH', { release_date: day(6) })
ok('an admin still simply moves it', r.status === 200, `${r.status} ${r.data.error || ''}`)

stop()
console.log(fails === 0 ? '\nRound-67 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
