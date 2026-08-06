// Round 21: the unscheduled tray on both calendar tabs (undated work waits
// in a dashed strip; dropping it on a day schedules it) and admin-regulated
// stage rules — who may move work OUT of which stage, defaulting to the
// natural chain (operator → Shot, editor → Ready, SMM everywhere).
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
// ---- pre-clean ----
for (const c of (await req('/content')).data.filter((c) => /r21:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
for (const u of (await req('/users')).data.filter((u) => u.username === 'r21op')) await req(`/users/${u.id}`, 'DELETE')
await req('/statuses/rules', 'POST', {})
const statuses = (await req('/statuses')).data
const sid = (l) => statuses.find((s) => s.label.toLowerCase() === l).id

// ---- stage rules: defaults, tightening, admin bypass, reset ----
const op = (await req('/users', 'POST', { name: 'Otash Operator', username: 'r21op', password: 'o1234', role: 'operator' })).data
const tOp = await login('r21op', 'o1234')
const t1 = (await req('/content', 'POST', { title: 'r21: chain video', channels: ['youtube'], type: 'video', operator_id: op.id, status_id: sid('to shoot') })).data
ok('default: operator ticks shot from To shoot', (await req(`/content/${t1.id}`, 'PATCH', { milestone: 'shot' }, tOp)).status === 200)
await req(`/content/${t1.id}`, 'PATCH', { status_id: sid('to shoot') })
const rules = (await req('/statuses/rules')).data
ok('effective rules answer the natural chain',
  rules.operator[sid('to shoot')] === true && rules.operator[sid('ready')] === false &&
  rules.editor[sid('shot')] === true && rules.member[sid('editing')] === true)
const tightened = { ...rules, operator: { ...rules.operator, [sid('to shoot')]: false, [sid('idea')]: false } }
await req('/statuses/rules', 'POST', tightened)
const denied = await req(`/content/${t1.id}`, 'PATCH', { milestone: 'shot' }, tOp)
ok('tightened: the operator’s tick is refused', denied.status === 403 && /stage rules/i.test(denied.data.error || ''))
const tJas = await login('jas', 'j1234')
const t2 = (await req('/content', 'POST', { title: 'r21: member move', channels: ['instagram_main'], type: 'post', status_id: sid('editing') })).data
ok('default: member moves Editing → Ready', (await req(`/content/${t2.id}`, 'PATCH', { status_id: sid('ready') }, tJas)).status === 200)
await req(`/content/${t2.id}`, 'PATCH', { status_id: sid('editing') })
await req('/statuses/rules', 'POST', { ...tightened, member: { ...rules.member, [sid('editing')]: false } })
ok('tightened: the member is refused out of Editing', (await req(`/content/${t2.id}`, 'PATCH', { status_id: sid('ready') }, tJas)).status === 403)
ok('the admin passes regardless', (await req(`/content/${t2.id}`, 'PATCH', { status_id: sid('ready') })).status === 200)
await req('/statuses/rules', 'POST', {})
ok('reset: the operator’s tick works again', (await req(`/content/${t1.id}`, 'PATCH', { milestone: 'shot' }, tOp)).status === 200)

// ---- the unscheduled tray ----
const t3 = (await req('/content', 'POST', { title: 'r21: dateless clip', channels: ['youtube'], type: 'video' })).data
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.goto(BASE + '/dept/youtube'); await p.waitForTimeout(1200)
await p.locator('.pill', { hasText: 'Recording' }).click()
await p.waitForSelector('.cal-tray', { timeout: 8000 })
ok('the Recording tab shows the undated clip in the tray', (await p.locator('.cal-tray-chip', { hasText: 'r21: dateless clip' }).count()) === 1)
await p.screenshot({ path: 'r21-tray.png' })
// Drop it on today. Pills travel by pointer events now (a mouse and a finger
// take the same path) — the suite drags exactly like a person would: press,
// slide, release.
{
  const cb = await p.locator('.cal-tray-chip', { hasText: 'r21: dateless clip' }).boundingBox()
  const db = await p.locator('.cal-day.today').boundingBox()
  await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2)
  await p.mouse.down()
  await p.mouse.move(cb.x + cb.width / 2 + 14, cb.y + cb.height / 2 + 8, { steps: 3 })
  await p.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 8 })
  await p.mouse.up()
}
await p.waitForTimeout(900)
const fmtT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const after = (await req('/content')).data.find((x) => x.id === t3.id)
ok('dropping it on today schedules the shoot', after.recording_date === fmtT, `got ${after.recording_date}`)
ok('the chip left the tray', (await p.locator('.cal-tray-chip', { hasText: 'r21: dateless clip' }).count()) === 0)
await p.locator('.pill', { hasText: 'Releases' }).click()
await p.waitForTimeout(700)
ok('the Releases tab has its own tray (undated releases)', (await p.locator('.cal-tray-chip', { hasText: 'r21: chain video' }).count()) === 1)

// ---- the Admin rules table ----
await p.goto(BASE + '/admin'); await p.waitForTimeout(800)
await p.locator('.tab', { hasText: 'Pipeline' }).click()
await p.waitForSelector('.rules-tbl', { timeout: 8000 })
ok('the Stage rules table renders per actor per stage', (await p.locator('.rules-cell').count()) >= 20)
await p.screenshot({ path: 'r21-rules.png' })
await browser.close()

// ---- cleanup ----
for (const c of (await req('/content')).data.filter((c) => /r21:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
await req(`/users/${op.id}`, 'DELETE')
await req('/statuses/rules', 'POST', {})
console.log(fails === 0 ? '\nRound-21 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
