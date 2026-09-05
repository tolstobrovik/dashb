// This round: the right-click context menu, wired across the whole app.
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
for (const c of (await req('/content')).data.filter((c) => /r8:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
for (const p of (await req('/programs?channel=target')).data.filter((p) => /R8 /.test(p.name)))
  await req(`/programs/${p.id}`, 'DELETE')
const t1 = (await req('/content', 'POST', { title: 'r8: task for the menu', channels: ['instagram_main'], type: 'post', release_date: today })).data
const t2 = (await req('/content', 'POST', { title: 'r8: task to delete', channels: ['instagram_main'], type: 'post', release_date: add(1) })).data
const prog = (await req('/programs', 'POST', { channel: 'target', name: 'R8 menu program', status: 'running', start_date: add(-2), end_date: add(8) })).data
const need = (await req('/hiring', 'POST', { title: 'R8 need', note: 'menu test' })).data
ok('fixtures in place', [t1, t2, prog, need].every((x) => x?.id))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
const page = await ctx.newPage()

// The task sheet is three views and a thread now — Brief, Execution, Logistics
// — so a field is reached the way a person reaches it: open the view holding
// it first. Idempotent, and silent on a sheet short enough to show whole.
const cmTab = async (pg, name) => {
  // The same view is "Execution" to whoever runs the piece and "Your part" to
  // whoever does the work on it — it holds the crew, the handovers and the
  // crew's own tick, and which of those you are here for depends on who you
  // are. Either name reaches it.
  // Round 91 hides a view nobody has been in, behind one "Add details"
  // control — so reaching one is two presses when it is empty and one when it
  // is not, exactly as it is for a person.
  const more = pg.locator('.cm-page-more')
  for (const pass of [0, 1]) {
    for (const n of name === 'Execution' ? ['Execution', 'Your part'] : [name]) {
      const tab = pg.locator('.cm-page-tab', { hasText: n })
      if (await tab.count()) { await tab.first().click(); await pg.waitForTimeout(200); return }
    }
    if (pass === 0 && await more.count()) { await more.first().click(); await pg.waitForTimeout(250) }
    else return
  }
}

page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })

// ---- to-do rows ----
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.tcard', { timeout: 12000 })
await page.waitForTimeout(500)
const row1 = page.locator('.tcard', { hasText: 'r8: task for the menu' }).first()
await row1.click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
const items1 = await page.locator('.ctx-item').allTextContents()
ok('to-do row menu: open / done / pin / reschedule-free / delete',
  items1.some((i) => i.includes('Open')) && items1.some((i) => i.includes('Mark as done'))
  && items1.some((i) => i.includes('Pin')) && items1.some((i) => i.includes('Delete')), items1.join(' | '))
await page.screenshot({ path: 'r8-menu.png' })
// Esc closes
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
ok('Esc closes the menu', (await page.locator('.ctx-menu').count()) === 0)
// mark done through the menu
await row1.click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
await page.locator('.ctx-item', { hasText: 'Mark as done' }).click()
await page.waitForTimeout(700)
// Finishing a piece means it is published, and since round 86 the board will
// not take that word without the link. A card has nowhere to paste one, so the
// refusal opens the task on the box it is asking for rather than dead-ending
// in an alert.
ok('done without the link is refused, and the task opens on it',
  !(await req('/content')).data.find((c) => c.id === t1.id).done_at
  && (await page.locator('.modal').count()) === 1
  && (await page.locator('.modal [data-field="post_link"] input').count()) === 1)
await page.fill('.modal [data-field="post_link"] input', 'https://instagram.com/p/r8menu')
await page.locator('.modal').getByRole('button', { name: 'Save changes' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(400)
await row1.click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
await page.locator('.ctx-item', { hasText: 'Mark as done' }).click()
await page.waitForTimeout(600)
ok('menu → Mark as done really lands', !!(await req('/content')).data.find((c) => c.id === t1.id).done_at)
// delete through the menu (confirm auto-accepted)
const row2 = page.locator('.tcard', { hasText: 'r8: task to delete' }).first()
await row2.click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
await page.locator('.ctx-item.danger', { hasText: 'Delete' }).click()
await page.waitForTimeout(600)
ok('menu → Delete removes it server-side', !(await req('/content')).data.some((c) => c.id === t2.id))
// outside click closes
await row1.click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
await page.mouse.click(40, 200)
await page.waitForTimeout(200)
ok('a click anywhere else dismisses it', (await page.locator('.ctx-menu').count()) === 0)

// ---- brief rows ----
await page.goto(BASE + '/brief')
await page.waitForSelector('.brief-title', { timeout: 10000 })
await page.waitForTimeout(500)
const briefRow = page.locator('.ov-row', { hasText: 'r8: task for the menu' }).first()
if (await briefRow.count()) {
  await briefRow.click({ button: 'right' })
  await page.waitForSelector('.ctx-menu', { timeout: 5000 })
  await page.locator('.ctx-item', { hasText: 'Mark as not done' }).click()
  await page.waitForTimeout(600)
  ok('brief row menu flips done back off', !(await req('/content')).data.find((c) => c.id === t1.id).done_at)
} else {
  // done rows show under "What you've done"
  ok('brief row present for the menu', false, 'row not found')
}

// ---- program gantt rows ----
await page.goto(BASE + '/dept/target')
await page.waitForSelector('.gantt-row', { timeout: 10000 })
await page.waitForTimeout(400)
const progRow = page.locator('.gantt-row', { hasText: 'R8 menu program' })
await progRow.click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
ok('program menu offers halt & finish & delete', (await page.locator('.ctx-item', { hasText: 'Halt' }).count()) === 1
  && (await page.locator('.ctx-item', { hasText: 'finished' }).count()) === 1
  && (await page.locator('.ctx-item.danger').count()) === 1)
await page.locator('.ctx-item', { hasText: 'Halt' }).click()
await page.waitForTimeout(600)
ok('menu → Halt persists', (await req('/programs?channel=target')).data.find((p) => p.id === prog.id).status === 'paused')

// ---- team & hiring cards ----
await page.goto(BASE + '/team')
await page.waitForSelector('.team-grid, .tbl', { timeout: 10000 })
await page.waitForTimeout(500)
if ((await page.locator('.team-grid').count()) === 0) {
  await page.locator('.pill', { hasText: 'Cards' }).click()
  await page.waitForTimeout(300)
}
await page.locator('.team-card', { hasText: 'Jasmina' }).click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
await page.locator('.ctx-item', { hasText: 'Edit member' }).click()
await page.waitForSelector('.modal', { timeout: 5000 })
ok('member card menu opens the editor', (await page.locator('.modal').textContent()).includes('Permissions'))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.locator('.hire-card', { hasText: 'R8 need' }).click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
await page.locator('.ctx-item', { hasText: 'Mark as hired' }).click()
await page.waitForTimeout(500)
ok('hiring card menu marks it hired', (await req('/hiring')).data.find((n) => n.id === need.id).status === 'hired')

// ---- whiteboard nodes ----
await page.goto(BASE + '/admin')
await page.getByRole('button', { name: 'Whiteboard' }).click()
await page.waitForSelector('.board-inner', { timeout: 10000 })
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Add role' }).click()
await page.waitForSelector('.modal', { timeout: 5000 })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const before = await page.locator('.board-node').count()
await page.locator('.board-node').last().click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
ok('node menu: edit / connect / delete', (await page.locator('.ctx-item').count()) === 3)
await page.locator('.ctx-item.danger').click()
await page.waitForTimeout(400)
ok('menu → Delete card removes the node', (await page.locator('.board-node').count()) === before - 1)

await browser.close()

// ============ cleanup ============
for (const c of (await req('/content')).data.filter((c) => /r8:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
await req(`/programs/${prog.id}`, 'DELETE')
await req(`/hiring/${need.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-8 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
