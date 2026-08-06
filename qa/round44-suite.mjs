// Round 44: the Unassigned page stops nagging about work that sits far
// ahead in the calendar. The default date pill is "Due soon" — a task shows
// only when its NEAREST date (shoot or release) stands within 3 days, or
// when it is overdue or has no date at all (those ARE the emergencies).
// "Any date" is one tap away and remembered; Overview's gap strip keeps the
// same horizon so its number and the page agree. Runs on the main 4090.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x44:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
}
await cleanup()
const sts = (await req('/statuses')).data
const sid = (re) => sts.find((s) => re.test(s.label)).id
const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + n * 864e5))

// three reels with people-gaps: far ahead (+10), shoot tomorrow (release +10),
// and dateless — plus one task fully staffed far ahead (never shows anywhere)
const far = (await req('/content', 'POST', { title: 'x44: far ahead reel', channels: ['youtube'], type: 'reel', release_date: day(10), status_id: sid(/to shoot/i) })).data
await req('/content', 'POST', { title: 'x44: shooting tomorrow', channels: ['youtube'], type: 'reel', recording_date: day(1), release_date: day(10), status_id: sid(/to shoot/i) })
await req('/content', 'POST', { title: 'x44: dateless reel', channels: ['youtube'], type: 'reel', status_id: sid(/to shoot/i) })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })

// ---- the default horizon ----
await p.goto(BASE + '/unassigned'); await p.waitForTimeout(1400)
ok('the page opens on "Due soon"', (await p.locator('.pill.active', { hasText: 'Due soon' }).count()) === 1)
ok('work sitting far ahead stays off the page', (await p.locator('text=x44: far ahead reel').count()) === 0)
ok('a shoot booked for tomorrow shows — whatever its release', (await p.locator('text=x44: shooting tomorrow').count()) === 1)
ok('dateless work always shows', (await p.locator('text=x44: dateless reel').count()) === 1)

// ---- one tap widens the view, and the choice is remembered ----
await p.locator('.pill', { hasText: 'Any date' }).click()
await p.waitForTimeout(600)
ok('"Any date" brings the far work back', (await p.locator('text=x44: far ahead reel').count()) === 1)
await p.reload(); await p.waitForTimeout(1400)
ok('the choice survives a reload', (await p.locator('.pill.active', { hasText: 'Any date' }).count()) === 1 &&
  (await p.locator('text=x44: far ahead reel').count()) === 1)
await p.locator('.pill', { hasText: 'Due soon' }).click()
await p.waitForTimeout(400)

// ---- every deadline counts, and the row explains itself ----
// A cut due tomorrow makes the task urgent whatever its release; a shoot
// that already slipped keeps it on the page — and the date cell shows THE
// date that pulled it in (its kind's icon, marked late), never a far-off
// release that would make the row look like it sneaked in early.
await req('/content', 'POST', { title: 'x44: cut due tomorrow', channels: ['youtube'], type: 'reel', edit_ready_date: day(1), release_date: day(10), status_id: sid(/editing/i) })
await req('/content', 'POST', { title: 'x44: shot slipped', channels: ['youtube'], type: 'reel', recording_date: day(-2), release_date: day(6), status_id: sid(/to shoot/i) })
await p.reload(); await p.waitForTimeout(1400)
ok('a cut deadline pulls the task in — release still far', (await p.locator('text=x44: cut due tomorrow').count()) === 1)
const slipped = p.locator('.ov-row', { hasText: 'x44: shot slipped' })
ok('an overdue shoot keeps the task on the page', (await slipped.count()) === 1)
ok('…and the row shows the slipped SHOOT date, marked late',
  (await slipped.locator('.ov-date.late').count()) === 1 && (await slipped.locator('.ov-date svg').count()) === 1)

// ---- Overview's strip keeps the same horizon ----
await p.goto(BASE + '/overview'); await p.waitForTimeout(1200)
const stripCount = async () => {
  const el = p.locator('.ov-gaps b')
  return (await el.count()) ? Number(await el.textContent()) : 0
}
const withFar = await stripCount()
await req(`/content/${far.id}`, 'DELETE')
await p.reload(); await p.waitForTimeout(1200)
ok('the far-ahead task never bumped the Overview strip', (await stripCount()) === withFar, `with=${withFar}`)

await p.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-44 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
