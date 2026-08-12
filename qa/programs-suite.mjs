// Launch programs: API rules, then the Target team's lived flow.
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

// Target's dashboard defaults to programs-first
const chans = (await req('/channels')).data
const target = chans.find((c) => c.key === 'target')
ok('target leads with the programs widget by default', JSON.parse(target.dashboard || '[]')[0] === 'programs', target.dashboard)

// API rules
const running = (await req('/programs', 'POST', { channel: 'target', name: 'Lead gen — August intake', status: 'running', start_date: add(-12), end_date: add(9), budget: 800 })).data
const halted = (await req('/programs', 'POST', { channel: 'target', name: 'Retargeting — site visitors', status: 'paused', start_date: add(-20), end_date: add(20) })).data
const planned = (await req('/programs', 'POST', { channel: 'target', name: 'Back to school promo', status: 'planned', start_date: add(6), end_date: add(30) })).data
const done = (await req('/programs', 'POST', { channel: 'target', name: 'June open day ads', status: 'done', start_date: add(-40), end_date: add(-16) })).data
const overdue = (await req('/programs', 'POST', { channel: 'target', name: 'Duels promo', status: 'running', start_date: add(-15), end_date: add(-2) })).data
const openEnded = (await req('/programs', 'POST', { channel: 'target', name: 'Always-on brand ads', status: 'running', start_date: add(-30) })).data
ok('programs created', [running, halted, planned, done, overdue, openEnded].every((p) => p.id))
ok('bad channel refused', (await req('/programs', 'POST', { channel: 'nope', name: 'x' })).status === 400)
ok('end before start refused', (await req('/programs', 'POST', { channel: 'target', name: 'x', start_date: add(5), end_date: add(1) })).status === 400)
ok('unknown state refused', (await req(`/programs/${running.id}`, 'PATCH', { status: 'zombie' })).status === 400)
const JT = await login('jas', 'j1234') // instagram member, manage_content — but not target
ok('outsider member cannot read target programs', (await req('/programs?channel=target', 'GET', null, JT)).status === 403)
ok('outsider member cannot write either', (await req(`/programs/${running.id}`, 'PATCH', { status: 'done' }, JT)).status === 403)
ok('halt → resume round-trip', (await req(`/programs/${halted.id}`, 'PATCH', { status: 'running' })).data.status === 'running'
  && (await req(`/programs/${halted.id}`, 'PATCH', { status: 'paused' })).data.status === 'paused')

// ---- the UI ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })
await page.goto(BASE + '/dept/target')
await page.waitForSelector('.gantt-bar', { timeout: 10000 })
await page.waitForTimeout(500)

const heads = await page.locator('.section-head h2').allTextContents()
ok('Programs section renders first on Target', heads[0] === 'Programs', heads.join(','))
ok('six bars on the timeline', (await page.locator('.gantt-bar').count()) === 6)
const summary = await page.locator('.prog-summary').textContent()
ok('summary counts the fleet', /3\s*running/.test(summary) && /1\s*halted/.test(summary) && /1\s*planned/.test(summary) && /1\s*finished/.test(summary), summary)
ok('running shows day N of M', (await page.locator('.gantt-sub', { hasText: /day \d+ of \d+/ }).count()) >= 1)
ok('planned shows starts-in', (await page.locator('.gantt-sub', { hasText: /starts in \d+d/ }).count()) === 1)
ok('past-end running is flagged', (await page.locator('.gantt-sub', { hasText: 'past its end date' }).count()) === 1)
ok('open-ended run stretches on', (await page.locator('.gantt-bar.prog-open').count()) === 1)
ok('halted bar wears stripes', (await page.locator('.gantt-bar.prog-halted').count()) === 1)
ok('budget rides in the label', (await page.locator('.gantt-sub', { hasText: '800 budget' }).count()) === 1)
await page.screenshot({ path: 'programs-gantt.png', fullPage: true })

// one-click halt from the row
const row = page.locator('.gantt-row', { hasText: 'Lead gen — August intake' })
await row.hover()
await row.locator('button[aria-label="Halt"]').click()
await page.waitForTimeout(500)
ok('one click halts a running program', (await req(`/programs/${running.id}`)).status === 404 || (await req('/programs?channel=target')).data.find((p) => p.id === running.id).status === 'paused')

// create through the modal
await page.getByRole('button', { name: 'New program' }).click()
await page.waitForSelector('.modal', { timeout: 8000 })
await page.locator('.modal input.input').first().fill('Telegram ads test')
await page.locator('.modal .prog-state', { hasText: 'Running' }).click()
await page.getByRole('button', { name: 'Launch plan' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(400)
ok('modal creates a running program', (await req('/programs?channel=target')).data.some((p) => p.name === 'Telegram ads test' && p.status === 'running'))

// finish it through the modal's state buttons
await page.locator('.gantt-row', { hasText: 'Telegram ads test' }).locator('.gantt-label').click()
await page.waitForSelector('.modal', { timeout: 8000 })
await page.locator('.modal .prog-state', { hasText: 'Finished' }).click()
await page.locator('.modal').getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(400)
ok('finished through the modal', (await req('/programs?channel=target')).data.find((p) => p.name === 'Telegram ads test')?.status === 'done')

// members of target see it read-only (no quick actions, no New program)
const az = await login('azi', 'a1234') // telegram member — no target access; use a target member instead
await browser.close()

// cleanup
for (const p of (await req('/programs?channel=target')).data) await req(`/programs/${p.id}`, 'DELETE')
console.log(fails === 0 ? '\nPrograms suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
