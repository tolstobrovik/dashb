// This round: the candidates pipeline (name / contacts / position / salary /
// portfolio / experience / notes / stage) and the team Board + Dashboard views.
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

// ============ pre-clean ============
for (const c of (await req('/candidates')).data.filter((c) => /R9 /.test(c.name)))
  await req(`/candidates/${c.id}`, 'DELETE')

// ============ the API ============
const JT = await login('jas', 'j1234')
ok('candidates are admin-only', (await req('/candidates', 'GET', null, JT)).status === 403)
const cand = (await req('/candidates', 'POST', {
  name: 'R9 Dilshod Rahimov', contacts: '+998 90 777 66 55, @dilshod', position: 'YouTube manager',
  salary: '$700', portfolio: 'https://behance.net/dilshod', experience: '3 years at TVX, 40+ reels shipped',
  notes: 'Strong reel work, slow on motion graphics',
})).data
ok('candidate stored with every field', cand.id && cand.stage === 'new' && cand.salary === '$700'
  && cand.portfolio.includes('behance') && cand.experience.includes('TVX'), JSON.stringify(cand).slice(0, 140))
ok('unknown stage refused', (await req(`/candidates/${cand.id}`, 'PATCH', { stage: 'ghosted' })).status === 400)
ok('stage moves', (await req(`/candidates/${cand.id}`, 'PATCH', { stage: 'interview' })).data.stage === 'interview')
ok('nameless refused', (await req('/candidates', 'POST', { name: '' })).status === 400)

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
await page.goto(BASE + '/team')
await page.waitForSelector('.cand-grid, .cand-card, .section-head', { timeout: 10000 })
await page.waitForTimeout(600)

// the seeded candidate renders with its facts
const card = page.locator('.cand-card', { hasText: 'R9 Dilshod' })
ok('candidate card renders', (await card.count()) === 1)
const cardTxt = await card.textContent()
ok('card carries position / salary / experience / notes',
  cardTxt.includes('for YouTube manager') && cardTxt.includes('expects $700')
  && cardTxt.includes('TVX') && cardTxt.includes('motion graphics'), cardTxt.slice(0, 120))
ok('portfolio is a real link', (await card.locator('a.cand-link').getAttribute('href')).includes('behance'))
ok('stage chip says Interview', cardTxt.includes('Interview'))
ok('the stat tile counts them in play', (await page.locator('.miss-stat', { hasText: 'in play' }).textContent()).includes('1'))

// add one through the modal
await page.getByRole('button', { name: 'Add candidate' }).click()
await page.waitForSelector('.modal', { timeout: 8000 })
await page.locator('.modal input').nth(0).fill('R9 Madina Yusuf')
await page.locator('.modal input').nth(1).fill('@madina_y')
await page.locator('.modal input[list="cand-positions"]').fill('Motion designer')
await page.locator('.modal .prog-state', { hasText: 'Offer' }).click()
await page.locator('.modal').getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(500)
ok('modal-created candidate lands on the wall', (await page.locator('.cand-card', { hasText: 'R9 Madina' }).count()) === 1)
ok('…and on the server, at the right stage', (await req('/candidates')).data.some((c) => c.name === 'R9 Madina Yusuf' && c.stage === 'offer'))
await page.screenshot({ path: 'r9-candidates.png', fullPage: true })

// right-click: move through the pipeline
await card.click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
ok('candidate menu offers stage moves + edit + remove',
  (await page.locator('.ctx-item', { hasText: 'Move to Offer' }).count()) === 1
  && (await page.locator('.ctx-item', { hasText: 'Edit' }).count()) === 1
  && (await page.locator('.ctx-item.danger').count()) === 1)
await page.locator('.ctx-item', { hasText: 'Move to Hired' }).click()
await page.waitForTimeout(500)
ok('menu → Hired persists', (await req('/candidates')).data.find((c) => c.id === cand.id).stage === 'hired')
ok('hired leaves the in-play wall', (await page.locator('.cand-card', { hasText: 'R9 Dilshod' }).count()) === 0)
await page.locator('.pill', { hasText: 'Hired' }).first().click()
await page.waitForTimeout(400)
ok('the Hired filter still finds them', (await page.locator('.cand-card', { hasText: 'R9 Dilshod' }).count()) === 1)
await page.locator('.pill', { hasText: 'In play' }).click()
await page.waitForTimeout(300)

// ---- board view ----
await page.getByRole('button', { name: 'Board', exact: true }).click()
await page.waitForSelector('.team-board', { timeout: 8000 })
const cols = await page.locator('.team-col-head').allTextContents()
ok('board view: columns by role', cols.some((c) => c.includes('Admins')) && cols.some((c) => c.includes('Members')), cols.join(' | '))
ok('mini cards fill the columns', (await page.locator('.team-mini').count()) >= 4)
await page.locator('.team-mini', { hasText: 'Jasmina' }).click()
await page.waitForSelector('.modal', { timeout: 5000 })
ok('a mini card opens the member editor', (await page.locator('.modal').textContent()).includes('Username'))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.screenshot({ path: 'r9-board.png', fullPage: true })

// ---- dashboard view ----
await page.locator('.pill', { hasText: 'Dashboard' }).click()
await page.waitForSelector('.team-dash', { timeout: 8000 })
const dashTxt = await page.locator('.team-dash').textContent()
ok('dashboard: roles / coverage / pipeline in one look',
  dashTxt.includes('Roles') && dashTxt.includes('Channel coverage') && dashTxt.includes('Hiring pipeline'))
ok('coverage flags ownerless channels', (await page.locator('.team-dash .no-owner-badge').count()) >= 1)
ok('completeness counters render', /\d+\/\d+ phones set/.test(dashTxt) && /\d+\/\d+ schedules set/.test(dashTxt))
await page.screenshot({ path: 'r9-dash.png', fullPage: true })
await browser.close()

// ============ cleanup ============
for (const c of (await req('/candidates')).data.filter((c) => /R9 /.test(c.name)))
  await req(`/candidates/${c.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-9 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
