// The task sheet: writing one down, and reading one back.
//
// Writing an idea down should cost a title and a press.
//
// It used to cost a form. The sheet opened with four tabs across the top —
// Brief, Execution, Logistics, Talk — on a task that did not exist yet, so
// three of them were doors to empty rooms: nobody has delivered anything on a
// piece nobody has created, no day has been promised, and there is nobody to
// say anything to. Under them sat a paragraph explaining that an idea only
// needs a name, a sentence explaining what the plan arithmetic would do, a
// classification nobody classifies a thought by, and a button called "Fewer
// details" on the screen with the fewest details on the board.
//
// Eight hundred pixels and eighty-six words to write down a thought is how a
// team stops writing thoughts down, which is the one thing the idea stage
// exists for.
//
// What is checked here is the shape of the shortest path, and that the long
// one is still one press away — because the person who already knows the
// format, the crew and the three dates should not have to save and reopen.
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage()
page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin'); await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]'); await page.waitForTimeout(2400)
await page.goto(BASE + '/dept/instagram_main'); await page.waitForTimeout(2400)

const openNew = async () => {
  await page.locator('button', { hasText: 'New task' }).first().click()
  await page.waitForSelector('.modal', { timeout: 8000 })
  await page.waitForTimeout(900)
}

// ===================== the short path =====================
await openNew()
const m = page.locator('.modal')
ok('a task being written down has no tabs', (await m.locator('.cm-page-tab').count()) === 0)
ok('…and nothing offering fewer details than none',
  (await m.locator('.cm-less-details, .cm-add-details').count()) === 0)
const words = (await m.textContent()).replace(/\s+/g, ' ').trim().split(' ').length
ok('the sheet is short enough to read at a glance', words < 60, `${words} words`)
const h = Math.round((await m.boundingBox()).height)
ok('…and short enough to see whole', h < 600, `${h}px`)
ok('classification is not asked of a thought', !/Rubrika/i.test(await m.textContent()))

// A title and the button, and that is the whole act.
const title = `newtask ${stamp} idea`
await m.locator('input').first().fill(title)
await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /Create task/.test(e.textContent || '')); if (x) x.click() })
await page.waitForTimeout(2200)
ok('a title and a press is a task', (await page.locator('.tcard', { hasText: title }).count()) === 1)
const made = (await req('/content')).data.find((r) => r.title === title)
ok('…which lands in the idea stage', !!made && made.status_id === 1, String(made?.status_id))

// ===================== the long one, one press away =====================
await openNew()
const short = await m.locator('input:visible, select:visible, textarea:visible').count()
await page.locator('button', { hasText: 'I already know the rest' }).click()
await page.waitForTimeout(900)
// The whole form arrives dealt into pages, so what proves it is there is the
// strip — counting the boxes on screen would only count the first page, which
// is the point of having pages at all.
const tabs = await m.locator('.cm-page-tab').allTextContents()
ok('the whole form is one press away', tabs.length >= 3, `${short} controls → ${tabs.join(' / ')}`)
ok('…and brings the classification back with it', /Rubrika/i.test(await m.textContent()))
await page.keyboard.press('Escape')

// ===================== an existing task still pages =====================
await page.waitForTimeout(600)
await page.locator('.tcard', { hasText: title }).first().click()
await page.waitForSelector('.modal', { timeout: 8000 }); await page.waitForTimeout(1200)
await page.evaluate(() => { const b = document.querySelector('.cm-add-details'); if (b) b.click() })
await page.waitForTimeout(700)
ok('a task that EXISTS still has its pages', (await page.locator('.cm-page-tab').count()) >= 3,
  JSON.stringify(await page.locator('.cm-page-tab').allTextContents()))

// ===================== reading one back =====================
// A reviewer opens a task to answer one question — is it moving, and who is it
// waiting on — and the answer used to be spread across three tabs: the crew on
// Execution, the days on Logistics, the files between them. Land on Talk,
// which is where a comment link puts you, and there was nothing on screen
// about the work at all.
// Dates built from today, not typed out. These were three absolute days —
// 2026-09-07, -16, -17 — so the fixture meant "three days late" on exactly
// one date in history and something else every day after it. A suite that can
// only pass on the afternoon it was written is a suite that starts lying the
// next morning. The board keeps a Tashkent day, so the fixture does too.
const day = (n) => {
  const d = new Date(Date.now() + 5 * 3600e3)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const LATE_BY = 3
const live = (await req('/content', 'POST', {
  title: `tasksheet ${stamp} live`, type: 'reel', channels: ['instagram_main'], status_id: 3,
  operator_id: 3, editor_id: 2,
  recording_date: day(-LATE_BY), edit_ready_date: day(6), release_date: day(7),
})).data
await req(`/content/${live.id}`, 'PATCH', { shot_link: 'https://drive.google.com/file/d/TS/view' })
await page.goto(`${BASE}/brief?task=${live.id}`); await page.waitForTimeout(2200)
const sheet = page.locator('.modal')
const strips = await sheet.locator('.cm-page-tab').allTextContents()
let everywhere = true
let seen = []
for (let i = 0; i < strips.length; i++) {
  await sheet.locator('.cm-page-tab').nth(i).click(); await page.waitForTimeout(450)
  const bits = (await sheet.locator('.cm-state-bit').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim())
  if (bits.length < 2) everywhere = false
  if (i === strips.length - 1) seen = bits
}
ok('where the work has got to is on every page', everywhere, JSON.stringify(seen))
ok('…naming the phase and who holds it', /Shooting/.test(seen.join(' ')) && /Mirabbos/.test(seen.join(' ')), seen.join(' | '))
ok('…and saying how late the late one is', new RegExp(`${LATE_BY}d late`).test(seen.join(' ')), seen.join(' | '))
ok('…in the colour the rest of the board uses for late',
  (await sheet.locator('.cm-state-bit.s-late').count()) === 1)
ok('…while what has not started yet says so, rather than reading as late',
  (await sheet.locator('.cm-state-bit.s-waiting').count()) >= 1)
await browser.close()

await req(`/content/${live.id}`, 'DELETE')
if (made) await req(`/content/${made.id}`, 'DELETE')
console.log(fails === 0 ? '\nTask-sheet suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
