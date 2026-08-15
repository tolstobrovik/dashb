// This round: the Post Production video deck shows ONLY operator/editor-role
// accounts. A member who merely holds a hat on some task keeps the hat on the
// task — but gets no column on this page.
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

for (const c of (await req('/content')).data.filter((c) => /r12:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
for (const u of (await req('/users')).data.filter((u) => u.username === 'r12cru'))
  await req(`/users/${u.id}`, 'DELETE')

const cru = (await req('/users', 'POST', { name: 'Rustam Crewman', username: 'r12cru', password: 'c1234', role: 'operator' })).data
const users = (await req('/users')).data
const mir = users.find((u) => u.username === 'mir')
ok('fixtures ready', !!cru.id && !!mir)
const vid = (await req('/content', 'POST', { title: 'r12: member shoots this', channels: ['youtube'], type: 'video', operator_id: mir.id, recording_date: '2031-03-03', edit_ready_date: '2031-03-05', release_date: '2031-03-07' })).data
ok('member holds an operator hat on a live task', vid.operator_id === mir.id)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })

await page.goto(BASE + '/crew')
await page.waitForSelector('.crew-card, .crew-tt', { timeout: 10000 })
await page.waitForTimeout(400)
const deck = await page.locator('main').first().textContent()
ok('a crew-ROLE account gets a column', deck.includes('Rustam Crewman'))
ok('a member with a task hat does NOT', !deck.includes('Mirabbos'), 'deck should hold roles only')

const pills = (await page.locator('.pill.pill-person').allTextContents()).join(' | ')
ok('person filter lists crew roles only', pills.includes('Rustam') && !pills.includes('Mirabbos'), pills)
await page.screenshot({ path: 'r12-crew.png' })

await page.goto(BASE + '/todo')
await page.waitForSelector('.todo-row', { timeout: 10000 })
const rowTxt = await page.locator('.todo-row', { hasText: 'r12: member shoots this' }).textContent()
ok('the task still wears the member’s operator chip', rowTxt.includes('Mirabbos'))
await browser.close()

for (const c of (await req('/content')).data.filter((c) => /r12:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
await req(`/users/${cru.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-12 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
