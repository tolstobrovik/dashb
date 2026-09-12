// Logic tests, round two: the awkward data.
//
// Round one asked whether two features agree about one fact. This one asks
// what happens at the edges — the empty board, the single reading, the day
// that is one day in Tashkent and another in UTC, the number nobody set. Those
// are where a chart divides by zero, a percentage reads 100% off one sample,
// and a day boundary quietly moves a deadline.
//
// Self-contained: port 4125.
import { spawn } from 'child_process'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = new URL('.', import.meta.url).pathname
const PORT = 4125
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
  { env: { ...process.env, DATA_DIR: SP + 'logic2-' + Date.now(), PORT: String(PORT) }, stdio: 'ignore' }))
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
const S = (re) => stages.find((s) => re.test(s.label))
const idea = S(/^idea/i), published = S(/published/i)
const ch = (await req('/channels')).data[0].key
const stamp = Date.now().toString().slice(-6)
const mk = async (patch = {}, tok = T) => (await req('/content', 'POST', {
  title: `M${stamp} ${patch.title || 'task'}`, channels: [ch], type: 'reel', ...patch }, tok)).data

console.log('\n=== M. an empty board answers, rather than breaking ===')
// Every report is opened on day one, before there is anything to report. A
// division by zero here is a white screen on somebody's first morning.
const emptyAct = (await req('/reports/activity?days=30')).data
ok('M1', 'the activity report answers on an empty board', !!emptyAct.days)
ok('M2', '…with a window and no work', emptyAct.days.length === 30 && emptyAct.done === 0,
  JSON.stringify({ n: emptyAct.days?.length, done: emptyAct.done }))
ok('M3', '…and no series at all, rather than flat lines along the floor',
  Array.isArray(emptyAct.series) && emptyAct.series.length === 0, JSON.stringify(emptyAct.series))
ok('M4', '…and says nothing about a rate it cannot compute', emptyAct.rate === null, JSON.stringify(emptyAct.rate))
ok('M5', '…and names no busiest day', emptyAct.peak === null, JSON.stringify(emptyAct.peak))
const emptyStats = await req(`/reports/stats?from=${day(-30)}&to=${day(0)}`)
ok('M6', 'the statistics page answers on an empty board', emptyStats.status === 200, String(emptyStats.status))
const emptyPay = await req(`/reports/pay?from=${day(-30)}&to=${day(0)}`)
ok('M7', 'the payroll answers on an empty board', emptyPay.status === 200, String(emptyPay.status))
ok('M8', '…and pays nobody rather than failing to add up',
  (emptyPay.data.people || []).every((p) => p.total === 0), JSON.stringify((emptyPay.data.people || []).map((p) => p.total)))

console.log('\n=== N. one reading is not a trend ===')
const solo = (await req('/users', 'POST', {
  name: `Solo ${stamp}`, username: `solo${stamp}`, password: 'probe-only-123', role: 'member' })).data
await req(`/users/${solo.id}`, 'PATCH', { departments: [ch] })
await mk({ title: 'the only one', status_id: published.id, editor_id: solo.id,
  edited_at: new Date().toISOString(), edit_ready_date: day(0), release_date: day(0),
  post_link: 'https://example.com/p', done_at: new Date().toISOString() })
const oneAct = (await req('/reports/activity?days=30')).data
ok('N1', 'one delivery gives one active day', oneAct.active_days === 1, String(oneAct.active_days))
ok('N2', '…and no quiet stretch is claimed from it',
  oneAct.quiet_run === 0, `${oneAct.quiet_run} — a rhythm needs more than one beat to break`)
ok('N3', '…and the rate is stated in a unit it is legible in',
  oneAct.rate && oneAct.rate.n > 0, JSON.stringify(oneAct.rate))
ok('N4', 'the busiest day is the day it happened', oneAct.peak?.day === day(0), JSON.stringify(oneAct.peak))

console.log('\n=== O. the Tashkent day is the day ===')
// The board reckons in Tashkent (UTC+5). Anything that reads a date off a UTC
// timestamp moves work a day when the office is in the evening.
const nowT = day(0)
const health = (await req('/reports/activity?days=7')).data
ok('O1', 'the window ends on the Tashkent today, not the UTC one',
  health.days[health.days.length - 1] === nowT,
  JSON.stringify({ last: health.days[health.days.length - 1], tashkent: nowT }))
// A piece finished right now must land on today, whatever the hour.
const justNow = await mk({ title: 'just now', status_id: published.id,
  post_link: 'https://example.com/x', release_date: nowT })
const backAct = (await req('/reports/activity?days=7')).data
ok('O2', 'work finished now counts on the Tashkent today',
  backAct.totals[backAct.days.indexOf(nowT)] > 0,
  JSON.stringify({ day: nowT, n: backAct.totals[backAct.days.indexOf(nowT)] }))
ok('O3', 'the board stamped it as done', !!justNow.done_at, JSON.stringify({ done_at: justNow.done_at }))

console.log('\n=== P. a project cannot be more than finished, or less than started ===')
const proj = (await req('/projects', 'POST', {
  name: `Logic project ${stamp}`, metric: 'Enrollments', target: 100, actual: 0,
  start_date: day(-10), deadline: day(10), status: 'active' })).data
ok('P1', 'a project starts where it says', proj.actual === 0 && proj.target === 100)
const beaten = (await req(`/projects/${proj.id}`, 'PATCH', { actual: 150 })).data
ok('P2', 'beating the target is stored as beating it, not capped',
  beaten.actual === 150, JSON.stringify({ actual: beaten.actual }))
const neg = await req(`/projects/${proj.id}`, 'PATCH', { actual: -5 })
ok('P3', 'a negative result is refused or clamped, never stored as-is',
  neg.status >= 400 || neg.data.actual >= 0, JSON.stringify({ status: neg.status, actual: neg.data.actual }))
ok('P4', 'a project with no campaigns still reports its health',
  !!(await req(`/projects/${proj.id}`)).data.health, JSON.stringify((await req(`/projects/${proj.id}`)).data.health))

console.log('\n=== Q. the sprint week is a week ===')
const cur = (await req('/sprints/current')).data
ok('Q1', 'there is always a current week', !!cur.sprint?.id)
ok('Q2', '…that starts before it freezes', cur.sprint.start_at < cur.sprint.freeze_at,
  JSON.stringify({ start: cur.sprint.start_at, freeze: cur.sprint.freeze_at }))
ok('Q3', '…and freezes before the meeting it is for',
  cur.sprint.freeze_at <= cur.sprint.meeting_at,
  JSON.stringify({ freeze: cur.sprint.freeze_at, meet: cur.sprint.meeting_at }))
const hist = (await req('/sprints/history')).data
const histIds = (Array.isArray(hist) ? hist : []).map((w) => w.id)
ok('Q4', 'history never counts a week twice',
  new Set(histIds).size === histIds.length,
  `${histIds.length} weeks, ${new Set(histIds).size} distinct — a repeat would double its numbers`)

console.log('\n=== R. the bell rings once ===')
const before = (await req('/notifications')).data
const nTask = await mk({ title: 'ringer', status_id: idea.id })
await req(`/content/${nTask.id}`, 'PATCH', { assignee_id: solo.id })
await req(`/content/${nTask.id}`, 'PATCH', { assignee_id: solo.id })   // same again
const after = (await req('/notifications', 'GET', null, await login(`solo${stamp}`, 'probe-only-123'))).data
const mineRings = (after.items || after || []).filter?.((n) => n.content_id === nTask.id) || []
ok('R1', 'assigning the same person twice does not ring twice',
  mineRings.length <= 1, JSON.stringify({ rings: mineRings.length }))

console.log('\n=== S. what the numbers page says adds up ===')
const stats = (await req(`/reports/stats?from=${day(-30)}&to=${day(0)}`)).data
const pct = (v) => v === null || v === undefined || (v >= 0 && v <= 100)
ok('S1', 'every percentage on the statistics page is a percentage',
  [stats.plan_pct, stats.on_time_pct, stats.production_pct].every(pct),
  JSON.stringify({ plan: stats.plan_pct, ontime: stats.on_time_pct, prod: stats.production_pct }))
ok('S2', 'delivered is never more than planned when both are counted',
  stats.planned === undefined || stats.delivered === undefined
    || stats.planned === 0 || stats.delivered <= stats.planned + 0,
  JSON.stringify({ planned: stats.planned, delivered: stats.delivered }))

console.log(`\n${'='.repeat(58)}`)
if (found.length) {
  console.log(`${found.length} FINDING(S):`)
  found.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
} else {
  console.log('Logic round two clean.')
}
process.exit(fails ? 1 : 0)
