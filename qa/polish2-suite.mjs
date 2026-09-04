// Fullscreen gantt, program/campaign checklists, multi-dept quick-add,
// quick department create, sounds setting — driven end to end.
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

// ---- API: program checklist rules ----
for (const p of (await req('/programs?channel=target')).data) await req(`/programs/${p.id}`, 'DELETE')
const prog = (await req('/programs', 'POST', { channel: 'target', name: 'Checklist run', status: 'running', start_date: add(-2), end_date: add(10), checklist: [{ text: 'Creatives ready', done: true }, { text: 'Landing approved', done: false }] })).data
ok('program stores its checklist', JSON.parse(prog.checklist).length === 2)
const JT = await login('jas', 'j1234')
ok('non-admin cannot edit a program checklist', (await req(`/programs/${prog.id}`, 'PATCH', { checklist: [] }, JT)).status === 403)
// campaign created WITH a checklist from the form payload
const camps = (await req('/campaigns')).data
const proj = (await req('/projects')).data[0]
const camp = (await req('/campaigns', 'POST', { name: 'Checklist campaign', stage: 'idea', project_id: proj.id, checklist: [{ text: 'Brief the designer', done: false }] })).data
ok('campaign creation carries a checklist', camp.checklist.length === 1)

// ---- UI ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })

// 1. Fullscreen gantt
await page.goto(BASE + '/dept/target')
await page.waitForSelector('.gantt-bar', { timeout: 10000 })
ok('checklist progress chip on the row', (await page.locator('.prog-cl', { hasText: '1/2' }).count()) === 1)
await page.locator('.section-head', { hasText: 'Programs' }).locator('button[aria-label="Full screen"]').click()
await page.waitForTimeout(400)
ok('gantt goes fullscreen', await page.locator('.fs-wrap.on').count() === 1)
ok('fullscreen bars are bigger', await page.locator('.gantt-big .gantt-bar').first().evaluate((el) => el.getBoundingClientRect().height >= 42))
await page.screenshot({ path: 'fs-gantt.png' })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
ok('Esc leaves fullscreen', await page.locator('.fs-wrap.on').count() === 0)

// 2. Program checklist: click-to-edit, delete — like a to-do list
await page.locator('.gantt-row', { hasText: 'Checklist run' }).locator('.gantt-label').click()
await page.waitForSelector('.modal', { timeout: 8000 })
ok('checklist lives in the program modal', (await page.locator('.modal .subtask-row').count()) === 2)
await page.locator('.modal .pc-check-txt', { hasText: 'Landing approved' }).click()
await page.locator('.modal .subtask-row input.pc-mini').first().fill('Landing approved by Aziz')
await page.keyboard.press('Enter')
await page.locator('.modal').getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(400)
const saved = (await req('/programs?channel=target')).data.find((p) => p.id === prog.id)
ok('click-to-edit rename persisted', JSON.parse(saved.checklist).some((c) => c.text === 'Landing approved by Aziz'), saved.checklist)

// 3. Campaign form carries the checklist editor (admin)
await page.goto(BASE + '/projects')
await page.getByRole('button', { name: 'New campaign' }).click().catch(() => {})
if (!(await page.locator('.modal').count())) {
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click()
  await page.getByRole('button', { name: 'New campaign' }).click()
}
await page.waitForSelector('.modal', { timeout: 8000 })
ok('campaign form has the checklist block', (await page.locator('.modal .pc-check-head').count()) === 1)
await page.keyboard.press('Escape')

// 4. One task, several departments
// This used to be the To-Do page's quick-add line, with a row of channel
// checkboxes under the title. Round 82 removed that page; the capability it
// offered did not go with it — the board's own quick-add starts the card and
// the task itself carries the channel chips — so the same question is asked of
// the path that survived.
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.board-col', { timeout: 10000 })
// The task sheet is views now — Brief, Execution, Logistics, Talk — so a
// field is reached the way a person reaches it: open the view holding it
// first. Idempotent, and silent on a sheet short enough to show whole.
const cmTab = async (pg, name) => {
  for (const n of name === 'Execution' ? ['Execution', 'Your part'] : [name]) {
    const tab = pg.locator('.cm-page-tab', { hasText: n })
    if (await tab.count()) { await tab.first().click(); await pg.waitForTimeout(200); return }
  }
}

await page.locator('.board-col').first().locator('.board-quick-btn').click()
await page.locator('.board-quick-input').fill('Cross-post announcement')
await page.keyboard.press('Enter')
await page.waitForTimeout(900)
await page.locator('.tcard', { hasText: 'Cross-post announcement' }).first().click()
await page.waitForSelector('.modal', { timeout: 8000 })
// Which platforms a piece goes out on is set up beside who is on it and when
// it is due, so it lives in the Execution view. Reach it the way a person
// does. (The view is "Your part" to whoever does the work on the piece.)
await cmTab(page, 'Execution')
await page.locator('.modal .checkbox-chip', { hasText: 'YouTube' }).first().click()
await page.locator('.modal').getByRole('button', { name: 'Save changes' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(600)
const multi = (await req('/content')).data.find((c) => c.title === 'Cross-post announcement')
ok('a task lands on several departments at once', multi && multi.channels.length === 2 && multi.channels.includes('youtube'), JSON.stringify(multi?.channels))

// 5. Quick department create from the task modal, icon guessed
await page.locator('.tcard', { hasText: 'Cross-post announcement' }).first().click()
await page.waitForSelector('.modal', { timeout: 8000 })
// The "add a channel" chip sits with the platforms, so it is in Execution too.
await cmTab(page, 'Execution')
await page.locator('.modal .chip-add').click()
await page.locator('.modal .chip-add-form input').fill('TikTok Ads')
await page.locator('.modal .chip-add-form button').click()
await page.waitForTimeout(700)
const chans = (await req('/channels')).data
const tiktok = chans.find((c) => c.label === 'TikTok Ads')
ok('department created from the modal', !!tiktok)
ok('logo guessed from the name', tiktok?.icon === 'music', tiktok?.icon)
ok('new department is pre-selected on the task', (await page.locator('.modal .checkbox-chip.on', { hasText: 'TikTok Ads' }).count()) === 1)
await page.screenshot({ path: 'quick-dept.png' })
await page.keyboard.press('Escape')

// 6. Sounds setting
await page.goto(BASE + '/profile')
await page.waitForSelector('.seg-btn', { timeout: 8000 })
ok('sounds switch present', (await page.locator('.seg-btn', { hasText: 'Sounds on' }).count()) === 1)
await page.locator('.seg-btn', { hasText: 'Off' }).last().click()
ok('off is remembered', await page.evaluate(() => localStorage.getItem('satashkent_sounds') === 'off'))
await page.locator('.seg-btn', { hasText: 'Sounds on' }).click()
ok('back on', await page.evaluate(() => localStorage.getItem('satashkent_sounds') === 'on'))

// 7. Motion: reduced-motion users get stillness (media emulation)
const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
const rp = await rctx.newPage()
await rp.goto(BASE + '/login')
const dur = await rp.locator('.login-card').evaluate((el) => getComputedStyle(el).animationDuration)
ok('reduced motion honored', dur === '0.001s' || dur === '0s', dur)
await rctx.close()

await browser.close()
// cleanup
await req(`/campaigns/${camp.id}`, 'DELETE')
for (const c of (await req('/content')).data.filter((x) => x.title === 'Cross-post announcement')) await req(`/content/${c.id}`, 'DELETE')
if (tiktok) await req(`/channels/${tiktok.id}`, 'DELETE')
for (const p of (await req('/programs?channel=target')).data) await req(`/programs/${p.id}`, 'DELETE')
console.log(fails === 0 ? '\nPolish-2 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
