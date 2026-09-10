// A month, graded against the card the admin set.
//
// Every KPI sheet this team runs on is the same object in a different suit: a
// METRIC, five BANDS from A+ down to D, and what each band pays. The skip rate
// on a reel, quality leads out of all leads, channel growth against plan,
// deadline misses, flawed days. Some are gated — a floor the whole bonus sits
// behind, so under 80% of the lead plan the leads bonus pays nothing at all
// however good the quality was.
//
// None of the numbers live in the code. What is checked here is that the SHAPE
// reads correctly: the right band for a value, the floor that holds a bonus
// back, a metric the board measures itself, one that has to be typed in, and
// one nobody has taken a reading for — which is not the same as a zero.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const stamp = Date.now()
const MONTH = new Date().toISOString().slice(0, 7)
const DAY = new Date().toISOString().slice(0, 10)
const statuses = (await req('/statuses')).data
const published = statuses.find((s) => s.is_final && !/deleted/i.test(s.label)).id

const who = (await req('/users', 'POST', {
  name: 'KPI Suite', username: `kpi${stamp}`, password: 'k1234',
  departments: ['instagram_main'], crew_roles: ['operator', 'editor'],
})).data
const ME = await login(`kpi${stamp}`, 'k1234')

// Three reels, filmed and cut by them, at 30 / 34 / 38 per cent skip.
for (const sk of [30, 34, 38]) {
  const t = (await req('/content', 'POST', {
    title: `kpi ${stamp} reel ${sk}`, type: 'reel', channels: ['instagram_main'], status_id: published,
    operator_id: who.id, editor_id: who.id, recording_date: DAY,
    shot_at: `${DAY}T09:00:00Z`, edited_at: `${DAY}T10:00:00Z`, done_at: `${DAY}T11:00:00Z`,
  })).data
  await req(`/content/${t.id}`, 'PATCH', { skip_rate: sk })
}

const SKIP = [
  { grade: 'A+', to: 34.9, pays: 300 }, { grade: 'A', from: 35, to: 44.9, pays: 240 },
  { grade: 'B', from: 45, to: 49.9, pays: 180 }, { grade: 'C', from: 50, to: 54.9, pays: 120 },
  { grade: 'D', from: 55, pays: 0 },
]
const put = (body) => req(`/reports/kpi/${who.id}/${MONTH}`, 'PUT', body)

// ===================== the board's own metric =====================
let r = await put({ currency: 'USD', fixed: 400, ladders: [
  { key: 'skip', label: 'Skip rate', metric: 'skip_rate', unit: '%', bands: SKIP },
  { key: 'late', label: 'On time', metric: 'late', bands: [
    { grade: 'A+', to: 1, pays: 100 }, { grade: 'A', from: 2, to: 2, pays: 75 },
    { grade: 'B', from: 3, to: 3, pays: 50 }, { grade: 'D', from: 4, pays: 0 }] },
] })
ok('a card is saved', r.status === 200, `${r.status} ${r.data.error || ''}`)
let card = r.data.card
const line = (k) => card.ladders.find((l) => l.key === k)
ok('the skip rate is averaged off the pieces themselves', line('skip').value === 34, String(line('skip')?.value))
ok('…and lands in the band the sheet says it does', line('skip').grade === 'A+' && line('skip').pays === 300, `${line('skip')?.grade} ${line('skip')?.pays}`)
ok('nothing was late, which is its own ladder', line('late').value === 0 && line('late').grade === 'A+', `${line('late')?.value} ${line('late')?.grade}`)
ok('the month totals the floor plus what the grades paid', card.total === 400 + 300 + 100, String(card.total))

// ===================== a floor the bonus sits behind =====================
const GATED = {
  currency: 'UZS', fixed: 8000000, ladders: [{
    key: 'leads', label: 'Quality leads', metric: 'manual', unit: '%',
    gate: { metric: 'manual', min: 80 },
    bands: [{ grade: 'A+', from: 50, pays: 3000000 }, { grade: 'A', from: 40, to: 49.9, pays: 2000000 },
      { grade: 'D', to: 39.9, pays: 0 }],
  }],
}
card = (await put({ ...GATED, readings: { leads: 50, leads_gate: 60 } })).data.card
ok('a bonus under its floor pays nothing, however good the number is',
  line('leads').pays === 0 && !!line('leads').gated, JSON.stringify(line('leads')?.gated))
ok('…and says which floor, rather than showing a bare nought',
  line('leads').gated.need === 80 && line('leads').gated.got === 60, JSON.stringify(line('leads')?.gated))
card = (await put({ ...GATED, readings: { leads: 50, leads_gate: 85 } })).data.card
ok('…and pays in full once the floor is cleared',
  line('leads').grade === 'A+' && line('leads').pays === 3000000, `${line('leads')?.grade} ${line('leads')?.pays}`)

// ===================== a number nobody took =====================
card = (await put({ ...GATED, readings: {} })).data.card
ok('a metric with no reading is not a D', line('leads').grade === null && line('leads').value === null, JSON.stringify(line('leads')))

// ===================== whose card it is =====================
ok('somebody reads their own card', (await req('/reports/kpi/mine', 'GET', null, ME)).status === 200)
ok('…and not the payroll', (await req(`/reports/kpi/${who.id}`, 'GET', null, ME)).status === 403)
r = await put({ fixed: 0, ladders: [{ key: 'bad', metric: 'nonsense', bands: SKIP }] })
ok('a metric the board cannot read is refused', r.status === 400, `${r.status} ${r.data.error || ''}`)

// ===================== and it reaches the page =====================
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await put({ currency: 'USD', fixed: 400, ladders: [{ key: 'skip', label: 'Skip rate', metric: 'skip_rate', unit: '%', bands: SKIP }] })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', `kpi${stamp}`); await page.fill('input[name="password"]', 'k1234')
await page.click('button[type="submit"]'); await page.waitForTimeout(2400)
await page.goto(BASE + '/docs'); await page.waitForTimeout(2600)
ok('the Payment page shows the month’s KPI', (await page.locator('.kpi-card').count()) === 1)
ok('…with the grade beside the ladder', (await page.locator('.kpi-grade').first().textContent()) === 'A+')
const before = (await page.locator('.kpi-line').first().textContent())
ok('…and the amount hidden until it is asked for', /•/.test(before), before)
await page.locator('.my-pay-eye').first().click(); await page.waitForTimeout(700)
ok('…which the eye reveals', /300/.test(await page.locator('.kpi-line').first().textContent()))
await browser.close()

await req(`/users/${who.id}`, 'DELETE')
console.log(fails === 0 ? '\nKPI suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
