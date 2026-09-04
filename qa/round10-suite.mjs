// This round: role-holders fill the crew lists (multi-select roles included),
// assign lists that learn your regulars via a cookie, and synced-action toasts.
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

// ============ pre-clean + fixtures ============
for (const c of (await req('/content')).data.filter((c) => /r10:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
for (const u of (await req('/users')).data.filter((x) => x.username === 'r10cru'))
  await req(`/users/${u.id}`, 'DELETE')
const t1 = (await req('/content', 'POST', { title: 'r10: crew pick probe', channels: ['instagram_main'], type: 'video' })).data
ok('fixture in place', !!t1.id)
// Both hats in one person: an editor & operator account (multi-select roles).
const cru = (await req('/users', 'POST', { name: 'Rustam Multihat', username: 'r10cru', password: 'r1234', role: 'crew', crew_roles: ['editor', 'operator'] })).data
ok('multi-role account stores both capabilities', Array.isArray(cru.crew_roles) && cru.crew_roles.includes('editor') && cru.crew_roles.includes('operator'), JSON.stringify(cru.crew_roles))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
const page = await ctx.newPage()

// ---- driving the person pickers ------------------------------------------
// The crew seats and the assignee box are searchable pickers now rather than
// <select> elements: a select's type-ahead jumps to the first matching name
// instead of narrowing the list, which is exactly what was wrong with it. The
// suites drive them the way a person does — open, type, press the row.
const ppOpen = async (root) => {
  await root.click()
  await page.waitForSelector('.pp-pop', { timeout: 8000 })
}
const ppNames = async (root, group = null) => {
  await ppOpen(root)
  const sel = group
    ? `.pp-pop .pp-group:text-is("${group}") + button, .pp-pop .pp-group:text-is("${group}") ~ .pp-row`
    : '.pp-pop .pp-row'
  const names = await page.locator(sel).allTextContents()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  return names
}
const ppPick = async (root, name) => {
  await ppOpen(root)
  await page.fill('.pp-pop .pp-search .input', name)
  await page.waitForTimeout(200)
  await page.locator('.pp-pop .pp-row', { hasText: name }).first().click()
  await page.waitForTimeout(250)
}
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })

// ---- 1. a person with both roles is offered for both hats ----
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.tcard', { timeout: 12000 })
await page.locator('.tcard', { hasText: 'r10: crew pick probe' }).first().click()
await page.waitForSelector('.modal .crew-field', { timeout: 8000 })
const opSel = page.locator('.modal .crew-field .pp-field').first()
const edSel = page.locator('.modal .crew-field .pp-field').nth(1)
const opOptions = await ppNames(opSel)
const edOptions = await ppNames(edSel)
ok('an operator-role holder is offered as operator', opOptions.some((o) => o.includes('Rustam Multihat')))
ok('…and, holding the editor role too, as editor of the same video', edOptions.some((o) => o.includes('Rustam Multihat')))
await ppPick(opSel, 'Rustam Multihat')
await ppPick(edSel, 'Rustam Multihat')
await page.locator('.modal').getByRole('button', { name: 'Save changes' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(400)
const saved = (await req('/content')).data.find((c) => c.id === t1.id)
ok('one person holds both hats after save', saved.operator_id === cru.id && saved.editor_id === cru.id,
  `want=${cru.id} op=${saved.operator_id} ed=${saved.editor_id}`)

// ---- 3. the toast confirms only after the server did ----
ok('a synced toast appeared for the save', (await page.locator('.toast').count()) >= 1
  && /synced/.test(await page.locator('.toast').first().textContent()))
await page.waitForTimeout(2800)
ok('toasts dismiss themselves', (await page.locator('.toast').count()) === 0)

// ---- 2. the lists learn: the regular floats to the top (cookie) ----
const picksCookie = (await ctx.cookies(BASE)).find((c) => c.name === 'satashkent_picks')
ok('picks cookie written after the confirmed save', !!picksCookie && decodeURIComponent(picksCookie.value).includes(`"${cru.id}"`))
for (let i = 0; i < 2; i++) {
  await page.locator('.tcard', { hasText: 'r10: crew pick probe' }).first().click()
  await page.waitForSelector('.modal .crew-field', { timeout: 8000 })
  await page.locator('.modal').getByRole('button', { name: 'Save changes' }).click()
  await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
  await page.waitForTimeout(300)
}
await page.locator('.tcard', { hasText: 'r10: crew pick probe' }).first().click()
await page.waitForSelector('.modal .crew-field', { timeout: 8000 })
const rankedOps = await ppNames(page.locator('.modal .crew-field .pp-field').first())
// [1], not [0]: the list opens with the "— nobody —" row, exactly as the old
// <select> opened with its empty option.
ok('most-picked person now leads the operator list', rankedOps[1].includes('Rustam Multihat'), rankedOps.slice(0, 3).join(' | '))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// quick-add fires a toast after the server confirms
// The To-Do page's add line is gone; the board's own column foot took the job
// and toasts the same way, once the server has actually answered.
await page.locator('.board-col').first().locator('.board-quick-btn').click()
await page.locator('.board-quick-input').fill('r10: toast probe')
await page.keyboard.press('Enter')
// "Added", not just any synced toast: the saves above leave their own on
// screen and a strict locator matching two of them is a false failure.
await page.locator('.toast', { hasText: 'Added' }).first().waitFor({ timeout: 6000 })
ok('quick-add toast says added + synced', /synced/.test(await page.locator('.toast', { hasText: 'Added' }).first().textContent()))
await page.screenshot({ path: 'r10-toast.png' })
await page.waitForTimeout(2800)

// delete via right-click → toast
const probeRow = page.locator('.tcard', { hasText: 'r10: toast probe' }).first()
await probeRow.click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
await page.locator('.ctx-item.danger', { hasText: 'Delete' }).click()
await page.locator('.toast', { hasText: 'deleted' }).waitFor({ timeout: 6000 })
ok('delete confirms with a toast', true)

await browser.close()

// ============ cleanup ============
for (const c of (await req('/content')).data.filter((c) => /r10:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
await req(`/users/${cru.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-10 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
