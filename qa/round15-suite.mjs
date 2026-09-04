// This round: the crew get their own month calendar and never see the word
// "release"; Missed becomes Statistics — done / upcoming / missed / open as
// numbers over 1d–6mo windows, person + project filters properly scoped; the
// Target fleet leads with a big running count, ALL-branches shorthand and a
// creatives count per program.
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
const yesterday = fmt.format(new Date(Date.now() - 864e5))
const add = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

for (const c of (await req('/content')).data.filter((c) => /r15:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
for (const u of (await req('/users')).data.filter((u) => u.username === 'r15cru'))
  await req(`/users/${u.id}`, 'DELETE')
for (const cp of (await req('/campaigns')).data.filter((c) => /r15:/.test(c.name)))
  await req(`/campaigns/${cp.id}`, 'DELETE')
for (const pr of (await req('/projects')).data.filter((p) => /r15:/.test(p.name)))
  await req(`/projects/${pr.id}`, 'DELETE')
for (const pr of (await req('/programs?channel=target')).data.filter((x) => /r15:/.test(x.name)))
  await req(`/programs/${pr.id}`, 'DELETE')

const cru = (await req('/users', 'POST', { name: 'Ravil Crewman', username: 'r15cru', password: 'c1234', role: 'crew', crew_roles: ['editor', 'operator'] })).data
const users = (await req('/users')).data
const mir = users.find((u) => u.username === 'mir')

const shoot = (await req('/content', 'POST', { title: 'r15: campus shoot', channels: ['youtube'], type: 'video', operator_id: cru.id, recording_date: today, recording_time: '21:00', recording_end: '22:00' })).data
const cut = (await req('/content', 'POST', { title: 'r15: campus cut', channels: ['youtube'], type: 'video', editor_id: cru.id, edit_ready_date: today })).data
await req('/content', 'POST', { title: 'r15: release only', channels: ['youtube'], type: 'video', editor_id: cru.id, release_date: add(2) })
ok('crew fixtures in place', !!shoot.id && !!cut.id)

const doneT = (await req('/content', 'POST', { title: 'r15: shipped today', channels: ['instagram_main'], type: 'post', assignee_ids: [mir.id] })).data
await req(`/content/${doneT.id}`, 'PATCH', { done: true, post_link: 'https://instagram.com/p/qa' })
await req('/content', 'POST', { title: 'r15: upcoming post', channels: ['instagram_main'], type: 'post', assignee_ids: [mir.id], release_date: add(2) })
await req('/content', 'POST', { title: 'r15: missed release', channels: ['instagram_main'], type: 'post', assignee_ids: [mir.id], release_date: yesterday })
const proj = (await req('/projects', 'POST', { name: 'r15: Open Day' })).data
const camp = (await req('/campaigns', 'POST', { name: 'r15: Open Day teasers', project_id: proj.id })).data
const projTask = (await req('/content', 'POST', { title: 'r15: teaser video', channels: ['instagram_main'], type: 'post', campaign_id: camp.id, assignee_ids: [mir.id] })).data
await req(`/content/${projTask.id}`, 'PATCH', { done: true, post_link: 'https://instagram.com/p/qa' })
ok('statistics fixtures in place', !!proj.id && !!camp.id && !!projTask.id)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const pageC = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()

// The task sheet is three views and a thread now — Brief, Execution, Logistics
// — so a field is reached the way a person reaches it: open the view holding
// it first. Idempotent, and silent on a sheet short enough to show whole.
const cmTab = async (pg, name) => {
  // The same view is "Execution" to whoever runs the piece and "Your part" to
  // whoever does the work on it — it holds the crew, the handovers and the
  // crew's own tick, and which of those you are here for depends on who you
  // are. Either name reaches it.
  for (const n of name === 'Execution' ? ['Execution', 'Your part'] : [name]) {
    const tab = pg.locator('.cm-page-tab', { hasText: n })
    if (await tab.count()) { await tab.first().click(); await pg.waitForTimeout(200); return }
  }
}

pageC.on('pageerror', (e) => { fails++; console.log(`✘ CREW PAGE ERROR: ${e.message}`) })
await pageC.goto(BASE + '/login')
await pageC.fill('input[name="username"]', 'r15cru')
await pageC.fill('input[name="password"]', 'c1234')
await pageC.click('button[type="submit"]')
await pageC.waitForURL(/brief/, { timeout: 15000 })
await pageC.waitForTimeout(600)

const crewList = await pageC.locator('main').first().textContent()
ok('crew list view has no Releasing section', !crewList.includes('Releasing today'))
ok('the word Release never reaches the crew', !/Release\b/.test(crewList))

await pageC.locator('.pill', { hasText: 'Calendar' }).click()
await pageC.waitForSelector('.cc-grid', { timeout: 8000 })
const cal = await pageC.locator('main').first().textContent()
ok('their shoot sits on today’s calendar cell', /Shoot · 21:00/.test(cal) && cal.includes('r15: campus shoot'))
ok('their edit deadline sits on the calendar too', /Edit due/.test(cal) && cal.includes('r15: campus cut'))
ok('the calendar wears channels', cal.includes('YouTube'))
ok('a release-only cut appears as their implicit Edit due', cal.includes('r15: release only') && !/Release\b/.test(cal))
await pageC.screenshot({ path: 'r15-calendar.png' })

await pageC.locator('.pill', { hasText: 'List' }).click()
await pageC.waitForTimeout(300)
await pageC.locator('.cb-row', { hasText: 'r15: campus shoot' }).first().click()
await pageC.waitForSelector('.modal', { timeout: 8000 })
await cmTab(pageC, 'Logistics')
await pageC.waitForSelector('.modal .dates-block', { timeout: 8000 })
const dates = await pageC.locator('.modal .dates-block').textContent()
ok('crew modal shows Shoot + Edit ready but NO Release', /Shoot/.test(dates) && /Edit ready/.test(dates) && !/Release/.test(dates), dates.slice(0, 120))
await pageC.keyboard.press('Escape')

const page = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })
ok('the sidebar says Statistics now', (await page.locator('.sidebar').textContent()).includes('Statistics'))
await page.goto(BASE + '/missed')
await page.waitForSelector('.stats-card', { timeout: 10000 })
await page.waitForTimeout(400)

const tile = async (name) => Number(await page.locator(`.stats-card .miss-stat:has(span:text-is("${name}")) b`).textContent())
ok('done today counted', (await tile('done')) >= 2)
await page.locator('.stats-card .pill', { hasText: 'Today' }).click()
await page.waitForTimeout(300)
const upToday = await tile('upcoming')
await page.locator('.stats-card .pill', { hasText: 'This year' }).click()
await page.waitForTimeout(300)
ok('a wider window pulls the 2-days-away release in', (await tile('upcoming')) > upToday)
ok('missed counted in the window', (await tile('missed')) >= 1)
await page.screenshot({ path: 'r15-stats.png' })

await page.locator('.stats-filters select').first().selectOption({ label: 'Ravil Crewman' })
await page.waitForTimeout(300)
ok('person filter narrows done to their own', (await tile('done')) === 0)
await page.locator('.stats-filters select').first().selectOption({ label: 'Everyone' })
await page.waitForTimeout(200)

await page.locator('.stats-filters select').nth(1).selectOption({ label: 'r15: Open Day' })
await page.waitForTimeout(300)
ok('project filter → the project’s one done task', (await tile('done')) === 1 && (await tile('open now')) === 0)
await page.screenshot({ path: 'r15-project.png' })

// ============ the Target fleet ============
const allBr = (await req('/programs', 'POST', {
  channel: 'target', name: 'r15: citywide push', status: 'running', start_date: yesterday,
  branches: ['shahristan', 'chilanzar', 'drujba', 'andijan', 'bukhara'],
  creatives: [{ name: 'Banner A' }, { name: 'Banner B' }, { name: 'Reel hook' }],
})).data
ok('all-branches program fixture in place', !!allBr.id)
await page.goto(BASE + '/dept/target')
await page.waitForSelector('.gantt-bar', { timeout: 10000 })
await page.waitForTimeout(400)
ok('the running count rides BIG on the fleet line', (await page.locator('.prog-big b').count()) === 1
  && Number(await page.locator('.prog-big b').textContent()) >= 1)
const allBar = page.locator('.gantt-bar', { hasText: 'r15: citywide push' })
ok('every-branch programs just say ALL', (await allBar.locator('.prog-branch-txt').textContent()) === 'ALL')
const allRow = page.locator('.gantt-row', { hasText: 'r15: citywide push' })
ok('creatives are counted per program', /3 creatives/.test(await allRow.textContent()))
await page.screenshot({ path: 'r15-programs.png' })

const pageM = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
pageM.on('pageerror', (e) => { fails++; console.log(`✘ MEMBER PAGE ERROR: ${e.message}`) })
await pageM.goto(BASE + '/login')
await pageM.fill('input[name="username"]', 'mir')
await pageM.fill('input[name="password"]', 'm1234')
await pageM.click('button[type="submit"]')
await pageM.waitForURL(/brief|dept|todo|overview/, { timeout: 15000 })
await pageM.goto(BASE + '/missed')
await pageM.waitForSelector('.stats-card', { timeout: 10000 })
await pageM.waitForTimeout(400)
const selCount = await pageM.locator('.stats-filters select').count()
const memberProjects = selCount > 0 ? await pageM.locator('.stats-filters select').last().locator('option').allTextContents() : []
ok('member gets no person filter', !(await pageM.locator('main').first().textContent()).includes('Everyone'))
ok('member’s project list holds only their projects', memberProjects.some((o) => o.includes('r15: Open Day')))
const mDone = Number(await pageM.locator('.stats-card .miss-stat:has(span:text-is("done")) b').textContent())
ok('member numbers are their own', mDone >= 2)
await browser.close()

for (const pr of (await req('/programs?channel=target')).data.filter((x) => /r15:/.test(x.name)))
  await req(`/programs/${pr.id}`, 'DELETE')
for (const c of (await req('/content')).data.filter((c) => /r15:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
for (const cp of (await req('/campaigns')).data.filter((c) => /r15:/.test(c.name)))
  await req(`/campaigns/${cp.id}`, 'DELETE')
for (const pr of (await req('/projects')).data.filter((p) => /r15:/.test(p.name)))
  await req(`/projects/${pr.id}`, 'DELETE')
await req(`/users/${cru.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-15 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
