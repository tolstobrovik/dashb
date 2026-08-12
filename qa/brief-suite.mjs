// The daily brief + role-scoped navigation, driven as a real crew member.
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

// A pure crew member: no departments at all.
const bek = (await req('/users', 'POST', { name: 'Bekzod Kamolov', username: 'bek', password: 'b1234', role: 'crew' })).data
const statuses = (await req('/statuses')).data
const sid = (l) => statuses.find((s) => s.label.toLowerCase() === l)?.id
const mk = (b) => req('/content', 'POST', b)
const rec = (await mk({ title: 'Shoot: campus tour ep. 2', channels: ['youtube'], type: 'video', operator_id: bek.id, recording_date: today, recording_time: '10:30' })).data
await mk({ title: 'Shoot: teacher interview', channels: ['instagram_main'], type: 'video', operator_id: bek.id, recording_date: add(2), recording_time: '14:00' })
const editNow = (await mk({ title: 'Edit: June recap film', channels: ['youtube'], type: 'video', editor_id: bek.id, recording_date: add(-3), release_date: add(1), status_id: sid('editing') })).data
await mk({ title: 'Edit: dorm room reveal', channels: ['youtube'], type: 'video', editor_id: bek.id, recording_date: add(-5), release_date: add(-1), status_id: sid('shot') })
await mk({ title: 'Release: alumni promo', channels: ['instagram_main'], type: 'video', editor_id: bek.id, recording_date: add(-8), release_date: today, release_time: '18:00', status_id: sid('ready') })

// crew visibility through the API
const BT = await login('bek', 'b1234')
const mine = (await req('/content', 'GET', null, BT)).data
ok('crew member sees videos outside his departments', mine.length >= 5, `sees ${mine.length}`)
ok('operator + editor roles both included', mine.some((c) => c.operator_id === bek.id) && mine.some((c) => c.editor_id === bek.id))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'bek')
await page.fill('input[name="password"]', 'b1234')
await page.click('button[type="submit"]')
await page.waitForURL(/brief/, { timeout: 15000 }).catch(() => {})
ok('crew lands on the brief after signing in', page.url().includes('/brief'), page.url())
await page.waitForSelector('.brief-title', { timeout: 10000 })
await page.waitForTimeout(700)
const hero = await page.locator('.brief-title').textContent()
ok('the brief headline sums up the day — no releasing for crew', /1 to record/.test(hero) && /1 overdue/.test(hero) && !/on the editing desk/.test(hero) && !/releasing/.test(hero), hero)
const pageTxt = await page.locator('.content').textContent()
ok('recording hour shown', pageTxt.includes('10:30'))
ok('the day splits into SHOOT and EDIT lanes', (await page.locator('.cb-col').count()) === 2 && /SHOOT/.test(pageTxt) && /EDIT/.test(pageTxt))
ok('the overdue edit sits in the still-haunting section', (await page.locator('.cb-emergency').count()) >= 1
  && (await page.locator('.cb-emergency').allTextContents()).join(' ').includes('dorm room reveal'))
ok('release hour hidden from the crew', !pageTxt.includes('18:00'))
await page.locator('.cb-col').first().locator('.cb-toggle', { hasText: 'Upcoming' }).click()
await page.waitForTimeout(200)
ok('the folded Upcoming section opens to show the future shoot', (await page.locator('.content').textContent()).includes('Shoot: teacher interview'))
ok('no metrics anywhere on the brief', !/followers|views|Metrics/i.test(pageTxt))
ok('crew topbar has no Projects link', (await page.locator('header').textContent()).includes('My Day') && !(await page.locator('header').textContent()).includes('Projects'))
await page.screenshot({ path: 'brief-crew.png', fullPage: true })

// member with departments: sidebar cleaned up
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const p2 = await ctx2.newPage()
await p2.goto(BASE + '/login')
await p2.fill('input[name="username"]', 'jas')
await p2.fill('input[name="password"]', 'j1234')
await p2.click('button[type="submit"]')
await p2.waitForURL(/brief/, { timeout: 15000 }).catch(() => {})
ok('member also lands on the brief', p2.url().includes('/brief'))
await p2.waitForSelector('.sidebar', { timeout: 8000 })
const side = await p2.locator('.sidebar').textContent()
ok('member sidebar: no Projects', !side.includes('Projects'))
const chans = (await req('/channels')).data
const jasDepts = ['instagram_main', 'instagram_uzb']
const mineLabels = chans.filter((c) => jasDepts.includes(c.key)).map((c) => c.label)
const otherLabels = chans.filter((c) => !jasDepts.includes(c.key)).map((c) => c.label)
ok('member sidebar: only their channels',
  mineLabels.every((l) => side.includes(l)) && otherLabels.every((l) => !side.includes(l)),
  `mine=${mineLabels.join('/')} others=${otherLabels.join('/')}`)
ok('member sidebar: My Day present', side.includes('My Day'))
await ctx2.close()

// admin keeps everything
const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const p3 = await ctx3.newPage()
await p3.goto(BASE + '/login')
await p3.fill('input[name="username"]', 'admin')
await p3.fill('input[name="password"]', 'admin123')
await p3.click('button[type="submit"]')
await p3.waitForURL(/overview/, { timeout: 15000 })
const side3 = await p3.locator('.sidebar').textContent()
ok('admin still lands on Overview with full nav', side3.includes('Projects') && side3.includes('My Day') && side3.includes('Admin'))
await ctx3.close()
await browser.close()

// cleanup the crew fixtures so other suites' counts stay stable
for (const c of mine.filter((x) => x.operator_id === bek.id || x.editor_id === bek.id)) await req(`/content/${c.id}`, 'DELETE')
await req(`/users/${bek.id}`, 'DELETE')

console.log(fails === 0 ? '\nBrief & navigation clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
