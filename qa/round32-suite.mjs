// Round 32: the post-production deep round. Designers get the same week
// grid the editors have — Design-due cards that drag across days (deadline)
// and rows (the designer), a Late tray for slipped artwork, Undo restoring
// exactly what a drop overwrote — and every open Pravki is visible on the
// person who owes it, on deck cards and in the grid.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + d * 864e5))
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x32:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
  for (const u of (await req('/users')).data.filter((u) => ['x32da', 'x32db'].includes(u.username))) await req(`/users/${u.id}`, 'DELETE')
}
await cleanup()
const da = (await req('/users', 'POST', { name: 'Dilnoza Artova', username: 'x32da', password: 'd1234', role: 'designer' })).data
const db = (await req('/users', 'POST', { name: 'Bobur Brushev', username: 'x32db', password: 'b1234', role: 'designer' })).data
const due = (await req('/content', 'POST', { title: 'x32: banner due', channels: ['instagram_main'], type: 'post', designer_id: da.id, design_ready_date: iso(1) })).data
await req('/content', 'POST', { title: 'x32: slipped cover', channels: ['instagram_main'], type: 'post', designer_id: da.id, design_ready_date: iso(-2) })
const fix = (await req('/content', 'POST', { title: 'x32: needs fixes', channels: ['instagram_main'], type: 'post', designer_id: da.id, design_ready_date: iso(2) })).data
await req(`/content/${fix.id}/revisions`, 'POST', { note: 'Bigger headline', target: 'designer' })

// ---- 1) the open-revisions contract ----
const open = (await req('/content/open-revisions')).data
ok('the admin sees every open Pravki with its owner',
  open.some((r) => r.content_id === fix.id && r.target === 'designer' && r.person_id === da.id))
const jasT = await login('jas', 'j1234')
ok('members are turned away', (await req('/content/open-revisions', 'GET', null, jasT)).status === 403)

// ---- 2) the design week ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.goto(BASE + '/crew'); await p.waitForTimeout(1000)
await p.locator('.pp-tabs .pill', { hasText: 'Designers' }).click(); await p.waitForTimeout(600)
ok('the deck card says who owes pravki', (await p.locator('.crew-num', { hasText: 'pravki waiting' }).count()) >= 1)
ok('the hero counts the changes requested', (await p.locator('.brief-title').textContent()).includes('change requested'))
await p.locator('.pill', { hasText: 'Timetable' }).click(); await p.waitForTimeout(700)
ok('the design grid stands, a row per designer', (await p.locator('.crew-tt tbody tr').count()) === 2)
ok('the due card waits on its day', (await p.locator('.tt-design', { hasText: 'x32: banner due' }).count()) === 1)
ok('slipped artwork waits in the Late tray', (await p.locator('.crew-late-tray .cal-tray-chip', { hasText: 'x32: slipped cover' }).count()) === 1)

const dragTo = async (cardText, personFirst, dayIso) => await p.evaluate(([cardText, personFirst, dayIso]) => {
  const card = [...document.querySelectorAll('.tt-shoot, .cal-tray-chip')].find((el) => el.textContent.includes(cardText))
  const row = [...document.querySelectorAll('.crew-tt tbody tr')].find((r) => r.querySelector('.tt-who b')?.textContent === personFirst)
  if (!card || !row) return 'missing'
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
  const cell = [...row.querySelectorAll('td')].slice(1)[Math.round((Date.parse(dayIso) - Date.parse(todayIso)) / 864e5)]
  if (!cell) return 'no cell'
  const dt = new DataTransfer()
  card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
  cell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  cell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return 'ok'
}, [cardText, personFirst, dayIso])

const r1 = await dragTo('x32: banner due', 'Bobur', iso(4))
await p.waitForTimeout(900)
let row = (await req('/content')).data.find((c) => c.id === due.id)
ok('a design drags to another designer and day', r1 === 'ok' && row.design_ready_date === iso(4) && row.designer_id === db.id)
await p.locator('.toast-act', { hasText: 'Undo' }).click(); await p.waitForTimeout(900)
row = (await req('/content')).data.find((c) => c.id === due.id)
ok('Undo hands it back whole — date AND designer', row.design_ready_date === iso(1) && row.designer_id === da.id)
const r2 = await dragTo('x32: slipped cover', 'Dilnoza', iso(0))
await p.waitForTimeout(900)
ok('the tray chip rebooks onto today',
  r2 === 'ok' && (await req('/content')).data.find((c) => c.title === 'x32: slipped cover').design_ready_date === iso(0))
await p.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-32 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
