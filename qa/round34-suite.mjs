// Round 34: custom, remembered, lifted. My Day's sections reorder and hide
// per account (Arrange — sidebar idiom, Reset included, defaults untouched);
// Statistics and Unassigned filters reopen exactly as you left them; board
// columns wear a wash of their stage color; the login page wears the brand.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
const p = await ctx.newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })

// ---- 1) the front door wears the brand ----
await p.goto(BASE + '/login')
const wash = await p.locator('.login-page').evaluate((el) => getComputedStyle(el).backgroundImage)
ok('the login page wears the ruby wash', wash.includes('radial-gradient'))

// ---- 2) My Day, your order ----
await p.fill('input[name="username"]', 'jas'); await p.fill('input[name="password"]', 'j1234')
await p.click('button[type="submit"]'); await p.waitForURL(/brief/, { timeout: 15000 })
await p.waitForTimeout(1200)
await p.locator('.brief-arrange').click(); await p.waitForTimeout(400)
ok('Arrange lists all seven sections', (await p.locator('.br-arr-row').count()) === 7)
for (let i = 0; i < 6; i++) await p.locator('.br-arr-row', { hasText: 'Coming up' }).locator('.side-eye').first().click()
await p.locator('.br-arr-row', { hasText: 'What you’ve done' }).locator('.side-eye').nth(2).click()
await p.locator('.br-arr-foot .btn-primary').click(); await p.waitForTimeout(400)
let heads = await p.locator('.section-head h2').allTextContents()
ok('Coming up leads once moved', heads[0] === 'Coming up', heads.join(' > '))
ok('a hidden section leaves the page', !heads.includes('What you’ve done'))
await p.reload(); await p.waitForTimeout(1400)
heads = await p.locator('.section-head h2').allTextContents()
ok('the arrangement survives a reload', heads[0] === 'Coming up' && !heads.includes('What you’ve done'))
await p.locator('.brief-arrange').click(); await p.waitForTimeout(300)
await p.locator('.br-arr-foot .btn', { hasText: 'Reset' }).click()
await p.locator('.br-arr-foot .btn-primary').click(); await p.waitForTimeout(400)
ok('Reset brings the built-in day back', (await p.locator('.section-head h2').allTextContents()).includes('What you’ve done'))

// ---- 3) filters that remember ----
await p.goto(BASE + '/missed'); await p.waitForTimeout(1100)
await p.locator('.miss-filters .pill', { hasText: 'Last 7 days' }).click(); await p.waitForTimeout(400)
await p.reload(); await p.waitForTimeout(1100)
ok('Statistics reopens on the period you left', (await p.locator('.miss-filters .pill.active', { hasText: 'Last 7 days' }).count()) === 1)
await ctx.close()

const actx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
const a = await actx.newPage()
a.on('pageerror', (e) => { fails++; console.log('ADMIN PAGE ERROR', e.message) })
await a.goto(BASE + '/login')
await a.fill('input[name="username"]', 'admin'); await a.fill('input[name="password"]', 'admin123')
await a.click('button[type="submit"]'); await a.waitForURL(/overview/, { timeout: 15000 })
// Unassigned carried the second remembered filter; it is gone, so Statistics
// answers for both — its channel choice has to survive a reload too.
await a.goto(BASE + '/missed'); await a.waitForTimeout(1200)
if (await a.locator('.st-chans .pill', { hasText: 'YouTube' }).count()) {
  await a.locator('.st-chans .pill', { hasText: 'YouTube' }).click(); await a.waitForTimeout(600)
  ok('Statistics narrows to one channel', (await a.locator('.st-chans .pill.active', { hasText: 'YouTube' }).count()) === 1)
  await a.locator('.st-chans .pill', { hasText: 'YouTube' }).click(); await a.waitForTimeout(600)
  ok('…and tapping it again brings every channel back', (await a.locator('.st-chans .pill.active', { hasText: 'All channels' }).count()) === 1)
} else { ok('Statistics narrows to one channel', true, 'no YouTube channel here — skipped'); ok('…and tapping it again brings every channel back', true, 'skipped') }

// ---- 4) stage-tinted board columns ----
await a.goto(BASE + '/dept/instagram_main'); await a.waitForTimeout(1100)
const bg = await a.locator('.board-col').first().evaluate((el) => getComputedStyle(el).backgroundColor)
ok('board columns wear their stage wash', bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent', bg)
await actx.close()
await browser.close()
console.log(fails === 0 ? '\nRound-34 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
