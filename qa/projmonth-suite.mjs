// One month of projects at a time — and a project that runs past the end of
// the month is in both.
//
// A project is not a day, it is a stretch: started then, due then. Filtering
// on the deadline alone would file a project that ran from 20 August to the
// middle of September under September only, and drop it out of August — the
// month most of the work happened in. So the filter asks whether the stretch
// TOUCHES the month, and a straddling project answers yes twice.
//
// The strip only offers months that hold something, so it is as long as the
// work is and never longer; an open project with no deadline is live rather
// than scheduled, and sits in this month alone rather than in every month
// since it was started, dragging empty months into the strip behind it.
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
// A project starts when it is made, and there is no way to make one in the
// past — so the fixtures run from TODAY, and the two cases are told apart by
// where they END. One finishes inside this month; the other runs on into the
// next, which is the whole case this filter exists for.
const d = new Date()
const ym = (n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 7)
const A = ym(0), Bm = ym(1)   // this month, and the next
const lastDay = (m) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10) }
const stamp = Date.now()
const mk = async (name, deadline) => (await req('/projects', 'POST', { name: `${name} ${stamp}`, deadline })).data
const only = await mk('PM-ONLY-A', lastDay(A))   // starts and ends inside this month
const both = await mk('PM-STRADDLE', `${Bm}-14`) // starts this month, runs into the next
const later = await mk('PM-ONLY-B', `${Bm}-25`)  // also runs into the next, ends later

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin'); await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]'); await page.waitForTimeout(2200)
await page.goto(BASE + '/projects'); await page.waitForTimeout(2200)

const strip = page.locator('.proj-months')
ok('the projects list grows a month strip', (await strip.count()) === 1)
const pills = (await strip.locator('.pill').allTextContents()).map((s) => s.trim())
ok('…that starts with All', pills[0] === 'All', JSON.stringify(pills))
ok('…and offers only months that hold something', pills.length > 1 && pills.length < 24, `${pills.length} pills`)

const names = async () => (await page.locator('.proj-name').allTextContents()).map((s) => s.trim())
const pick = async (label) => { await strip.locator('.pill', { hasText: label }).first().click(); await page.waitForTimeout(500) }
const seen = (list, p) => list.some((n) => n.includes(p.name))

const all = await names()
ok('All shows every project', seen(all, only) && seen(all, both) && seen(all, later))

const monthName = (s) => new Date(`${s}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
await pick(monthName(Bm))
const inB = await names()
ok('next month holds the projects that run into it', seen(inB, later) && seen(inB, both), JSON.stringify(inB.slice(0, 4)))
ok('…but not the one that finished before it started', !seen(inB, only))

await pick(monthName(A))
const inA = await names()
ok('this month holds the one that starts and ends inside it', seen(inA, only), JSON.stringify(inA.slice(0, 4)))
ok('…and the SAME straddling project, because it is running now too', seen(inA, both))

await pick(monthName(Bm))
ok('…which is the point: it is in both months, not filed under one',
  seen(await names(), both) && seen(inA, both))

await pick('All')
ok('All comes back to everything', (await names()).length >= all.length)

await browser.close()
for (const p of [only, both, later]) await req(`/projects/${p.id}`, 'DELETE')
console.log(fails === 0 ? '\nProject-month suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
