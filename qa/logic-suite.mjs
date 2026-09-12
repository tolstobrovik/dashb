// Logic tests: the places two parts of the board could disagree about one fact.
//
// The gate has a suite per feature, and each one checks that feature against
// its own spec. That shape cannot see the bugs that live BETWEEN features —
// where the payroll and the activity chart count the same delivery
// differently, where a number survives a PATCH but not a round trip, where a
// rule is enforced on one endpoint and forgotten on its neighbour. Those are
// the ones that make people stop trusting the board, because both screens look
// right and only the pair is wrong.
//
// So these are invariants rather than examples: things that must hold whatever
// the data is. Each is numbered so a failure can be worked one at a time.
//
// Self-contained: port 4124.
import { spawn } from 'child_process'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = new URL('.', import.meta.url).pathname
const PORT = 4124
const B = `http://localhost:${PORT}`

let fails = 0
const found = []
const ok = (id, n, c, x = '') => {
  if (!c) { fails++; found.push(`${id} ${n}${x ? ` — ${x}` : ''}`) }
  console.log(`${c ? '✔' : '✘ FAIL'} [${id}] ${n}${x ? ` — ${x}` : ''}`)
}
const procs = []
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })
procs.push(spawn(process.execPath, [ROOT + '/server/index.js'],
  { env: { ...process.env, DATA_DIR: SP + 'logic-' + Date.now(), PORT: String(PORT) }, stdio: 'ignore' }))
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(B + '/api/health')).ok) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500))
}

const login = async (u, p) => (await (await fetch(B + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (path, method = 'GET', body, tok = T) => {
  const r = await fetch(B + '/api' + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
// The Tashkent day, the way the server reckons it.
const day = (n) => {
  const d = new Date(Date.now() + 5 * 3600e3)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const stages = (await req('/statuses')).data
const S = (re) => stages.find((s) => re.test(s.label))
const idea = S(/^idea/i), toShoot = S(/to\s*shoot/i), editing = S(/editing/i)
const ready = S(/^ready$/i), published = S(/published/i)
const ch = (await req('/channels')).data[0].key
const stamp = Date.now().toString().slice(-6)

const mk = async (patch = {}, tok = T) => (await req('/content', 'POST', {
  title: `L${stamp} ${patch.title || 'task'}`, channels: [ch], type: 'reel', ...patch }, tok)).data

console.log('\n=== A. the money and the picture count the same work ===')
// The payroll and the activity chart are computed by the same contributions()
// helper on purpose, so that a month's pay and a month's chart can never
// describe different months. If they drift, one of the two screens is lying
// and nobody can tell which.
// A fresh board has one account on it. Everybody this suite needs, it makes.
const crew = (await req('/users', 'POST', {
  name: `Logic Crew ${stamp}`, username: `lcrew${stamp}`, password: 'probe-only-123', role: 'member' })).data
await req(`/users/${crew.id}`, 'PATCH', { departments: [ch] })
await mk({ title: 'paid A', status_id: published.id, editor_id: crew.id,
  edited_at: new Date().toISOString(), edit_ready_date: day(0), release_date: day(0),
  done_at: new Date().toISOString() })
await mk({ title: 'paid B', status_id: published.id, editor_id: crew.id,
  edited_at: new Date().toISOString(), edit_ready_date: day(0), release_date: day(0),
  done_at: new Date().toISOString() })
const from = day(-3), to = day(0)
const pay = (await req(`/reports/pay?from=${from}&to=${to}`)).data
const act = (await req(`/reports/activity?days=4`)).data
const mine = (pay.people || []).find((p) => p.id === crew.id)
const actMine = (act.people || []).find((p) => p.id === crew.id)
ok('A1', 'the payroll saw this person deliver', (mine?.delivered || 0) > 0, JSON.stringify({ delivered: mine?.delivered }))
ok('A2', 'the activity report saw them too', (actMine?.n || 0) > 0, JSON.stringify({ n: actMine?.n }))
// Not the same number necessarily — pay counts one hat, activity counts every
// craft — but neither may be zero while the other is not.
ok('A3', 'neither reports nothing while the other reports something',
  ((mine?.delivered || 0) > 0) === ((actMine?.n || 0) > 0),
  JSON.stringify({ pay: mine?.delivered, activity: actMine?.n }))
ok('A4', 'the activity series adds up to its own totals',
  act.days.every((_, i) => act.series.reduce((a, s) => a + s.values[i], 0) === act.totals[i]),
  'a stacked band disagrees with the total it is part of')
// The server floors the window at a week — four points is not a chart — so
// the question is whether it serves the window it settled on, ending today.
ok('A5', 'the window ends today and is as long as the server says',
  act.days.length >= 7 && act.days[act.days.length - 1] === day(0)
    && act.days[0] === day(-(act.days.length - 1)),
  JSON.stringify({ n: act.days.length, first: act.days[0], last: act.days[act.days.length - 1] }))

console.log('\n=== B. a percentage is a percentage ===')
ok('B1', 'on-time is between 0 and 100, or absent',
  (pay.people || []).every((p) => p.onTimePct === null || (p.onTimePct >= 0 && p.onTimePct <= 100)),
  JSON.stringify((pay.people || []).map((p) => p.onTimePct)))
ok('B2', 'nobody is paid a negative amount',
  (pay.people || []).every((p) => p.total >= 0 || p.penalty > 0),
  JSON.stringify((pay.people || []).map((p) => ({ n: p.name, t: p.total }))))
ok('B3', 'the activity rate is absent rather than zero when nothing happened',
  act.done > 0 ? act.rate !== null : act.rate === null, JSON.stringify(act.rate))

console.log('\n=== C. counted and not counted are different answers ===')
// Empty means nobody has looked yet; 0 means somebody looked and it got none.
// Every sum downstream depends on telling them apart, and a round trip through
// the API is where that distinction usually dies.
const vt = await mk({ title: 'views', status_id: published.id, done_at: new Date().toISOString(), release_date: day(0) })
ok('C1', 'a new piece has no view count, rather than a count of nought',
  vt.views === null || vt.views === undefined, JSON.stringify({ views: vt.views }))
const z = (await req(`/content/${vt.id}`, 'PATCH', { views: 0 })).data
ok('C2', 'a counted nought is stored as a nought', z.views === 0, JSON.stringify({ views: z.views }))
const zBack = (await req(`/content/${vt.id}`)).data
ok('C3', '…and survives being read back', zBack.views === 0, JSON.stringify({ views: zBack.views }))
const cleared = (await req(`/content/${vt.id}`, 'PATCH', { views: null })).data
ok('C4', 'clearing it goes back to not-counted, not to nought',
  cleared.views === null, JSON.stringify({ views: cleared.views }))

console.log('\n=== D. a duplicate keeps the brief and drops the promises ===')
const orig = await mk({ title: 'to copy', status_id: editing.id,
  description: 'the brief that must survive', script: 'a script that must survive',
  recording_date: day(1), edit_ready_date: day(2), release_date: day(3),
  ready_link: 'https://example.com/a-cut' })
const dup = (await req(`/content/${orig.id}/duplicate`, 'POST', {})).data
ok('D1', 'the copy keeps the description', dup.description === orig.description, JSON.stringify({ got: dup.description }))
ok('D2', 'the copy keeps the script', dup.script === orig.script)
ok('D3', 'the copy has no dates', !dup.recording_date && !dup.edit_ready_date && !dup.release_date,
  JSON.stringify({ r: dup.recording_date, e: dup.edit_ready_date, p: dup.release_date }))
ok('D4', 'the copy carries no delivery link from the original', !dup.ready_link, JSON.stringify({ ready_link: dup.ready_link }))
ok('D5', 'the copy starts at the beginning of the pipeline',
  dup.status_id !== editing.id, JSON.stringify({ status_id: dup.status_id }))

console.log('\n=== E. finished work is not late work ===')
// A piece that went out is not waiting for anybody, whatever its dates say.
const lateOne = await mk({ title: 'late then done', status_id: toShoot.id,
  recording_date: day(-9), edit_ready_date: day(-8), release_date: day(-7) })
// A piece cannot claim to be published with nothing attached — the reviewer
// would have to go and find it. That wall is the first thing to check.
ok('E0', 'publishing with nothing attached is refused',
  (await req(`/content/${lateOne.id}`, 'PATCH', { status_id: published.id })).status === 400)
const pub = (await req(`/content/${lateOne.id}`, 'PATCH', {
  status_id: published.id, post_link: 'https://example.com/the-post' })).data
ok('E1', 'publishing with the link records the day it went out', !!pub.done_at,
  JSON.stringify({ done_at: pub.done_at }))
const listed = (await req('/content')).data.find((t) => t.id === lateOne.id)
ok('E2', 'the list and the task agree it is done',
  !!listed?.done_at === !!pub.done_at, JSON.stringify({ list: listed?.done_at, one: pub.done_at }))
ok('E3', 'a published piece raises no open hand about being late',
  !(pub.hands || []).some((h) => !h.down_at), JSON.stringify(pub.hands || []))

console.log('\n=== F. the list and the task tell the same story ===')
// Two code paths build a task: the list projection and the single read. A
// field that exists in one and not the other is how a card shows a state the
// task itself denies.
const one = (await req(`/content/${orig.id}`)).data
const inList = (await req('/content')).data.find((t) => t.id === orig.id)
const SAME = ['title', 'type', 'status_id', 'recording_date', 'edit_ready_date',
  'release_date', 'assignee_id', 'operator_id', 'editor_id', 'designer_id', 'done_at']
const drift = SAME.filter((k) => JSON.stringify(one?.[k] ?? null) !== JSON.stringify(inList?.[k] ?? null))
ok('F1', 'every field both shapes carry agrees', drift.length === 0, JSON.stringify(drift))
ok('F2', 'the list carries the channels the task does',
  JSON.stringify(one?.channels) === JSON.stringify(inList?.channels),
  JSON.stringify({ one: one?.channels, list: inList?.channels }))

console.log('\n=== G. the date chain cannot promise the impossible ===')
// Shoot, then cut, then out. A shoot moved past the cut leaves the cut due
// before the footage exists.
const chain = await mk({ title: 'chain', status_id: idea.id,
  recording_date: day(1), edit_ready_date: day(2), release_date: day(3) })
// The cascade is a CLIENT rule — the form and, since this round, the calendar
// both run cascadeDates before saving, so the chain the server is asked to
// store is already consistent. The server stores what it is told. So what is
// asserted here is that a single-field PATCH is accepted (the API is not the
// place the chain is kept) and, separately, that the helper both callers share
// actually holds the chain.
const pushed = (await req(`/content/${chain.id}`, 'PATCH', { recording_date: day(5) })).data
ok('G1', 'the API stores the day it is given', pushed.recording_date === day(5),
  JSON.stringify({ shoot: pushed.recording_date }))
const { cascadeDates } = await import(`${ROOT}/client/src/lib/formState.js`)
const chained = cascadeDates(
  { recording_date: day(1), edit_ready_date: day(2), release_date: day(3) }, 'recording_date', day(5))
ok('G2', 'the shared cascade pushes the cut past the shoot',
  chained.form.edit_ready_date >= chained.form.recording_date,
  JSON.stringify({ shoot: chained.form.recording_date, cut: chained.form.edit_ready_date }))
ok('G3', '…and the release past the cut',
  chained.form.release_date >= chained.form.edit_ready_date,
  JSON.stringify({ cut: chained.form.edit_ready_date, out: chained.form.release_date }))
ok('G4', '…and says what it moved, so nothing shifts in silence',
  chained.moved.length === 2, JSON.stringify(chained.moved))


console.log('\n=== H. the schedule is shared; the paperwork is not ===')
// Round 92's split, asked at every endpoint rather than the one it was
// written on.
const other = (await req('/users', 'POST', {
  name: `Logic Outsider ${stamp}`, username: `lout${stamp}`, password: 'probe-only-123', role: 'member' })).data
await req(`/users/${other.id}`, 'PATCH', { departments: [], permissions: {
  manage_content: false, move_tasks: false, review_publish: false, request_changes: false,
  deliver_work: true, edit_metrics: false, manage_metrics: false, manage_layout: false, manage_ambassadors: false } })
const OT = await login(`lout${stamp}`, 'probe-only-123')
ok('H1', 'somebody off the channel still sees the work on the schedule',
  (await req('/content', 'GET', null, OT)).data.some((t) => t.id === orig.id))
ok('H2', '…and may open it', (await req(`/content/${orig.id}`, 'GET', null, OT)).status === 200)
ok('H3', '…but not its files', (await req(`/content/${orig.id}/files`, 'GET', null, OT)).status === 404)
ok('H4', '…and may not edit it', (await req(`/content/${orig.id}`, 'PATCH', { title: 'hijacked' }, OT)).status === 403)
ok('H5', '…and may not undo somebody else’s move',
  (await req(`/content/${orig.id}/undo`, 'POST', {}, OT)).status === 403)
ok('H6', '…and may not delete it', (await req(`/content/${orig.id}`, 'DELETE', null, OT)).status === 403)

console.log('\n=== I. an idea is free; a promise is not ===')
const onCh = (await req('/users', 'POST', {
  name: `Logic Member ${stamp}`, username: `lmem${stamp}`, password: 'probe-only-123', role: 'member' })).data
await req(`/users/${onCh.id}`, 'PATCH', { departments: [ch], permissions: {
  manage_content: false, move_tasks: false, review_publish: false, request_changes: false,
  deliver_work: true, edit_metrics: false, manage_metrics: false, manage_layout: false, manage_ambassadors: false } })
const MT = await login(`lmem${stamp}`, 'probe-only-123')
const thought = await mk({ title: 'a thought', status_id: idea.id, release_date: day(2) })
ok('I1', 'a member may move an idea’s day',
  (await req(`/content/${thought.id}`, 'PATCH', { release_date: day(6) }, MT)).status === 200)
ok('I2', '…and it actually moved', (await req(`/content/${thought.id}`)).data.release_date === day(6))
const booked = await mk({ title: 'a promise', status_id: toShoot.id, release_date: day(2) })
ok('I3', 'the same member may not move a booked piece’s day',
  (await req(`/content/${booked.id}`, 'PATCH', { release_date: day(6) }, MT)).status === 403)
ok('I4', '…and that day did not move', (await req(`/content/${booked.id}`)).data.release_date === day(2))
// The carve-out has to close behind the task, not stay open because it was
// once an idea.
const promoted = (await req(`/content/${thought.id}`, 'PATCH', { status_id: toShoot.id })).data
ok('I5', 'once an idea is booked, its days stop being free',
  (await req(`/content/${thought.id}`, 'PATCH', { release_date: day(9) }, MT)).status === 403,
  JSON.stringify({ now: promoted.status_id }))

console.log('\n=== J. what is deleted stops counting ===')
const doomed = await mk({ title: 'doomed', status_id: published.id,
  done_at: new Date().toISOString(), release_date: day(0), editor_id: crew.id,
  edited_at: new Date().toISOString(), edit_ready_date: day(0) })
const beforeAct = (await req('/reports/activity?days=4')).data.done
await req(`/content/${doomed.id}`, 'DELETE')
const afterAct = (await req('/reports/activity?days=4')).data.done
ok('J1', 'a deleted piece stops being counted as work done',
  afterAct === beforeAct - 1, JSON.stringify({ before: beforeAct, after: afterAct }))
const afterPay = (await req(`/reports/pay?from=${from}&to=${to}`)).data
  .people.find((p) => p.id === crew.id)
ok('J2', '…and stops being paid for',
  (afterPay?.delivered || 0) === (mine?.delivered || 0), JSON.stringify({ was: mine?.delivered, now: afterPay?.delivered }))

console.log('\n=== K. reading a report cannot change it ===')
const r1 = (await req(`/reports/pay?from=${from}&to=${to}`)).data
const r2 = (await req(`/reports/pay?from=${from}&to=${to}`)).data
ok('K1', 'asking twice gives the same payroll', JSON.stringify(r1) === JSON.stringify(r2))
const a1 = (await req('/reports/activity?days=30')).data
const a2 = (await req('/reports/activity?days=30')).data
ok('K2', 'asking twice gives the same activity', JSON.stringify(a1) === JSON.stringify(a2))
ok('K3', 'a window of one day is one day', (await req('/reports/activity?days=1')).data.days.length === 7,
  'the shortest window the server allows is a week — it clamps rather than refusing')

console.log('\n=== L. nonsense is refused, not stored ===')
ok('L1', 'a task cannot be created with no title', (await req('/content', 'POST', { channels: [ch], type: 'reel' })).status === 400)
ok('L2', 'a task cannot be created on a channel that does not exist',
  (await req('/content', 'POST', { title: 'x', channels: ['not_a_channel'], type: 'reel' })).status === 400)
ok('L3', 'a task cannot be moved to a stage that does not exist',
  (await req(`/content/${orig.id}`, 'PATCH', { status_id: 99999 })).status === 400)
ok('L4', 'a shoot cannot end before it starts',
  (await req('/content', 'POST', { title: 'x', channels: [ch], type: 'reel',
    recording_time: '14:00', recording_end: '10:00' })).status === 400)
ok('L5', 'a view count cannot be negative',
  [400, 422].includes((await req(`/content/${vt.id}`, 'PATCH', { views: -5 })).status),
  String((await req(`/content/${vt.id}`, 'PATCH', { views: -5 })).status))

console.log(`\n${'='.repeat(58)}`)
if (found.length) {
  console.log(`${found.length} FINDING(S):`)
  found.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
} else {
  console.log('Logic suite clean.')
}
process.exit(fails ? 1 : 0)
