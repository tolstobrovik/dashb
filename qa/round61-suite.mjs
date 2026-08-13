// Round 61: three conveniences on the two schedule pages.
//
// BY PERSON. A schedule read down the days answers "what happens Thursday".
// It does not answer "what does Anvar owe", which is the question asked at
// every stand-up. One toggle regroups the same rows by the people on them —
// and because a shoot has an operator, an editor and an owner, it turns up
// under each of them rather than under whichever one we picked as the
// "real" one. A person's card carries their late work too, so nobody has to
// read two places to know what they are behind on.
//
// MOVE A DAY. Rescheduling is the edit a schedule exists for, and it cost
// opening the whole task. Now the day sits on the row. Anyone who cannot
// move tasks does not get the control.
//
// TAKE IT AWAY. What is on screen, as a spreadsheet: the same rows the
// filters left standing — with a BOM so Excel reads Cyrillic as Cyrillic.
// Runs against the shared 4090 stack.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

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
const tag = 'r61' + Date.now().toString(36).slice(-4)

// ---- fixtures: two people, two channels, one straight quote ----
const statuses = (await api('/statuses', 'GET', null, T)).data
const sid = (re) => statuses.find((s) => re.test(s.label))?.id
const mkUser = async (name, username, role) => (await api('/users', 'POST', {
  name, username, password: 'probe123', role, departments: [],
}, T)).data
const anvar = await mkUser(`${tag} Anvar`, `${tag}anvar`, 'operator')
const dilnoza = await mkUser(`${tag} Dilnoza`, `${tag}dil`, 'editor')
const mk = (over) => api('/content', 'POST', {
  channels: ['instagram_main'], type: 'video', status_id: sid(/to shoot/i), assignee_ids: [], ...over,
}, T).then((r) => r.data)

// Anvar's three releases — the exact set the person filter must isolate.
const late = await mk({ title: `${tag} overdue release`, release_date: day(-3), operator_id: anvar.id })
const soon = await mk({ title: `${tag} shared job`, release_date: day(2), release_time: '18:00', recording_date: day(1), operator_id: anvar.id, editor_id: dilnoza.id })
const quoted = await mk({ title: `${tag} Съёмка "интервью", с запятой`, release_date: day(4), operator_id: anvar.id })
// Not Anvar's: one nobody owns, and one on another channel.
const orphan = await mk({ title: `${tag} nobody owns me`, release_date: day(3) })
const onYt = await mk({ title: `${tag} youtube job`, channels: ['youtube'], release_date: day(2), editor_id: dilnoza.id })
ok('fixtures exist', [late, soon, quoted, orphan, onYt].every((t) => t?.id))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
const signIn = async (pg, u, pw) => {
  await pg.goto(BASE + '/login')
  await pg.fill('input[name="username"], input[autocomplete="username"]', u)
  await pg.fill('input[type="password"]', pw)
  await pg.click('button[type="submit"]')
  // Not waitForURL(/\/(?!login)/) — that regex matches the `//` in `http://`
  // and so returns before the sign-in has actually landed anywhere.
  await pg.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 25000 })
}
await signIn(page, 'admin', 'admin123')

const openPage = async (pg, path) => {
  await pg.goto(BASE + path)
  await pg.waitForSelector('.sch-row, .empty', { timeout: 25000 })
  await pg.waitForTimeout(700)
}
const mine = async (pg = page) => (await pg.locator('.sch-title').allTextContents()).filter((t) => t.includes(tag))

// ================= the day a row sits on, edited in place =================
await openPage(page, '/releases')
ok('every row carries the day it sits on',
  await page.locator('.sch-date').count() === await page.locator('.sch-row').count()
  && await page.locator('.sch-row').count() > 0)

const rowOf = (title, pg = page) => pg.locator('.sch-row').filter({ hasText: title }).first()
const orphanRow = rowOf(`${tag} nobody owns me`)
ok('the row shows the date it is currently on', await orphanRow.locator('.sch-date').inputValue() === day(3))
await orphanRow.locator('.sch-date').fill(day(9))
await page.waitForTimeout(1500)
ok('changing it moves the task on the server, with no task ever opened',
  (await api(`/content/${orphan.id}`, 'GET', null, T)).data.release_date === day(9))
ok('…and it says so', (await page.locator('.toast, .toast-text').allTextContents()).some((t) => t.includes('nobody owns me')))
// day(9) is later than every other fixture, so the row must have travelled to
// the bottom of the page — the list regrouped without a reload.
const lastCard = page.locator('.sch-day').last()
ok('…and the row moved to its new day without a reload',
  (await lastCard.locator('.sch-title').allTextContents()).some((t) => t.includes('nobody owns me')))
await page.reload()
await page.waitForSelector('.sch-row', { timeout: 25000 })
await page.waitForTimeout(800)
ok('…and it is still there after a reload', await rowOf(`${tag} nobody owns me`).locator('.sch-date').inputValue() === day(9))

// A crew member may not move work, so they are not offered a control that
// would only fail.
const crewCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const crew = await crewCtx.newPage()
await signIn(crew, `${tag}dil`, 'probe123')
await openPage(crew, '/releases')
ok('an editor still sees the schedule', (await mine(crew)).length > 0)
ok('…but is offered no day to change, having no right to move work',
  await crew.locator('.sch-date').count() === 0)
await crewCtx.close()

// ========================= grouped by person =========================
ok('it starts grouped by day', await page.locator('.pill.active', { hasText: 'By day' }).count() === 1)
await page.locator('.pill', { hasText: 'By person' }).click()
await page.waitForTimeout(800)
ok('the grouping is in the address, so a reload keeps it', page.url().includes('group=person'))

const cardOf = (name) => page.locator('.sch-phead', { hasText: name }).locator('xpath=following-sibling::*[1]')
const heads = await page.locator('.sch-phead').allTextContents()
ok('there is a card per person', heads.some((h) => h.includes(`${tag} Anvar`)) && heads.some((h) => h.includes(`${tag} Dilnoza`)),
  heads.filter((h) => h.includes(tag)).join(' | '))
const anvarRows = (await cardOf(`${tag} Anvar`).locator('.sch-title').allTextContents()).filter((t) => t.includes(tag))
const dilRows = (await cardOf(`${tag} Dilnoza`).locator('.sch-title').allTextContents()).filter((t) => t.includes(tag))
ok('the operator’s card holds what he films', anvarRows.includes(`${tag} shared job`), anvarRows.join(' / '))
ok('…and the editor’s card holds the SAME job, because she cuts it',
  dilRows.includes(`${tag} shared job`), dilRows.join(' / '))
ok('…the editor’s other channel is there too', dilRows.includes(`${tag} youtube job`), dilRows.join(' / '))
ok('a person’s card carries their late work as well', anvarRows.includes(`${tag} overdue release`), anvarRows.join(' / '))
ok('…so the separate Late list is not repeated above it', await page.locator('.sch-late-head').count() === 0)
const nobody = (await cardOf('Nobody yet').locator('.sch-title').allTextContents()).filter((t) => t.includes(tag))
ok('work with no one on it is not lost — it is called out', nobody.includes(`${tag} nobody owns me`), nobody.join(' / '))
ok('a person’s card spans days, so every row shows its date',
  (await cardOf(`${tag} Anvar`).locator('.sch-when').allTextContents()).every((t) => !/^\d\d:\d\d$/.test(t.trim())))
await page.screenshot({ path: SP + 'r61-person.png' })
await page.reload()
await page.waitForSelector('.sch-phead', { timeout: 25000 })
await page.waitForTimeout(600)
ok('the grouping survives a reload', await page.locator('.pill.active', { hasText: 'By person' }).count() === 1)

// ===================== the same view, as a spreadsheet =====================
await page.locator('.pill', { hasText: 'By day' }).click()
await page.waitForTimeout(500)
// Narrow to one person so the file has an exactly known content, whatever
// else is on the shared stack.
await page.locator('.cf-bar .cf-sel').first().selectOption(String(anvar.id))
await page.waitForTimeout(700)
const onScreen = await mine()
ok('the filter leaves this person’s three releases', onScreen.length === 3, onScreen.join(' / '))

const grab = async () => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('.sch-export').click(),
  ])
  return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') }
}
const csv = await grab()
ok('it downloads under a name that says what and when', csv.name === `releases-${today}.csv`, csv.name)
const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n')
ok('…it starts with a byte-order mark, so Excel reads Cyrillic as Cyrillic', csv.text.startsWith('\uFEFF'))
ok('…the first line names the columns',
  lines[0] === '"Date","Time","Title","Type","Channels","Stage","Operator","Editor","Designer","Assignees"', lines[0])
ok('…there is exactly one line per row on screen', lines.length === 4, `${lines.length - 1} rows for ${onScreen.length} on screen`)
ok('…carrying the date, the time and the crew',
  lines.some((l) => l.includes(`"${day(2)}","18:00"`) && l.includes(`${tag} Anvar`) && l.includes(`${tag} Dilnoza`)),
  lines.slice(1).join(' ‖ '))
ok('…a quote inside a title is doubled, not left to break the file',
  csv.text.includes('""интервью""'), lines.find((l) => l.includes('интервью')) || '(no such line)')
ok('…and Cyrillic comes through unharmed', csv.text.includes('Съёмка'))
ok('…what the filter hid stays hidden', !csv.text.includes('youtube job') && !csv.text.includes('nobody owns me'))

await page.locator('.cf-clear').click()
await page.waitForTimeout(500)
await openPage(page, '/recordings')
const rec = await grab()
ok('the shoot list exports under its own name', rec.name === `recordings-${today}.csv`, rec.name)
ok('…and it is the shoot dates that are in it',
  rec.text.includes(`"${day(1)}"`) && rec.text.includes(`${tag} shared job`))

ok('no page errors anywhere in the run', errs.length === 0, errs.join(' | '))

// ============================== on a phone ==============================
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true })
const mp = await m.newPage()
const mErrs = []
mp.on('pageerror', (e) => mErrs.push(e.message))
await signIn(mp, 'admin', 'admin123')
await openPage(mp, '/releases')
ok('the phone gets the day control too', await mp.locator('.sch-date').count() > 0)
ok('…and the head wraps instead of pushing the page sideways',
  !(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
await mp.locator('.pill', { hasText: 'By person' }).click()
await mp.waitForSelector('.sch-phead', { timeout: 20000 })
await mp.waitForTimeout(600)
ok('…by person reads on a phone as well', (await mp.locator('.sch-phead').count()) > 0
  && !(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
ok('…with nothing thrown', mErrs.length === 0, mErrs.join(' | '))
await mp.screenshot({ path: SP + 'r61-phone.png' })
await m.close()

await ctx.close()
await browser.close()
console.log(fails === 0 ? '\nRound-61 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
