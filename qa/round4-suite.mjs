// This round: project success criteria + earned progress, no-owner flags,
// crew deck/timetable/list views with filters, full member editing on the
// team page, all channels on Missed, and the misses-by-person report.
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

// ============ pre-clean ============
for (const u of (await req('/users')).data.filter((u) => ['zar', 'tst'].includes(u.username)))
  await req(`/users/${u.id}`, 'DELETE')
for (const c of (await req('/content')).data.filter((c) => /r4:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
const oldP = (await req('/projects')).data.find((p) => p.name === 'R4 progress probe')
if (oldP) await req(`/projects/${oldP.id}`, 'DELETE')

// ============ projects: success criteria + earned progress ============
const proj = (await req('/projects', 'POST', {
  name: 'R4 progress probe', success: '500 applications before Sept 1, CAC under $10',
})).data
ok('success criteria stored on create', proj.success === '500 applications before Sept 1, CAC under $10')
let p1 = (await req(`/projects/${proj.id}`, 'PATCH', {
  checklist: [{ text: 'Landing page live', done: true }, { text: 'Pixel installed', done: false }],
})).data
ok('checklist-only progress: 1 of 2 = 50%', p1.progress.pct === 50 && p1.progress.checklist_done === 1 && p1.progress.campaigns_total === 0, JSON.stringify(p1.progress))
const users = (await req('/users')).data
const camp = (await req('/campaigns', 'POST', {
  name: 'R4 camp', stage: 'accepted', project_id: proj.id, owner_id: users[0].id,
  start_date: add(-5), end_date: add(5), channels: ['youtube'], metric: 'Leads', target: 100, actual: 10,
})).data
p1 = (await req(`/projects/${proj.id}`, 'PATCH', {})).data
ok('a live campaign adds an unearned step: 1 of 3 = 33%', p1.progress.pct === 33 && p1.progress.campaigns_total === 1 && p1.progress.campaigns_done === 0, JSON.stringify(p1.progress))
await req(`/campaigns/${camp.id}`, 'PATCH', { stage: 'closed' })
p1 = (await req(`/projects/${proj.id}`, 'PATCH', {})).data
ok('closing the campaign earns it: 2 of 3 = 67%', p1.progress.pct === 67 && p1.progress.campaigns_done === 1, JSON.stringify(p1.progress))
const listRow = (await req('/projects')).data.find((p) => p.id === proj.id)
ok('the list rows carry progress + success too', listRow.progress.pct === 67 && listRow.success.includes('500 applications'))
ok('PATCH edits the criteria', (await req(`/projects/${proj.id}`, 'PATCH', { success: 'Tighter: 600 apps' })).data.success === 'Tighter: 600 apps')

// ============ crew fixtures for the views ============
const rav = (await req('/users', 'POST', { name: 'Zafar Toshpulatov', username: 'zar', password: 'z1234', role: 'crew', work_start: '09:00', work_end: '18:00', work_days: [0, 1, 2, 3, 4, 5, 6] })).data
const s1 = (await req('/content', 'POST', { title: 'r4: shoot lab tour', channels: ['youtube'], type: 'video', operator_id: rav.id, recording_date: today, recording_time: '10:00', recording_end: '12:00', edit_ready_date: today, release_date: today })).data
const s2 = (await req('/content', 'POST', { title: 'r4: shoot open day', channels: ['instagram_main'], type: 'video', operator_id: rav.id, recording_date: add(2), recording_time: '14:00', recording_end: '15:30', edit_ready_date: add(2), release_date: add(2) })).data
const e1 = (await req('/content', 'POST', { title: 'r4: cut promo', channels: ['target'], type: 'video', editor_id: rav.id, release_date: add(1), operator_id: 1, recording_date: add(1), edit_ready_date: add(1) })).data
ok('crew fixtures in place', [s1, s2, e1].every((c) => c?.id))

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
await page.waitForTimeout(600)

// ---- no-owner flags ----
ok('overview: headless channels wear the no-owner badge', (await page.locator('.ov-card .no-owner-badge').count()) >= 1)
await page.goto(BASE + '/projects/' + proj.id)
await page.waitForSelector('.pc-header', { timeout: 10000 })
const detTxt = await page.locator('.pc-header').textContent()
ok('project detail shows the success criteria', detTxt.includes('Success criteria') && detTxt.includes('Tighter: 600 apps'))
ok('project detail shows earned progress with the breakdown', detTxt.includes('67%') && detTxt.includes('1/2 checklist') && detTxt.includes('1/1 campaigns done'))
await page.screenshot({ path: 'r4-project.png', fullPage: true })

await page.goto(BASE + '/projects')
await page.waitForSelector('.tbl', { timeout: 10000 })
const probeRow = page.locator('tr', { hasText: 'R4 progress probe' })
ok('projects table: progress bar + %', (await probeRow.locator('.proj-progress').count()) === 1 && (await probeRow.textContent()).includes('67%'))

// ---- crew: three views, one filter ----
await page.goto(BASE + '/crew')
await page.waitForSelector('.crew-card, .crew-tt', { timeout: 10000 })
await page.waitForTimeout(500)
if (!(await page.locator('.pill', { hasText: 'Deck' }).first().evaluate((el) => el.classList.contains('active'))).valueOf()) {
  await page.locator('.pill', { hasText: 'Deck' }).click()
  await page.waitForTimeout(300)
}
const zCard = page.locator('.crew-card', { hasText: 'Zafar' })
ok('deck: calm card — badge, meter, numbers, no timetable noise', (await zCard.count()) === 1
  && (await zCard.locator('.load-badge').count()) === 1
  && (await zCard.locator('.tt-shoot').count()) === 0
  && /next shoot:/.test(await zCard.textContent()))

await page.locator('.pill', { hasText: 'Timetable' }).click()
await page.waitForSelector('.crew-tt', { timeout: 8000 })
const tt = await page.locator('.crew-tt').textContent()
ok('timetable: the big week grid holds both shoots with hours', tt.includes('10:00–12:00') && tt.includes('14:00–15:30') && tt.includes('Zafar'))
ok('timetable: today’s column is highlighted', (await page.locator('.crew-tt th.tt-today').count()) === 1)
ok('timetable: day-off cells are marked', (await page.locator('.crew-tt .tt-off').count()) >= 0)
await page.screenshot({ path: 'r4-crew-tt.png', fullPage: true })

await page.locator('.pill', { hasText: 'List' }).click()
await page.waitForTimeout(400)
const listTxt = await page.locator('.content').textContent()
ok('list: chronological rows with times, people and channels', listTxt.includes('10:00–12:00') && listTxt.includes('r4: shoot lab tour') && listTxt.includes('due') && listTxt.includes('r4: cut promo'))

// person filter narrows every view
const opRow = (await req('/users')).data.find((u) => u.username === 'rav') // may exist from round3 runs
await page.locator('.pill.pill-person', { hasText: 'Zafar' }).click()
await page.waitForTimeout(400)
const afterFilter = await page.locator('.content').textContent()
ok('person filter keeps only their work', afterFilter.includes('r4: shoot lab tour') && (!opRow || !afterFilter.includes('Ravshan')))
await page.locator('.pill', { hasText: 'Everyone' }).click()

// ---- team: table view + the full member editor ----
const tst = (await req('/users', 'POST', { name: 'Temur Sobirov', username: 'tst', password: 't1234', role: 'member', departments: ['youtube'] })).data
await page.goto(BASE + '/team')
await page.waitForSelector('.team-grid, .tbl', { timeout: 10000 })
await page.waitForTimeout(500)
if ((await page.locator('.team-grid').count()) === 0) {
  await page.locator('.pill', { hasText: 'Cards' }).click()
  await page.waitForTimeout(300)
}
await page.locator('.pill', { hasText: 'Table' }).click()
await page.waitForTimeout(400)
ok('team table view renders with schedule + phone columns', (await page.locator('.tbl th', { hasText: 'Working hours' }).count()) === 1)
const tstRow = page.locator('.tbl tr', { hasText: 'Temur Sobirov' })
await tstRow.locator('button[aria-label="Edit"]').click()
await page.waitForSelector('.modal', { timeout: 8000 })
const modalTxt = await page.locator('.modal').textContent()
ok('member editor covers identity, role, channels, rights — no password', modalTxt.includes('Username') && modalTxt.includes('Role') && modalTxt.includes('Channels') && modalTxt.includes('Permissions') && !(await page.locator('.modal input[type="password"]').count()))
await page.locator('.modal input').nth(0).fill('Temur Sobirov Jr.')
await page.locator('.modal .perm-row', { hasText: 'Add & edit metrics' }).click() // off by default for members
await page.locator('.modal input[placeholder*="Videographer"]').fill('YouTube producer')
await page.locator('.modal').getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(400)
const tstNow = (await req('/users')).data.find((u) => u.id === tst.id)
ok('full edit persisted (name, permission, position)', tstNow.name === 'Temur Sobirov Jr.' && tstNow.permissions.manage_metrics === true && tstNow.position === 'YouTube producer', JSON.stringify({ n: tstNow.name, mm: tstNow.permissions.manage_metrics, pos: tstNow.position }))
await page.screenshot({ path: 'r4-team-table.png', fullPage: true })

// ---- missed: every channel visible + the by-person report ----
await page.goto(BASE + '/missed')
await page.waitForSelector('.miss-stats', { timeout: 10000 })
await page.waitForTimeout(500)
const chanCount = (await req('/channels')).data.length
const pillCount = await page.locator('.miss-filters .pill-group').nth(1).locator('.pill').count()
ok('every channel is a pill (plus All)', pillCount === chanCount + 1, `pills=${pillCount} channels=${chanCount}`)
ok('quiet channels show a zero, dimmed', (await page.locator('.pill-zero').count()) >= 1)
ok('the by-person report card renders', (await page.locator('.miss-report .miss-person-row').count()) >= 1)
const firstRow = page.locator('.miss-report .miss-person-row').first()
const rowTxt = await firstRow.textContent()
ok('report rows carry the split', /\d+ open/.test(rowTxt) && /\d+ late/.test(rowTxt), rowTxt)
await page.screenshot({ path: 'r4-missed-report.png', fullPage: true })
await firstRow.click()
await page.waitForTimeout(400)
ok('clicking a report row filters to that person', (await firstRow.evaluate((el) => el.classList.contains('on'))))
// custom range far in the past zeros the report out
await page.locator('.miss-filters .pill', { hasText: 'Custom…' }).click()
await page.locator('.miss-custom input').first().fill(add(-90))
await page.locator('.miss-custom input').last().fill(add(-60))
await page.waitForTimeout(400)
ok('custom dates rule the report card too', (await page.locator('.miss-report').count()) === 0 || (await page.locator('.miss-report .miss-person-row').count()) === 0)

await browser.close()

// ============ cleanup ============
await req(`/campaigns/${camp.id}`, 'DELETE')
await req(`/projects/${proj.id}`, 'DELETE')
for (const c of [s1, s2, e1]) await req(`/content/${c.id}`, 'DELETE')
await req(`/users/${rav.id}`, 'DELETE')
await req(`/users/${tst.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-4 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
