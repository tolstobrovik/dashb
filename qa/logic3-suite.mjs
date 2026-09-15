// Logic tests, round three: the corners nobody opens twice.
//
// Rounds one and two covered the board's spine — content, reports, money,
// dates. This one goes where the traffic is thinner and the rules are
// therefore less exercised: the ambassador programme, the KPI card, the
// documents shelf, the assistant, and the handful of writes that are supposed
// to be safe to repeat.
//
// Repeating a write is the theme. Every one of these endpoints is reachable
// from a button somebody can press twice — a double tap on a phone, a retry
// after a timeout, a page restored from a back button. An endpoint that is
// safe once and wrong twice is a bug nobody can reproduce on purpose.
//
// Self-contained: port 4126.
import { spawn } from 'child_process'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = new URL('.', import.meta.url).pathname
const PORT = 4126
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
  { env: { ...process.env, DATA_DIR: SP + 'logic3-' + Date.now(), PORT: String(PORT) }, stdio: 'ignore' }))
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
const day = (n) => {
  const d = new Date(Date.now() + 5 * 3600e3)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const stages = (await req('/statuses')).data
const idea = stages.find((s) => /^idea/i.test(s.label))
const ch = (await req('/channels')).data[0].key
const stamp = Date.now().toString().slice(-6)
const mk = async (patch = {}) => (await req('/content', 'POST', {
  title: `T${stamp} ${patch.title || 'task'}`, channels: [ch], type: 'reel', status_id: idea.id, ...patch })).data

console.log('\n=== U. a button pressed twice does the thing once ===')
const dbl = await mk({ title: 'double tap' })
// Deleting twice: the second must not 500, and must not resurrect anything.
const d1 = await req(`/content/${dbl.id}`, 'DELETE')
const d2 = await req(`/content/${dbl.id}`, 'DELETE')
ok('U1', 'deleting once works', d1.status === 200, String(d1.status))
ok('U2', 'deleting again says "not there", not "server error"',
  d2.status === 404 || d2.status === 200, String(d2.status))
// A checklist item added twice from a stuttering tap.
const cl = await mk({ title: 'checklist' })
await req(`/content/${cl.id}`, 'PATCH', { checklist: [{ text: 'one', done: false }] })
const twice = (await req(`/content/${cl.id}`, 'PATCH', { checklist: [{ text: 'one', done: false }] })).data
ok('U3', 'sending the same checklist twice does not double it',
  (twice.checklist || []).length === 1, JSON.stringify(twice.checklist))
// The same stage move, sent twice.
const st = await mk({ title: 'stage twice' })
const s1 = await req(`/content/${st.id}`, 'PATCH', { status_id: idea.id })
const s2 = await req(`/content/${st.id}`, 'PATCH', { status_id: idea.id })
ok('U4', 'moving a task to the stage it is already on is not an error',
  s1.status === 200 && s2.status === 200, JSON.stringify({ a: s1.status, b: s2.status }))

console.log('\n=== V. the assistant advises and never blocks ===')
// The brief reader has to work with no key at all, and must never be the
// reason somebody cannot save.
const r1 = await req('/ai/review', 'POST', { text: 'asdf' })
ok('V1', 'the reader answers with no model configured', r1.status === 200, String(r1.status))
ok('V2', '…and catches a placeholder on the rules alone',
  r1.data.verdict === 'bad' && r1.data.provider === 'rules', JSON.stringify(r1.data))
const r2 = await req('/ai/review', 'POST', { text: 'Film Aziz in the main office explaining the September SAT deadline, forty seconds vertical, hand the cut to Mira by Friday.' })
ok('V3', 'a real brief is passed in silence', r2.data.verdict === 'ok', JSON.stringify(r2.data.verdict))
ok('V4', 'the reader never names the providers to an ordinary reader',
  r2.data.tried === undefined, JSON.stringify(r2.data.tried))
const r3 = await req('/ai/review', 'POST', { text: '' })
ok('V5', 'an empty box is not an error', r3.status === 200, String(r3.status))
const big = await req('/ai/review', 'POST', { text: 'x'.repeat(30000) })
ok('V6', 'something longer than any brief is refused, not swallowed', big.status === 413, String(big.status))
// The insight endpoint takes a digest, not prose.
ok('V7', 'the reader of numbers refuses something that is not a digest',
  (await req('/ai/insight', 'POST', { digest: 'not an object' })).status === 400)

console.log('\n=== W. a KPI card is this month’s, and only this month’s ===')
const person = (await req('/users', 'POST', {
  name: `KPI Logic ${stamp}`, username: `kpil${stamp}`, password: 'probe-only-123', role: 'member' })).data
const month = day(0).slice(0, 7)
const card = { currency: 'UZS', fixed: 1000, ladders: [{
  key: 'k1', label: 'Delivered', metric: 'delivered', unit: '',
  bands: [{ grade: 'A+', from: 10, to: null, pays: 500 }, { grade: 'D', from: null, to: 9, pays: 0 }] }], readings: {}, note: '' }
ok('W1', 'a card can be set for a month', (await req(`/reports/kpi/${person.id}/${month}`, 'PUT', card)).status === 200)
const got = (await req(`/reports/kpi/${person.id}?month=${month}`)).data
ok('W2', '…and read back', got.raw?.fixed === 1000, JSON.stringify({ fixed: got.raw?.fixed }))
const other = (await req(`/reports/kpi/${person.id}?month=2020-01`)).data
ok('W3', 'another month is not this month’s card', !other.raw || other.raw.fixed !== 1000,
  JSON.stringify({ raw: other.raw }))
ok('W4', 'a ladder with no reading is still drawn, rather than hidden',
  (got.card?.ladders || []).length > 0, JSON.stringify({ n: (got.card?.ladders || []).length }))
// Their own card, through the door a member actually uses.
const PT = await login(`kpil${stamp}`, 'probe-only-123')
const own = await req('/reports/kpi/mine', 'GET', null, PT)
ok('W5', 'a member may read their own card', own.status === 200, String(own.status))
ok('W6', '…and may not read somebody else’s',
  (await req(`/reports/kpi/1?month=${month}`, 'GET', null, PT)).status === 403)

console.log('\n=== X. the ambassador programme keeps its own books ===')
const amb = await req('/ambassadors')
ok('X1', 'the programme answers on an empty board', amb.status === 200, String(amb.status))
// There is no POST /ambassadors — the programme is run through named actions,
// so the boundary worth asking about is those. Every one of them decides money
// or status for somebody else.
const AT = PT   // an ordinary member
const enrol = await req(`/ambassadors/person/${person.id}`, 'PUT', { status: 'active' }, AT)
ok('X2', 'an ordinary member cannot enrol somebody in the programme',
  enrol.status === 403, `${enrol.status} ${JSON.stringify(enrol.data).slice(0, 90)}`)
const paid = await req('/ambassadors/cards/1/paid', 'POST', {}, AT)
ok('X3', '…nor mark a card paid', paid.status === 403, String(paid.status))
const look = await req(`/ambassadors/person/${person.id}/cards`, 'GET', null, AT)
ok('X4', '…nor read somebody else’s account', look.status === 403, String(look.status))
ok('X5', 'an admin can do all three', (await req(`/ambassadors/person/${person.id}`, 'PUT', { status: 'active' })).status !== 403)

console.log('\n=== Y. a document belongs to somebody ===')
const docs = await req('/docs')
ok('Y1', 'the shelf answers', docs.status === 200, String(docs.status))
ok('Y2', 'a member sees a shelf, not somebody else’s papers',
  (await req('/docs', 'GET', null, PT)).status === 200)

console.log('\n=== Z. the board never promises a day it has refused ===')
// The whole point of the freeze: if the server would refuse a day, the form
// must not offer it. Asked at the API, where the answer is authoritative.
const frozen = await mk({ title: 'frozen', status_id: stages.find((s) => /to\s*shoot/i.test(s.label)).id,
  recording_date: day(3), edit_ready_date: day(4), release_date: day(5) })
await req(`/users/${person.id}`, 'PATCH', { departments: [ch], permissions: {
  manage_content: false, move_tasks: false, review_publish: false, request_changes: true,
  deliver_work: true, edit_metrics: false, manage_metrics: false, manage_layout: false, manage_ambassadors: false } })
const PT2 = await login(`kpil${stamp}`, 'probe-only-123')
const refused = await req(`/content/${frozen.id}`, 'PATCH', { release_date: day(9) }, PT2)
ok('Z1', 'a booked day is refused for somebody who may not move it', refused.status === 403, String(refused.status))
ok('Z2', '…and the refusal says what to ask for instead of just saying no',
  !!refused.data.ask_to_move || /admin|permission/i.test(refused.data.error || ''),
  JSON.stringify(refused.data).slice(0, 160))

console.log('\n=== AA. booking an operator is one decision ===')
// The content team's actual job: pick who films it, and a time that person
// really has. Both halves have to be true at once — a picker that offers a
// time the operator is already booked for is worse than no picker.
const op = (await req('/users', 'POST', {
  name: `Book Op ${stamp}`, username: `bop${stamp}`, password: 'probe-only-123', role: 'operator' })).data
ok('AA1', 'somebody can be made an operator in one call',
  op.role === 'operator' && (op.crew_roles || []).includes('operator'),
  JSON.stringify({ role: op.role, caps: op.crew_roles }))
await req(`/users/${op.id}`, 'PATCH', { work_start: '10:00', work_end: '18:00', work_days: [1, 2, 3, 4, 5] })

const firstWorkday = (() => {
  for (let n = 1; n < 9; n++) {
    const d = new Date(`${day(n)}T00:00:00Z`)
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) return day(n)
  }
  return day(1)
})()
// Book the middle of that day, then ask what is left.
await req('/content', 'POST', { title: `AA held ${stamp}`, channels: [ch], type: 'reel',
  status_id: stages.find((x) => /to\s*shoot/i.test(x.label)).id, operator_id: op.id,
  recording_date: firstWorkday, recording_time: '12:00', recording_end: '14:00',
  reference_links: ['https://example.com/r'], script: 'Something to film' })

const free = (await req(`/users/${op.id}/slots?days=7&mins=120`)).data
const thatDay = (free.calendar || []).find((d) => d.day === firstWorkday)
ok('AA2', 'the board knows the hours they set',
  free.hours?.from === '10:00' && free.hours?.to === '18:00', JSON.stringify(free.hours))
ok('AA3', 'the day they are booked still offers its free half',
  (thatDay?.slots || []).length > 0, JSON.stringify((thatDay?.slots || []).map((s) => s.from)))
ok('AA4', '…and never offers a time that overlaps the booking',
  (thatDay?.slots || []).every((s) => s.to <= '12:00' || s.from >= '14:00'),
  JSON.stringify((thatDay?.slots || []).map((s) => `${s.from}-${s.to}`)))
ok('AA5', '…and never offers a time outside their working hours',
  (thatDay?.slots || []).every((s) => s.from >= '10:00' && s.to <= '18:00'),
  JSON.stringify((thatDay?.slots || []).map((s) => `${s.from}-${s.to}`)))
const weekend = (free.calendar || []).find((d) => !d.working)
ok('AA6', 'a day they do not work offers nothing',
  !weekend || (weekend.slots || []).length === 0, JSON.stringify({ day: weekend?.day, n: weekend?.slots?.length }))
// A longer shoot than the gap that is left cannot be offered on that day.
const long = (await req(`/users/${op.id}/slots?days=7&mins=240`)).data
const longDay = (long.calendar || []).find((d) => d.day === firstWorkday)
ok('AA7', 'a half-day shoot is not offered into a two-hour gap',
  (longDay?.slots || []).every((s) => s.to <= '12:00' || s.from >= '14:00'),
  JSON.stringify((longDay?.slots || []).map((s) => `${s.from}-${s.to}`)))

console.log(`\n${'='.repeat(58)}`)
if (found.length) {
  console.log(`${found.length} FINDING(S):`)
  found.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
} else {
  console.log('Logic round three clean.')
}
process.exit(fails ? 1 : 0)
