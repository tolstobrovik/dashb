// This round: the crew see the stage but can't set it — they tick one
// milestone (Shot / Edited / Designed) and drop a Google-Drive ready link.
// Their day gains a "Missed — still haunting" section above To-do today:
// emergency (red, open) while it has items, calm "all clear" at zero.
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

// ---- pre-clean + fixtures ----
for (const c of (await req('/content')).data.filter((c) => /r16:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
for (const u of (await req('/users')).data.filter((u) => ['r16op', 'r16ed'].includes(u.username))) await req(`/users/${u.id}`, 'DELETE')
const op = (await req('/users', 'POST', { name: 'Oybek Operator', username: 'r16op', password: 'o1234', role: 'operator' })).data
const ed = (await req('/users', 'POST', { name: 'Eldor Editor', username: 'r16ed', password: 'e1234', role: 'editor' })).data
const statuses = (await req('/statuses')).data
const shotSt = statuses.find((s) => /^editing$/i.test(s.label))
const readySt = statuses.find((s) => /^ready$/i.test(s.label))

// operator: a shoot TODAY + a shoot that's OVERDUE (haunting)
const shootToday = (await req('/content', 'POST', { title: 'r16: shoot today', channels: ['youtube'], type: 'video', operator_id: op.id, recording_date: today, recording_time: '14:00' })).data
const shootLate = (await req('/content', 'POST', { title: 'r16: shoot overdue', channels: ['youtube'], type: 'video', operator_id: op.id, recording_date: add(-2), recording_time: '10:00' })).data
// editor: a cut due today
const cutToday = (await req('/content', 'POST', { title: 'r16: cut today', channels: ['youtube'], type: 'video', editor_id: ed.id, edit_ready_date: today })).data
ok('fixtures in place', !!shootToday.id && !!shootLate.id && !!cutToday.id)

// ============ server: the milestone contract ============
const tOp = await login('r16op', 'o1234')
const r1 = await req(`/content/${shootToday.id}`, 'PATCH', { milestone: 'shot' }, tOp)
ok('operator tick "shot" lands on the Shot stage', r1.status === 200 && r1.data.status_id === shotSt.id)
ok('operator cannot set a raw stage', (await req(`/content/${shootToday.id}`, 'PATCH', { status_id: readySt.id }, tOp)).status === 403)
ok('operator cannot mark a cut edited', (await req(`/content/${cutToday.id}`, 'PATCH', { milestone: 'edited' }, tOp)).status === 403)
ok('operator cannot blanket-complete', (await req(`/content/${shootToday.id}`, 'PATCH', { done: true, post_link: 'https://instagram.com/p/qa' }, tOp)).status === 403)
// reset shootToday back so the UI still shows it in today
await req(`/content/${shootToday.id}`, 'PATCH', { status_id: statuses[0].id })
const tEd = await login('r16ed', 'e1234')
const r2 = await req(`/content/${cutToday.id}`, 'PATCH', { ready_link: 'https://drive.google.com/file/d/xyz' }, tEd)
ok('editor drops a Google-Drive ready link', r2.status === 200 && r2.data.ready_link.includes('drive.google.com'))
ok('a non-URL link is refused', (await req(`/content/${cutToday.id}`, 'PATCH', { ready_link: 'my file' }, tEd)).status === 400)

// ============ UI: the operator's modal + board ============
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'r16op')
await page.fill('input[name="password"]', 'o1234')
await page.click('button[type="submit"]')
await page.waitForURL(/brief/, { timeout: 15000 })
await page.waitForTimeout(600)

// the haunting section, above To-do today, emergency + open
const shootLane = page.locator('.cb-col').first()
ok('the "still haunting" section is present and emergency', (await shootLane.locator('.cb-emergency').count()) === 1)
ok('it names the overdue shoot (open by default)', (await shootLane.locator('.cb-emergency').textContent()).includes('r16: shoot overdue'))
ok('it sits above To-do today', (await shootLane.locator('.cb-emergency, .cb-sec-head').first().textContent()).includes('haunting'))
await page.screenshot({ path: 'r16-board.png' })

// open the today shoot → the crew modal
await shootLane.locator('.cb-row', { hasText: 'r16: shoot today' }).click()
await page.waitForSelector('.modal', { timeout: 8000 })
// stage is read-only for the crew (no enabled non-active chip)
const stageChips = page.locator('.modal .stage-chip')
const enabledStage = await stageChips.evaluateAll((els) => els.filter((e) => !e.disabled).length)
ok('the stage is read-only (only the current chip is live)', enabledStage <= 1, `enabled=${enabledStage}`)
// the operator gets a Shot tick, and the ready-link field
ok('the operator sees a "Mark as shot" tick', (await page.locator('.modal .do-tick', { hasText: 'Mark as shot' }).count()) === 1)
ok('the operator does NOT get an edit tick', (await page.locator('.modal .do-tick', { hasText: 'edited' }).count()) === 0)
ok('the ready-file link field is offered', (await page.locator('.modal .ready-link-field').count()) === 1)

// tick shot + save → the task leaves today and the shoot is marked
await page.locator('.modal .do-tick', { hasText: 'Mark as shot' }).click()
await page.locator('.modal').getByRole('button', { name: 'Save changes' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(500)
const afterShoot = (await req('/content')).data.find((c) => c.id === shootToday.id)
ok('the tick moved the task to Shot', afterShoot.status_id === shotSt.id)

await browser.close()

// ============ UI: the editor's board — all clear when nothing overdue ============
// give the editor no overdue work; their haunting section should be calm
const browser2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page2 = await (await browser2.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
page2.on('pageerror', (e) => { fails++; console.log(`✘ PAGE2 ERROR: ${e.message}`) })
await page2.goto(BASE + '/login')
await page2.fill('input[name="username"]', 'r16ed')
await page2.fill('input[name="password"]', 'e1234')
await page2.click('button[type="submit"]')
await page2.waitForURL(/brief/, { timeout: 15000 })
await page2.waitForTimeout(600)
const editLane = page2.locator('.cb-col').first()
ok('with nothing overdue the section is the calm all-clear', (await editLane.locator('.cb-clear').count()) === 1
  && /all clear/i.test(await editLane.locator('.cb-clear').textContent()))
// the editor can open the ready link they saved
await editLane.locator('.cb-row', { hasText: 'r16: cut today' }).click()
await page2.waitForSelector('.modal .ready-link-field', { timeout: 8000 })
ok('the saved ready link is shown with an Open button', (await page2.locator('.modal .ready-link-input a', { hasText: 'Open' }).count()) === 1)
await page2.screenshot({ path: 'r16-modal.png' })
await browser2.close()

// ---- cleanup ----
for (const c of (await req('/content')).data.filter((c) => /r16:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
for (const u of [op.id, ed.id]) await req(`/users/${u}`, 'DELETE')

console.log(fails === 0 ? '\nRound-16 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
