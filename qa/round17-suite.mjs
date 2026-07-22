// Round 17: the Deleted stage — killed content keeps its record. It counts
// for the maker (operator's Done), never for the editor (lanes, Pravki,
// misses), and it leaves the channel plan. Plus the mobile polish contract:
// no horizontal overflow on a phone, wrapped crew nav, compact crew modal.
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
for (const c of (await req('/content')).data.filter((c) => /r17:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
for (const u of (await req('/users')).data.filter((u) => ['r17op', 'r17ed'].includes(u.username))) await req(`/users/${u.id}`, 'DELETE')
const op = (await req('/users', 'POST', { name: 'Olim Operator', username: 'r17op', password: 'o1234', role: 'operator' })).data
const ed = (await req('/users', 'POST', { name: 'Erkin Editor', username: 'r17ed', password: 'e1234', role: 'editor' })).data

const statuses = (await req('/statuses')).data
const delSt = statuses.find((s) => /^deleted$/i.test(s.label))
const readySt = statuses.find((s) => /^ready$/i.test(s.label))
ok('the Deleted stage exists (seed/migration)', !!delSt && delSt.is_final === 0)

// t1: shot yesterday, edit due today — the piece that will be killed
const t1 = (await req('/content', 'POST', {
  title: 'r17: killed launch video', channels: ['youtube'], type: 'video',
  operator_id: op.id, editor_id: ed.id, recording_date: add(-1), edit_ready_date: today, status_id: readySt.id,
})).data
ok('fixture in place', !!t1.id)

// ---- the plan walks back when a piece is killed, and returns on restore ----
const planTarget = async () => ((await req('/trackers?department=youtube')).data.find((x) => x.content_type === 'video') || {}).target
const p0 = await planTarget()
await req(`/content/${t1.id}`, 'PATCH', { status_id: delSt.id })
ok('killing a piece leaves the channel plan (target −1)', (await planTarget()) === p0 - 1, `${p0}→${await planTarget()}`)
await req(`/content/${t1.id}`, 'PATCH', { status_id: readySt.id })
ok('restoring re-enters the plan (target back)', (await planTarget()) === p0)

// ---- Pravki die with the task ----
await req(`/content/${t1.id}/revisions`, 'POST', { note: 'tighten the intro', target: 'editor' })
const tEd = await login('r17ed', 'e1234')
ok('editor has the Pravki while the task lives',
  (await req('/content/revisions/mine', 'GET', null, tEd)).data.some((r) => r.content_id === t1.id))
await req(`/content/${t1.id}`, 'PATCH', { status_id: delSt.id })
ok('a killed task takes its Pravki off the editor’s desk',
  !(await req('/content/revisions/mine', 'GET', null, tEd)).data.some((r) => r.content_id === t1.id))

// ---- un-completing never lands on Deleted (it sorts after Published) ----
const t2 = (await req('/content', 'POST', { title: 'r17: undone probe', channels: ['youtube'], type: 'post' })).data
await req(`/content/${t2.id}`, 'PATCH', { done: true })
const undone = (await req(`/content/${t2.id}`, 'PATCH', { done: false })).data
ok('un-done steps back to Ready, not the graveyard', undone.status_id === readySt.id, `got ${undone.status_id}`)

// ============ UI ============
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

// editor (desktop): the killed task is gone from the EDIT lane
const e = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
e.on('pageerror', (x) => { fails++; console.log(`✘ EDITOR PAGE ERROR: ${x.message}`) })
await e.goto(BASE + '/login')
await e.fill('input[name="username"]', 'r17ed'); await e.fill('input[name="password"]', 'e1234')
await e.click('button[type="submit"]'); await e.waitForURL(/brief/, { timeout: 15000 })
await e.waitForTimeout(1200)
const editLane = await e.locator('.cb-col').nth(1).textContent()
ok('editor’s lane no longer shows the killed piece', !editLane.includes('r17: killed launch video'))
await e.close()

// operator (mobile 390): killed piece counts as Done; nav wraps; modal compact
const o = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
o.on('pageerror', (x) => { fails++; console.log(`✘ OPERATOR PAGE ERROR: ${x.message}`) })
await o.goto(BASE + '/login')
await o.fill('input[name="username"]', 'r17op'); await o.fill('input[name="password"]', 'o1234')
await o.click('button[type="submit"]'); await o.waitForURL(/brief/, { timeout: 15000 })
await o.waitForTimeout(1200)
ok('mobile crew page has no horizontal overflow',
  await o.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth <= 1))
ok('every crew nav link fits the phone screen', await o.evaluate(() =>
  [...document.querySelectorAll('.solo-link')].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1)))
const shootLane = o.locator('.cb-col').first()
await shootLane.locator('.cb-toggle', { hasText: 'Done' }).click()
await o.waitForTimeout(300)
ok('the killed piece still counts for its maker (operator’s Done)',
  (await shootLane.textContent()).includes('r17: killed launch video'))
await o.screenshot({ path: 'r17-mobile-brief.png' })
// the crew modal: compact About line instead of pickers, nothing clips
await shootLane.locator('.cb-row', { hasText: 'r17: killed launch video' }).click()
await o.waitForSelector('.modal', { timeout: 8000 })
await o.waitForTimeout(400)
ok('crew modal shows the compact About line', (await o.locator('.modal .crew-about').count()) === 1)
ok('crew modal hides the pickers the crew can’t use',
  !(await o.locator('.modal .cm-key', { hasText: 'Platforms' }).count()))
ok('nothing in the modal clips off-screen', await o.evaluate(() =>
  [...document.querySelectorAll('.modal .input, .modal .btn')].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1)))
await o.screenshot({ path: 'r17-mobile-modal.png' })
await browser.close()

// ---- cleanup ----
for (const c of (await req('/content')).data.filter((c) => /r17:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
for (const u of [op.id, ed.id]) await req(`/users/${u}`, 'DELETE')

console.log(fails === 0 ? '\nRound-17 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
