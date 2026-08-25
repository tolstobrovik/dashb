// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 76: the KPI section becomes the pay scheme, and ads get a ceiling.
//
// The board has kept KPIs since long before it had a payroll — a row per
// person per goal, with `current` typed in by hand once a month by whoever
// remembered. And then, separately, pay was worked out from the same numbers,
// also by hand, on the same day, by the same person, from a different screen.
//
//   SOURCE     a KPI says which thing the board already counts is its
//              current, and fills itself from the delivery record the report
//              and the payroll already share
//   REWARD     what hitting it is worth, so the KPI section IS the scheme
//   DIRECTION  the one that is expensive to get wrong: "no more than two
//              late" is met by a SMALLER number, and reading every target the
//              same way pays the person who missed the most
//
// Plus two ceilings that prevent rather than refuse: a channel's video ads
// per day, and the crew picker showing a full day before somebody walks into
// it.
//
// Self-contained: port 4115.
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const B = 'http://localhost:4115/api'

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
boot([ROOT + '/server/index.js'], { DATA_DIR: SP + 'r76-' + Date.now(), PORT: '4115' })
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('the stack is up', await up(B + '/health'))

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (n) => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) } // Tashkent day, like the server
const chans = (await req('/channels')).data
const ch = chans[0].key
const chId = chans[0].id
const stages = (await req('/statuses')).data
const sid = (re) => stages.find((s) => re.test(s.label)).id
const editing = sid(/editing/i)

const mkUser = async (name, username, role) => (await req('/users', 'POST', {
  name, username, password: 'probe123', role, departments: [ch],
})).data
const op = await mkUser('R76 Olim', 'r76op', 'operator')
const ed = await mkUser('R76 Eldor', 'r76ed', 'editor')
const opT = await login('r76op', 'probe123')
const edT = await login('r76ed', 'probe123')
const mk = (over) => req('/content', 'POST', {
  channels: [ch], type: 'reel', status_id: sid(/to shoot/i), operator_id: op.id, editor_id: ed.id,
  reference_links: ['https://example.com/reference'],
  recording_date: day(0), edit_ready_date: day(1), release_date: day(4), ...over,
})
// Four cuts delivered on time.
for (let i = 0; i < 4; i++) {
  const t = (await mk({ title: `r76 cut ${i}` })).data
  await req(`/content/${t.id}`, 'PATCH', { milestone: 'shot' }, opT)
  await req(`/content/${t.id}`, 'PATCH', { status_id: editing })
  await req(`/content/${t.id}`, 'PATCH', { milestone: 'edited', ready_link: 'https://drive.google.com/c' }, edT)
}
const from = day(-30), to = day(1)

// ===================== a KPI that counts itself =====================
const sources = (await req('/kpis/sources')).data
ok('the board offers what it can count', sources.length >= 8, JSON.stringify(sources.map((s) => s.key)))
ok('…including video ads, which are their own question',
  sources.some((s) => s.key === 'ads'), JSON.stringify(sources.map((s) => s.key)))

const made = await req('/kpis', 'POST', {
  user_id: ed.id, name: 'Cuts a month', target: '3', unit: 'cuts',
  source: 'cuts', direction: 'atleast', reward: 500000,
})
ok('a KPI can be told what to count itself from', made.status === 201, JSON.stringify(made.data).slice(0, 120))
ok('…and comes back already counted', made.data.actual === 4 && made.data.counted === true,
  JSON.stringify({ actual: made.data.actual, counted: made.data.counted }))
ok('…having read the same delivery record the report reads',
  made.data.actual === (await req(`/reports?from=${from}&to=${to}&hat=editor`)).data
    .report.find((r) => r.name === 'R76 Eldor')?.total,
  String(made.data.actual))
ok('…knows it was hit', made.data.met === true)
ok('…and what that earned', made.data.earned === 500000, String(made.data.earned))

// The Current column stops being something somebody retypes.
const mineKpis = (await req(`/kpis?user_id=${ed.id}`, 'GET', null, edT)).data
ok('the person sees the counted number as their Current', mineKpis[0].current === '4', mineKpis[0].current)
ok('…marked as coming from the work, not from a keyboard', mineKpis[0].counted === true)

// A KPI with no source keeps the old behaviour exactly.
const manual = await req('/kpis', 'POST', { user_id: ed.id, name: 'Tone of voice', target: 'good', current: 'fine' })
ok('a KPI with no source is still whatever somebody typed',
  manual.data.counted === false && manual.data.current === 'fine',
  JSON.stringify({ counted: manual.data.counted, current: manual.data.current }))
ok('…and is worth nothing unless somebody says otherwise', manual.data.earned === 0)
// The one that would quietly pay the wrong people. A KPI whose target is a
// WORD is a goal somebody judges, not a number the board can — and stripping
// the non-digits out of "good" leaves an empty string, which Number() reads
// as 0. Read carelessly, such a KPI reports 0 against a target of 0, calls
// itself met, and pays every month for ever.
const worded = await req('/kpis', 'POST', {
  user_id: ed.id, name: 'Consistency', target: 'good', current: 'fine', reward: 900000,
})
ok('a KPI measured in words has nothing to judge',
  worded.data.met === null && worded.data.actual === null && worded.data.target_num === null,
  JSON.stringify({ met: worded.data.met, actual: worded.data.actual, target: worded.data.target_num }))
ok('…so it pays nothing, however much money is on it',
  worded.data.earned === 0 && worded.data.reward === 900000,
  JSON.stringify({ earned: worded.data.earned, reward: worded.data.reward }))
ok('…and the payroll does not quietly hand it over',
  ((await req(`/reports/pay?from=${from}&to=${to}`)).data.people
    .find((p) => p.name === 'R76 Eldor').kpis.find((k) => k.name === 'Consistency') || {}).earned === 0)
// A target of a real zero is still a real target.
const zero = await req('/kpis', 'POST', {
  user_id: ed.id, name: 'Missed shoots', target: '0', source: 'late_count', direction: 'atmost', reward: 100000,
})
ok('a target of zero is a number, not a blank', zero.data.target_num === 0 && zero.data.met === true,
  JSON.stringify({ target: zero.data.target_num, met: zero.data.met }))
await req(`/kpis/${worded.data.id}`, 'DELETE')
await req(`/kpis/${zero.data.id}`, 'DELETE')

// ===================== the direction that is expensive to get wrong ==========
const late = await req('/kpis', 'POST', {
  user_id: ed.id, name: 'Late pieces', target: '2', source: 'late_count', direction: 'atmost', reward: 200000,
})
ok('"no more than two late" is met by a SMALLER number',
  late.data.actual === 0 && late.data.met === true,
  JSON.stringify({ actual: late.data.actual, met: late.data.met }))
ok('…and pays', late.data.earned === 200000, String(late.data.earned))
// Now make it impossible to meet, and check it is the DIRECTION doing the work.
const flipped = await req(`/kpis/${late.data.id}`, 'PATCH', { direction: 'atleast' })
ok('read the other way round, the same numbers fail it',
  flipped.data.met === false && flipped.data.earned === 0,
  JSON.stringify({ met: flipped.data.met, earned: flipped.data.earned }))
await req(`/kpis/${late.data.id}`, 'PATCH', { direction: 'atmost' })

ok('a source the board cannot count is refused',
  (await req('/kpis', 'POST', { user_id: ed.id, name: 'x', source: 'wizardry' })).status === 400)
ok('a direction that is neither is refused',
  (await req('/kpis', 'POST', { user_id: ed.id, name: 'x', direction: 'sideways' })).status === 400)
ok('a KPI that pays a negative amount is refused',
  (await req('/kpis', 'POST', { user_id: ed.id, name: 'x', reward: -5 })).status === 400)

// ===================== the KPI section IS the pay scheme =====================
await req('/reports/pay/rules/default', 'PUT', { base: 1000000, per_edit: 100000, ontime_target: 90 })
const payOf = async (name) => (await req(`/reports/pay?from=${from}&to=${to}`)).data.people.find((p) => p.name === name)
let pe = await payOf('R76 Eldor')
ok('the payroll picks the KPI money up', pe.kpiEarned === 700000, String(pe.kpiEarned))
ok('…and carries the lines, so nobody takes the total on trust',
  pe.kpis.length === 3 && pe.kpis.every((k) => 'actual' in k && 'target' in k && 'met' in k),
  JSON.stringify(pe.kpis.map((k) => [k.name, k.actual, k.target, k.met])))
ok('…the arithmetic still closes', pe.total === pe.base + pe.piecework + pe.bonus - pe.penalty, String(pe.total))
ok('…and comes to what you would work out by hand',
  pe.total === 1000000 + 4 * 100000 + 700000, String(pe.total))
// The person sees their own, and it agrees to the som.
const own = (await req(`/reports/pay/mine?from=${from}&to=${to}`, 'GET', null, edT)).data
ok('their own page shows the same number', own.total === pe.total, String(own.total))
ok('…with the KPI lines on it', (own.kpis || []).length === 3, String((own.kpis || []).length))
ok('…and which pieces were late, not just how many',
  Array.isArray(own.items) && own.items.every((i) => 'late' in i && 'day' in i),
  JSON.stringify((own.items || []).slice(0, 1)))
ok('a KPI worth nothing still shows, and still earns nothing',
  own.kpis.some((k) => k.reward === 0 && k.earned === 0))

// Raise the target out of reach: the money goes, nothing else moves.
await req(`/kpis/${made.data.id}`, 'PATCH', { target: '40' })
pe = await payOf('R76 Eldor')
ok('a target out of reach withholds its money', pe.kpiEarned === 200000, String(pe.kpiEarned))
ok('…and the piecework is untouched by it', pe.piecework === 400000, String(pe.piecework))
await req(`/kpis/${made.data.id}`, 'PATCH', { target: '3' })

// Nobody reads anybody else's.
ok('the crew cannot read another person’s KPIs',
  (await req(`/kpis?user_id=${op.id}`, 'GET', null, edT)).status === 403)
ok('…nor everybody’s at once', (await req('/kpis?all=1', 'GET', null, edT)).status === 403)
ok('…nor set what a KPI pays', (await req(`/kpis/${made.data.id}`, 'PATCH', { reward: 9 }, edT)).status === 403)

// ===================== how many ads a channel runs in a day =================
ok('a channel takes a daily ad ceiling',
  (await req(`/channels/${chId}`, 'PATCH', { daily_ad_cap: 2 })).status === 200)
ok('…and refuses a nonsense one',
  (await req(`/channels/${chId}`, 'PATCH', { daily_ad_cap: -1 })).status === 400)
const adDay = day(9)
const a1 = await mk({ title: 'r76 ad 1', type: 'target', release_date: adDay })
const a2 = await mk({ title: 'r76 ad 2', type: 'target', release_date: adDay })
const a3 = await mk({ title: 'r76 ad 3', type: 'target', release_date: adDay })
ok('two ads on one day are fine', a1.status === 201 && a2.status === 201)
ok('the third is refused', a3.status === 409, String(a3.status))
ok('…naming the channel, the day and where to change it',
  /already has 2 video ads/.test(a3.data.error || '') && /Admin/.test(a3.data.error || ''), a3.data.error)
ok('a piece that is not an ad is not counted against it',
  (await mk({ title: 'r76 a reel that day', release_date: adDay })).status === 201)
ok('another day is still free',
  (await mk({ title: 'r76 ad 4', type: 'target', release_date: day(10) })).status === 201)
// Dragging one onto a full day is the same over-booking by a different door.
const movable = (await mk({ title: 'r76 ad 5', type: 'target', release_date: day(11) })).data
ok('dragging an ad onto a full day is refused too',
  (await req(`/content/${movable.id}`, 'PATCH', { release_date: adDay })).status === 409)
ok('…and turning something INTO an ad on a full day is refused as well',
  (await req(`/content/${(await mk({ title: 'r76 becomes an ad', release_date: adDay })).data.id}`,
    'PATCH', { type: 'target' })).status === 409)
// No ceiling is what every channel was before this existed.
await req(`/channels/${chId}`, 'PATCH', { daily_ad_cap: 0 })
ok('with no ceiling the day takes as many as you like',
  (await mk({ title: 'r76 ad 6', type: 'target', release_date: adDay })).status === 201)

// ===================== a full day says so BEFORE the save ==================
await req(`/users/${ed.id}`, 'PATCH', { daily_cap: 2 })
const capDay = day(14)
await mk({ title: 'r76 fills 1', edit_ready_date: capDay })
await mk({ title: 'r76 fills 2', edit_ready_date: capDay })
const load = await req(`/content/load?hat=editor_id&day=${capDay}`)
ok('the board says how full each person’s day already is', load.status === 200)
ok('…for the person who is full', load.data[ed.id]?.taken === 2 && load.data[ed.id]?.cap === 2,
  JSON.stringify(load.data[ed.id]))
ok('…and for somebody with no ceiling at all', load.data[op.id]?.cap === 0, JSON.stringify(load.data[op.id]))
ok('…which is the same answer the save would have given',
  (await mk({ title: 'r76 one too many', edit_ready_date: capDay })).status === 409)
ok('a made-up hat is refused rather than answered',
  (await req(`/content/load?hat=wizard&day=${capDay}`)).status === 400)
// The route is one segment, and lives above /:id for that reason.
ok('asking about the load is not read as a task called "load"',
  (await req(`/content/load?hat=editor_id&day=${capDay}`)).status === 200)

stop()
console.log(fails === 0 ? '\nRound-76 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
