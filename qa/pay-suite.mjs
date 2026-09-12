// Payment: the calculator, the record, and what is still on the table.
//
// This section had one structural hole and one presentational one, and the
// tests are shaped around both.
//
// The structural hole: every figure re-derived itself for ever. Nothing wrote
// down what actually went out, so "was I paid for August?" had no answer and
// editing an August task in October quietly rewrote an August payslip. The
// invariant the whole feature exists for is in section C: a CLOSED MONTH DOES
// NOT MOVE. If only one test in this file survives, it should be that one.
//
// The presentational hole: a bonus was a line reading "5 more to go" — a fact
// with no sense of whether five more is a comfortable week or an impossible
// afternoon. Sections A and B check that the states are worked out from the
// calendar as well as the count, and that the two edges people actually hit
// (nothing delivered yet; the month already gone) do not produce nonsense.
//
// Self-contained: port 4127.
import { spawn } from 'child_process'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = new URL('.', import.meta.url).pathname
const PORT = 4127
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
  { env: { ...process.env, DATA_DIR: SP + 'pay-' + Date.now(), PORT: String(PORT) }, stdio: 'ignore' }))
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
// The board reckons in Tashkent (UTC+5), so the fixtures do too.
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

const person = async (name, role = 'editor') => {
  const made = await req('/users', 'POST', {
    name: `${name} ${stamp}`, username: `${name.toLowerCase()}${stamp}`,
    password: 'probe-only-123', role })
  if (made.status !== 201) throw new Error(`fixture: user ${made.status} ${JSON.stringify(made.data)}`)
  return { ...made.data, short: name }
}
const tokenOf = (name) => login(`${name.toLowerCase()}${stamp}`, 'probe-only-123')

// One delivered piece, credited to `who` as the editor, on time unless asked.
//
// A LATE one has to be genuinely late, and on this board that takes more than
// putting a date in the past. Two rules get in the way of the obvious fixture,
// and both of them are right:
//
//   an editor whose footage only arrived after their own deadline had gone is
//   EXCUSED, not late — the delay is upstream, not theirs; and
//
//   when a shoot slips, the dates downstream of it are revised, so the cut is
//   on time against the date it was actually given.
//
// Between them, a task invented this morning with an edit deadline five days
// ago produces a perfectly punctual editor. So a late piece is charged where
// lateness is unambiguous: the SHOOT, which has nothing upstream of it and
// answers for itself. The handover clocks are stamped by the board when a
// stage is crossed — they are not writable — so the piece is simply published
// today against a recording day that has gone.
let piece = 0
const deliver = async (who, { late = false, views = null } = {}) => {
  const tag = `${stamp}-${who.short}-${++piece}`
  const made = await req('/content', 'POST', {
    title: `pay ${tag}`, channels: [ch], type: 'reel',
    ...(late
      ? { operator_id: who.id, recording_date: day(-8), release_date: today }
      : { editor_id: who.id, edit_ready_date: today, release_date: today }),
  })
  if (made.status !== 201) throw new Error(`fixture: create ${made.status} ${JSON.stringify(made.data)}`)
  const done = await req(`/content/${made.data.id}`, 'PATCH', {
    status_id: published.id,
    post_link: `https://example.com/${tag}`, ...(views === null ? {} : { views }),
  })
  if (done.status !== 200) throw new Error(`fixture: publish ${done.status} ${JSON.stringify(done.data)}`)
  return made.data
}
const mineFor = async (who) => (await req(`/reports/pay/mine?from=${first}&to=${today}`, 'GET', null, await tokenOf(who.short))).data
const goal = (pay, key) => (pay.goals || []).find((g) => g.key === key)

console.log('\n=== A. a bonus is a goal, not a fact ===')
// Rates everybody starts from: a quota well out of a day's reach, so the
// state has to be worked out rather than guessed at.
await req('/reports/pay/rules/default', 'PUT', {
  currency: 'UZS', base: 1000000, per_edit: 100000,
  quota: 12, quota_bonus: 500000, ontime_bonus: 300000, ontime_target: 90,
})
const ann = await person('Ann')
let pay = await mineFor(ann)
ok('A1', 'a person with rates and nothing delivered still gets goals',
  Array.isArray(pay.goals) && pay.goals.length >= 2, JSON.stringify((pay.goals || []).map((g) => g.key)))
ok('A2', '…and the window is the whole month, not the days that have passed',
  pay.period?.horizon === new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10),
  JSON.stringify(pay.period))
ok('A3', '…so the days left are counted to the end of the month',
  pay.period?.days_left === Math.round((Date.parse(pay.period.horizon + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000),
  JSON.stringify({ left: pay.period?.days_left, horizon: pay.period?.horizon, today }))
// Nothing delivered is not a punctuality failure. A share of nothing is not
// 0% — it is "nothing to judge" — and a card that opens on somebody's first
// morning telling them they have failed a target is the fastest way to have
// the page closed for ever.
ok('A4', 'nothing delivered yet is not a punctuality failure',
  goal(pay, 'ontime')?.state !== 'behind' && goal(pay, 'ontime')?.state !== 'lost',
  JSON.stringify(goal(pay, 'ontime')))
ok('A5', '…and no goal claims to be won off no work',
  (pay.goals || []).every((g) => g.state !== 'won'), JSON.stringify((pay.goals || []).map((g) => [g.key, g.state])))

// Two delivered against a quota of twelve, most of the month gone or not —
// either way this is not "nearly".
for (let i = 0; i < 2; i++) await deliver(ann)
pay = await mineFor(ann)
const q2 = goal(pay, 'quota')
ok('A6', 'two of twelve is not called nearly', q2.state !== 'close' && q2.state !== 'won',
  JSON.stringify({ state: q2.state, have: q2.have, need: q2.need }))
ok('A7', '…and the goal says how many are left, not just a percentage',
  q2.left === 10 && q2.pct === 17, JSON.stringify({ left: q2.left, pct: q2.pct }))

console.log('\n=== B. the sentence has a number and a verb in it ===')
// The on-time bonus is the one that needed real arithmetic. "You are on 80%"
// is not actionable; "3 more on time and it is yours" is. Two delivered, one
// of them late: 50%, against a 90% target.
const bo = await person('Bo')
await deliver(bo)
await deliver(bo, { late: true })
pay = await mineFor(bo)
const ot = goal(pay, 'ontime')
ok('B1', 'punctuality is read as a share', ot.have === 50 && ot.need === 90,
  JSON.stringify({ have: ot.have, need: ot.need }))
// k on-time deliveries such that (onTime + k) / (done + k) >= 0.9
//   (1 + k) / (2 + k) >= 0.9  →  k >= 8
ok('B2', '…and says how many MORE on time would win it back',
  ot.on_time_more === 8, `${ot.on_time_more} — (1+k)/(2+k) ≥ 0.9 needs k ≥ 8`)
ok('B3', '…which is a number somebody can act on, not a mood',
  Number.isFinite(ot.on_time_more) && ot.on_time_more > 0, JSON.stringify(ot))

// Meeting the quota turns the goal, and pays the bonus, in the same answer.
const cy = await person('Cy')
await req(`/reports/pay/rules/${cy.id}`, 'PUT', {
  currency: 'UZS', base: 0, per_edit: 0, quota: 3, quota_bonus: 400000, ontime_bonus: 0, ontime_target: 90,
})
for (let i = 0; i < 3; i++) await deliver(cy)
pay = await mineFor(cy)
ok('B4', 'meeting the quota wins the goal', goal(pay, 'quota')?.state === 'won',
  JSON.stringify(goal(pay, 'quota')))
ok('B5', '…and the money is actually in the total, not just on the ring',
  pay.quotaBonus === 400000 && pay.total === 400000,
  JSON.stringify({ bonus: pay.quotaBonus, total: pay.total }))
ok('B6', '…and it is not still counted as on the table',
  goal(pay, 'quota')?.left === 0, JSON.stringify({ left: goal(pay, 'quota')?.left }))

console.log('\n=== C. a closed month does not move ===')
// The invariant the whole feature exists for. Close the month, then edit the
// board underneath it. The payslip must not change — that is the difference
// between a record and a calculator, and it is the reason the table exists.
const before = (await mineFor(cy)).total
const closed = await req('/reports/pay/payouts', 'POST', { month, user_ids: [cy.id], note: 'suite' })
ok('C1', 'an admin can close a month', closed.status === 201 && closed.data.recorded > 0,
  JSON.stringify({ status: closed.status, n: closed.data.recorded }))
const afterClose = await mineFor(cy)
ok('C2', '…and the person is told their month is settled', !!afterClose.payout,
  JSON.stringify(afterClose.payout && { total: afterClose.payout.total, paid_at: afterClose.payout.paid_at }))
ok('C3', '…at the figure it stood at', afterClose.payout?.total === Math.round(before),
  JSON.stringify({ frozen: afterClose.payout?.total, was: before }))
// Now change the board under it.
await deliver(cy)
const afterEdit = await mineFor(cy)
ok('C4', 'work added afterwards does not rewrite a settled month',
  afterEdit.payout?.total === Math.round(before),
  JSON.stringify({ now: afterEdit.payout?.total, was: before }))
ok('C5', '…and the history reads the settled month from the record',
  (await req('/reports/pay/mine/history?months=2', 'GET', null, await tokenOf('Cy')))
    .data.months.find((m) => m.month === month)?.total === Math.round(before),
  JSON.stringify({ was: before }))
// The same invariant one level down. Freezing the TOTAL and leaving its
// itemisation to a live re-derivation is the worst of both worlds: a number
// that cannot move, broken down by numbers that can, which stop adding up to
// it the first time anybody edits an old task. The record has to carry the
// whole payslip — what it was paid on, and which pieces.
const snap = afterEdit.payout?.breakdown || {}
ok('C8', 'the record carries the whole payslip, not just the total',
  ['base', 'piecework', 'bonus', 'delivered', 'lines'].every((k) => k in snap),
  JSON.stringify(Object.keys(snap)))
ok('C9', '…including the rate card it was worked out on',
  !!snap.rates && typeof snap.rates.quota === 'number',
  JSON.stringify(snap.rates && { quota: snap.rates.quota }))
ok('C10', '…and the pieces it was paid for', Array.isArray(snap.items),
  `${(snap.items || []).length} — "which work was I paid for" is the other half of a payslip`)
ok('C11', '…and those counts do not move either when the board is edited',
  snap.delivered === afterClose.payout.breakdown.delivered,
  JSON.stringify({ now: snap.delivered, frozen: afterClose.payout.breakdown.delivered }))
ok('C12', '…and the frozen parts still add up to the frozen total',
  Math.round((snap.base || 0) + (snap.piecework || 0) + (snap.viewsPay || 0)
    + (snap.bonus || 0) - (snap.penalty || 0)) === Math.round(afterEdit.payout.total),
  JSON.stringify({ parts: (snap.base || 0) + (snap.piecework || 0) + (snap.viewsPay || 0) + (snap.bonus || 0) - (snap.penalty || 0), total: afterEdit.payout.total }))

// Re-opening is the only way back, and it gives the calculator its job back.
const reopened = await req(`/reports/pay/payouts/${month}/${cy.id}`, 'DELETE')
const afterReopen = await mineFor(cy)
ok('C6', 're-opening a month drops the record', reopened.status === 200 && !afterReopen.payout,
  JSON.stringify({ status: reopened.status, payout: afterReopen.payout }))
ok('C7', '…and the calculator has its job back — the added work now counts',
  afterReopen.delivered > afterClose.payout.breakdown.delivered,
  JSON.stringify({ now: afterReopen.delivered, frozen: afterClose.payout.breakdown.delivered }))

console.log('\n=== D. closing a month is an admin decision ===')
const notAdmin = await req('/reports/pay/payouts', 'POST', { month }, await tokenOf('Cy'))
ok('D1', 'a crew member cannot record the payroll as paid', notAdmin.status === 403,
  `${notAdmin.status} ${JSON.stringify(notAdmin.data).slice(0, 60)}`)
const peek = await req('/reports/pay/payouts', 'GET', null, await tokenOf('Cy'))
ok('D2', '…nor read everybody else’s', peek.status === 403, String(peek.status))
const mineOwn = await req('/reports/pay/mine/history', 'GET', null, await tokenOf('Cy'))
ok('D3', '…but their OWN history is theirs to read', mineOwn.status === 200,
  `${mineOwn.status} — declared above the admin gate, like /pay/mine`)
// A month that has not happened cannot be paid for.
const future = await req('/reports/pay/payouts', 'POST', { month: '2099-01' })
ok('D4', 'a month that has not happened cannot be closed', future.status === 400, String(future.status))
const nonsense = await req('/reports/pay/payouts', 'POST', { month: 'whenever' })
ok('D5', '…and neither can a month that is not a month', nonsense.status === 400, String(nonsense.status))

console.log('\n=== E. the history says which figures are settled ===')
const hist = (await req('/reports/pay/mine/history?months=6', 'GET', null, await tokenOf('Ann'))).data
ok('E1', 'six months come back, oldest first', hist.months?.length === 6
  && hist.months[0].month < hist.months[5].month,
  JSON.stringify(hist.months?.map((m) => m.month)))
ok('E2', 'this month is marked as still running', hist.months[5].running === true && hist.months[5].settled === false,
  JSON.stringify(hist.months[5]))
// The honest bit. A base salary is paid "whatever the count", so the
// calculator reports a full month for months before somebody joined. That is
// not a lie about the rate card; it would be a lie about the month.
const ghosts = hist.months.slice(0, 5)
ok('E3', 'months with no record of this person working are marked, not claimed',
  ghosts.every((m) => m.delivered === 0 && m.assumed === true),
  JSON.stringify(ghosts.map((m) => ({ m: m.month, d: m.delivered, assumed: m.assumed }))))
ok('E4', '…and this month, which has real work in it, is not',
  hist.months[5].assumed === false && hist.months[5].delivered > 0,
  JSON.stringify({ assumed: hist.months[5].assumed, delivered: hist.months[5].delivered }))

console.log('\n=== F. the payroll tells the admin what has gone out ===')
await req('/reports/pay/payouts', 'POST', { month, user_ids: [ann.id], paid_at: today })
const roll = (await req(`/reports/pay?from=${first}&to=${today}`)).data
const annRow = roll.people.find((p) => p.id === ann.id)
const boRow = roll.people.find((p) => p.id === bo.id)
ok('F1', 'the payroll says which rows are already paid', !!annRow?.payout && !boRow?.payout,
  JSON.stringify({ ann: !!annRow?.payout, bo: !!boRow?.payout }))
ok('F2', '…and how many, so a half-closed month cannot look closed',
  roll.settled === 1 && roll.people.length > 1,
  JSON.stringify({ settled: roll.settled, of: roll.people.length }))
ok('F3', '…and what those rows came to', roll.settledTotal === annRow.payout.total,
  JSON.stringify({ total: roll.settledTotal, ann: annRow.payout.total }))
// Closing twice is one payment, not two — two admins pressing at the same
// moment must not make the month look paid twice.
await req('/reports/pay/payouts', 'POST', { month, user_ids: [ann.id], paid_at: today })
const twice = (await req(`/reports/pay/payouts?month=${month}`)).data
ok('F4', 'closing the same month twice records one payment',
  twice.payouts.filter((p) => p.user_id === ann.id).length === 1,
  JSON.stringify(twice.payouts.map((p) => p.user_id)))

console.log('\n=== G. a board that pays no bonus never mentions one ===')
// The page has been careful since the day it stopped printing "0 UZS" under
// everybody's name: an empty ladder is a statement about the setup, not about
// the person. A goal for a bonus nobody set is exactly that mistake again.
const dee = await person('Dee')
await req(`/reports/pay/rules/${dee.id}`, 'PUT', {
  currency: 'UZS', base: 2000000, per_edit: 0,
  quota: 0, quota_bonus: 0, ontime_bonus: 0, ontime_target: 90, views_target: 0, views_bonus: 0,
})
const flat = await mineFor(dee)
ok('G1', 'a flat salary with no bonuses produces no goals',
  (flat.goals || []).length === 0, JSON.stringify((flat.goals || []).map((g) => g.key)))
ok('G2', '…and is still paid', flat.total === 2000000, String(flat.total))
// A views bonus nobody set a target for is not a goal either.
const eve = await person('Eve')
await req(`/reports/pay/rules/${eve.id}`, 'PUT', {
  currency: 'UZS', base: 0, per_edit: 0, quota: 2, quota_bonus: 100000,
  ontime_bonus: 0, ontime_target: 90, views_target: 0, views_bonus: 250000,
})
const noTarget = await mineFor(eve)
ok('G3', 'a views bonus with no target set is not a goal',
  !goal(noTarget, 'views'), JSON.stringify((noTarget.goals || []).map((g) => g.key)))
ok('G4', '…while the quota, which IS set, is one', !!goal(noTarget, 'quota'))

console.log(`\n${'='.repeat(58)}`)
if (found.length) {
  console.log(`${found.length} FINDING(S):`)
  found.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
} else {
  console.log('Payment suite clean.')
}
process.exit(fails ? 1 : 0)
