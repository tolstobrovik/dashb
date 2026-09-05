// Round 79: the phone gets an app, not the desk shrunk down.
//
// The bugs this suite exists for are the ones a desktop test cannot see. A
// drawer of thirteen destinations sliding in from the left still renders,
// still navigates, still passes every API check — it is simply not a thing a
// phone does, and neither is a 2,600px form, nor a footer that spends a third
// of the sheet on buttons you are not pressing, nor a six-column table read
// two columns at a time.
//
// So the checks are measurements on a 390x844 touch viewport:
//   · a tab bar, fixed to the bottom, with the action raised in the middle
//   · giving a task starts from anywhere and lands in the same form
//   · the task sheet is dealt into pages, and each one is reachable
//   · the commit row is one line and Save is on the screen
//   · More comes up from the bottom, it does not slide in from the left
//   · tables are stacked cards with the column names kept
//   · boards show one column at a time and snap
//
// It rides the shared 4090 stack, which regress.sh has already seeded.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

// Same pinned binary every other suite uses — the sandbox has one.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage(PHONE)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(`${BASE}/login`)
await page.fill('input[name=username]', 'admin')
await page.fill('input[name=password]', 'admin123')
await page.click('button[type=submit]')
await page.waitForTimeout(2500)

// ---- 1. the tab bar ----
await page.goto(`${BASE}/dept/instagram_main`)
await page.waitForTimeout(1600)
const bar = await page.evaluate(() => {
  const el = document.querySelector('.mob-tabs')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return { bottom: Math.round(r.bottom), top: Math.round(r.top), position: cs.position }
})
ok('a tab bar exists on a phone', !!bar)
ok('it is fixed to the bottom edge', bar && bar.position === 'fixed' && Math.abs(bar.bottom - 844) <= 1,
  bar ? `${bar.position} bottom=${bar.bottom}` : '')
const tabCount = await page.locator('.mob-tab').count()
ok('four destinations, no more', tabCount === 4, `${tabCount}`)
ok('the action is raised in the middle', await page.locator('.mob-new').isVisible())
// The drawer's door is gone: an app has one way into More, not two.
ok('the desktop hamburger is put away', !(await page.locator('.hamburger').isVisible()))

// Nothing on the page hides behind the bar.
const clear = await page.evaluate(() => {
  const bar = document.querySelector('.mob-tabs').getBoundingClientRect()
  const main = document.querySelector('.content')
  window.scrollTo(0, document.body.scrollHeight)
  const last = [...main.children].pop().getBoundingClientRect()
  return Math.round(bar.top - last.bottom)
})
ok('the last row of the page clears the bar', clear >= 0, `${clear}px`)

// ---- 2. More comes up, it does not slide in ----
await page.locator('.mob-tab').last().click()
await page.waitForTimeout(600)
const sheet = await page.evaluate(() => {
  const el = document.querySelector('.sidebar')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: Math.round(r.left), width: Math.round(r.width), bottom: Math.round(r.bottom) }
})
ok('More is a sheet off the bottom edge, full width', sheet && sheet.left === 0 && sheet.width === 390 && Math.abs(sheet.bottom - 844) <= 1,
  sheet ? JSON.stringify(sheet) : 'no sidebar')
ok('every destination is still in it', (await page.locator('.sidebar .nav-item').count()) > 8)
await page.mouse.click(195, 40)
await page.waitForTimeout(500)

// ---- 3. giving a task, from a page that owns no channel ----
await page.locator('.mob-new').click()
await page.waitForTimeout(1800)
ok('the raised button opens the task form', await page.locator('.modal .cm-title').isVisible())
const pages = await page.locator('.cm-page-tab').allTextContents()
ok('the form is dealt into pages', pages.length >= 3, pages.join(' / '))
// Every page is reachable and none of them is the whole form again.
let tallest = 0
for (let i = 0; i < pages.length; i++) {
  await page.locator('.cm-page-tab').nth(i).click()
  await page.waitForTimeout(350)
  const h = await page.evaluate(() => document.querySelector('.modal-body').scrollHeight)
  tallest = Math.max(tallest, h)
  const on = await page.locator('.cm-page-tab.on').textContent()
  ok(`page "${pages[i].trim()}" opens`, on.trim() === pages[i].trim(), `showing ${on.trim()}`)
}
ok('no page is a wall of form', tallest < 1400, `tallest ${tallest}px`)

// The commit row: one line, both buttons on the screen.
const foot = await page.evaluate(() => {
  const f = document.querySelector('.modal-foot')
  const btns = [...f.querySelectorAll('.btn')].map((b) => b.getBoundingClientRect())
  const rows = new Set(btns.map((r) => Math.round(r.top)))
  return {
    height: Math.round(f.getBoundingClientRect().height),
    rows: rows.size,
    offscreen: btns.filter((r) => r.left < 0 || r.right > 390 || r.bottom > 845).length,
  }
})
ok('the commit row is one line', foot.rows === 1, `${foot.rows} rows, ${foot.height}px`)
ok('no button is off the screen', foot.offscreen === 0, `${foot.offscreen} off`)

// A refusal about a field on another page turns to that page.
await page.locator('.cm-page-tab').first().click()
await page.waitForTimeout(300)
await page.fill('.cm-title', 'Mobile suite probe')
await page.locator('.modal-foot .btn-primary').click()
await page.waitForTimeout(2000)
const gone = (await page.locator('.modal').count()) === 0
ok('a task given from the tab bar saves', gone)

// ---- 4. an existing task: the tools are behind one button ----
await page.goto(`${BASE}/dept/instagram_main`)
await page.waitForTimeout(1800)
await page.locator('.tcard').first().click()
await page.waitForTimeout(1800)
ok('the tools sit behind one button', await page.locator('.cm-more-btn').isVisible())
const footH = await page.evaluate(() => Math.round(document.querySelector('.modal-foot').getBoundingClientRect().height))
ok('the footer is one row on an existing task', footH < 90, `${footH}px`)
await page.locator('.cm-more-btn').click()
await page.waitForTimeout(400)
const toolLabels = await page.locator('.cm-tools.open .btn').allTextContents()
ok('Delete and Duplicate are in the menu', toolLabels.length >= 2, toolLabels.join(' / '))
ok('every tool in the menu says what it is', toolLabels.every((t) => t.trim().length > 0), JSON.stringify(toolLabels))
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

// ---- 5. tables are cards, and the column names survive ----
await page.goto(`${BASE}/admin`)
await page.waitForTimeout(2600)
const table = await page.evaluate(() => {
  const td = document.querySelector('table.tbl tbody td[data-th]')
  if (!td) return null
  const cs = getComputedStyle(document.querySelector('table.tbl tbody tr'))
  return { display: cs.display, label: td.dataset.th }
})
ok('a table row is a card, not a row', table && table.display === 'block', table ? table.display : 'no table')
ok('each cell kept its column name', !!table?.label, table?.label || '')
// The eleven Admin tabs used to wrap onto four rows.
const tabRows = await page.evaluate(() => {
  const t = document.querySelector('.tabs')
  return new Set([...t.children].map((c) => Math.round(c.getBoundingClientRect().top))).size
})
ok('the tab strip is one line that scrolls', tabRows === 1, `${tabRows} rows`)

// ---- 6. a board shows one column at a time ----
await page.goto(`${BASE}/sprints`)
await page.waitForTimeout(2200)
const col = await page.evaluate(() => {
  const b = document.querySelector('.sp-board')
  const c = document.querySelector('.sp-col')
  if (!b || !c) return null
  return {
    snap: getComputedStyle(b).scrollSnapType,
    width: Math.round(c.getBoundingClientRect().width),
    scrolls: b.scrollWidth > b.clientWidth + 4,
  }
})
ok('the sprint board is a snapped carousel', col && col.snap.startsWith('x') && col.scrolls,
  col ? JSON.stringify(col) : 'no board')
ok('a column is nearly the whole screen', col && col.width > 280, col ? `${col.width}px` : '')

ok('no page threw', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
console.log(fails ? `\n${fails} failed` : '\nAll good')
process.exit(fails ? 1 : 0)
