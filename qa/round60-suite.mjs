// Round 60: the whole team's week without walking the channels, and a
// calendar that opens what you pointed at.
//
// RELEASES and RECORDINGS. The channel pages answer "what is happening on
// Instagram Main". Nobody's week starts there — it starts with "what are we
// putting out" and "what are we filming", wherever it lives. Two pages,
// every channel at once, grouped by day, late work first.
//
// THE CALENDAR CLICK. In the month grid a task pill had no click handler at
// all, so the click fell through to the day cell and opened a summary of the
// whole day — you then read it to find the thing you had already pointed at.
// A click on a TASK opens that task; only a click on the day itself opens
// the day.
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
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
  .format(new Date(Date.now() + off * 86400000))
const tag = Date.now().toString(36).slice(-4)

// Work on two different channels, so a page that only reads one is caught.
const statuses = (await api('/statuses', 'GET', null, T)).data
const sid = (re) => statuses.find((s) => re.test(s.label))?.id
const mk = (over) => api('/content', 'POST', {
  channels: ['instagram_main'], type: 'video', status_id: sid(/to shoot/i), ...over,
}, T).then((r) => r.data)

const relA = await mk({ title: `r60 ${tag} release on IG`, release_date: day(2), release_time: '18:00' })
const relB = await mk({ title: `r60 ${tag} release on YouTube`, channels: ['youtube'], release_date: day(3) })
const recA = await mk({ title: `r60 ${tag} shoot on IG`, recording_date: day(1), recording_time: '09:30' })
const recB = await mk({ title: `r60 ${tag} shoot on YouTube`, channels: ['youtube'], recording_date: day(4) })
const lateRel = await mk({ title: `r60 ${tag} release overdue`, release_date: day(-3) })
const post = await mk({ title: `r60 ${tag} a post is never filmed`, type: 'post', release_date: day(2) })
ok('fixtures exist on two channels', [relA, relB, recA, recB, lateRel, post].every((t) => t?.id))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto(BASE + '/login')
await page.fill('input[name="username"], input[autocomplete="username"]', 'admin')
await page.fill('input[type="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 25000 })

// Since round 63 these pages are calendars. Work is on screen in one of three
// places — a pill on its day, a chip in the late strip, a chip in the tray —
// and "is this task on the page" means any of them.
const rowTitles = async () => (await page.locator('.rel-ev, .late-chip, .cal-tray-chip').allTextContents())
  .filter((t) => t.includes(tag))
const openPage = async (path) => {
  await page.goto(BASE + path)
  await page.waitForSelector('.cal, .empty', { timeout: 25000 })
  await page.waitForTimeout(800)
  await ensureVisible()
}
// The grid draws six weeks from the Monday on or before the 1st. These
// fixtures sit within four days of today, which falls off the end of that span
// in the last week of a month — so step the calendar forward when it does,
// exactly as a person would, rather than asserting on days not being drawn.
const monthSpanTo = async () => page.evaluate(() => {
  const cells = [...document.querySelectorAll('.cal-day[data-drop]')]
  return cells.length ? cells[cells.length - 1].getAttribute('data-drop') : null
})
const ensureVisible = async () => {
  if (await page.locator('.cal').count() === 0) return
  const last = await monthSpanTo()
  if (last && day(4) > last) {
    await page.locator('.cal-head .icon-btn').nth(1).click()   // next month
    await page.waitForTimeout(700)
  }
}

// ---- both pages reachable from the sidebar ----
await page.goto(BASE + '/brief')
// Wait for the shell to actually paint rather than guessing at a duration —
// the first load after a restart is slower than any number worth hard-coding.
await page.waitForSelector('a[href="/dept/instagram_main"]', { timeout: 20000 })
ok('the sidebar offers Releases', await page.locator('a[href="/releases"]').count() === 1)
ok('…and Recordings', await page.locator('a[href="/recordings"]').count() === 1)

// ---- Releases: every channel at once ----
await openPage('/releases')
let list = await rowTitles()
ok('Releases shows work from BOTH channels without choosing one',
  list.some((t) => t.includes('release on IG')) && list.some((t) => t.includes('release on YouTube')), list.join(' / '))
ok('…including a post, which is released like anything else',
  list.some((t) => t.includes('a post is never filmed')), list.join(' / '))
ok('…and it does NOT list shoots', !list.some((t) => t.includes('shoot on')), list.join(' / '))
// Overdue work must stay in front of you wherever the calendar is parked —
// it is the only part of a schedule that needs deciding about today.
ok('…overdue work is called out above the grid',
  (await page.locator('.sch-late').count()) === 1 &&
  (await page.locator('.sch-late .late-chip').allTextContents()).some((t) => t.includes('release overdue')))
ok('…the month is drawn as a grid of days', (await page.locator('.cal-day').count()) === 42)
ok('…and a time shows on the pill where one was set',
  (await page.locator('.rel-ev').allTextContents()).some((t) => t.includes('18:00')))
await page.screenshot({ path: SP + 'r60-releases.png' })

// ---- Recordings: the other half ----
await openPage('/recordings')
list = await rowTitles()
ok('Recordings shows shoots from both channels',
  list.some((t) => t.includes('shoot on IG')) && list.some((t) => t.includes('shoot on YouTube')), list.join(' / '))
ok('…and never a release that was not filmed', !list.some((t) => t.includes('release on')), list.join(' / '))
ok('…a post is never a shoot', !list.some((t) => t.includes('a post is never filmed')), list.join(' / '))
await page.screenshot({ path: SP + 'r60-recordings.png' })

// ---- narrowing works the same way it does on a channel ----
await page.locator('.section-head .cf-sel').first().selectOption('youtube')
await page.waitForTimeout(600)
list = await rowTitles()
ok('one channel can be picked out', list.every((t) => t.includes('YouTube')) && list.length > 0, list.join(' / '))
// every() over an empty array is true, so the count is asserted as well — a
// reload that showed NOTHING used to pass this line without a complaint.
ok('…and it survives a reload, being in the address', (await (async () => {
  await page.reload()
  await page.waitForSelector('.cal, .empty', { timeout: 25000 })
  await page.waitForTimeout(900)
  await ensureVisible()
  const after = await rowTitles()
  return after.length > 0 && after.every((t) => t.includes('YouTube'))
})()))
await page.locator('.section-head .cf-sel').first().selectOption('')
await page.waitForTimeout(500)
await page.locator('.cf-bar .cf-sel').nth(1).selectOption('video') // a post is never a shoot, so Recordings offers no 'post'
await page.waitForTimeout(500)
ok('the person / type / stage row narrows it too', (await page.locator('.cf-count').count()) === 1)
await page.locator('.cf-clear').click()
await page.waitForTimeout(400)

// ---- a row opens its task ----
await openPage('/releases')
await page.locator('.rel-ev', { hasText: `${tag} release on IG` }).first().click()
await page.waitForTimeout(900)
ok('clicking a task on the calendar opens that task', (await page.locator('.modal').count()) > 0)
ok('…and it is the one that was clicked',
  (await page.locator('.modal input').first().inputValue()).includes('release on IG'))
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// ---- the calendar opens what you pointed at ----
await page.evaluate(() => {
  localStorage.setItem('satashkent_dept_view', 'release')
  localStorage.setItem('satashkent_cal_scale', 'month')
})
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.cal-day', { timeout: 15000 })
await page.waitForTimeout(900)
const pill = page.locator('.rel-ev', { hasText: `${tag} release on IG` }).first()
ok('the release calendar shows the task', await pill.count() === 1)
await pill.scrollIntoViewIfNeeded()
await pill.click()
await page.waitForTimeout(900)
ok('clicking the TASK opens the task, not the day', (await page.locator('.modal').count()) > 0)
ok('…and the day summary did not open instead', (await page.locator('.planner').count()) === 0)
ok('…it is the task that was clicked',
  (await page.locator('.modal input').first().inputValue()).includes('release on IG'))
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

// clicking the day itself still gives the day
const cell = page.locator(`.cal-day[data-drop="${day(2)}"]`).first()
await cell.scrollIntoViewIfNeeded()
await cell.locator('.cal-daynum').click()   // the date itself is never a task
await page.waitForTimeout(900)
ok('clicking the empty part of a day still opens the day', (await page.locator('.planner').count()) > 0)

ok('no page errors anywhere in the run', errs.length === 0, errs.join(' | '))

await ctx.close()
await browser.close()
console.log(fails === 0 ? '\nRound-60 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
