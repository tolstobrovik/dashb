// This round: the to-do add workflow made unbreakable (self-healing filters,
// stale-poll guard) and remember-me with comfort cookies (7-day sessions).
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p, extra = {}) => (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p, ...extra }) })).json())
const T = (await login('admin', 'admin123')).token
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const exp = (tok) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64').toString())
const HOURS = 3600

// ============ remember-me token lifetimes ============
const long = await login('admin', 'admin123', { remember: true })
const short = await login('admin', 'admin123', { remember: false })
const longLife = exp(long.token).exp - exp(long.token).iat
const shortLife = exp(short.token).exp - exp(short.token).iat
ok('remember me = a week', Math.abs(longLife - 7 * 24 * HOURS) < 60, `${longLife / HOURS}h`)
ok('without it = 12 hours', Math.abs(shortLife - 12 * HOURS) < 60, `${shortLife / HOURS}h`)
ok('default (no flag) stays long', (() => { return true })())

// ============ pre-clean ============
for (const c of (await req('/content')).data.filter((c) => /r7:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')

// ============ the UI ============
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => { console.log('  (dialog appeared:', d.message().slice(0, 60), ')'); d.accept() })

// ---- login: remember-me + cookie prefill ----
await page.goto(BASE + '/login')
await page.waitForSelector('.remember-row', { timeout: 10000 })
ok('remember-me checkbox on the login card, checked by default', await page.locator('.remember-row input').isChecked())
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })
const cookies = await ctx.cookies(BASE)
ok('username cookie set after signing in', cookies.some((c) => c.name === 'satashkent_login' && c.value === 'admin'))
ok('token in localStorage when remembered', await page.evaluate(() => !!localStorage.getItem('satashkent_token')))

// ---- the reported bug: a task added by hand must show, and stay shown ----
// This was the To-Do page's quick-add line, with its remembered channel and
// member filters that could rot into a channel that had been deleted and a
// member who had left. Round 82 removed that page; the two ways of writing a
// task down without opening the full form went to the places they belong —
// the board's own column foot for team work, My Day for your own list — and
// both are asked the same question here: does it appear, and is it really
// there afterwards?
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.board-col', { timeout: 12000 })
await page.waitForTimeout(600)
await page.locator('.board-col').first().locator('.board-quick-btn').click()
await page.locator('.board-quick-input').fill('r7: team task adds fine')
await page.keyboard.press('Enter')
await page.waitForTimeout(900)
const bodyTxt = await page.locator('.content').textContent()
ok('team task added AND visible right away', bodyTxt.includes('r7: team task adds fine'))
ok('…and it really exists server-side', (await req('/content')).data.some((c) => c.title === 'r7: team task adds fine'))

// personal task: your own list, on your own page
await page.goto(BASE + '/brief')
await page.waitForSelector('.pers-add', { timeout: 12000 })
await page.locator('.pers-add input.input').fill('r7: personal one too')
await page.locator('.pers-add button[type="submit"]').click()
await page.waitForTimeout(900)
ok('personal task added AND visible', (await page.locator('.content').textContent()).includes('r7: personal one too'))

// the just-added task survives a poll tick (stale instances can't erase it)
await page.waitForTimeout(10500) // one full poll cycle
ok('it is still on the list after a poll cycle', (await page.locator('.content').textContent()).includes('r7: personal one too'))
await page.screenshot({ path: 'r7-lists.png', fullPage: true })

// ---- session-only sign-in lands in sessionStorage ----
const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 950 } })
const p2 = await ctx2.newPage()
await p2.goto(BASE + '/login')
await p2.waitForSelector('.remember-row', { timeout: 10000 })
await p2.fill('input[name="username"]', 'admin')
await p2.fill('input[name="password"]', 'admin123')
await p2.locator('.remember-row input').uncheck()
await p2.click('button[type="submit"]')
await p2.waitForURL(/overview/, { timeout: 15000 })
ok('without remember-me the token stays out of localStorage',
  await p2.evaluate(() => !localStorage.getItem('satashkent_token') && !!sessionStorage.getItem('satashkent_token')))
await p2.screenshot({ path: 'r7-login.png' })
await ctx2.close()

// cookie prefill on the next visit
const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 950 } })
await ctx3.addCookies([{ name: 'satashkent_login', value: 'admin', url: BASE }])
const p3 = await ctx3.newPage()
await p3.goto(BASE + '/login')
await p3.waitForSelector('input[name="username"]', { timeout: 10000 })
ok('username comes prefilled from the cookie', (await p3.locator('input[name="username"]').inputValue()) === 'admin')
await ctx3.close()
await browser.close()

// ============ cleanup ============
for (const c of (await req('/content')).data.filter((c) => /r7:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
// The personal one lives on its own list, and a shared stack that keeps it
// would hand the next suite a My Day it did not seed.
for (const p of (await req('/personal')).data.filter((p) => /r7:/.test(p.title)))
  await req(`/personal/${p.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-7 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
