// Round 28: the Post Production timetable is draggable. A shoot or edit-due
// card dropped on another day rebooks the date; dropped on another person's
// row it changes the operator/editor too. Overdue work — invisible before,
// its date off the left edge of the week — waits in the Late tray above the
// grid and drags back onto any day. "no hours set" became a set-hours link.
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
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + d * 864e5))
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x28:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
  for (const u of (await req('/users')).data.filter((u) => ['x28opa', 'x28edb'].includes(u.username))) await req(`/users/${u.id}`, 'DELETE')
}
await cleanup()
const opA = (await req('/users', 'POST', { name: 'Otabek Operator', username: 'x28opa', password: 'o1234', role: 'crew', crew_roles: ['operator', 'editor'] })).data
const edB = (await req('/users', 'POST', { name: 'Bekzod Editor', username: 'x28edb', password: 'b1234', role: 'crew', crew_roles: ['editor'] })).data
const shoot = (await req('/content', 'POST', { title: 'x28: campus shoot', channels: ['youtube'], type: 'video', operator_id: opA.id, recording_date: iso(1), recording_time: '10:00', recording_end: '12:00' })).data
const cut = (await req('/content', 'POST', { title: 'x28: promo cut', channels: ['youtube'], type: 'video', editor_id: opA.id, edit_ready_date: iso(2) })).data
const late = (await req('/content', 'POST', { title: 'x28: forgotten cut', channels: ['youtube'], type: 'video', editor_id: edB.id, edit_ready_date: iso(-3) })).data

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.goto(BASE + '/crew'); await p.waitForTimeout(1000)
await p.locator('.pill', { hasText: 'Timetable' }).click()
await p.waitForSelector('.crew-tt', { timeout: 8000 })
ok('the Late tray holds the slipped cut', (await p.locator('.crew-late-tray .cal-tray-chip', { hasText: 'x28: forgotten cut' }).count()) === 1)
ok('unset hours became a set-hours link', (await p.locator('.tt-who .lnk', { hasText: 'set hours' }).count()) >= 2)
ok('cards wear the grab handle', (await p.locator('.tt-shoot[draggable="true"]').count()) >= 2)

// synthetic HTML5 drags (headless can't start real ones)
const dragTo = async (cardText, personFirst, dayIso) => await p.evaluate(([cardText, personFirst, dayIso]) => {
  const card = [...document.querySelectorAll('.tt-shoot, .cal-tray-chip')].find((el) => el.textContent.includes(cardText))
  if (!card) return 'no card'
  const row = [...document.querySelectorAll('.crew-tt tbody tr')].find((r) => r.querySelector('.tt-who b')?.textContent === personFirst)
  if (!row) return 'no row'
  const cells = [...row.querySelectorAll('td')].slice(1)
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
  const dayIdx = Math.round((Date.parse(dayIso) - Date.parse(todayIso)) / 864e5)
  const cell = cells[dayIdx]
  if (!cell) return 'no cell'
  const dt = new DataTransfer()
  card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
  cell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  cell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return 'ok'
}, [cardText, personFirst, dayIso])

// 1) cut → another person, another day: date AND editor change
const r1 = await dragTo('x28: promo cut', 'Bekzod', iso(4))
await p.waitForTimeout(900)
let row = (await req('/content')).data.find((c) => c.id === cut.id)
ok('a cut dropped on another row moves date and editor', r1 === 'ok' && row.edit_ready_date === iso(4) && row.editor_id === edB.id, `${r1}, ${row.edit_ready_date}`)

// 2) the Late chip → a day on the grid: rebooked, tray empties
const r2 = await dragTo('x28: forgotten cut', 'Bekzod', iso(0))
await p.waitForTimeout(900)
row = (await req('/content')).data.find((c) => c.id === late.id)
ok('the Late chip rebooks onto today', r2 === 'ok' && row.edit_ready_date === iso(0))
ok('…and its chip leaves the tray', (await p.locator('.crew-late-tray .cal-tray-chip', { hasText: 'x28: forgotten cut' }).count()) === 0)

// 3) a shoot → another day, same person: date moves, the hours ride along
const r3 = await dragTo('x28: campus shoot', 'Otabek', iso(3))
await p.waitForTimeout(900)
row = (await req('/content')).data.find((c) => c.id === shoot.id)
ok('a shoot rebooks with its hours intact', r3 === 'ok' && row.recording_date === iso(3) && row.recording_time === '10:00' && row.recording_end === '12:00')
await p.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-28 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
