import { chromium } from 'playwright'
const BASE = 'http://localhost:4085'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const admin = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) })).json()
const T = admin.token
const req = async (p, m = 'GET', b) => {
  const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
const today = fmt.format(new Date())
const monthStart = today.slice(0, 8) + '01'

const jas = (await req('/users', 'POST', { name: 'Jasmina', username: 'jas', password: 'j1234', departments: ['instagram_main'] })).data
const cutter = (await req('/users', 'POST', { name: 'Eldor Cutter', username: 'eld', password: 'e1234', role: 'editor' })).data
const mir = (await req('/users', 'POST', { name: 'Mirabbos', username: 'mir', password: 'm1234', departments: ['youtube'] })).data
const mk = async (title, ch, type, extra = {}) => (await req('/content', 'POST', { title, channels: [ch], type, ...extra })).data
const d1 = await mk('IG done 1', 'instagram_main', 'post', { assignee_id: jas.id })
const d2 = await mk('IG done 2', 'instagram_main', 'reel', { assignee_id: jas.id })
const d3 = await mk('YT done', 'youtube', 'video', { assignee_id: mir.id })
for (const t of [d1, d2, d3]) await req(`/content/${t.id}`, 'PATCH', { done: true })
await mk('IG open', 'instagram_main', 'post', { release_date: today })
await mk('IG overdue', 'instagram_main', 'post', { release_date: '2026-07-10' })

const vid = await req('/content', 'POST', { title: 'Крю видео', channels: ['youtube'], type: 'video', operator_id: mir.id, editor_id: jas.id })
ok('video stores operator + editor', vid.status === 201 && vid.data.operator_id === mir.id && vid.data.editor_id === jas.id)
const patched = await req(`/content/${vid.data.id}`, 'PATCH', { operator_id: jas.id })
ok('crew reassignable', patched.data.operator_id === jas.id)
ok('bogus crew member rejected', (await req(`/content/${vid.data.id}`, 'PATCH', { editor_id: 9999 })).status === 400)

const rep = (await req(`/reports?from=${monthStart}&to=${today}`)).data
ok('reports carries byChannel', rep.byChannel.instagram_main.total === 2 && rep.byChannel.youtube.total === 1, JSON.stringify(rep.byChannel))
const personSum = rep.report.reduce((n, r) => n + (r.byChannel.instagram_main || 0), 0)
ok('channel total equals the sum over people (one truth)', personSum === rep.byChannel.instagram_main.total)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
await page.goto(BASE + '/login')
await page.fill('input[type="text"]', 'admin')
await page.fill('input[type="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })
await page.goto(BASE + '/admin')
await page.getByRole('button', { name: 'Channels' }).click()
await page.waitForSelector('.chan-stats', { timeout: 10000 })

const igRow = page.locator('.chan-row', { hasText: 'Instagram Main' })
// The done-count arrives with the reports fetch; wait for it before reading.
await igRow.locator('.chan-stat', { hasText: 'done' }).waitFor({ timeout: 10000 })
const igTxt = await igRow.textContent()
ok('channel row shows done this month', igTxt.includes('2 done'), igTxt.slice(0, 120))
ok('channel row shows open + overdue', igTxt.match(/2 open.*1 overdue/s) !== null, igTxt.slice(0, 120))

await igRow.getByRole('button', { name: 'Report →' }).click()
await page.waitForSelector('.rp-big', { timeout: 8000 })
ok('jump lands on the Reports tab filtered to the channel', (await page.locator('.rp-big').textContent()).includes('Instagram Main'))
ok('big number matches the channel row', (await page.locator('.rp-big b').first().textContent()) === '2')

await page.getByRole('button', { name: 'All channels' }).click()
await page.waitForTimeout(300)
ok('all-channels total is bold and big', (await page.locator('.rp-big b').first().textContent()) === '3')
ok('clickable colored channel chips', await page.locator('.rp-chan').count() === 2)
ok('person cards show big totals', await page.locator('.rp-person-total b').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 30))
await page.screenshot({ path: 'reports-new.png' })

await page.goto(BASE + '/todo')
await page.waitForSelector('.todo-row', { timeout: 10000 })
const vidRow = page.locator('.todo-row', { hasText: 'Крю видео' })
ok('crew chips on the to-do row', (await vidRow.textContent()).includes('Jasmina'))
await vidRow.locator('.todo-main').click()
await page.waitForSelector('.modal', { timeout: 8000 })
ok('crew selects visible for video type', await page.locator('.modal .crew-field').count() === 3)
await page.locator('.modal .tchip', { hasText: 'Post' }).click()
ok('a post swaps the crew for one designer hat', await page.locator('.modal .crew-field').count() === 1)
await page.locator('.modal .tchip', { hasText: 'Video' }).click()
await page.locator('.modal .crew-field select').nth(1).selectOption({ label: 'Eldor Cutter' })
await page.getByRole('button', { name: 'Save changes' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
const final = (await req(`/content/${vid.data.id}`)).data
ok('crew edit through the modal persisted', final.editor_id === cutter.id)
await browser.close()

console.log(fails === 0 ? '\nReports & crew suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
