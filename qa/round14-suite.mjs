// This round: Post Production with an Editors&shooters / Designers split and
// designer statistics; a designer deadline separate from edit and release on
// every task; channel tags on the timetable blocks; the Designer role with
// multi-select roles and role-restricted pickers; multi-person assignees.
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
const yesterday = fmt.format(new Date(Date.now() - 864e5))
const add = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

for (const c of (await req('/content')).data.filter((c) => /r14:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
for (const u of (await req('/users')).data.filter((u) => ['r14mix', 'r14op'].includes(u.username)))
  await req(`/users/${u.id}`, 'DELETE')

const mix = (await req('/users', 'POST', { name: 'Malika Mixed', username: 'r14mix', password: 'm1234', role: 'crew', crew_roles: ['editor', 'designer'] })).data
ok('editor+designer in one account', (mix.crew_roles || []).join(',') === 'editor,designer', JSON.stringify(mix.crew_roles))
const op14 = (await req('/users', 'POST', { name: 'Otkir Operator', username: 'r14op', password: 'o1234', role: 'operator' })).data
const chg = (await req(`/users/${mix.id}`, 'PATCH', { crew_roles: ['designer'] })).data
ok('capabilities re-selectable — down to designer only', chg.role === 'designer' && (chg.crew_roles || []).join(',') === 'designer')
await req(`/users/${mix.id}`, 'PATCH', { crew_roles: ['editor', 'designer'] })
ok('crew accounts must keep at least one capability', (await req(`/users/${mix.id}`, 'PATCH', { role: 'crew', crew_roles: [] })).status === 400)

const vid = await req('/content', 'POST', {
  title: 'r14: launch video', channels: ['youtube'], type: 'video',
  operator_id: op14.id, editor_id: mix.id, designer_id: mix.id,
  edit_ready_date: yesterday, design_ready_date: yesterday, release_date: today,
  assignee_ids: [],
})
ok('a video carries an editor deadline AND a designer deadline', vid.status === 201
  && vid.data.edit_ready_date === yesterday && vid.data.design_ready_date === yesterday)
const wk = await req('/content', 'POST', {
  title: 'r14: campus shoot', channels: ['instagram_main'], type: 'video',
  operator_id: op14.id, recording_date: add(1), recording_time: '10:00', recording_end: '11:00',
})
ok('in-week shoot fixture created', wk.status === 201)

const users = (await req('/users')).data
const mir = users.find((u) => u.username === 'mir')
const jas = users.find((u) => u.username === 'jas')
const duo = await req('/content', 'POST', { title: 'r14: two-person task', channels: ['instagram_main'], type: 'post', assignee_ids: [mir.id, jas.id] })
ok('a task stores several assignees', duo.status === 201 && (duo.data.assignees || []).length === 2, JSON.stringify(duo.data.assignees))
ok('the legacy assignee mirrors the first', duo.data.assignee_id === mir.id)
const tokJas = await login('jas', 'j1234')
ok('the second assignee sees and works the task too', (await req(`/content/${duo.data.id}`, 'PATCH', { done: true, post_link: 'https://instagram.com/p/qa' }, tokJas)).status === 200)
await req(`/content/${duo.data.id}`, 'PATCH', { done: false })
ok('non-admin cannot multi-assign others', (await req('/content', 'POST', { title: 'r14: sneak', channels: ['instagram_main'], assignee_ids: [mir.id, jas.id] }, tokJas)).status === 403)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()

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
    ? `.pp-pop .pp-group:text-is("${group}") ~ .pp-row`
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

ok('the sidebar says Post Production', (await page.locator('.sidebar').textContent()).includes('Post Production'))
await page.goto(BASE + '/crew')
await page.waitForSelector('.pp-tabs', { timeout: 10000 })
await page.waitForTimeout(400)
ok('two sub-pages offered', (await page.locator('.pp-tabs').textContent()).includes('Editors & shooters')
  && (await page.locator('.pp-tabs').textContent()).includes('Designers'))
await page.locator('.pp-tabs .pill', { hasText: 'Designers' }).click()
await page.waitForTimeout(400)
const dPage = await page.locator('main').first().textContent()
ok('designer stats card renders', dPage.includes('Malika Mixed') && dPage.includes('in work') && dPage.includes('due this week'))
ok('the late design is counted against the design date', dPage.includes('past the design date'))
ok('queue rows carry the channel without opening the task', dPage.includes('r14: launch video') && dPage.includes('YouTube'))
await page.screenshot({ path: 'r14-designers.png' })

await page.locator('.pp-tabs .pill', { hasText: 'Editors & shooters' }).click()
await page.waitForTimeout(300)
await page.locator('.pill', { hasText: 'Timetable' }).click()
await page.waitForSelector('.crew-tt', { timeout: 8000 })
const igLabel = (await req('/channels')).data.find((c) => c.key === 'instagram_main')?.label || 'Instagram Main'
ok('timetable blocks say the channel', (await page.locator('.crew-tt .tt-ch').count()) >= 1
  && (await page.locator('.crew-tt').textContent()).includes(igLabel))
await page.screenshot({ path: 'r14-timetable.png' })

// The fixture lives on YouTube, and a channel board shows its own channel —
// the To-Do page this replaced listed every channel at once.
await page.goto(BASE + '/dept/youtube')
await page.waitForSelector('.tcard', { timeout: 12000 })
await page.locator('.tcard', { hasText: 'r14: launch video' }).first().click()
await page.waitForSelector('.modal', { timeout: 8000 })
await cmTab(page, 'Execution')
await page.waitForSelector('.modal .crew-field', { timeout: 8000 })
const labels = await page.locator('.modal .crew-field .crew-label').allTextContents()
// Round 78 took the designer hat off the picker — this board runs
// idea → shoot → edit and a designer has no stage in it. The design-ready
// deadline below is untouched, and so is the column: what changed is that
// the form no longer offers a hat nobody was picking.
ok('a video offers the Operator and Editor hats', labels.length === 2
  && /Operator/.test(labels[0]) && /Editor/.test(labels[1]), labels.join(' | '))
// Round 27: specialists lead their optgroup; everyone else is offered below
// for one-time duty — so the check is on who LEADS, not who appears.
const edSpecial = await ppNames(page.locator('.modal .crew-field .pp-field').nth(1), 'Editors')
ok('the editor specialists lead their list', edSpecial.some((o) => o.includes('Malika')) && !edSpecial.some((o) => o.includes('Otkir')))
ok('both deadline rows present', /Edit ready/.test(await page.locator('.modal .dates-block').textContent())
  && /Design ready/.test(await page.locator('.modal .dates-block').textContent()))

const addSel = page.locator('.modal .assignee-add .pp-field')
await ppPick(addSel, 'Mirabbos Tashkentov')
await ppPick(addSel, 'Jasmina Karimova')
await page.waitForTimeout(200)
ok('two assignee chips picked', (await page.locator('.modal .assignee-chip').count()) === 2,
  String(await page.locator('.modal .assignee-chip').count()))
await page.screenshot({ path: 'r14-modal.png' })
await page.locator('.modal').getByRole('button', { name: 'Save changes' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(400)
const savedVid = (await req('/content')).data.find((c) => c.id === vid.data.id)
ok('both assignees persisted', (savedVid.assignees || []).length === 2, JSON.stringify(savedVid.assignees))
const rowTxt = await page.locator('.tcard', { hasText: 'r14: launch video' }).first().textContent()
ok('the board card shows the crowd (+1)', /\+1/.test(rowTxt), rowTxt.slice(0, 140))

await page.goto(BASE + '/missed')
await page.waitForSelector('.ov-row', { timeout: 10000 })
const missRows = page.locator('.ov-row', { hasText: 'r14: launch video' })
const missAll = (await missRows.allTextContents()).join(' || ')
ok('the video missed BOTH maker deadlines separately', /edit deadline/.test(missAll) && /design deadline/.test(missAll), missAll.slice(0, 200))
ok('…design miss attributed to the designer', /Malika/.test(missAll))
await page.screenshot({ path: 'r14-missed.png' })
await browser.close()

for (const c of (await req('/content')).data.filter((c) => /r14:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
for (const u of (await req('/users')).data.filter((u) => ['r14mix', 'r14op'].includes(u.username)))
  await req(`/users/${u.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-14 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
