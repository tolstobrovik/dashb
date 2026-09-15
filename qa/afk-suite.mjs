// Time that is actually somebody working.
//
// The clock used to run whenever the tab was VISIBLE, which counts three
// things that are not work: a window parked on a second monitor all afternoon,
// a board left open on a desk while its owner is at lunch, and — the easiest
// one to do without meaning to — a second tab, which used to accrue a second
// second for every second.
//
// Three conditions now, all of them at once: visible, focused, and input in
// the last thirty seconds. And one tab holds the clock, claimed through
// localStorage and handed on when a tab goes.
//
// This suite waits in real time, because there is no other honest way to ask
// a clock whether it is running. It is about a minute and a half.
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
const u = (await req('/users', 'POST', { name: 'AFK Suite', username: `afk${stamp}`, password: 'a1234', departments: ['youtube'] })).data
const secondsOf = async (id) => {
  const d = (await req('/usage?from=2020-01-01&to=2999-01-01')).data
  const rows = d.people || d.rows || d
  const me = (Array.isArray(rows) ? rows : []).find((x) => x.id === id || x.user_id === id)
  return me ? (me.seconds || 0) : 0
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', `afk${stamp}`); await page.fill('input[name="password"]', 'a1234')
await page.click('button[type="submit"]'); await page.waitForTimeout(2500)

// The heartbeat leaves once a minute and there is no honest way to make it
// leave sooner from out here, so this measures over a window long enough for
// beats to land and asks what the total says. That is the only question that
// matters anyway: does the number the admin reads match the time somebody
// actually spent, or does it match how long the tab was open.

// ---- 40 seconds of use, then 80 seconds of nothing ----
// A clock that counts visible time would call this 120. A clock that counts
// somebody being there calls it about 70: the 40, plus the 30 second grace
// before it decides they have gone.
const t0 = Date.now()
for (let i = 0; i < 40; i++) { await page.mouse.move(100 + (i % 30), 200); await page.waitForTimeout(1000) }
await page.waitForTimeout(80000)
await page.waitForTimeout(8000)                       // let the beat land
const wall = Math.round((Date.now() - t0) / 1000)
const counted = await secondsOf(u.id)
ok('the clock does not simply count the tab being open', counted < wall - 25, `counted ${counted}s of ${wall}s open`)
ok('…it counts about the time somebody was actually there', counted >= 30 && counted <= 90, `${counted}s`)

// ---- a second tab is not a second person ----
const before = counted
const two = await ctx.newPage()
await two.goto(BASE + '/brief'); await two.waitForTimeout(2000)
await page.bringToFront(); await page.waitForTimeout(500)
const t1 = Date.now()
for (let i = 0; i < 45; i++) { await page.mouse.move(200 + (i % 20), 300); await page.waitForTimeout(1000) }
await page.waitForTimeout(25000)                      // let the beat land
const twoWall = Math.round((Date.now() - t1) / 1000)
const twoGain = (await secondsOf(u.id)) - before
ok('two tabs on one account do not count double', twoGain <= twoWall + 15, `gained ${twoGain}s over ${twoWall}s with two tabs open`)
await browser.close()

await req(`/users/${u.id}`, 'DELETE')
console.log(fails === 0 ? '\nAFK suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
