// This round: shoot/edit clarity on the crew page, no-owner on the channel
// page, branch tags big on Target bars, the videographer's edit-ready
// deadline feeding Missed, and the simple task-first My Day for non-crew.
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
for (const u of (await req('/users')).data.filter((u) => ['kam'].includes(u.username)))
  await req(`/users/${u.id}`, 'DELETE')
for (const c of (await req('/content')).data.filter((c) => /r5:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
for (const p of (await req('/programs?channel=target')).data.filter((p) => /R5 /.test(p.name)))
  await req(`/programs/${p.id}`, 'DELETE')

// ============ programs: branches ============
const prog = (await req('/programs', 'POST', {
  channel: 'target', name: 'R5 lead push', status: 'running', start_date: add(-3), end_date: add(10),
  branches: ['shahristan', 'andijan', 'nowhere'],
})).data
ok('branches stored, unknown ones dropped', JSON.stringify(JSON.parse(prog.branches)) === '["shahristan","andijan"]', prog.branches)
const patched = (await req(`/programs/${prog.id}`, 'PATCH', { branches: ['bukhara'] })).data
ok('branches editable', JSON.parse(patched.branches)[0] === 'bukhara')
await req(`/programs/${prog.id}`, 'PATCH', { branches: ['shahristan', 'andijan'] })

// ============ edit-ready: the videographer's clock ============
const kam = (await req('/users', 'POST', { name: 'Kamron Aliyev', username: 'kam', password: 'k1234', role: 'crew' })).data
const statuses = (await req('/statuses')).data
const sid = (l) => statuses.find((s) => s.label.toLowerCase() === l)?.id
// missed the edit deadline, still not ready
const lateEdit = (await req('/content', 'POST', { title: 'r5: montage overdue', channels: ['youtube'], type: 'video', editor_id: kam.id, edit_ready_date: add(-2), release_date: add(3) })).data
ok('edit_ready_date stored', lateEdit.edit_ready_date === add(-2) && lateEdit.release_date === add(3))
// was late but IS ready now (ready_at stamps when the stage reaches ready)
const readyLate = (await req('/content', 'POST', { title: 'r5: promo ready late', channels: ['instagram_main'], type: 'video', editor_id: kam.id, edit_ready_date: add(-4), release_date: add(5) })).data
const stamped = (await req(`/content/${readyLate.id}`, 'PATCH', { status_id: sid('ready') })).data
ok('reaching the Ready stage stamps ready_at', !!stamped.ready_at, stamped.ready_at)
// edit deadline in the future — clean
const cleanEdit = (await req('/content', 'POST', { title: 'r5: cut on schedule', channels: ['youtube'], type: 'video', editor_id: kam.id, edit_ready_date: add(2), release_date: add(6) })).data
// release missed too, by the head (assignee admin)
const relMiss = (await req('/content', 'POST', { title: 'r5: release overdue post', channels: ['instagram_main'], type: 'post', release_date: add(-1) })).data
ok('fixtures in place', [lateEdit, readyLate, cleanEdit, relMiss].every((c) => c?.id))

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
await page.waitForTimeout(500)

// ---- branches ride BIG on the target bars ----
await page.goto(BASE + '/dept/target')
await page.waitForSelector('.gantt-bar', { timeout: 10000 })
await page.waitForTimeout(400)
const bar = page.locator('.gantt-bar', { hasText: 'R5 lead push' })
ok('branch names ride the bar in caps', (await bar.locator('.prog-branch-txt').textContent()) === 'SHAHRISTAN · ANDIJAN')
ok('row label carries the branches too', (await page.locator('.gantt-row', { hasText: 'R5 lead push' }).locator('.prog-br').count()) === 1)
// the form offers the five filials
await bar.click()
await page.waitForSelector('.modal', { timeout: 8000 })
const chips = await page.locator('.modal .checkbox-chip').allTextContents()
ok('form offers all five branches, two pre-checked',
  ['Shahristan', 'Chilanzar', 'Drujba', 'Andijan', 'Bukhara'].every((b) => chips.some((c) => c.includes(b)))
  && (await page.locator('.modal .checkbox-chip.on').count()) === 2, chips.join(','))
await page.screenshot({ path: 'r5-branches.png', fullPage: false })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// ---- no-owner on the channel page itself ----
ok('channel page wears the no-owner flag', (await page.locator('.dept-head-row .no-owner-badge').count()) === 1)
// clicking it (admin) opens the channel settings with the head picker
await page.locator('.dept-head-row .no-owner-badge').click()
await page.waitForSelector('.modal', { timeout: 8000 })
ok('the flag opens the fix — channel settings', (await page.locator('.modal').textContent()).includes('Head'))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// ---- crew page: shoot vs edit, unmistakable ----
const shootFx = (await req('/content', 'POST', { title: 'r5: campus shoot', channels: ['youtube'], type: 'video', operator_id: kam.id, recording_date: today, recording_time: '11:00', recording_end: '12:30' })).data
await page.goto(BASE + '/crew')
await page.waitForSelector('.crew-card, .crew-tt', { timeout: 10000 })
await page.locator('.pill', { hasText: 'Timetable' }).click()
await page.waitForSelector('.crew-tt', { timeout: 8000 })
await page.waitForTimeout(400)
const kamRow = page.locator('.crew-tt tr', { hasText: 'Kamron' })
ok('shoot block says Shoot with its hours', (await kamRow.locator('.tt-shoot:not(.tt-edit)', { hasText: 'Shoot' }).first().textContent()).includes('11:00–12:30'))
ok('edit block says Edit due, in its own color', (await kamRow.locator('.tt-edit', { hasText: 'Edit due' }).count()) >= 1)
await page.screenshot({ path: 'r5-crew-clarity.png', fullPage: true })
await page.locator('.pill', { hasText: 'List' }).click()
await page.waitForTimeout(400)
const listTxt = await page.locator('.content').textContent()
ok('list rows spell it out too', listTxt.includes('Shoot · 11:00–12:30') && listTxt.includes('Edit due'))

// ---- missed: the videographer's clock shows up ----
await page.goto(BASE + '/missed')
await page.waitForSelector('.miss-stats', { timeout: 10000 })
await page.waitForTimeout(500)
const mTxt = await page.locator('.content').textContent()
ok('missed edit deadline listed while release is still fine', mTxt.includes('r5: montage overdue'))
ok('its row wears the edit-deadline chip', (await page.locator('.ov-row', { hasText: 'r5: montage overdue' }).locator('.miss-kind-edit').count()) === 1)
ok('ready-late edit lands under Finished-but-late', mTxt.includes('r5: promo ready late') && /ready \d+ days? late/.test(mTxt))
ok('release misses keep their own chip', (await page.locator('.ov-row', { hasText: 'r5: release overdue post' }).locator('.miss-kind-rel').count()) === 1)
ok('on-schedule edit stays off the page', !mTxt.includes('r5: cut on schedule'))
await page.screenshot({ path: 'r5-missed-kinds.png', fullPage: true })

// crew see their own edit miss
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const p2 = await ctx2.newPage()
p2.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR (kam): ${e.message}`) })
await p2.goto(BASE + '/login')
await p2.fill('input[name="username"]', 'kam')
await p2.fill('input[name="password"]', 'k1234')
await p2.click('button[type="submit"]')
await p2.waitForURL(/brief/, { timeout: 15000 })
await p2.waitForSelector('.brief-title', { timeout: 10000 })
await p2.waitForTimeout(500)
const crewBrief = await p2.locator('.content').textContent()
ok('crew brief carries the SHOOT and EDIT lanes', crewBrief.includes('SHOOT') && crewBrief.includes('EDIT') && crewBrief.includes('To-do today'))
ok('the late cut is flagged in the edit lane', crewBrief.includes('late'))
await p2.goto(BASE + '/missed')
await p2.waitForSelector('.brief-title', { timeout: 10000 })
await p2.waitForTimeout(400)
const kamMissed = await p2.locator('.content').textContent()
ok('crew see their own edit miss', kamMissed.includes('r5: montage overdue'))
ok("crew don't see the head's release miss", !kamMissed.includes('r5: release overdue post'))
await ctx2.close()

// ---- the simple My Day for non-crew ----
const JT = await login('jas', 'j1234')
await req('/content', 'POST', { title: 'r5: jas post today', channels: ['instagram_main'], type: 'post', release_date: today }, JT)
await req('/content', 'POST', { title: 'r5: jas next week', channels: ['instagram_main'], type: 'post', release_date: add(9) }, JT)
const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const p3 = await ctx3.newPage()
p3.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR (jas): ${e.message}`) })
await p3.goto(BASE + '/login')
await p3.fill('input[name="username"]', 'jas')
await p3.fill('input[name="password"]', 'j1234')
await p3.click('button[type="submit"]')
await p3.waitForURL(/brief/, { timeout: 15000 })
await p3.waitForSelector('.brief-title', { timeout: 10000 })
await p3.waitForTimeout(500)
const jasBrief = await p3.locator('.content').textContent()
ok('member brief is the simple one — no crew sections', jasBrief.includes('To do today') && !jasBrief.includes('Editing desk') && !jasBrief.includes('Record today'))
ok('today list holds their task', jasBrief.includes('r5: jas post today'))
ok('horizons: tomorrow / 3 / 7 / custom', jasBrief.includes('Tomorrow') && jasBrief.includes('Next 7 days') && jasBrief.includes('Custom'))
// the custom stretch finds the task 9 days out
await p3.locator('.brief-horizon .miss-custom input').first().fill(add(8))
await p3.locator('.brief-horizon .miss-custom input').last().fill(add(12))
await p3.waitForTimeout(400)
ok('custom dates pull in the far task', (await p3.locator('.content').textContent()).includes('r5: jas next week'))
await p3.screenshot({ path: 'r5-simple-brief.png', fullPage: true })
await ctx3.close()
await browser.close()

// ============ cleanup ============
for (const c of (await req('/content')).data.filter((c) => /r5:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
await req(`/programs/${prog.id}`, 'DELETE')
await req(`/users/${kam.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-5 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
