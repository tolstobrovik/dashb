// Editor / operator as first-class roles: server rules, then the lived flow.
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

// pre-clean leftovers from any crashed earlier run
for (const uname of ['tim', 'oli']) {
  const u = (await req('/users')).data.find((x) => x.username === uname)
  if (u) await req(`/users/${u.id}`, 'DELETE')
}
for (const c of (await req('/content')).data.filter((x) => ['renamed', 'Edit: campus film', 'Foreign post'].includes(x.title))) {
  await req(`/content/${c.id}`, 'DELETE')
}

// role rules on create
ok('bogus role refused', (await req('/users', 'POST', { name: 'X', username: 'x1', password: 'x1234', role: 'boss' })).status === 400)
const ed = (await req('/users', 'POST', { name: 'Timur Editor', username: 'tim', password: 't1234', role: 'editor', departments: ['youtube', 'instagram_main'], permissions: { manage_content: true } })).data
ok('editor created; departments and permissions stripped', ed.role === 'editor' && ed.departments.length === 0 && Object.keys(ed.permissions).filter((k) => ed.permissions[k]).length === 0, JSON.stringify({ d: ed.departments, p: ed.permissions }))
const op = (await req('/users', 'POST', { name: 'Olim Operator', username: 'oli', password: 'o1234', role: 'operator' })).data
ok('operator created', op.role === 'operator')

// tasks: one theirs, one foreign
const statuses = (await req('/statuses')).data
const sid = (l) => statuses.find((s) => s.label.toLowerCase() === l)?.id
const vid = (await req('/content', 'POST', { title: 'Edit: campus film', channels: ['youtube'], type: 'video', editor_id: ed.id, operator_id: op.id, recording_date: '2026-07-14', release_date: '2026-07-18', status_id: sid('shot') })).data
const foreign = (await req('/content', 'POST', { title: 'Foreign post', channels: ['telegram_main'], type: 'post' })).data

const ET = await login('tim', 't1234')
const mine = (await req('/content', 'GET', null, ET)).data
ok('editor sees only their videos', mine.some((c) => c.id === vid.id) && !mine.some((c) => c.id === foreign.id), `sees ${mine.length}`)
ok('editor sees the whole team for names', (await req('/users', 'GET', null, ET)).data.length >= 5)
ok('editor cannot set a raw stage', (await req(`/content/${vid.id}`, 'PATCH', { status_id: sid('editing') }, ET)).status === 403)
// milestone verified on a throwaway so vid stays pristine (unstamped) for the UI below
const mp = (await req('/content', 'POST', { title: 'Edit: milestone probe', channels: ['youtube'], type: 'video', editor_id: ed.id, status_id: sid('shot') })).data
// The cut rides along with the tick since round 69: saying a stage is
// finished is a claim, and for a stage that produces a file the claim is
// checkable, so it is checked.
ok('editor ticks "edited" → the cut lands on Ready', (await req(`/content/${mp.id}`, 'PATCH', { milestone: 'edited', ready_link: 'https://drive.google.com/role-cut' }, ET)).data.status_id === sid('ready'))
ok('…and the tick without the cut is refused', (await req(`/content/${(await req('/content', 'POST', { title: 'Edit: no cut', channels: ['youtube'], type: 'video', editor_id: ed.id, status_id: sid('shot') })).data.id}`, 'PATCH', { milestone: 'edited' }, ET)).status === 400)
await req(`/content/${mp.id}`, 'DELETE')
ok('editor cannot touch a foreign task', (await req(`/content/${foreign.id}`, 'PATCH', { status_id: sid('editing') }, ET)).status === 403)
ok('editor cannot rewrite details', (await req(`/content/${vid.id}`, 'PATCH', { title: 'renamed' }, ET)).status === 403)
ok('editor cannot create team tasks', (await req('/content', 'POST', { title: 'sneak', channels: ['youtube'], type: 'post' }, ET)).status === 403)
ok('editor cannot complete — that is not their reach', (await req(`/content/${vid.id}`, 'PATCH', { done: true }, ET)).status === 403)
ok('editor drops a Google-Drive ready link', (await req(`/content/${vid.id}`, 'PATCH', { ready_link: 'https://drive.google.com/x' }, ET)).status === 200)

// a department member sees crew users for the chips
const JT = await login('jas', 'j1234')
const jasSees = (await req('/users', 'GET', null, JT)).data
ok('members see crew users', jasSees.some((u) => u.id === ed.id) && jasSees.some((u) => u.id === op.id))

// ---- the lived editor flow ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'tim')
await page.fill('input[name="password"]', 't1234')
await page.click('button[type="submit"]')
await page.waitForURL(/brief/, { timeout: 15000 }).catch(() => {})
ok('editor lands on the brief', page.url().includes('/brief'), page.url())
await page.waitForSelector('.brief-title', { timeout: 10000 })
await page.waitForTimeout(600)
ok('their video sits in the edit lane (still-haunting, open by default)', (await page.locator('.cb-col').first().textContent()).includes('Edit: campus film'))
const header = await page.locator('header').textContent()
ok('crew chrome: My Day + To-Do, nothing else', header.includes('My Day') && header.includes('To-Do') && !header.includes('Projects'))

// move the stage through the modal
await page.locator('.cb-row', { hasText: 'Edit: campus film' }).first().click()
await page.waitForSelector('.modal', { timeout: 8000 })
const readyChip = page.locator('.modal .stage-chip', { hasText: 'Ready' })
ok('the stage is read-only for the editor', !(await readyChip.isEnabled()))
ok('the editor sees a "Mark as edited" tick', (await page.locator('.modal .do-tick', { hasText: 'edited' }).count()) === 1)
await page.locator('.modal .do-tick', { hasText: 'edited' }).click()
await page.getByRole('button', { name: 'Save changes' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(400)
ok('the tick moved it to Ready', (await req(`/content/${vid.id}`)).data.status_id === sid('ready'))
await page.screenshot({ path: 'role-editor.png', fullPage: true })

// To-Do for crew: only their items, no channel tabs, no team quick-add
await page.goto(BASE + '/todo')
await page.waitForTimeout(800)
const todoTxt = await page.locator('.content').textContent()
ok('to-do holds their video, not foreign work', todoTxt.includes('Edit: campus film') && !todoTxt.includes('Foreign post'))
ok('no channel tabs for crew', !(todoTxt.includes('Telegram Main')) && !(todoTxt.includes('Instagram')))

// admin table shows the new badges
const actx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const ap = await actx.newPage()
await ap.goto(BASE + '/login')
await ap.fill('input[name="username"]', 'admin')
await ap.fill('input[name="password"]', 'admin123')
await ap.click('button[type="submit"]')
await ap.waitForURL(/overview/, { timeout: 15000 })
await ap.goto(BASE + '/admin')
await ap.waitForSelector('table.tbl', { timeout: 8000 })
const row = ap.locator('tr', { hasText: 'Timur Editor' })
ok('team table: Editor badge + scope note', /Editor/.test(await row.textContent()) && /Their work, any channel/.test(await row.textContent()))
await ap.screenshot({ path: 'role-team.png', fullPage: true })
await actx.close()
await browser.close()

// cleanup
await req(`/content/${vid.id}`, 'DELETE')
await req(`/content/${foreign.id}`, 'DELETE')
await req(`/users/${ed.id}`, 'DELETE')
await req(`/users/${op.id}`, 'DELETE')

console.log(fails === 0 ? '\nRoles suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
