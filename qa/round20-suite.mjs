// Round 20: the whole sidebar personalizes — the main pages and the admin's
// Manage group get the same hide/reorder treatment as channels. "My Day" is
// the locked anchor (can't be hidden), and preferences belong to the
// account: two people sharing a browser each keep their own sidebar.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
const login = async (u, pw) => {
  await p.goto(BASE + '/login')
  await p.fill('input[name="username"]', u)
  await p.fill('input[name="password"]', pw)
  await p.click('button[type="submit"]')
  await p.waitForURL(/overview|brief|dept/, { timeout: 15000 })
  await p.waitForTimeout(700)
}
const logout = async () => {
  await p.locator('.sidebar button[aria-label="Sign out"]').click()
  await p.waitForURL(/login/, { timeout: 10000 })
}

await login('admin', 'admin123')
await p.locator('.side-edit-btn', { hasText: 'Personalize' }).click()
ok('main pages become editable rows', (await p.locator('.side-edit-row.grp-main').count()) >= 5)
ok('the Manage group is editable too', (await p.locator('.side-edit-row.grp-manage').count()) === 3)
ok('My Day is the locked anchor — no hide toggle',
  (await p.locator('.side-edit-row.grp-main', { hasText: 'My Day' }).locator('.side-eye.locked').count()) === 1)

// hide To-Do (main) and Post Production (manage)
await p.locator('.side-edit-row.grp-main', { hasText: 'To-Do' }).locator('button.side-eye').last().click()
await p.locator('.side-edit-row.grp-manage', { hasText: 'Post Production' }).locator('button.side-eye').last().click()
// Move Statistics up one slot with the arrow. Measured as its PLACE in the
// list, not its y: the sidebar's list scrolls once it is long enough, and a
// pixel that moved because the list scrolled says nothing about the arrow.
const placeOf = async (label) => (await p.locator('.side-edit-row.grp-main').allTextContents())
  .findIndex((t) => t.includes(label))
const iBefore = await placeOf('Statistics')
await p.locator('.side-edit-row.grp-main', { hasText: 'Statistics' }).locator('button.side-eye').first().click()
await p.waitForTimeout(200)
const iAfter = await placeOf('Statistics')
ok('the arrow moves a page up the list', iAfter >= 0 && iAfter < iBefore, `${iBefore}→${iAfter}`)
await p.locator('.side-edit-btn', { hasText: 'Done' }).click()

const nav1 = await p.locator('.sidebar nav').textContent()
ok('hidden pages left the sidebar', !nav1.includes('To-Do') && !nav1.includes('Post Production'))
ok('badge counts them', nav1.includes('2 hidden'))
ok('hidden page still opens by URL', await (async () => {
  await p.goto(BASE + '/todo'); await p.waitForTimeout(800)
  return (await p.locator('.topbar h1').textContent()).includes('To-Do')
})())
await p.reload(); await p.waitForSelector('.sidebar nav', { timeout: 10000 }); await p.waitForTimeout(700)
ok('preferences survive a reload', !(await p.locator('.sidebar nav').textContent()).includes('To-Do'))
await p.screenshot({ path: 'r20-sidebar.png' })

// ---- per-account: jas gets her own defaults in the same browser ----
await logout()
await login('jas', 'j1234')
const jasNav = await p.locator('.sidebar nav').textContent()
ok('another account keeps its own sidebar (To-Do visible)', jasNav.includes('To-Do'))
await logout()
await login('admin', 'admin123')
ok('the admin’s trims are still theirs', !(await p.locator('.sidebar nav').textContent()).includes('To-Do'))

// ---- reset leaves no trace ----
await p.locator('.side-edit-btn', { hasText: /Personalize/ }).click()
await p.locator('.side-edit-btn', { hasText: 'Reset' }).click()
await p.locator('.side-edit-btn', { hasText: 'Done' }).click()
const navReset = await p.locator('.sidebar nav').textContent()
ok('reset restores the full sidebar', navReset.includes('To-Do') && navReset.includes('Post Production'))

await browser.close()
console.log(fails === 0 ? '\nRound-20 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
