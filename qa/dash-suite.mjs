// CRUD + customizable dashboards: server behavior, then the real UI flows.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const JT = await login('jas', 'j1234')   // manage_content only, depts instagram_*
const MT = await login('mir', 'm1234')   // youtube
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

// ---- dashboard config API ----
const chans = (await req('/channels')).data
const ig = chans.find((c) => c.key === 'instagram_main')
ok('channels carry a dashboard field (default null)', 'dashboard' in ig && ig.dashboard == null)
const saved = await req(`/channels/${ig.id}/dashboard`, 'PATCH', { dashboard: ['timetable', 'metrics', 'campaigns', 'upcoming', 'done', 'bogus'] })
ok('admin saves a layout; unknown keys dropped', saved.status === 200 && JSON.parse(saved.data.dashboard).join(',') === 'timetable,metrics,campaigns,upcoming,done', JSON.stringify(saved.data.dashboard))
ok('empty layout refused', (await req(`/channels/${ig.id}/dashboard`, 'PATCH', { dashboard: [] })).status === 400)
ok('member without the layout right is refused', (await req(`/channels/${ig.id}/dashboard`, 'PATCH', { dashboard: ['metrics'] }, JT)).status === 403)
const yt = chans.find((c) => c.key === 'youtube')
ok('outsider member refused even with array', (await req(`/channels/${yt.id}/dashboard`, 'PATCH', { dashboard: ['metrics'] }, JT)).status === 403)

// ---- notes CRUD ----
const projects = (await req('/projects')).data
const kaz = projects.find((p) => p.name.includes('Kazakh'))
const note = (await req(`/projects/${kaz.id}/notes`, 'POST', { text: 'note by jasmina' }, JT)).data
ok('member adds a project note', !!note.id)
ok('another member cannot delete it', (await req(`/projects/${kaz.id}/notes/${note.id}`, 'DELETE', null, MT)).status === 403)
ok('the author deletes their note', (await req(`/projects/${kaz.id}/notes/${note.id}`, 'DELETE', null, JT)).status === 200)
const note2 = (await req(`/projects/${kaz.id}/notes`, 'POST', { text: 'note two' }, JT)).data
ok('admin deletes any note', (await req(`/projects/${kaz.id}/notes/${note2.id}`, 'DELETE')).status === 200)
const camps = (await req('/campaigns')).data
const live = camps.find((c) => c.name === 'July enrollment sprint')
const cnote = (await req(`/campaigns/${live.id}/notes`, 'POST', { text: 'campaign note' }, JT)).data
ok('campaign note delete works the same', (await req(`/campaigns/${live.id}/notes/${cnote.id}`, 'DELETE', null, JT)).status === 200)

// ---- delete flows (API level, on scratch rows) ----
const scratchP = (await req('/projects', 'POST', { name: 'Scratch project' })).data
const scratchC = (await req('/campaigns', 'POST', { name: 'Scratch campaign', stage: 'idea', project_id: scratchP.id })).data
ok('deleting a project unlinks its campaigns', (await req(`/projects/${scratchP.id}`, 'DELETE')).status === 200
  && (await req(`/campaigns/${scratchC.id}`)).data.project_id === null)
ok('deleting a campaign works', (await req(`/campaigns/${scratchC.id}`, 'DELETE')).status === 200)

// ---- UI ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '/login')
await page.fill('input[type="text"]', 'admin')
await page.fill('input[type="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })

// The customized channel renders its saved layout, in order
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.section-head', { timeout: 10000 })
await page.waitForTimeout(600)
const heads = await page.locator('.section-head h2').allTextContents()
ok('customized layout renders in saved order', heads.join(',') === 'Releasing,Shooting,Metrics,Campaigns,Upcoming,Done', heads.join(','))
ok('growth hidden when toggled off', !heads.includes('Growth'))
ok('release + shooting timetables show 7 day rows each', await page.locator('.tt-row').count() === 14)
ok('campaigns board lists this channel’s campaigns', (await page.locator('.pc-camp-row').count()) >= 1)
ok('upcoming board lists dated tasks', (await page.locator('.ov-row').count()) >= 2)
await page.screenshot({ path: 'dash-custom.png', fullPage: true })

// Customize modal round-trip: put Growth back on top via the UI
await page.getByRole('button', { name: 'Customize' }).click()
await page.waitForSelector('.dash-row', { timeout: 8000 })
ok('modal lists every section once', await page.locator('.dash-row').count() === 8)
await page.screenshot({ path: 'dash-modal.png' })
const growthRow = page.locator('.dash-row', { hasText: 'Growth' })
await growthRow.locator('input[type=checkbox]').check()
for (let i = 0; i < 6; i++) {
  const idx = await page.locator('.dash-row').evaluateAll((rows) => rows.findIndex((r) => r.textContent.includes('Growth')))
  if (idx === 0) break
  await growthRow.getByRole('button', { name: 'Move up' }).click()
}
await page.getByRole('button', { name: 'Save layout' }).click()
await page.waitForTimeout(800)
const heads2 = await page.locator('.section-head h2').allTextContents()
ok('UI save puts Growth first', heads2[0] === 'Growth', heads2.join(','))

// A member sees the same customized layout
const mctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const mp = await mctx.newPage()
await mp.goto(BASE + '/login')
await mp.fill('input[type="text"]', 'jas')
await mp.fill('input[type="password"]', 'j1234')
await mp.click('button[type="submit"]')
await mp.waitForURL(/dept|todo|overview|brief/, { timeout: 15000 })
await mp.goto(BASE + '/dept/instagram_main')
await mp.waitForSelector('.section-head', { timeout: 10000 })
await mp.waitForTimeout(600)
const mheads = await mp.locator('.section-head h2').allTextContents()
ok('member sees the customized layout too', mheads[0] === 'Growth' && mheads.includes('Releasing') && mheads.includes('Shooting'), mheads.join(','))
ok('member without rights sees no Customize button', (await mp.getByRole('button', { name: 'Customize' }).count()) === 0)
await mctx.close()

// Channel settings: rename updates the sidebar
await page.getByRole('button', { name: 'Channel settings' }).click()
await page.waitForSelector('.modal', { timeout: 8000 })
await page.locator('.modal input.input').first().fill('Instagram Flagship')
await page.locator('.modal').getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(800)
ok('rename shows in the sidebar', (await page.locator('.sidebar').textContent()).includes('Instagram Flagship'))

// Note delete via UI (project page)
await page.goto(BASE + '/projects/' + kaz.id)
await page.waitForSelector('.pc-note', { timeout: 8000 })
const notesBefore = await page.locator('.pc-note').count()
await page.locator('.pc-note button[aria-label="Delete note"]').first().click()
await page.waitForTimeout(600)
ok('note removed through the ×', (await page.locator('.pc-note').count()) === notesBefore - 1)

// Delete buttons exist on both detail pages
ok('project delete button present', (await page.locator('button[aria-label="Delete project"]').count()) === 1)
await page.goto(BASE + '/campaigns/' + live.id)
await page.waitForSelector('.pc-header', { timeout: 8000 })
ok('campaign delete button present', (await page.locator('button[aria-label="Delete campaign"]').count()) === 1)

await browser.close()
console.log(fails === 0 ? '\nCRUD & dashboards clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
