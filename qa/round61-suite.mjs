// The two schedule pages — Releases and Recordings — as CALENDARS.
//
// Written for round 61 (when they were lists) and rewritten in round 63, when
// they became calendars. A schedule is a shape before it is a list: you plan
// around the gaps, and a gap is something you see. What the list did in three
// controls the grid does in one gesture, so the pins moved with it:
//
//   MOVE A DAY was a date field on every row. It is now a drag across the
//   grid, which is the same edit with the destination visible.
//   LATE WORK led the list. A calendar parked on this month would leave last
//   month's overdue work behind it, so late work rides above the grid wherever
//   you have navigated to — and can be put on today in one press.
//   EACH PAGE KEEPS TO ITS OWN DATE. The grid briefly offered the other
//   page's undated work as a tray to drag from; it read as a backlog nobody
//   asked for, so a page shows only work carrying a date on ITS field.
//   TAKE IT AWAY still exports exactly what is shown — which now means the
//   span the calendar is parked on, plus the late strip.
//
// Anyone who cannot move tasks gets no drag and no quick action.
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

// The exact span the month grid draws: six weeks from the Monday on or before
// the 1st. The export promises "what is shown", so the suite has to know what
// that is — otherwise a run near the end of a month asserts on rows the
// calendar was never displaying and fails for the wrong reason.
const monthSpan = () => {
  const [y, m] = today.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const from = new Date(first)
  from.setUTCDate(1 - ((first.getUTCDay() + 6) % 7))
  const to = new Date(from)
  to.setUTCDate(from.getUTCDate() + 41)
  return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)]
}
const [spanFrom, spanTo] = monthSpan()
const inSpan = (iso) => iso >= spanFrom && iso <= spanTo

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
  channels: ['instagram_main'], type: 'video', status_id: sid(/^editing$/i), assignee_ids: [], ...over,
}, T).then((r) => r.data)

const late = await mk({ title: `${tag} overdue release`, release_date: day(-3), operator_id: anvar.id })
const soon = await mk({ title: `${tag} shared job`, release_date: day(2), release_time: '18:00', recording_date: day(1), operator_id: anvar.id, editor_id: dilnoza.id })
const quoted = await mk({ title: `${tag} Съёмка "интервью", с запятой`, release_date: day(4), operator_id: anvar.id })
const orphan = await mk({ title: `${tag} nobody owns me`, release_date: day(3) })
const onYt = await mk({ title: `${tag} youtube job`, channels: ['youtube'], release_date: day(2), editor_id: dilnoza.id })
// Work with no release date at all — the Releases grid must not adopt it.
const undated = await mk({ title: `${tag} not scheduled yet`, operator_id: anvar.id })
ok('fixtures exist', [late, soon, quoted, orphan, onYt, undated].every((t) => t?.id))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
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
  await pg.waitForSelector('.cal, .empty', { timeout: 25000 })
  await pg.waitForTimeout(900)
}
// Pills carry the title; the tray and late strip carry chips.
const pillFor = (title, pg = page) => pg.locator('.rel-ev').filter({ hasText: title }).first()

// ======================= it is a calendar now =======================
await openPage(page, '/releases')
ok('the page draws a calendar, not a list of rows',
  await page.locator('.cal').count() === 1 && await page.locator('.sch-row').count() === 0)
ok('…with a full month of day cells', await page.locator('.cal-day').count() === 42)
ok('…and a task sits in its own day',
  await page.locator(`[data-drop="${day(3)}"] .rel-ev`).filter({ hasText: `${tag} nobody owns me` }).count() === 1)

// ==================== moving a day is one drag ====================
// The grid's own pointer drag: press the pill, slide to the target day, drop.
//
// Aims at the CENTRE and checks what is under the cursor before letting go —
// see the long note on the same helper in round62-suite.mjs. Eight pixels
// above the bottom of a cell read before the press is a coordinate that
// belongs to the day next door as soon as a full calendar reflows.
const dragTo = async (pill, iso, pg = page) => {
  const target = pg.locator(`[data-drop="${iso}"]`)
  await target.scrollIntoViewIfNeeded()
  await pg.waitForTimeout(250)
  const from = await pill.boundingBox()
  await pg.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await pg.mouse.down()
  for (let tries = 0; tries < 3; tries++) {
    const cell = await target.boundingBox()
    if (!cell) break
    const x = cell.x + cell.width / 2
    const y = cell.y + cell.height / 2
    await pg.mouse.move(x, y, { steps: 12 })
    const under = await pg.evaluate(([px, py]) =>
      document.elementFromPoint(px, py)?.closest?.('[data-drop]')?.getAttribute('data-drop') || null, [x, y])
    if (under === iso) break
  }
  await pg.mouse.up()
  await pg.waitForTimeout(1400)
}
// A destination inside the drawn month, empty, and not where it already is.
const target = inSpan(day(6)) ? day(6) : day(-1)
await dragTo(pillFor(`${tag} nobody owns me`), target)
ok('dragging a task to another day moves it on the server, with no task opened',
  (await api(`/content/${orphan.id}`, 'GET', null, T)).data.release_date === target,
  (await api(`/content/${orphan.id}`, 'GET', null, T)).data.release_date)
ok('…and it says so, with a way back',
  (await page.locator('.toast').allTextContents()).some((t) => t.includes('nobody owns me')))
ok('…and the pill is now drawn on the day it landed on',
  await page.locator(`[data-drop="${target}"] .rel-ev`).filter({ hasText: `${tag} nobody owns me` }).count() === 1)
await page.reload()
await page.waitForSelector('.cal', { timeout: 25000 })
await page.waitForTimeout(900)
ok('…and it is still there after a reload',
  await page.locator(`[data-drop="${target}"] .rel-ev`).filter({ hasText: `${tag} nobody owns me` }).count() === 1)

// =================== late work rides above the grid ===================
ok('late work is called out above the calendar',
  await page.locator('.sch-late .late-chip').filter({ hasText: `${tag} overdue release` }).count() === 1)
ok('…carrying the day it was due', (await page.locator('.sch-late .late-chip')
  .filter({ hasText: `${tag} overdue release` }).locator('.late-when').innerText()).length > 0)
await page.locator('.sch-late .late-chip').filter({ hasText: `${tag} overdue release` })
  .locator('.qbtn').click()
await page.waitForTimeout(1400)
ok('…and one press puts it on today',
  (await api(`/content/${late.id}`, 'GET', null, T)).data.release_date === today)
ok('…which takes it out of the late strip',
  await page.locator('.sch-late .late-chip').filter({ hasText: `${tag} overdue release` }).count() === 0)

// ============ each page keeps to its own date ============
// The two calendars were briefly offered each other's undated work as a tray
// to drag from. It read as a backlog nobody asked for: every release-only
// video piled into Recordings and every shoot into Releases, drowning the page
// it was supposed to help. A page shows work carrying a date on ITS field —
// a shoot with no release day is a shoot, not an unscheduled release.
ok('work with no release date is not dragged onto the Releases calendar',
  !(await page.locator('.cal-tray-chip:not(.late-chip)').allTextContents())
    .some((t) => t.includes(`${tag} not scheduled yet`)))
await openPage(page, '/recordings')
const recTitles = await page.locator('.rel-ev, .cal-tray-chip').allTextContents()
ok('…and Recordings does not carry release-only work either',
  !recTitles.some((t) => t.includes(`${tag} nobody owns me`)), recTitles.join(' / '))
ok('…while the shoot it does own is on the grid',
  recTitles.some((t) => t.includes(`${tag} shared job`)), recTitles.join(' / '))
await openPage(page, '/releases')

// ============ no right to move work, no way to try ============
const crewCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const crew = await crewCtx.newPage()
await signIn(crew, `${tag}dil`, 'probe123')
await openPage(crew, '/releases')
ok('an editor still sees the schedule', await crew.locator('.cal-day').count() === 42)
ok('…and still sees the work on it',
  await crew.locator('.rel-ev').filter({ hasText: `${tag} shared job` }).count() === 1)
const before = (await api(`/content/${soon.id}`, 'GET', null, T)).data.release_date
await dragTo(crew.locator('.rel-ev').filter({ hasText: `${tag} shared job` }).first(),
  inSpan(day(8)) ? day(8) : day(-4), crew)
ok('…but dragging moves nothing, having no right to move work',
  (await api(`/content/${soon.id}`, 'GET', null, T)).data.release_date === before)
ok('…and no quick action is offered on late work either',
  await crew.locator('.sch-late .qbtn').count() === 0)
await crewCtx.close()

// ===================== the same view, as a spreadsheet =====================
await openPage(page, '/releases')
await page.locator('.cf-bar .cf-sel').first().selectOption(String(anvar.id))
await page.waitForTimeout(900)

// What the page should be exporting: this person's work inside the drawn
// month, plus anything of theirs still late — worked out here from the same
// rules, so the count is a real expectation and not a copy of the answer.
const anvarRows = [
  { d: today, t: `${tag} overdue release` },      // moved onto today above
  { d: day(2), t: `${tag} shared job` },
  { d: day(4), t: `${tag} Съёмка` },
].filter((r) => inSpan(r.d) || r.d < today)

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
ok('…with one line per row the calendar is showing',
  lines.length === anvarRows.length + 1, `${lines.length - 1} rows, expected ${anvarRows.length}`)
ok('…carrying the date, the time and the crew',
  lines.some((l) => l.includes(`"${day(2)}","18:00"`) && l.includes(`${tag} Anvar`) && l.includes(`${tag} Dilnoza`)),
  lines.slice(1).join(' ‖ '))
ok('…a quote inside a title is doubled, not left to break the file',
  csv.text.includes('""интервью""'), lines.find((l) => l.includes('интервью')) || '(no such line)')
ok('…and Cyrillic comes through unharmed', csv.text.includes('Съёмка'))
ok('…what the filter hid stays hidden',
  !csv.text.includes('youtube job') && !csv.text.includes('nobody owns me'))

await page.locator('.cf-clear').click()
await page.waitForTimeout(600)
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
// Round 77 opened a phone on the WEEK, where titles are readable; round 82
// asked for the month to be the default in every view, a phone included — a
// week is a horizon you check, a month is the one you plan in. So the phone
// opens on the month now, and the week is the tap away instead.
ok('the phone gets the calendar too, opened on the month',
  (await mp.locator('.cal-day').count()) === 42,
  String(await mp.locator('.cal-day').count()))
await mp.locator('.cal-scale .pill', { hasText: 'Week' }).click()
await mp.waitForTimeout(800)
ok('…and the week is one press away, all seven columns', await mp.locator('.wk-col').count() === 7,
  String(await mp.locator('.wk-col').count()))
ok('…and the page never scrolls sideways',
  !(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
// The controls above the grid must be reachable without a sideways scroll.
const reach = await mp.evaluate(() => {
  const seen = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1 }
  return { today: seen(document.querySelector('.cal-head .btn')), scale: seen(document.querySelector('.cal-scale')) }
})
ok('…with Today reachable without scrolling sideways', reach.today)
ok('…and the Month/Week switch too', reach.scale)
ok('…with nothing thrown', mErrs.length === 0, mErrs.join(' | '))
await mp.screenshot({ path: SP + 'r61-phone.png' })
await m.close()

await ctx.close()
await browser.close()
console.log(fails === 0 ? '\nRound-61 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
