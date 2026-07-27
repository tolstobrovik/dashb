// This round: split release/shoot timetables, crew-only dropdowns, no admin
// gantt, whiteboard zoom, work-kind chips on My Day, labeled overview stages,
// and the collapsible sidebar.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
const today = fmt.format(new Date())
const add = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// ============ pre-clean + fixtures ============
for (const u of (await req('/users')).data.filter((u) => ['r6op'].includes(u.username)))
  await req(`/users/${u.id}`, 'DELETE')
for (const c of (await req('/content')).data.filter((c) => /r6:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
const op = (await req('/users', 'POST', { name: 'Round Six Operator', username: 'r6op', password: 'r1234', role: 'operator' })).data
const relTask = (await req('/content', 'POST', { title: 'r6: release tomorrow', channels: ['instagram_main'], type: 'post', release_date: add(1) })).data
const shootTask = (await req('/content', 'POST', { title: 'r6: shoot in two days', channels: ['instagram_main'], type: 'video', operator_id: op.id, recording_date: add(2), recording_time: '10:00', recording_end: '11:00', edit_ready_date: add(4) })).data
// legacy pick: a member as operator, set via the API (still allowed there)
const users = (await req('/users')).data
const jas = users.find((u) => u.username === 'jas')
const legacy = (await req('/content', 'POST', { title: 'r6: legacy member crew', channels: ['instagram_main'], type: 'video', operator_id: jas.id })).data
ok('fixtures in place', [op, relTask, shootTask, legacy].every((x) => x?.id))

// ============ the UI ============
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })
await page.waitForTimeout(500)

// ---- overview: stage names written on the color ----
ok('overview stages are labeled, not bare color', (await page.locator('.ov-stage').count()) >= 1
  && /[A-Za-z]/.test(await page.locator('.ov-stage').first().textContent()))
await page.screenshot({ path: 'r6-overview.png', fullPage: true })

// ---- sidebar steps aside ----
ok('collapse toggle present', (await page.locator('.side-toggle').count()) === 1)
await page.locator('.side-toggle').click()
await page.waitForTimeout(300)
ok('sidebar hidden — the page owns the screen', !(await page.locator('.sidebar').isVisible()))
await page.reload()
await page.waitForSelector('.side-toggle', { timeout: 10000 })
await page.waitForTimeout(400)
ok('the choice survives a reload', !(await page.locator('.sidebar').isVisible()))
await page.locator('.side-toggle').click()
await page.waitForTimeout(300)
ok('and comes back with one click', await page.locator('.sidebar').isVisible())

// ---- split timetables on the channel page ----
// the widget must be on the channel's dashboard to render
const igChan = (await req('/channels')).data.find((c) => c.key === 'instagram_main')
await req(`/channels/${igChan.id}/dashboard`, 'PATCH', { dashboard: ['timetable', 'content'] })
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.section-head', { timeout: 10000 })
await page.waitForTimeout(600)
const heads = await page.locator('.section-head h2').allTextContents()
ok('Releasing and Shooting are separate tables', heads.includes('Releasing') && heads.includes('Shooting'))
ok('two 7-day tables render', (await page.locator('.tt-row').count()) === 14)
const relIdx = heads.indexOf('Releasing')
const relCard = page.locator('.section-head:has(h2:text-is("Releasing")) + .card')
const shootCard = page.locator('.section-head:has(h2:text-is("Shooting")) + .card')
ok('release task sits in the Releasing table only',
  (await relCard.textContent()).includes('r6: release tomorrow') && !(await shootCard.textContent()).includes('r6: release tomorrow'))
ok('shoot task sits in the Shooting table only',
  (await shootCard.textContent()).includes('r6: shoot in two days') && !(await relCard.textContent()).includes('r6: shoot in two days'))
await page.screenshot({ path: 'r6-timetables.png', fullPage: true })

// ---- crew dropdowns: operators & editors only (legacy picks stay) ----
await page.goto(BASE + '/todo')
await page.waitForSelector('.todo-row', { timeout: 10000 })
await page.locator('.todo-row', { hasText: 'r6: shoot in two days' }).locator('.todo-main').click()
await page.waitForSelector('.modal .crew-field', { timeout: 8000 })
// Round 27 freed the pickers: specialists lead their own group, everyone
// else waits in the one-time-duty group below.
const opSel = page.locator('.modal .crew-field select').first()
const opSpecial = await opSel.locator('optgroup[label="Operators"] option').allTextContents()
const opAnyone = await opSel.locator('optgroup[label*="Everyone"] option').allTextContents()
ok('operator specialists lead their own group', opSpecial.some((o) => o.includes('Round Six Operator'))
  && !opSpecial.some((o) => o.includes('Jasmina') || o.includes('Mirabbos')), opSpecial.join(' | '))
ok('…and anyone can take a one-time duty', opAnyone.some((o) => o.includes('Jasmina')), opAnyone.join(' | '))
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.locator('.todo-row', { hasText: 'r6: legacy member crew' }).locator('.todo-main').click()
await page.waitForSelector('.modal .crew-field', { timeout: 8000 })
const legacyOptions = await page.locator('.modal .crew-field select').first().locator('option').allTextContents()
ok('an old pick stays selectable on its task', legacyOptions.some((o) => o.includes('Jasmina')))
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// ---- admin: campaign gantt gone; whiteboard zooms ----
await page.goto(BASE + '/admin')
await page.waitForSelector('.tabs', { timeout: 10000 })
const tabs = await page.locator('.tabs .tab').allTextContents()
ok('Campaign Gantt tab removed', !tabs.some((t) => t.includes('Campaign Gantt')), tabs.join(','))
await page.getByRole('button', { name: 'Whiteboard' }).click()
await page.waitForSelector('.board-inner', { timeout: 10000 })
await page.waitForTimeout(600)
ok('zoom controls present', (await page.locator('.zoom-ctl').count()) === 1 && (await page.locator('.zoom-pct').textContent()) === '100%')
await page.locator('.zoom-ctl button[aria-label="Zoom out"]').click()
await page.locator('.zoom-ctl button[aria-label="Zoom out"]').click()
await page.waitForTimeout(300)
ok('two steps out = 80%', (await page.locator('.zoom-pct').textContent()) === '80%')
const scaled = await page.locator('.board-inner').evaluate((el) => el.style.transform)
ok('the field actually scales', scaled.includes('scale(0.8)'), scaled)
const zw = await page.locator('.board-zoom').evaluate((el) => el.style.width)
ok('scroll area shrinks with it', zw === '4800px', zw)
await page.screenshot({ path: 'r6-zoom.png' })
await page.locator('.zoom-pct').click()
await page.waitForTimeout(200)
ok('clicking the percent resets to 100%', (await page.locator('.zoom-pct').textContent()) === '100%')

// ---- work chips on My Day ----
const KT = await login('r6op', 'r1234')
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const p2 = await ctx2.newPage()
p2.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR (crew): ${e.message}`) })
await p2.goto(BASE + '/login')
await p2.fill('input[name="username"]', 'r6op')
await p2.fill('input[name="password"]', 'r1234')
await p2.click('button[type="submit"]')
await p2.waitForURL(/brief/, { timeout: 15000 })
await p2.waitForSelector('.brief-title', { timeout: 10000 })
await p2.waitForTimeout(500)
await p2.locator('.cb-col').first().locator('.cb-toggle', { hasText: 'Upcoming' }).click()
await p2.waitForTimeout(200)
ok('the future shoot sits in the SHOOT lane', (await p2.locator('.cb-col').first().locator('.cb-row', { hasText: 'r6: shoot in two days' }).count()) === 1)
await p2.screenshot({ path: 'r6-brief-chips.png', fullPage: true })
await ctx2.close()

// admin's simple view: the release task carries the Release chip tomorrow
await page.goto(BASE + '/brief')
await page.waitForSelector('.brief-title', { timeout: 10000 })
await page.waitForTimeout(500)
ok('simple view wears work chips too', (await page.locator('.ov-row', { hasText: 'r6: release tomorrow' }).locator('.wk-chip.wk-rel').count()) === 1)

await browser.close()

// ============ cleanup ============
await req(`/channels/${igChan.id}/dashboard`, 'PATCH', { dashboard: ['metrics', 'growth', 'content'] })
for (const c of [relTask, shootTask, legacy]) await req(`/content/${c.id}`, 'DELETE')
await req(`/users/${op.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-6 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
