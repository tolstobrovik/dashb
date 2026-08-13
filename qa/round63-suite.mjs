// Round 63: the board is not allowed to lie about the day.
//
// Every page renders from the instant-boot cache first and swaps in fresh data
// when the network answers. That is what makes the app feel quick — and it was
// also hiding total failure. The opening load was
//
//     Promise.all([...]).then(setState).finally(() => setLoading(false))
//
// on all eleven loading pages, with no .catch anywhere. So when the load
// failed: the rejection went unhandled, the spinner cleared on schedule, and
// the screen kept showing the LAST data that arrived — looking exactly like a
// working board. Measured with the API answering 500 to everything, Overview
// still rendered 2542 of its usual 2544 characters and said nothing at all.
//
// On a board people read to decide what to film today, yesterday's plan
// presented as today's is the worst possible failure mode: strictly worse than
// an error, because an error sends you to ask someone. The load now catches,
// and says so.
//
// Runs against the shared 4090 stack.
import { chromium } from 'playwright'

const BASE = 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await ctx.newPage()
const threw = []
page.on('pageerror', (e) => threw.push(e.message))

await page.goto(BASE + '/login')
await page.fill('input[name="username"], input[autocomplete="username"]', 'admin')
await page.fill('input[type="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 25000 })

const settle = async (pg) => {
  await pg.waitForFunction(() => !document.querySelector('.app-loading'), null, { timeout: 20000 })
    .catch(() => { /* still spinning — asserted on below */ })
  await pg.waitForTimeout(900)
}
// Break every API call except auth, so the session survives and it is only the
// page's own data that cannot be fetched — a dead backend, not a logout.
const breakApi = (pg) => pg.route('**/api/**', (r) =>
  /\/api\/auth\//.test(r.request().url())
    ? r.continue()
    : r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"backend down"}' }))

// Representative of the eleven: one dense read-only board, one list page, one
// admin page. All three take the same Promise.all shape.
for (const path of ['/overview', '/projects', '/team']) {
  // A warm visit first, so the cache holds a full screen of real rows —
  // without this the failure would show as an empty page, which is honest by
  // accident and would not prove anything.
  await page.goto(BASE + path)
  await settle(page)
  const warm = (await page.evaluate(() => (document.querySelector('.app-main, main, #root')?.innerText || '').trim())).length
  ok(`${path} renders a full screen when the server is healthy`, warm > 100, `${warm} chars`)

  threw.length = 0
  await breakApi(page)
  await page.goto(BASE + path)
  await settle(page)
  const after = await page.evaluate(() => ({
    len: (document.querySelector('.app-main, main, #root')?.innerText || '').trim().length,
    spinner: !!document.querySelector('.app-loading'),
    toast: document.querySelector('.toast.err')?.innerText || '',
  }))
  await page.unroute('**/api/**')

  // The page is still showing the cached screen — that is the accelerator
  // working, and it is fine ONLY because the next assertion holds.
  ok(`${path} still shows the last data it had`, after.len > 40, `${after.len} chars`)
  ok(`${path} SAYS the data is stale`, /could not refresh/i.test(after.toast), JSON.stringify(after.toast) || '(no error toast)')
  ok(`${path} does not leave the spinner up`, !after.spinner)
  ok(`${path} no longer throws an unhandled rejection`, threw.length === 0, threw.slice(0, 2).join(' | '))
}

// The message has to carry the one fact that matters: what you are looking at
// is old. "Something went wrong" would pass a toast check and still leave the
// reader believing the board.
await page.goto(BASE + '/overview')
await settle(page)
await breakApi(page)
await page.goto(BASE + '/overview')
await settle(page)
const msg = await page.evaluate(() => document.querySelector('.toast.err')?.innerText || '')
await page.unroute('**/api/**')
ok('the message says the data is old, not merely that something broke',
  /last data|last loaded|stale|reached you/i.test(msg), JSON.stringify(msg))

// A healthy load must stay silent — a warning that cries wolf gets ignored,
// and this one has to be believed on the day it matters.
await page.goto(BASE + '/overview')
await settle(page)
const quiet = await page.evaluate(() => document.querySelector('.toast.err')?.innerText || '')
ok('a healthy load says nothing', quiet === '', JSON.stringify(quiet))

await browser.close()
console.log(fails ? `\n${fails} FAILED` : '\nround 63 clean')
process.exit(fails ? 1 : 0)
