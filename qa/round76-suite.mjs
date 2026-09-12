// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 76: ads get a ceiling.
//
// This suite also covered the KPI section that became the pay scheme. KPIs
// were removed in round 82 — the shelf keeps the documents and nothing else —
// so what is left here is the half about ad ceilings, which still stands.
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
