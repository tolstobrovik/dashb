// Round 62: four smaller frictions, removed.
//
// MINE. "Only my work" is the narrowing people ask for most, and the slowest
// way to ask for it is to find your own name in a menu of forty. One switch,
// in the filter row wherever that row appears — and it sets the same person
// filter the menu does, so it lights up when the menu lands on you and it
// clears with everything else.
//
// UNDO A DAY. A date field is easy to mis-tap. The server's ten-second regret
// only photographs stage moves, so the confirmation carries the way back —
// the page already knows the day it moved off.
//
// THE PAGE AS YOU LEFT IT. Channel, window and grouping come back when you
// return. A link someone sent you still wins: it should show what THEY meant.
//
// AND THE TWO NEW PAGES ARE FINDABLE. Ctrl-K reaches every page by name; when
// Releases and Recordings were added they were never told to it.
// Runs against the shared 4090 stack.
import { chromium } from 'playwright'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const api = async (path, m = 'GET', body, token) => {
  const r = await fetch(`${BASE}/api${path}`, {
    method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const T = (await api('/auth/login', 'POST', { username: 'admin', password: 'admin123' })).data.token
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const day = (off = 0) => {
  const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + off)
  return d.toISOString().slice(0, 10)
}
const tag = 'r62' + Date.now().toString(36).slice(-4)

// ---- fixtures: work belonging to two different people ----
const statuses = (await api('/statuses', 'GET', null, T)).data
const sid = (re) => statuses.find((s) => re.test(s.label))?.id
const admin = (await api('/auth/me', 'GET', null, T)).data.user  // /auth/me answers { user }
const zarina = (await api('/users', 'POST', {
  name: `${tag} Zarina`, username: `${tag}zar`, password: 'probe123', role: 'member', departments: ['instagram_main'],
}, T)).data
const mk = (over) => api('/content', 'POST', {
  channels: ['instagram_main'], type: 'video', status_id: sid(/to shoot/i), assignee_ids: [], ...over,
}, T).then((r) => r.data)

// One the admin owns, one he only edits (a different seat, still his work),
// and one that is Zarina's alone.
const ownd = await mk({ title: `${tag} the admin owns this`, release_date: day(2), assignee_ids: [admin.id] })
const cuts = await mk({ title: `${tag} the admin cuts this`, release_date: day(5), editor_id: admin.id })
const hers = await mk({ title: `${tag} zarina owns this`, release_date: day(3), assignee_ids: [zarina.id] })
ok('fixtures exist', [ownd, cuts, hers].every((t) => t?.id))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
const signIn = async (pg, u, pw) => {
  await pg.goto(BASE + '/login')
  await pg.fill('input[name="username"], input[autocomplete="username"]', u)
  await pg.fill('input[type="password"]', pw)
  await pg.click('button[type="submit"]')
  await pg.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 25000 })
}
await signIn(page, 'admin', 'admin123')
// The grid draws six weeks from the Monday on or before the 1st. These
// fixtures sit within five days of today, which falls off the end of that span
// in the last week of a month — so step forward when it does, exactly as a
// person would, rather than asserting on days not being drawn.
const ensureVisible = async (pg) => {
  if (await pg.locator('.cal').count() === 0) return
  const cells = await pg.locator('.cal-day[data-drop]').all()
  if (!cells.length) return
  const last = await cells[cells.length - 1].getAttribute('data-drop')
  if (last && day(5) > last) {
    await pg.locator('.cal-head .icon-btn').nth(1).click()
    await pg.waitForTimeout(700)
  }
}
const openPage = async (pg, path) => {
  await pg.goto(BASE + path)
  await pg.waitForSelector('.cal, .empty', { timeout: 25000 })
  await pg.waitForTimeout(800)
  await ensureVisible(pg)
}
// Work is on screen as a pill on its day or a chip in the late strip.
const mine = async (pg = page) => (await pg.locator('.rel-ev, .late-chip').allTextContents())
  .filter((t) => t.includes(tag))
// The grid's own pointer drag: press the pill, slide to the target day, drop.
const dragTo = async (pill, iso, pg = page) => {
  const from = await pill.boundingBox()
  const cell = await pg.locator(`[data-drop="${iso}"]`).boundingBox()
  await pg.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await pg.mouse.down()
  await pg.mouse.move(cell.x + cell.width / 2, cell.y + cell.height - 8, { steps: 12 })
  await pg.mouse.up()
  await pg.waitForTimeout(1400)
}
const spanHas = async (iso, pg = page) => await pg.locator(`[data-drop="${iso}"]`).count() > 0

// ============================ Mine ============================
await openPage(page, '/releases')
ok('the filter row offers one switch for your own work', await page.locator('.cf-mine').count() === 1)
const before = await mine()
ok('everything is there to begin with', before.length === 3, before.join(' / '))

await page.locator('.cf-mine').click()
await page.waitForTimeout(600)
let list = await mine()
ok('one click leaves only the work you are on',
  list.length === 2 && list.includes(`${tag} the admin owns this`) && list.includes(`${tag} the admin cuts this`), list.join(' / '))
ok('…which counts the seat you sit in, not only what you were handed',
  list.includes(`${tag} the admin cuts this`), list.join(' / '))
ok('…and it says how much it is hiding', /showing \d+ of \d+/.test(await page.locator('.cf-count').textContent()))
ok('…the switch shows it is on', await page.locator('.cf-mine.active').count() === 1)

await page.locator('.cf-mine').click()
await page.waitForTimeout(500)
ok('clicking it again puts everyone back',
  (await mine()).length === 3 && await page.locator('.cf-mine.active').count() === 0)

// It is the same person filter underneath, and the page must say so both ways.
await page.locator('.cf-bar .cf-sel').first().selectOption(String(admin.id))
await page.waitForTimeout(500)
ok('picking yourself from the menu lights the switch — it is one filter, not two',
  await page.locator('.cf-mine.active').count() === 1)
await page.locator('.cf-clear').click()
await page.waitForTimeout(400)
ok('…and Clear turns it off with everything else', await page.locator('.cf-mine.active').count() === 0)

// The proof it means the signed-in person: for Zarina it means Zarina.
const zCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const z = await zCtx.newPage()
await signIn(z, `${tag}zar`, 'probe123')
await openPage(z, '/releases')
await z.locator('.cf-mine').click()
await z.waitForTimeout(700)
const zList = await mine(z)
ok('for somebody else, “Mine” means THEM',
  zList.length === 1 && zList[0] === `${tag} zarina owns this`, zList.join(' / '))
await zCtx.close()

// The channel workspace has the same row, so it gets the same switch.
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.cf-bar', { timeout: 25000 })
await page.waitForTimeout(900)
ok('the channel workspace has it too', await page.locator('.cf-mine').count() === 1)
await page.locator('.cf-mine').click()
await page.waitForTimeout(700)
const board = (await page.locator('.tcard-title').allTextContents()).filter((t) => t.includes(tag))
ok('…and it narrows the board the same way',
  board.length === 2 && !board.includes(`${tag} zarina owns this`), board.join(' / '))
await page.locator('.cf-clear').click()
await page.waitForTimeout(400)

// ========================= taking a day back =========================
await openPage(page, '/releases')
const pill = () => page.locator('.rel-ev').filter({ hasText: `${tag} zarina owns this` }).first()
const moved = (await spanHas(day(6))) ? day(6) : day(-1)
await dragTo(pill(), moved)
ok('the day moved', (await api(`/content/${hers.id}`, 'GET', null, T)).data.release_date === moved,
  String((await api(`/content/${hers.id}`, 'GET', null, T)).data.release_date))
const undo = page.locator('.toast-act', { hasText: 'Undo' })
ok('…and the confirmation carries the way back', await undo.count() === 1)
await undo.click()
await page.waitForTimeout(1600)
ok('Undo puts the day back on the server',
  (await api(`/content/${hers.id}`, 'GET', null, T)).data.release_date === day(3))
ok('…and the pill goes back with it, with no reload',
  await page.locator(`[data-drop="${day(3)}"] .rel-ev`)
    .filter({ hasText: `${tag} zarina owns this` }).count() === 1)
// Not merely that it says "back to" — WHICH day it names. The undo toast
// once named the day the task had just left, which is the one thing the
// message exists to tell you, and a bare /back to/ check sailed past it.
ok('…and it names the day it went BACK to, not the one it left',
  (await page.locator('.toast').allTextContents())
    .some((t) => new RegExp(`back to .*\\b${Number(day(3).slice(8))}\\b`).test(t)),
  (await page.locator('.toast').allTextContents()).join(' | '))

// ===================== the page as you left it =====================
ok('a plain visit drags no parameters behind it', new URL(page.url()).search === '', page.url())
await page.locator('.section-head .cf-sel').first().selectOption('youtube')
await page.waitForTimeout(500)
await page.goto(BASE + '/brief')
await page.waitForTimeout(900)
await page.goto(BASE + '/releases')
await page.waitForSelector('.cal, .empty', { timeout: 25000 })
await page.waitForTimeout(900)
const back = new URL(page.url()).searchParams
ok('coming back finds the channel you were on', back.get('channel') === 'youtube', page.url())
// The window and the grouping went with the list — a calendar navigates by
// month, and which month you were parked on is deliberately not remembered: a
// schedule opens on the month you are living in, every time.
ok('…and it opens on this month rather than where you had scrolled to',
  (await page.locator('.cal-head h3').innerText()).includes(
    new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })),
  await page.locator('.cal-head h3').innerText())
ok('the OTHER page is remembered separately', await (async () => {
  await page.goto(BASE + '/recordings')
  await page.waitForSelector('.cal, .empty', { timeout: 25000 })
  await page.waitForTimeout(800)
  return new URL(page.url()).search === ''
})(), page.url())
// A link somebody sent shows what they meant.
await page.goto(BASE + '/releases?channel=instagram_main')
await page.waitForSelector('.cal, .empty', { timeout: 25000 })
await page.waitForTimeout(900)
const linked = new URL(page.url()).searchParams
ok('a link that says something wins over what you last looked at',
  linked.get('channel') === 'instagram_main', page.url())

// ==================== the new pages are findable ====================
await page.goto(BASE + '/brief')
await page.waitForSelector('a[href="/dept/instagram_main"]', { timeout: 25000 })
await page.waitForTimeout(500)
await page.keyboard.press('Control+k')
await page.waitForSelector('.qf-input', { timeout: 10000 })
await page.keyboard.type('releas')
await page.waitForTimeout(600)
ok('Ctrl-K finds Releases by name',
  (await page.locator('.qf-row').filter({ hasText: 'Releases' }).count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.keyboard.press('Control+k')
await page.waitForSelector('.qf-input', { timeout: 10000 })
await page.keyboard.type('recordi')
await page.waitForTimeout(600)
ok('…and Recordings', (await page.locator('.qf-row').filter({ hasText: 'Recordings' }).count()) === 1)
await page.keyboard.press('Enter')
await page.waitForTimeout(1200)
ok('…and Enter takes you there', new URL(page.url()).pathname === '/recordings', page.url())

ok('no page errors anywhere in the run', errs.length === 0, errs.join(' | '))

// ============================== on a phone ==============================
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const mp = await m.newPage()
const mErrs = []
mp.on('pageerror', (e) => mErrs.push(e.message))
await signIn(mp, 'admin', 'admin123')
await openPage(mp, '/releases')
await mp.locator('.cf-mine').click()
await mp.waitForTimeout(700)
ok('the phone gets the switch, and it works there',
  (await mp.locator('.cf-mine.active').count()) === 1 && (await mine(mp)).length === 2)
ok('…without pushing the page sideways',
  !(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
ok('…with nothing thrown', mErrs.length === 0, mErrs.join(' | '))
await mp.screenshot({ path: SP + 'r62-phone.png' })
await m.close()

await ctx.close()
await browser.close()
console.log(fails === 0 ? '\nRound-62 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
