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
const openPage = async (pg, path) => {
  await pg.goto(BASE + path)
  await pg.waitForSelector('.sch-row, .empty', { timeout: 25000 })
  await pg.waitForTimeout(700)
}
const mine = async (pg = page) => (await pg.locator('.sch-title').allTextContents()).filter((t) => t.includes(tag))

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
const row = () => page.locator('.sch-row').filter({ hasText: `${tag} zarina owns this` }).first()
await row().locator('.sch-date').fill(day(12))
await page.waitForTimeout(1500)
ok('the day moved', (await api(`/content/${hers.id}`, 'GET', null, T)).data.release_date === day(12))
const undo = page.locator('.toast-act', { hasText: 'Undo' })
ok('…and the confirmation carries the way back', await undo.count() === 1)
await undo.click()
await page.waitForTimeout(1600)
ok('Undo puts the day back on the server',
  (await api(`/content/${hers.id}`, 'GET', null, T)).data.release_date === day(3))
ok('…and the row goes back with it, with no reload',
  await row().locator('.sch-date').inputValue() === day(3))
ok('…and it says where it landed',
  (await page.locator('.toast').allTextContents()).some((t) => /back to/.test(t)),
  (await page.locator('.toast').allTextContents()).join(' | '))

// ===================== the page as you left it =====================
ok('a plain visit drags no parameters behind it', new URL(page.url()).search === '', page.url())
await page.locator('.section-head .cf-sel').first().selectOption('youtube')
await page.waitForTimeout(400)
await page.locator('.section-head .cf-sel').nth(1).selectOption('90')
await page.waitForTimeout(400)
await page.locator('.pill', { hasText: 'By person' }).click()
await page.waitForTimeout(600)
await page.goto(BASE + '/brief')
await page.waitForTimeout(900)
await page.goto(BASE + '/releases')
await page.waitForSelector('.sch-row, .empty', { timeout: 25000 })
await page.waitForTimeout(900)
const back = new URL(page.url()).searchParams
ok('coming back finds the channel you were on', back.get('channel') === 'youtube', page.url())
ok('…the window you had opened', back.get('window') === '90')
ok('…and the way you were reading it', back.get('group') === 'person')
ok('the OTHER page is remembered separately', await (async () => {
  await page.goto(BASE + '/recordings')
  await page.waitForSelector('.sch-row, .empty', { timeout: 25000 })
  await page.waitForTimeout(800)
  return new URL(page.url()).search === ''
})(), page.url())
// A link somebody sent shows what they meant.
await page.goto(BASE + '/releases?channel=instagram_main')
await page.waitForSelector('.sch-row, .empty', { timeout: 25000 })
await page.waitForTimeout(900)
const linked = new URL(page.url()).searchParams
ok('a link that says something wins over what you last looked at',
  linked.get('channel') === 'instagram_main' && !linked.get('window'), page.url())

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
