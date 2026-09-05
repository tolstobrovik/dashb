// Round 23: the minimal pass. Statistics is one card — the published-by-channel
// bars live under the same window as the four tiles; the task modal opens
// without empty Drive inputs or a blank Reference block (the extras row reveals
// them); a quiet My Day hides the sections it has nothing to say in.
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
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x23:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
  for (const u of (await req('/users')).data.filter((u) => u.username === 'x23quiet')) await req(`/users/${u.id}`, 'DELETE')
}
await cleanup()
const statuses = (await req('/statuses')).data
const finalId = statuses.find((s) => s.is_final).id
const pubT = (await req('/content', 'POST', { title: 'x23: went live', channels: ['instagram_main'], type: 'reel' })).data
await req(`/content/${pubT.id}`, 'PATCH', { status_id: finalId, post_link: 'https://instagram.com/p/r23' })
await req('/content', 'POST', { title: 'x23: bare task', channels: ['instagram_main'], type: 'reel' })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()

// The task sheet is three views and a thread now — Brief, Execution, Logistics
// — so a field is reached the way a person reaches it: open the view holding
// it first. Idempotent, and silent on a sheet short enough to show whole.
const cmTab = async (pg, name) => {
  // The same view is "Execution" to whoever runs the piece and "Your part" to
  // whoever does the work on it — it holds the crew, the handovers and the
  // crew's own tick, and which of those you are here for depends on who you
  // are. Either name reaches it.
  // Round 91 hides a view nobody has been in, behind one "Add details"
  // control — so reaching one is two presses when it is empty and one when it
  // is not, exactly as it is for a person.
  const more = pg.locator('.cm-page-more')
  for (const pass of [0, 1]) {
    for (const n of name === 'Execution' ? ['Execution', 'Your part'] : [name]) {
      const tab = pg.locator('.cm-page-tab', { hasText: n })
      if (await tab.count()) { await tab.first().click(); await pg.waitForTimeout(200); return }
    }
    if (pass === 0 && await more.count()) { await more.first().click(); await pg.waitForTimeout(250) }
    else return
  }
}

p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })

// ---- 1) Statistics: one card, one window ----
await p.goto(BASE + '/missed'); await p.waitForTimeout(1200)
ok('published-by-channel lives inside the numbers card', (await p.locator('.stats-card .pub-head').count()) === 1)
ok('the numbers card keeps its four tiles', (await p.locator('.stats-card .miss-stat').count()) === 4)
ok('today’s publish shows on its channel bar', (await p.locator('.stats-card .pub-row', { hasText: 'Instagram' }).count()) >= 1)
await p.screenshot({ path: 'r23-stats.png' })
await p.locator('.stats-card .pill', { hasText: 'Custom' }).click()
const dates = p.locator('.stats-card .miss-custom input')
await dates.nth(0).fill('2020-01-01'); await dates.nth(1).fill('2020-01-02')
await p.waitForTimeout(500)
ok('the bars follow the window — an old custom range empties them',
  (await p.locator('.stats-card', { hasText: 'Nothing published in this window.' }).count()) === 1)
await p.locator('.stats-card .pill', { hasText: 'This week' }).click()
await p.waitForTimeout(400)
ok('…and switching back brings them home', (await p.locator('.stats-card .pub-row', { hasText: 'Instagram' }).count()) >= 1)

// ---- 2) the modal opens without empty chrome; extras reveal it ----
await p.keyboard.press('Control+k')
await p.waitForSelector('.qf-input', { timeout: 5000 })
await p.fill('.qf-input', 'x23: bare')
await p.waitForTimeout(400)
await p.keyboard.press('Enter')
await p.waitForSelector('.modal', { timeout: 8000 })
ok('no empty Drive inputs on open', (await p.locator('.modal .ready-link-field').count()) === 0)
// The Reference block is open from the start since round 66. It was folded
// behind a button at the foot of the form, which is a strange place for the
// thing the crew reads first — and a shoot cannot be booked without it, so
// hiding the box that answers the demand was the wrong saving.
ok('the Reference block is open and waiting, not hidden at the foot of the form',
  (await p.locator('.modal .cm-key', { hasText: 'Reference' }).count()) === 1)
await p.screenshot({ path: 'r23-modal.png' })
// The strip that offers the rows nobody asked for yet sits with the thread,
// at the foot of the sheet. Pressing one takes you to where the row appeared.
await cmTab(p, 'Talk')
await p.locator('.modal .extra-btn', { hasText: 'Delivery links' }).click()
await cmTab(p, 'Execution')
ok('“Delivery links” reveals all three fields', (await p.locator('.modal .ready-link-field').count()) === 3)
// There is no "Reference" button left to press — the block is simply there.
ok('…so no button is offered to reveal what is already on screen',
  (await p.locator('.modal .extra-btn', { hasText: 'Reference' }).count()) === 0)
await p.keyboard.press('Escape')
await p.close()

// ---- 3) a quiet My Day says almost nothing ----
await req('/users', 'POST', { name: 'X23 Quiet', username: 'x23quiet', password: 'x23pass', role: 'member' })
const q = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
q.on('pageerror', (e) => { fails++; console.log('QUIET PAGE ERROR', e.message) })
await q.goto(BASE + '/login')
await q.fill('input[name="username"]', 'x23quiet'); await q.fill('input[name="password"]', 'x23pass')
await q.click('button[type="submit"]'); await q.waitForURL(/brief/, { timeout: 15000 })
await q.waitForTimeout(1000)
ok('the hero admits the day is clear', (await q.locator('.brief-hero', { hasText: 'nothing on the schedule' }).count()) === 1)
ok('no empty To-do-today section', (await q.locator('h2', { hasText: 'To do today' }).count()) === 0)
ok('no “what you’ve done · nothing” stub', (await q.locator('h2', { hasText: 'What you’ve done' }).count()) === 0)
ok('custom dates fold behind one button', (await q.locator('.brief-horizon .extra-btn', { hasText: 'Pick your own dates' }).count()) === 1)
await q.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-23 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
