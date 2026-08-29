// Round 24: the Unassigned page (every live task missing its people or its
// dates, admin-only, next to Statistics) and the per-person receipts on
// Statistics — a person's row in "Misses by person" expands to the exact
// deadlines they missed.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x24:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
}
await cleanup()
const users = (await req('/users')).data
const jas = users.find((u) => u.username === 'jas')
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + d * 864e5))
// Seeds start in Shot: Idea-stage tasks sit out the gap views (round 35), and
// since round 66 the shooting stage is a BOOKING that refuses exactly the
// holes this page exists to show. Work logged after the fact is where those
// holes really live now, and Shot is where it lands.
const shootId = (await req('/statuses')).data.find((s) => /^editing$/i.test(s.label)).id
const orphan = (await req('/content', 'POST', { title: 'x24: orphan video', channels: ['youtube'], type: 'video', status_id: shootId })).data
const dateless = (await req('/content', 'POST', { title: 'x24: staffed dateless', channels: ['instagram_main'], type: 'reel', assignees: [jas.id], operator_id: jas.id, editor_id: jas.id, status_id: shootId })).data
await req('/content', 'POST', { title: 'x24: late post', channels: ['instagram_main'], type: 'post', assignees: [jas.id], designer_id: jas.id, release_date: iso(-2), status_id: shootId })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
// ---- 1) admin: the Unassigned page ----
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.waitForTimeout(600)
ok('the sidebar offers Unassigned', (await p.locator('.nav-item', { hasText: 'Unassigned' }).count()) === 1)
await p.goto(BASE + '/unassigned'); await p.waitForTimeout(1200)
const orphanRow = p.locator('.ov-row', { hasText: 'x24: orphan video' })
ok('the orphan video is listed', (await orphanRow.count()) === 1)
ok('…wearing its people-holes', (await orphanRow.locator('.chip', { hasText: 'needs an operator' }).count()) === 1
  && (await orphanRow.locator('.chip', { hasText: 'needs an editor' }).count()) === 1)
const datelessRow = p.locator('.ov-row', { hasText: 'x24: staffed dateless' })
ok('the staffed-but-dateless reel is listed for dates only', (await datelessRow.count()) === 1
  && (await datelessRow.locator('.chip', { hasText: 'no shoot day' }).count()) === 1
  && (await datelessRow.locator('.chip', { hasText: 'needs an operator' }).count()) === 0)
ok('the fully-planned late post stays off this page', (await p.locator('.ov-row', { hasText: 'x24: late post' }).count()) === 0)
await p.screenshot({ path: 'r24s-unassigned.png' })
// filling the holes clears the row
await req(`/content/${dateless.id}`, 'PATCH', { recording_date: iso(1), release_date: iso(3) })
await p.reload(); await p.waitForTimeout(1000)
ok('dates filled → the row leaves', (await p.locator('.ov-row', { hasText: 'x24: staffed dateless' }).count()) === 0)
// a row opens the task to fix it
await p.locator('.ov-row', { hasText: 'x24: orphan video' }).click()
await p.waitForSelector('.modal', { timeout: 5000 })
ok('a row opens the task', (await p.locator('.modal .cm-title').inputValue()) === 'x24: orphan video')
await p.keyboard.press('Escape'); await p.waitForTimeout(300)

// ---- 2) admin: person receipts on Statistics ----
await p.goto(BASE + '/missed'); await p.waitForTimeout(1200)
const first = (jas.name || '').split(' ')[0]
const row = p.locator('.miss-person-row', { hasText: first }).first()
ok('the by-person report has her row', (await row.count()) === 1)
await row.click(); await p.waitForTimeout(400)
ok('expanding shows exactly what she missed',
  (await p.locator('.miss-person-tasks .ov-row', { hasText: 'x24: late post' }).count()) === 1)
await p.screenshot({ path: 'r24s-receipts.png' })
await row.click(); await p.waitForTimeout(300)
ok('a second tap folds the receipts', (await p.locator('.miss-person-tasks').count()) === 0)
await p.close()

// ---- 3) members neither see nor reach it ----
const m = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await m.goto(BASE + '/login')
await m.fill('input[name="username"]', 'jas'); await m.fill('input[name="password"]', 'j1234')
await m.click('button[type="submit"]'); await m.waitForURL(/brief/, { timeout: 15000 })
await m.waitForTimeout(600)
ok('no Unassigned in a member sidebar', (await m.locator('.nav-item', { hasText: 'Unassigned' }).count()) === 0)
await m.goto(BASE + '/unassigned'); await m.waitForTimeout(1000)
ok('the route bounces members away', !m.url().includes('/unassigned'))
await m.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-24 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
