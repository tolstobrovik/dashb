// The delivery link that went up and came back gone.
//
// A planner pasted a Google-Drive address into "Recording" or "Edit ready",
// pressed Save, watched the sheet close on a green save — and the box was
// empty when they opened it again. No error, no refusal, nothing in the log.
//
// Two things had to be true at once for it, which is why it survived a gate
// this size. The sheet builds its payload as `{ ...form }`, so it carries all
// six delivery boxes whether or not anybody typed in them — the three links
// AND the three "which file in the shared folder" names beside them. And
// buildDelivery took `body[fileKey] !== undefined` to mean a file had been
// named, so an empty `shot_file` riding along beside a perfectly good
// `shot_link` sent it down the file branch, found nothing, and returned null.
// The link was never read. The one person it worked for was the crew member
// whose own box it was, because their save builds a narrow payload by hand.
//
// So this asks the question end to end, in a browser, as the person who was
// actually losing the work: paste, save, reopen, and the link is still there
// with a door out to it.
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
const stamp = Date.now()
const statuses = (await req('/statuses')).data
const editing = statuses.find((s) => /editing/i.test(s.label)).id
const mk = async (extra = {}) => (await req('/content', 'POST', {
  title: `dlv ${stamp} ${Math.random().toString(36).slice(2, 7)}`, type: 'reel', channels: ['instagram_main'],
  status_id: editing, editor_id: 2, operator_id: 3, ...extra,
})).data
const linkOf = async (id, col) => (await req(`/content/${id}`)).data[col]

// ===================== an empty file box erases nothing =====================
// The shape the sheet actually sends: the link, and the blank file box beside
// it. Asked of the API directly because this is where the value was lost.
const URL_A = 'https://drive.google.com/file/d/SUITE_A/view'
let t = await mk()
await req(`/content/${t.id}`, 'PATCH', { shot_link: URL_A, shot_file: '' })
ok('a link survives the empty file box sent beside it', (await linkOf(t.id, 'shot_link')) === URL_A, String(await linkOf(t.id, 'shot_link')))

t = await mk()
await req(`/content/${t.id}`, 'PATCH', { ready_link: URL_A, ready_file: '   ' })
ok('…including when that box holds only spaces', (await linkOf(t.id, 'ready_link')) === URL_A, String(await linkOf(t.id, 'ready_link')))

// …while a file that IS named still wins, and clearing still clears.
t = await mk(({ shot_link: URL_A }))
await req(`/content/${t.id}`, 'PATCH', { shot_link: '' })
ok('clearing a delivery still clears it', (await linkOf(t.id, 'shot_link')) === null, String(await linkOf(t.id, 'shot_link')))

// ===================== the crew path did not regress =====================
t = await mk()
const crew = await login('jas', 'j1234')
const r = await req(`/content/${t.id}`, 'PATCH', { ready_link: 'https://drive.google.com/file/d/CREW/view' }, crew)
ok('the crew member still drops their own link', r.status === 200 && (await linkOf(t.id, 'ready_link')) === 'https://drive.google.com/file/d/CREW/view', `${r.status}`)

// ===================== and the sheet, which is where it broke =====================
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin'); await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]'); await page.waitForTimeout(2400)

const openSheet = async (id) => {
  await page.goto(`${BASE}/brief?task=${id}`); await page.waitForTimeout(2000)
  await page.evaluate(() => { const b = document.querySelector('.cm-add-details'); if (b) b.click() })
  await page.waitForTimeout(700)
}
const typed = await mk()
await openSheet(typed.id)
await page.evaluate(() => { const b = [...document.querySelectorAll('.extra-btn')].find((x) => /Delivery links/.test(x.textContent || '')); if (b) b.click() })
await page.waitForTimeout(800)
ok('the sheet offers the delivery boxes', (await page.locator('.ready-link-field input.input').count()) >= 1)
const URL_B = 'https://drive.google.com/file/d/SUITE_B/view'
await page.locator('.ready-link-field input.input').first().fill(URL_B)
await page.waitForTimeout(300)
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Save changes/.test(x.textContent || '')); if (b) b.click() })
await page.waitForTimeout(2600)
ok('a link pasted in the sheet is actually stored', (await linkOf(typed.id, 'shot_link')) === URL_B, String(await linkOf(typed.id, 'shot_link')))

// …and the person reviewing it gets a door out to the file.
await openSheet(typed.id)
const door = page.locator('.ready-link-input a')
ok('reviewing it offers a way to open it', (await door.count()) >= 1, `${await door.count()} links`)
ok('…which points at what was pasted', (await door.first().getAttribute('href')) === URL_B, String(await door.first().getAttribute('href')))
await browser.close()

console.log(fails === 0 ? '\nDelivery suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
