// This round's changes, verified in the real UI: the bigger Gantt, site-wide
// text size, and crew on a post. (The fourth — an add-metric tile under the
// pinned metrics — went with the metrics themselves in round 82.) Crew on
// every task type.
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

// crew is accepted on non-video types server-side
const users = (await req('/users')).data
const jas = users.find((u) => u.username === 'jas')
for (const u of users.filter((x) => x.username === 'polop' || x.username === 'poldes')) await req(`/users/${u.id}`, 'DELETE')
const polop = (await req('/users', 'POST', { name: 'Polish Operator', username: 'polop', password: 'p1234', role: 'operator' })).data
const poldes = (await req('/users', 'POST', { name: 'Polish Designer', username: 'poldes', password: 'p1234', role: 'designer' })).data
const post = (await req('/content', 'POST', { title: 'Crew on a post', channels: ['instagram_main'], type: 'post', operator_id: jas.id, editor_id: jas.id })).data
ok('post carries optional crew', post.operator_id === jas.id && post.editor_id === jas.id)
ok('crew clears with null', (await req(`/content/${post.id}`, 'PATCH', { operator_id: null })).data.operator_id === null)


const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })

// 2. Gantt is bigger
await page.goto(BASE + '/projects')
await page.getByRole('button', { name: 'Gantt', exact: true }).click()
await page.waitForSelector('.gantt-bar', { timeout: 8000 })
const barH = await page.locator('.gantt-bar').first().evaluate((el) => el.getBoundingClientRect().height)
const nameF = await page.locator('.gantt-name').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
ok('gantt bars are tall', barH >= 32, `${Math.round(barH)}px`)
ok('gantt labels are readable', nameF >= 14, `${nameF}px`)
await page.screenshot({ path: 'polish-gantt.png' })

// 3. Text size: Small / Medium / Large from the profile, applied site-wide
await page.goto(BASE + '/profile')
await page.waitForSelector('.seg-btn', { timeout: 8000 })
await page.locator('.seg-btn', { hasText: 'Large' }).click()
await page.waitForTimeout(200)
ok('Large zooms the whole site', (await page.evaluate(() => document.documentElement.style.zoom)) === '1.14')
ok('choice is remembered', (await page.evaluate(() => localStorage.getItem('satashkent_text_size'))) === 'large')
await page.reload()
await page.waitForSelector('.seg-btn', { timeout: 8000 })
ok('survives a reload', (await page.evaluate(() => document.documentElement.style.zoom)) === '1.14')
await page.screenshot({ path: 'polish-large.png' })
await page.locator('.seg-btn', { hasText: 'Small' }).click()
ok('Small works too', (await page.evaluate(() => document.documentElement.style.zoom)) === '0.88')
await page.locator('.seg-btn', { hasText: 'Medium' }).click()
ok('Medium resets to normal', (await page.evaluate(() => document.documentElement.style.zoom)) === '')

// 4. A post carries the hats that have a stage, and they persist
// This board runs idea → shoot → edit. The designer hat came off the picker
// in round 78 — it was offered on every task and picked on almost none — so
// a post now gets the same two hats every other type has, not a design
// pipeline of its own. The column and anyone already holding it are
// untouched; it is simply not offered any more.
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.tcard', { timeout: 12000 })
await page.locator('.tcard', { hasText: 'Crew on a post' }).first().click()
await page.waitForSelector('.modal .crew-field', { timeout: 8000 })
const hats = await page.locator('.modal .crew-label').allTextContents()
ok('a post carries the two hats with a stage', hats.length === 2, hats.join(' / '))
ok('the designer hat is not offered', !hats.some((h) => /designer/i.test(h)), hats.join(' / '))
ok('marked optional', (await page.locator('.modal').textContent()).includes('optional'))
// The crew seats are a searchable picker now, not a <select> — a select's
// type-ahead jumps to the first matching name instead of narrowing the list,
// which is the thing that was wrong with it. Driven the way a person drives
// it: open the second seat, type part of the name, press the row.
await page.locator('.modal .crew-field .pp-field').nth(1).click()
await page.waitForSelector('.pp-pop .pp-search .input', { timeout: 8000 })
await page.fill('.pp-pop .pp-search .input', 'Polish Oper')
await page.waitForTimeout(250)
const narrowed = await page.locator('.pp-pop .pp-row').allTextContents()
ok('typing a name narrows the list rather than jumping to it',
  narrowed.length > 0 && narrowed.every((n) => /Polish Oper/i.test(n)), narrowed.join(' / '))
await page.locator('.pp-pop .pp-row', { hasText: 'Polish Operator' }).first().click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Save changes' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
ok('crew persisted from the modal', (await req(`/content/${post.id}`)).data.editor_id === polop.id)

await browser.close()
await req(`/content/${post.id}`, 'DELETE')
await req(`/users/${polop.id}`, 'DELETE')
await req(`/users/${poldes.id}`, 'DELETE')
console.log(fails === 0 ? '\nPolish suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
