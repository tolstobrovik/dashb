// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 74: the board learns to say well done, and to say it in three
// languages.
//
//   the phrase book   every phrase the code asks for exists in Russian and
//                     Uzbek — the guard that keeps "polish it till flawless"
//                     from decaying the first time somebody edits a sentence
//   the standing      a streak is days on which work was really delivered,
//                     and cannot be farmed by clicking
//   the quota         paid apart from punctuality, because "how much" and
//                     "on time" are different questions
//   the crest         drawn heavier below the size where its detail dies
//
// Self-contained: port 4113.
import { spawn } from 'child_process'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const SP = new URL('.', import.meta.url).pathname
const B = 'http://localhost:4113/api'

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
boot([ROOT + '/server/index.js'], { DATA_DIR: SP + 'r74-' + Date.now(), PORT: '4113' })
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
const ch = (await req('/channels')).data[0].key
const stages = (await req('/statuses')).data
const sid = (re) => stages.find((s) => re.test(s.label)).id
const editing = sid(/editing/i)

const mkUser = async (name, username, role) => (await req('/users', 'POST', {
  name, username, password: 'probe123', role, departments: [ch],
})).data
const op = await mkUser('R74 Rasul', 'r74op', 'operator')
const ed = await mkUser('R74 Sarvar', 'r74ed', 'editor')
const opT = await login('r74op', 'probe123')
const edT = await login('r74ed', 'probe123')
const mk = (over) => req('/content', 'POST', {
  channels: [ch], type: 'reel', status_id: sid(/to shoot/i), operator_id: op.id, editor_id: ed.id,
  reference_links: ['https://example.com/reference'],
  recording_date: day(0), edit_ready_date: day(1), release_date: day(4), ...over,
})

// ===================== the phrase book =====================
// The board's sentences are keyed by the English itself, which is what keeps
// the call sites readable. The cost of that shape is that editing an English
// sentence silently orphans its translations — so the pairing is checked here
// rather than discovered by somebody in Tashkent reading half a page of
// English.
const i18n = readFileSync(join(ROOT, 'client/src/lib/i18n.jsx'), 'utf8')
const bookOf = (lang) => {
  const at = i18n.indexOf(`  ${lang}: {`)
  const end = i18n.indexOf('\n  },', at)
  const body = i18n.slice(at, end)
  return new Set([...body.matchAll(/^    "((?:[^"\\]|\\.)*)":/gm)].map((m) => JSON.parse(`"${m[1]}"`)))
}
const RU = bookOf('ru'), UZ = bookOf('uz')
ok('there is a Russian phrase book', RU.size > 200, String(RU.size))
ok('there is an Uzbek one the same size', UZ.size === RU.size, `${UZ.size} vs ${RU.size}`)

// A book is one object literal, so the SAME KEY WRITTEN TWICE is not an
// error — the later line silently wins and the earlier translation is simply
// never used again. That is how the attendance register came to head its Late
// column "Штраф": a pay table further down the book had claimed the word for
// its penalty line. Every check above reads the book into a Set, which is
// exactly the shape that cannot see this. So it is counted in the text.
const linesOf = (lang) => {
  const at = i18n.indexOf(`  ${lang}: {`)
  return [...i18n.slice(at, i18n.indexOf('\n  },', at))
    .matchAll(/^    "((?:[^"\\]|\\.)*)":/gm)].map((m) => JSON.parse(`"${m[1]}"`))
}
const twice = (lang) => {
  const seen = new Set(), dup = []
  for (const k of linesOf(lang)) { if (seen.has(k)) dup.push(k); seen.add(k) }
  return dup
}
ok('no phrase is written twice in the Russian book — the second would win in silence',
  twice('ru').length === 0, JSON.stringify(twice('ru').slice(0, 8)))
ok('…nor in the Uzbek one', twice('uz').length === 0, JSON.stringify(twice('uz').slice(0, 8)))

// Every tx('…') the codebase asks for, gathered from the source itself.
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : (/\.jsx?$/.test(p) ? [p] : [])
})
const asked = new Set()
for (const f of walk(join(ROOT, 'client/src'))) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/\btx\(\s*(["'])((?:[^\\]|\\.)*?)\1/g)) {
    try { asked.add(JSON.parse(m[1] === '"' ? `"${m[2]}"` : `"${m[2].replace(/"/g, '\\"')}"`)) } catch { /* skip odd quoting */ }
  }
}
ok('the code asks for a few hundred phrases', asked.size > 250, String(asked.size))
const missRU = [...asked].filter((p) => !RU.has(p))
const missUZ = [...asked].filter((p) => !UZ.has(p))
ok('every phrase the code asks for is in Russian', missRU.length === 0,
  JSON.stringify(missRU.slice(0, 6)))
ok('…and in Uzbek', missUZ.length === 0, JSON.stringify(missUZ.slice(0, 6)))
// Nothing in the book should be Russian-only or Uzbek-only either way round.
ok('the two books hold exactly the same phrases',
  [...RU].every((p) => UZ.has(p)), JSON.stringify([...RU].filter((p) => !UZ.has(p)).slice(0, 6)))
// A translation that is still the English is not a translation. Read the
// VALUES, not the keys: a book full of entries that all say the English back
// would have passed every check above.
const valuesOf = (lang) => {
  const at = i18n.indexOf(`  ${lang}: {`)
  const end = i18n.indexOf('\n  },', at)
  const out = new Map()
  for (const m of i18n.slice(at, end).matchAll(/^    "((?:[^"\\]|\\.)*)": "((?:[^"\\]|\\.)*)",$/gm)) {
    out.set(JSON.parse(`"${m[1]}"`), JSON.parse(`"${m[2]}"`))
  }
  return out
}
const ruV = valuesOf('ru'), uzV = valuesOf('uz')
ok('the Russian book was read as pairs', ruV.size === RU.size, `${ruV.size} vs ${RU.size}`)
// Words that are the same in every language — a brand, a key name, a file
// format — are allowed to stay as they are. Everything else must have moved.
// "reels / %…" is a units placeholder — it shows the shape of an answer, not
// a sentence, and reads the same in every language on this team.
const SAME = /^(esc|reels|portfolio|KPIs?|Target|Board|Word|PDF|Excel|PowerPoint|reels \/ %…)$/i
const untranslated = [...ruV].filter(([en, ru]) => en.length > 8 && !SAME.test(en) && !/[а-яА-ЯёЁ]/.test(ru))
ok('every Russian phrase of any length is actually in Russian',
  untranslated.length === 0, JSON.stringify(untranslated.slice(0, 6)))
// Uzbek is Latin script, so the test is that it is not simply the English.
const echoed = [...uzV].filter(([en, uz]) => en.length > 8 && !SAME.test(en) && uz === en)
ok('…and no Uzbek phrase is just the English echoed back',
  echoed.length === 0, JSON.stringify(echoed.slice(0, 6)))

// The dotted keys keep their own parity, as round 73 required.
const dictOf = (name) => {
  const at = i18n.indexOf(`const ${name} = {`)
  const end = i18n.indexOf('\n}\n', at)
  return new Set([...i18n.slice(at, end).matchAll(/^  '([^']+)':/gm)].map((m) => m[1]))
}
const EN = dictOf('EN')
ok('the keyed dictionaries are still in step',
  dictOf('RU').size === EN.size && dictOf('UZ').size === EN.size,
  `${EN.size}/${dictOf('RU').size}/${dictOf('UZ').size}`)

// ===================== the standing =====================
let mine = (await req('/rewards/mine', 'GET', null, edT)).data
ok('somebody who has done nothing has nothing to show',
  mine.total === 0 && mine.streak === 0 && mine.points === 0, JSON.stringify(mine))
ok('…and is pointed at the first rung', mine.nextMilestone === 1, String(mine.nextMilestone))

// Three cuts today.
for (let i = 0; i < 3; i++) {
  const t = (await mk({ title: `r74 cut ${i}` })).data
  await req(`/content/${t.id}`, 'PATCH', { milestone: 'shot' }, opT)
  await req(`/content/${t.id}`, 'PATCH', { status_id: editing })
  await req(`/content/${t.id}`, 'PATCH', { milestone: 'edited', ready_link: 'https://drive.google.com/c' }, edT)
}
mine = (await req('/rewards/mine', 'GET', null, edT)).data
ok('three cuts count as three', mine.total === 3, String(mine.total))
ok('…all on one day, so the streak is one day', mine.streak === 1, String(mine.streak))
ok('…and today says three', mine.today === 3, String(mine.today))
ok('points are the plain weighted count', mine.points === 30, String(mine.points))
ok('the fifth is the rung being walked towards', mine.nextMilestone === 5 && mine.toNextMilestone === 2,
  JSON.stringify({ next: mine.nextMilestone, to: mine.toNextMilestone }))
ok('landing exactly on a rung is what gets announced', mine.atMilestone === null, String(mine.atMilestone))

// A fourth and fifth — the fifth lands on a rung.
for (let i = 3; i < 5; i++) {
  const t = (await mk({ title: `r74 cut ${i}` })).data
  await req(`/content/${t.id}`, 'PATCH', { milestone: 'shot' }, opT)
  await req(`/content/${t.id}`, 'PATCH', { status_id: editing })
  await req(`/content/${t.id}`, 'PATCH', { milestone: 'edited', ready_link: 'https://drive.google.com/c' }, edT)
}
mine = (await req('/rewards/mine', 'GET', null, edT)).data
ok('the fifth lands on a rung, and says so', mine.atMilestone === 5, String(mine.atMilestone))
ok('…and the next one is ten', mine.nextMilestone === 10, String(mine.nextMilestone))

// A streak is days of DELIVERY. Opening the page, saving a draft, moving a
// date — none of it counts, which is the whole point.
const before = (await req('/rewards/mine', 'GET', null, edT)).data.streak
await req('/content', 'POST', { channels: [ch], type: 'post', status_id: sid(/^idea$/i), title: 'r74 just an idea' })
await req('/rewards/mine', 'GET', null, edT)
ok('making a task is not delivering one',
  (await req('/rewards/mine', 'GET', null, edT)).data.streak === before)
ok('asking twice does not raise the count',
  (await req('/rewards/mine', 'GET', null, edT)).data.total === 5)

// A shoot handed over on a past day extends the streak backwards, which is
// what makes it a record of work rather than of logins.
const old = (await mk({ title: 'r74 older shoot', recording_date: day(-1) })).data
await req(`/content/${old.id}`, 'PATCH', { milestone: 'shot' }, opT)
const opStand = (await req('/rewards/mine', 'GET', null, opT)).data
ok('the operator has a standing of their own', opStand.total >= 6, String(opStand.total))
ok('…and it is counted under their hat', !!opStand.byHat.operator, JSON.stringify(Object.keys(opStand.byHat)))

// Nobody sees anybody else's.
ok('there is no way to ask for somebody else’s standing',
  (await req(`/rewards/mine?user=${op.id}`, 'GET', null, edT)).data.total === 5)

// ===================== the quota =====================
const CARD = { base: 1000000, per_edit: 100000, quota: 5, quota_bonus: 400000, ontime_bonus: 200000, ontime_target: 90, late_penalty: 50000 }
ok('a card with a quota can be set', [200, 201].includes((await req('/reports/pay/rules/default', 'PUT', CARD)).status))
const from = day(-30), to = day(1)
const payOf = async (name) => (await req(`/reports/pay?from=${from}&to=${to}`)).data.people.find((p) => p.name === name)
let pe = await payOf('R74 Sarvar')
ok('five of five is the quota met', pe.quotaMet === true && pe.quotaLeft === 0,
  JSON.stringify({ met: pe.quotaMet, left: pe.quotaLeft }))
ok('…so the quota bonus is paid whole', pe.quotaBonus === 400000, String(pe.quotaBonus))
ok('…and the on-time bonus is paid apart from it', pe.onTimeBonus === 200000, String(pe.onTimeBonus))
ok('…which is a different number from their sum being one bonus',
  pe.bonus === pe.quotaBonus + pe.onTimeBonus, JSON.stringify({ bonus: pe.bonus }))
ok('the arithmetic closes', pe.total === pe.base + pe.piecework + pe.bonus - pe.penalty, String(pe.total))
ok('…and comes to what you would work out by hand',
  pe.total === 1000000 + 5 * 100000 + 400000 + 200000, String(pe.total))

// Raise the quota out of reach: the bonus goes, punctuality stays.
await req('/reports/pay/rules/default', 'PUT', { ...CARD, quota: 40 })
pe = await payOf('R74 Sarvar')
ok('a quota out of reach withholds its bonus', pe.quotaBonus === 0 && pe.quotaMet === false)
ok('…and says how many are left', pe.quotaLeft === 35, String(pe.quotaLeft))
ok('…while punctuality is still paid, because it is a different question',
  pe.onTimeBonus === 200000, String(pe.onTimeBonus))
// No quota at all is what everybody was before this existed.
await req('/reports/pay/rules/default', 'PUT', { ...CARD, quota: 0, quota_bonus: 400000 })
pe = await payOf('R74 Sarvar')
ok('no quota means no quota bonus and no nagging',
  pe.quotaBonus === 0 && pe.quota === 0 && pe.quotaLeft === null, JSON.stringify({ q: pe.quota, left: pe.quotaLeft }))

// Their own view agrees with the payroll, to the som.
await req('/reports/pay/rules/default', 'PUT', CARD)
const own = (await req(`/reports/pay/mine?from=${from}&to=${to}`, 'GET', null, edT)).data
ok('a person’s own pay matches the payroll exactly',
  own.total === (await payOf('R74 Sarvar')).total, String(own.total))
ok('…including the quota they are being measured against', own.quota === 5, String(own.quota))

// ===================== the crest =====================
// A logo that is only checked at 200px is a logo nobody has looked at.
const logo = readFileSync(join(ROOT, 'client/src/components/Logo.jsx'), 'utf8')
ok('the mark knows how big it is', /COMPACT_BELOW/.test(logo))
ok('…and draws heavier when small', /compact \? 9\.5 : 7|compact \? 10 : 9/.test(logo))
ok('…dropping the rosette, which cannot survive it', /!compact && \(/.test(logo))
const fav = readFileSync(join(ROOT, 'client/public/favicon.svg'), 'utf8')
ok('the favicon takes the compact cut, being 16px', /stroke-width="9.5"/.test(fav))
const html = readFileSync(join(ROOT, 'client/index.html'), 'utf8')
ok('both faces are actually fetched, not just named',
  /family=Inter/.test(html) && /Golos\+Text/.test(html), html.match(/css2\?[^"]*/)?.[0] || '')
const css = readFileSync(join(ROOT, 'client/src/styles.css'), 'utf8')
ok('the display face is one with Cyrillic in it', /--font-display: 'Golos Text'/.test(css))

stop()
console.log(fails === 0 ? '\nRound-74 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
