// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 73, six things asked for at once:
//
//   1  a channel's shared Drive folder, so a person types "1-3" and not a URL
//   2  a ceiling on what one person can be given for a day, and crew who only
//      appear on the channels they actually work on
//   3  three languages, English the base
//   4  a fourth kind of piece: Target
//   5  a report that counts every hat, and pay worked out from the same counts
//   6  confetti when something finally goes out
//
// The interesting ones here are 1, 2 and 5. Confetti is a canvas that removes
// itself and the languages are a dictionary; both are checked for the thing
// that could actually break — that a key exists in all three languages, and
// that the celebration fires on the CROSSING into done rather than on every
// save of something already finished.
//
// Self-contained: port 4112.
import { spawn } from 'child_process'
import { readFileSync } from 'fs'

const SP = new URL('.', import.meta.url).pathname
const B = 'http://localhost:4112/api'

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
boot([ROOT + '/server/index.js'], { DATA_DIR: SP + 'r73-' + Date.now(), PORT: '4112' })
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
const other = chans[1].key
const stages = (await req('/statuses')).data
const sid = (re) => stages.find((s) => re.test(s.label)).id

const mkUser = async (name, username, role, over = {}) => (await req('/users', 'POST', {
  name, username, password: 'probe123', role, departments: [ch], ...over,
})).data
const op = await mkUser('R73 Olim', 'r73op', 'operator')
const ed = await mkUser('R73 Eldor', 'r73ed', 'editor')
const opT = await login('r73op', 'probe123')
const edT = await login('r73ed', 'probe123')

const mk = (over) => req('/content', 'POST', {
  channels: [ch], type: 'reel', status_id: sid(/to shoot/i), operator_id: op.id, editor_id: ed.id,
  reference_links: ['https://example.com/reference'],
  recording_date: day(1), edit_ready_date: day(2), release_date: day(4), ...over,
})

// ======================= 4. a fourth kind of piece =======================
const target = await mk({ title: 'r73 target piece', type: 'target' })
ok('a Target piece can be made', target.status === 201, JSON.stringify(target.data).slice(0, 160))
ok('…and comes back as one', target.data.type === 'target', String(target.data.type))
// An unknown type has always fallen back rather than blowing up a save —
// that is deliberate and predates this round. What matters is that the
// nonsense is not STORED as a type nothing else understands.
const junkType = await mk({ title: 'r73 nonsense type', type: 'not-a-type' })
ok('…while a made-up type falls back instead of being stored',
  junkType.data.type !== 'not-a-type', String(junkType.data.type))

// ================== 1. the channel's shared Drive folder ==================
const FOLDER = 'https://drive.google.com/drive/folders/R73MAIN'
ok('a channel takes a Drive folder',
  (await req(`/channels/${chans[0].id}`, 'PATCH', { drive_url: FOLDER })).status === 200)
ok('…and refuses something that is not one',
  (await req(`/channels/${chans[0].id}`, 'PATCH', { drive_url: 'my videos folder' })).status === 400)

const piece = (await mk({ title: 'r73 folder piece' })).data
await req(`/content/${piece.id}`, 'PATCH', { milestone: 'shot' }, opT)
// With a folder set, the editor names the file and not the address.
const named = await req(`/content/${piece.id}`, 'PATCH',
  { milestone: 'edited', ready_file: '1-3' }, edT)
ok('an editor can deliver by file name alone', named.status === 200, JSON.stringify(named.data).slice(0, 160))
ok('…stored against the channel folder',
  String(named.data.ready_link || '').startsWith(FOLDER) && named.data.ready_link.includes('1-3'),
  String(named.data.ready_link))
// Still mandatory: naming nothing is naming nothing.
const piece2 = (await mk({ title: 'r73 empty name' })).data
await req(`/content/${piece2.id}`, 'PATCH', { milestone: 'shot' }, opT)
ok('…but an empty name is still refused',
  (await req(`/content/${piece2.id}`, 'PATCH', { milestone: 'edited', ready_file: '   ' }, edT)).status === 400)

// A channel with no folder still wants the whole address.
const bare = chans.find((c) => c.key === other)
await req(`/channels/${bare.id}`, 'PATCH', { drive_url: '' })
const onBare = (await mk({ title: 'r73 no folder', channels: [other] })).data
await req(`/content/${onBare.id}`, 'PATCH', { milestone: 'shot' }, opT)
ok('a channel with no folder still demands a full link',
  (await req(`/content/${onBare.id}`, 'PATCH', { milestone: 'edited', ready_file: '1-3' }, edT)).status === 400)

// ===================== 2. how much one person can take =====================
await req(`/users/${ed.id}`, 'PATCH', { daily_cap: 2 })
const userRow = async (id) => (await req('/users')).data.find((u) => u.id === id)
ok('the cap is stored', (await userRow(ed.id))?.daily_cap === 2,
  String((await userRow(ed.id))?.daily_cap))
const capDay = day(9)
const c1 = await mk({ title: 'r73 cap 1', edit_ready_date: capDay })
const c2 = await mk({ title: 'r73 cap 2', edit_ready_date: capDay })
ok('two cuts for one day are fine', c1.status === 201 && c2.status === 201)
const c3 = await mk({ title: 'r73 cap 3', edit_ready_date: capDay })
ok('the third is refused', c3.status === 409 || c3.status === 400, `${c3.status} ${JSON.stringify(c3.data).slice(0, 140)}`)
ok('…and it says whose limit it is and where to raise it',
  /R73 Eldor/.test(JSON.stringify(c3.data)) && /Admin/.test(JSON.stringify(c3.data)),
  JSON.stringify(c3.data).slice(0, 200))
ok('another day is still free', (await mk({ title: 'r73 cap other day', edit_ready_date: day(10) })).status === 201)
// Moving an existing piece ONTO a full day is the same over-assignment.
const movable = (await mk({ title: 'r73 cap move', edit_ready_date: day(11) })).data
ok('moving a piece onto a full day is refused too',
  [400, 409].includes((await req(`/content/${movable.id}`, 'PATCH', { edit_ready_date: capDay })).status))
// The person with no cap is what everybody was before this existed.
ok('somebody with no cap takes as many as you like',
  (await Promise.all([12, 12, 12, 12].map((d, i) =>
    mk({ title: `r73 uncapped ${i}`, editor_id: op.id, edit_ready_date: day(d) })))).every((r) => r.status === 201))
await req(`/users/${ed.id}`, 'PATCH', { daily_cap: 0 })

// ---- crew scoped to the channels they work on ----
await req(`/users/${ed.id}`, 'PATCH', { crew_channels: [other] })
ok('the scoping is stored',
  JSON.stringify((await userRow(ed.id))?.crew_channels) === JSON.stringify([other]),
  JSON.stringify((await userRow(ed.id))?.crew_channels))
const wrongChannel = await mk({ title: 'r73 wrong channel' })
ok('they cannot be given work on a channel they do not work on',
  wrongChannel.status === 400, `${wrongChannel.status} ${JSON.stringify(wrongChannel.data).slice(0, 140)}`)
ok('…and it says so by name', /R73 Eldor/.test(JSON.stringify(wrongChannel.data)),
  JSON.stringify(wrongChannel.data).slice(0, 160))
ok('…while their own channel is fine',
  (await mk({ title: 'r73 right channel', channels: [other] })).status === 201)
await req(`/users/${ed.id}`, 'PATCH', { crew_channels: [] })
ok('clearing it puts them back on every channel',
  (await mk({ title: 'r73 scoping cleared' })).status === 201)
// The list the pickers are built from has to carry the scoping, or the
// client cannot hide anybody.
ok('/users carries crew_channels and daily_cap for the pickers',
  (await req('/users')).data.every((u) => Array.isArray(u.crew_channels) && typeof u.daily_cap === 'number'))

// ======================= 5. the report, and pay =======================
// Fresh people, so the counts below are exact rather than "whatever the
// fixtures above happened to leave lying around".
const op2 = await mkUser('R73 Rustam', 'r73op2', 'operator')
const ed2 = await mkUser('R73 Sanjar', 'r73ed2', 'editor')
const op2T = await login('r73op2', 'probe123')
const ed2T = await login('r73ed2', 'probe123')
const mk2 = (over) => mk({ operator_id: op2.id, editor_id: ed2.id, ...over })
const editing = stages.find((st) => /editing/i.test(st.label)).id

// One shot handed over on its day, one handed over six days after it.
const onTime = (await mk2({ title: 'r73 shot on its day', recording_date: day(0), edit_ready_date: day(2) })).data
const overdue = (await mk2({ title: 'r73 shot six days late', recording_date: day(-6), edit_ready_date: day(-5) })).data
for (const t of [onTime, overdue]) {
  await req(`/content/${t.id}`, 'PATCH', { milestone: 'shot' }, op2T)
  await req(`/content/${t.id}`, 'PATCH', { status_id: editing })   // the handover
}

const from = day(-30), to = day(1)
const rOp = () => req(`/reports?from=${from}&to=${to}&hat=operator`)
let asOperator = (await rOp()).data
let rustam = asOperator.report.find((r) => r.name === 'R73 Rustam')
ok('both of the operator’s shoots are counted', rustam?.total === 2, JSON.stringify(rustam?.total))
ok('…and the one handed over after its day is marked late', rustam?.late === 1, JSON.stringify(rustam?.late))
ok('…the other is not', rustam?.items.find((i) => i.title.includes('on its day'))?.late === false)

// The one that was silently wrong: shot_at is stamped at the HANDOVER, so a
// shoot sitting on Shot with no editor yet had, by that column alone, never
// happened. Round 72 settled that everywhere else; the report has to agree.
const parked = (await mk2({ title: 'r73 filmed, nobody has picked it up', recording_date: day(-2), edit_ready_date: day(5) })).data
await req(`/content/${parked.id}`, 'PATCH', { milestone: 'shot' }, op2T)
ok('a shoot with nothing stamped on it is still counted once the card says Shot',
  (await rOp()).data.report.find((r) => r.name === 'R73 Rustam')?.total === 3,
  JSON.stringify((await rOp()).data.report.find((r) => r.name === 'R73 Rustam')?.total))
ok('…dated on the day it was due, since nothing recorded when it happened',
  (await rOp()).data.report.find((r) => r.name === 'R73 Rustam')
    ?.items.find((i) => i.title.includes('nobody has picked')).day === day(-2))
ok('…and not called late, because nothing here knows when it happened',
  (await rOp()).data.report.find((r) => r.name === 'R73 Rustam')
    ?.items.find((i) => i.title.includes('nobody has picked')).late === false)

// The editor delivers both cuts today.
for (const t of [onTime, overdue]) {
  await req(`/content/${t.id}`, 'PATCH', { milestone: 'edited', ready_file: String(t.id) }, ed2T)
}
const asEditor = (await req(`/reports?from=${from}&to=${to}&hat=editor`)).data
const sanjar = asEditor.report.find((r) => r.name === 'R73 Sanjar')
ok('the editor’s cuts are counted separately from the shoots', sanjar?.total === 2, JSON.stringify(sanjar?.total))
ok('…and the cut of a piece that reached them late is not charged to them',
  sanjar?.late === 0, JSON.stringify(sanjar?.late))
ok('the default lens is still the assignee, as it always was',
  (await req(`/reports?from=${from}&to=${to}`)).data.hat === 'assignee')
ok('a made-up hat falls back rather than breaking',
  (await req(`/reports?from=${from}&to=${to}&hat=wizard`)).data.hat === 'assignee')
ok('the report can be narrowed to one kind of piece',
  (await req(`/reports?from=${from}&to=${to}&hat=operator&type=target`)).data.totalDone === 0,
  JSON.stringify((await req(`/reports?from=${from}&to=${to}&hat=operator&type=target`)).data.totalDone))

// ---- pay ----
ok('with no rates set, the payroll says so',
  (await req(`/reports/pay?from=${from}&to=${to}`)).data.hasDefault === false)
ok('…and a person sees nothing rather than a zero',
  (await req(`/reports/pay/mine?from=${from}&to=${to}`, 'GET', null, op2T)).data.source === 'none')

const CARD = { base: 1000000, per_shoot: 50000, per_edit: 80000, ontime_bonus: 300000, ontime_target: 90, late_penalty: 20000 }
ok('a default card can be set', (await req('/reports/pay/rules/default', 'PUT', CARD)).status === 201)
ok('a negative rate is refused',
  (await req('/reports/pay/rules/default', 'PUT', { ...CARD, base: -1 })).status === 400)
ok('a target over 100 per cent is refused',
  (await req('/reports/pay/rules/default', 'PUT', { ...CARD, ontime_target: 140 })).status === 400)
ok('…and a refused card changed nothing',
  (await req('/reports/pay/rules')).data.find((r) => !r.user_id)?.base === 1000000)

const payroll = (await req(`/reports/pay?from=${from}&to=${to}`)).data
const pOp = payroll.people.find((p) => p.name === 'R73 Rustam')
ok('the operator is paid for all three shoots', pOp?.lines.find((l) => l.hat === 'operator')?.count === 3,
  JSON.stringify(pOp?.lines.filter((l) => l.count)))
ok('…one of three late, so two thirds on time', pOp?.onTimePct === 67, String(pOp?.onTimePct))
ok('…which misses the 90% bonus', pOp?.bonus === 0, String(pOp?.bonus))
ok('…and costs one deduction', pOp?.penalty === 20000, String(pOp?.penalty))
ok('the operator’s arithmetic adds up',
  pOp?.total === 1000000 + 3 * 50000 - 20000, String(pOp?.total))

const pEd = payroll.people.find((p) => p.name === 'R73 Sanjar')
ok('the editor is paid for two cuts, none of them late',
  pEd?.lines.find((l) => l.hat === 'editor')?.count === 2 && pEd?.late === 0,
  JSON.stringify({ lines: pEd?.lines.filter((l) => l.count), late: pEd?.late }))
ok('…so the on-time bonus is paid whole', pEd?.bonus === 300000, String(pEd?.bonus))
ok('the editor’s arithmetic adds up',
  pEd?.total === 1000000 + 2 * 80000 + 300000, String(pEd?.total))
ok('every row is base + piecework + bonus - deductions, with nothing else in it',
  payroll.people.every((p) => p.total === p.base + p.piecework + p.bonus - p.penalty)
  && payroll.people.every((p) => p.piecework === p.lines.reduce((a, l) => a + l.amount, 0)),
  JSON.stringify(payroll.people.map((p) => [p.name, p.total])))

// Somebody paid differently gets their own card, and it wins.
ok('a person can be put on their own card',
  [200, 201].includes((await req(`/reports/pay/rules/${ed2.id}`, 'PUT', { ...CARD, base: 2000000, per_edit: 100000 })).status))
const p2 = (await req(`/reports/pay?from=${from}&to=${to}`)).data.people.find((p) => p.name === 'R73 Sanjar')
ok('…and it is used instead of the default', p2?.source === 'own' && p2?.base === 2000000,
  JSON.stringify({ source: p2?.source, base: p2?.base }))
ok('…at their own rate, not the default one',
  p2?.lines.find((l) => l.hat === 'editor')?.rate === 100000,
  JSON.stringify(p2?.lines.find((l) => l.hat === 'editor')))
ok('…and nobody else moved', (await req(`/reports/pay?from=${from}&to=${to}`)).data
  .people.find((p) => p.name === 'R73 Rustam')?.source === 'default')
ok('dropping the card puts them back on the default',
  (await req(`/reports/pay/rules/${ed2.id}`, 'DELETE')).status === 200
  && (await req(`/reports/pay?from=${from}&to=${to}`)).data.people.find((p) => p.name === 'R73 Sanjar')?.source === 'default')
ok('the default card itself cannot be dropped',
  (await req('/reports/pay/rules/default', 'DELETE')).status === 400)

// Payroll is not for everybody. Your own pay is.
ok('the crew cannot see the payroll',
  (await req(`/reports/pay?from=${from}&to=${to}`, 'GET', null, ed2T)).status === 403)
ok('the crew cannot see the report either',
  (await req(`/reports?from=${from}&to=${to}`, 'GET', null, ed2T)).status === 403)
ok('the crew cannot set anybody’s rates',
  (await req('/reports/pay/rules/default', 'PUT', CARD, ed2T)).status === 403)
const mine = await req(`/reports/pay/mine?from=${from}&to=${to}`, 'GET', null, op2T)
ok('…but they see their own pay', mine.status === 200 && mine.data.name === 'R73 Rustam',
  JSON.stringify(mine.data).slice(0, 140))
ok('…and only their own', mine.data.id === op2.id, String(mine.data.id))
ok('…and it is the same number the payroll shows',
  mine.data.total === (await req(`/reports/pay?from=${from}&to=${to}`)).data
    .people.find((p) => p.name === 'R73 Rustam')?.total,
  String(mine.data.total))

// ---- the file name people type, and the address that comes out of it ----
// A delivery made through a shared folder is stored as ONE string — the
// folder, a separator, and "1-3". That reads correctly everywhere, and 404s
// the moment anything treats the whole of it as an address. So there is one
// place that takes the address back out of it, and it is the same code on
// both sides of the wire.
const { splitDelivery, deliveryHref, DELIVERY_SEP } = await import(ROOT + '/server/text.js')
const stored = `https://drive.google.com/drive/folders/R73MAIN${DELIVERY_SEP}1-3`
ok('the address comes back out of a folder delivery',
  deliveryHref(stored) === 'https://drive.google.com/drive/folders/R73MAIN', deliveryHref(stored))
ok('…and so does what the person actually typed', splitDelivery(stored).note === '1-3', splitDelivery(stored).note)
ok('a plain pasted link is left exactly as it is',
  deliveryHref('https://youtu.be/abc') === 'https://youtu.be/abc')
ok('and something that is not a link opens nothing',
  deliveryHref('ask Eldor for it') === '' && deliveryHref('') === '' && deliveryHref(null) === '')
ok('the client reads it the same way as the server',
  (await import(ROOT + '/client/src/lib/text.js')).deliveryHref(stored) === deliveryHref(stored))
// The real delivery made earlier in this run has to survive the round trip.
const delivered = (await req(`/content/${piece.id}`)).data.ready_link
ok('the cut delivered by file name opens on the channel’s folder',
  deliveryHref(delivered) === FOLDER, `${delivered} -> ${deliveryHref(delivered)}`)

// ======================= 3. three languages =======================
// The dictionary is the contract: a key added to English without its
// translations shows English to a Russian speaker, silently. So parity is
// checked here rather than discovered by somebody in Tashkent.
const dict = readFileSync(ROOT + '/client/src/lib/i18n.jsx', 'utf8')
const keysOf = (name) => {
  const body = dict.split(`const ${name} = {`)[1]?.split('\n}\n')[0] || ''
  return [...body.matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1])
}
const EN = keysOf('EN'), RU = keysOf('RU'), UZ = keysOf('UZ')
ok('English has a dictionary', EN.length > 50, String(EN.length))
ok('Russian says everything English says', RU.length === EN.length && EN.every((k) => RU.includes(k)),
  JSON.stringify(EN.filter((k) => !RU.includes(k))).slice(0, 200))
ok('Uzbek says everything English says', UZ.length === EN.length && EN.every((k) => UZ.includes(k)),
  JSON.stringify(EN.filter((k) => !UZ.includes(k))).slice(0, 200))
ok('no key is written twice in one language',
  new Set(EN).size === EN.length && new Set(RU).size === RU.length && new Set(UZ).size === UZ.length)
ok('nothing is left in English inside the Russian dictionary',
  /[а-яА-ЯёЁ]/.test(dict.split('const RU = {')[1].split('\n}\n')[0]))
ok('the app is wrapped in the provider',
  /I18nProvider/.test(readFileSync(ROOT + '/client/src/main.jsx', 'utf8')))

// ======================= 6. the party =======================
const cel = readFileSync(ROOT + '/client/src/lib/celebrate.js', 'utf8')
ok('the celebration fires on the crossing into done, not on every save',
  /!before\.done_at && after\.done_at/.test(cel))
ok('…is silent for somebody who asked for less motion',
  /prefers-reduced-motion/.test(cel))
ok('…and takes itself off the page afterwards',
  /canvas\.remove\(\)/.test(cel) && /setTimeout/.test(cel))

stop()
console.log(fails === 0 ? '\nRound-73 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
