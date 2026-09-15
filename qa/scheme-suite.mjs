// How a person is paid: the six arrangements, and the safety pillow.
//
// THE PILLOW IS A FLOOR, NOT A BONUS. It is worth writing down at the top of
// the file it is tested in, because "X plus the work he did" can be read two
// ways and only one of them is a pillow:
//
//   the month the company could not fill is paid the pillow IN FULL
//   the month that ran past the pillow is paid FOR WHAT WAS DONE
//
// max(pillow, earned). The other reading — pillow AND the work, stacked —
// would pay a good month twice and is the mistake section C exists to catch.
//
// The second thing here is arithmetic that must not be counted twice. Under
// Full KPI and Fixed + KPI the KPI card IS the month and the pay run puts it
// in the total; the payslip used to add it on afterwards, unconditionally.
// Section D is that.
//
// Self-contained: port 4129.
import { spawn } from 'child_process'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = new URL('.', import.meta.url).pathname
const PORT = 4129
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
  { env: { ...process.env, DATA_DIR: SP + 'sch-' + Date.now(), PORT: String(PORT) }, stdio: 'ignore' }))
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
const today = day(0)
const month = today.slice(0, 7)
const first = `${month}-01`
const stamp = Date.now().toString().slice(-6)

const stages = (await req('/statuses')).data
const published = stages.find((s) => /published/i.test(s.label))
const ch = (await req('/channels')).data[0].key

const who = (await req('/users', 'POST', {
  name: `Nodira ${stamp}`, username: `nod${stamp}`, password: 'probe-only-123', role: 'editor' })).data
const mine = async () => (await req(`/reports/pay/mine?from=${first}&to=${today}`,
  'GET', null, await login(`nod${stamp}`, 'probe-only-123'))).data

// 400 000 a cut, so the month's earnings are a round number of pieces.
const PIECE = 400000
const PILLOW = 4000000
const setCard = (extra = {}) => req(`/reports/pay/rules/${who.id}`, 'PUT', {
  currency: 'UZS', base: 0, per_edit: PIECE, quota: 0, quota_bonus: 0,
  ontime_bonus: 0, ontime_target: 90, pillow: PILLOW, ...extra })

let n = 0
const cut = async () => {
  const t = (await req('/content', 'POST', {
    title: `sch ${stamp} ${++n}`, channels: [ch], type: 'reel',
    editor_id: who.id, edit_ready_date: today, release_date: today })).data
  await req(`/content/${t.id}`, 'PATCH', {
    status_id: published.id, post_link: `https://example.com/${stamp}-${n}` })
}
const cutsTo = async (k) => { while (n < k) await cut() }

console.log('\n=== A. the month the company could not fill ===')
await setCard({ scheme: 'pillow' })
let p = await mine()
ok('A1', 'a month with no work at all is still paid the pillow in full',
  p.total === PILLOW, `${p.total} — "if a company could not provide this volume"`)
ok('A2', '…and the payslip says what it topped up, not just the answer',
  p.earned === 0 && p.pillowTopUp === PILLOW,
  JSON.stringify({ earned: p.earned, topUp: p.pillowTopUp }))
await cutsTo(3)
p = await mine()
ok('A3', 'a short month is topped up to the guarantee',
  p.total === PILLOW && p.earned === 3 * PIECE && p.pillowTopUp === PILLOW - 3 * PIECE,
  JSON.stringify({ earned: p.earned, topUp: p.pillowTopUp, paid: p.total }))

console.log('\n=== B. the month that ran past it ===')
await cutsTo(10)
p = await mine()
ok('B1', 'exactly filling the pillow pays the pillow and tops up nothing',
  p.total === PILLOW && p.pillowTopUp === 0 && p.pillowMet === true,
  JSON.stringify({ earned: p.earned, paid: p.total, met: p.pillowMet }))
await cutsTo(15)
p = await mine()
ok('B2', 'overworking is paid for what was actually done',
  p.total === 15 * PIECE, `${p.total} — "if the editor did more than X, he gets what he did"`)
ok('B3', '…with nothing topped up on a month that did not need it',
  p.pillowTopUp === 0, String(p.pillowTopUp))

console.log('\n=== C. a floor, not a bonus ===')
// The other reading of "X + the work he did": the pillow paid AND the work
// paid, stacked. That would hand a good month the guarantee a second time,
// and it is the single mistake this feature can make that nobody notices
// until payday.
ok('C1', 'a month past the pillow is NOT paid the pillow as well',
  p.total === 15 * PIECE && p.total !== PILLOW + 15 * PIECE,
  `${p.total} — stacking would have paid ${PILLOW + 15 * PIECE}`)
ok('C2', 'the pillow never makes a month smaller either',
  p.total >= p.earned, JSON.stringify({ earned: p.earned, paid: p.total }))
// And with no pillow set, the arrangement changes nothing.
await setCard({ scheme: 'pillow', pillow: 0 })
p = await mine()
ok('C3', 'a pillow of nothing guarantees nothing and pays the work',
  p.total === 15 * PIECE && p.pillowTopUp === 0, JSON.stringify({ paid: p.total }))

console.log('\n=== D. the KPI card is counted once ===')
// A ladder that pays 500 000 at this volume, over a fixed 2 000 000.
await req(`/reports/kpi/${who.id}/${month}`, 'PUT', {
  currency: 'UZS', fixed: 2000000,
  ladders: [{ key: 'delivered', label: 'Pieces delivered', metric: 'delivered', unit: '',
    bands: [{ grade: 'A', min: 10, pays: 500000 }, { grade: 'C', min: 0, pays: 0 }] }],
  readings: {},
})
const KPI = 2500000
await setCard({ scheme: 'kpi', base: 1000000 })
p = await mine()
ok('D1', 'on full KPI the month IS the card', p.total === KPI,
  `${p.total} — the base and the piece rates are not paid on this arrangement`)
ok('D2', '…and the payslip is told it is already in the total, so it is not added twice',
  p.kpiCounted === true, String(p.kpiCounted))
await setCard({ scheme: 'fixed_kpi', base: 1000000 })
p = await mine()
ok('D3', 'fixed + KPI is the salary and the card, and nothing per piece',
  p.total === 1000000 + KPI, `${p.total} — 15 cuts earned nothing extra here`)
await setCard({ scheme: 'piece', base: 1000000 })
p = await mine()
ok('D4', 'on piecework the card is NOT folded in — the payslip adds it separately, as it always did',
  p.kpiCounted === false && p.total === 1000000 + 15 * PIECE,
  JSON.stringify({ counted: p.kpiCounted, total: p.total }))

console.log('\n=== E. the plainer arrangements ===')
await setCard({ scheme: 'fixed', base: 1000000 })
p = await mine()
ok('E1', 'a fixed salary is the salary, whatever the month held',
  p.total === 1000000, `${p.total} — 15 cuts at 400 000 changed nothing`)
await setCard({ scheme: 'pillow_kpi', base: 1000000 })
p = await mine()
ok('E2', 'pillow then KPI: a card worth less than the pillow is topped up to it',
  p.total === PILLOW && p.earned === KPI && p.pillowTopUp === PILLOW - KPI,
  JSON.stringify({ earned: p.earned, topUp: p.pillowTopUp, paid: p.total }))

console.log('\n=== F. an arrangement nobody has heard of is piecework ===')
// Everybody was on piecework before schemes existed, so an unreadable value
// can only ever mean "as before" — never "paid nothing".
const junk = await req(`/reports/pay/rules/${who.id}`, 'PUT', {
  currency: 'UZS', base: 1000000, per_edit: PIECE, quota: 0, quota_bonus: 0,
  ontime_bonus: 0, ontime_target: 90, pillow: PILLOW, scheme: 'wishful-thinking' })
ok('F1', 'a scheme that is not one is stored as piecework',
  junk.data.scheme === 'piece', String(junk.data.scheme))
p = await mine()
ok('F2', '…and is paid as piecework', p.total === 1000000 + 15 * PIECE, String(p.total))
const served = (await req('/reports/pay/schemes')).data
ok('F3', 'the arrangements are served to the browser', Array.isArray(served.keys) && served.keys.length === 6,
  JSON.stringify(served.keys))
ok('F4', '…and every one of them is one a card may be set to',
  (await Promise.all(served.keys.map(async (k) =>
    (await req(`/reports/pay/rules/${who.id}`, 'PUT', {
      currency: 'UZS', base: 0, per_edit: 0, quota: 0, quota_bonus: 0,
      ontime_bonus: 0, ontime_target: 90, scheme: k })).data.scheme === k))).every(Boolean))

console.log('\n=== G. a closed month does not care what the arrangement becomes ===')
// The payout record froze a figure. Changing how somebody is paid afterwards
// must not rewrite a month they have already been paid for.
await setCard({ scheme: 'pillow', base: 0 })
const before = (await mine()).total
await req('/reports/pay/payouts', 'POST', { month, user_ids: [who.id], paid_at: today })
await setCard({ scheme: 'fixed', base: 1 })
const after = await mine()
ok('G1', 'a settled month keeps the figure it was settled at',
  after.payout?.total === Math.round(before),
  JSON.stringify({ frozen: after.payout?.total, was: before }))

console.log(`\n${'='.repeat(58)}`)
if (found.length) {
  console.log(`${found.length} FINDING(S):`)
  found.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
} else {
  console.log('Pay-scheme suite clean.')
}
process.exit(fails ? 1 : 0)
