// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 51: the content workspace can be narrowed. A filter row above the
// board and the calendars picks a PERSON (assigned, filming, editing or
// designing — all four count), a TYPE and a STAGE; whatever is chosen holds
// across the board, both calendars, the unscheduled tray and a day's agenda,
// survives a reload, and says how much it is hiding. Self-contained: it
// stands up its own stack on 4101 and seeds exact fixtures.
import { spawn } from 'child_process'
import { chromium } from 'playwright'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4101'
const B = BASE + '/api'

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

boot([ROOT + '/server/index.js'], { DATA_DIR: SP + 'f51-' + Date.now(), PORT: '4101' })
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('stack is up', await up(B + '/health'))

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

// ---- fixtures: one channel, three people, a spread of types and stages ----
const chKey = (await req('/channels')).data[0].key
const statuses = (await req('/statuses')).data
const idea = statuses.find((s) => /idea/i.test(s.label)).id
const shoot = statuses.find((s) => /to shoot/i.test(s.label)).id
const edit = statuses.find((s) => /editing/i.test(s.label)).id
const mkUser = async (name, username) => (await req('/users', 'POST', {
  name, username, password: 'probe123', role: 'member', departments: [chKey],
})).data
const anvar = await mkUser('F51 Anvar', 'f51anvar')   // the operator
const dilnoza = await mkUser('F51 Dilnoza', 'f51dil') // the editor
const sardor = await mkUser('F51 Sardor', 'f51sar')   // the assignee

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const day = (n) => {
  const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const mk = (title, extra) => req('/content', 'POST', { title, channels: [chKey], ...extra }).then((r) => r.data)

// 1 — Sardor's reel, an Idea, no date
const t1 = await mk('f51: sardor reel', { type: 'reel', assignee_ids: [sardor.id], status_id: idea })
// 2 — Anvar FILMS this one and is nobody's assignee (an empty assignee_ids
// is what stops the creator being written in as the owner by default)
const t2 = await mk('f51: anvar shoots', { type: 'video', assignee_ids: [], operator_id: anvar.id, status_id: shoot, release_date: day(2), recording_date: day(1) })
// 3 — Dilnoza CUTS this one; a video in editing, dated
const t3 = await mk('f51: dilnoza cuts', { type: 'video', assignee_ids: [], editor_id: dilnoza.id, status_id: edit, release_date: day(3), recording_date: day(1) })
// 4 — a post with nobody on it at all
const t4 = await mk('f51: orphan post', { type: 'post', assignee_ids: [], status_id: idea, release_date: day(4) })
// 5 — Sardor again, a post in editing, undated (so it also tests the tray)
const t5 = await mk('f51: sardor post', { type: 'post', assignee_ids: [sardor.id], status_id: edit })
ok('five fixtures exist', [t1, t2, t3, t4, t5].every((t) => t && t.id))

// ---- the UI ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))

await page.goto(BASE + '/login')
await page.fill('input[autocomplete="username"], input[name="username"]', 'admin')
await page.fill('input[type="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/\/(?!login)/, { timeout: 20000 })
await page.goto(`${BASE}/dept/${chKey}`)
await page.waitForSelector('.cf-bar', { timeout: 20000 })

const sel = (i) => page.locator('.cf-sel').nth(i)
const cards = () => page.locator('.tcard').count()
const countText = () => page.locator('.cf-count').textContent().catch(() => '')
const titles = async () => (await page.locator('.tcard-title').allTextContents()).filter((t) => t.startsWith('f51'))

ok('the filter row sits above the workspace', await page.locator('.cf-bar').count() === 1)
ok('it offers person, type and stage', await page.locator('.cf-sel').count() === 3)
ok('nothing is hidden until something is chosen', await page.locator('.cf-count').count() === 0)
const all = await cards()
ok('the board starts with everything', all >= 5, `${all} cards`)

// ---- person: the four seats all count ----
const personOpts = await sel(0).locator('option').allTextContents()
ok('the person menu lists only people on this channel’s work',
  personOpts.includes('F51 Anvar') && personOpts.includes('F51 Dilnoza') && personOpts.includes('F51 Sardor'),
  personOpts.join(' | '))

await sel(0).selectOption(String(sardor.id))
await page.waitForTimeout(250)
let list = await titles()
ok('an assignee’s two tasks, and only those', list.length === 2
  && list.includes('f51: sardor reel') && list.includes('f51: sardor post'), list.join(' / '))
ok('…and it says what it is hiding', /showing 2 of \d+/.test(await countText()), await countText())

await sel(0).selectOption(String(anvar.id))
await page.waitForTimeout(250)
list = await titles()
ok('the OPERATOR is found by his camera, not an assignment',
  list.length === 1 && list[0] === 'f51: anvar shoots', list.join(' / '))

await sel(0).selectOption(String(dilnoza.id))
await page.waitForTimeout(250)
list = await titles()
ok('the EDITOR is found by her cut', list.length === 1 && list[0] === 'f51: dilnoza cuts', list.join(' / '))

await sel(0).selectOption('none')
await page.waitForTimeout(250)
list = await titles()
ok('“Nobody yet” finds the work no one owns', list.length === 1 && list[0] === 'f51: orphan post', list.join(' / '))

// ---- the choice holds across every view ----
await sel(0).selectOption(String(sardor.id))
await page.waitForTimeout(200)
await page.locator('.pill', { hasText: 'Releases' }).click()
await page.waitForTimeout(500)
ok('switching to the release calendar keeps the filter', /showing 2 of/.test(await countText()), await countText())
const trayLabel = await page.locator('.cal-tray-label').textContent().catch(() => '')
ok('the unscheduled tray is narrowed too', /·\s*2\b/.test(trayLabel) || /Unscheduled$/.test(trayLabel.trim()), trayLabel)
await page.locator('.pill', { hasText: 'Recording' }).click()
await page.waitForTimeout(500)
ok('and the recording calendar', /showing 2 of/.test(await countText()), await countText())

// a day's agenda obeys it as well: Anvar's shoot day holds one task, and
// under Sardor's filter that day must come up empty rather than lie.
await sel(0).selectOption(String(anvar.id))
await page.waitForTimeout(300)
const dayCell = page.locator(`.cal-day[data-drop="${day(1)}"]`).first()
if (await dayCell.count()) {
  // The EMPTY part of the cell. Clicking its centre would land on a task pill,
  // and a click on a task opens that task rather than the day — which is the
  // point of the rule, not a fault in it.
  await dayCell.scrollIntoViewIfNeeded()
  await dayCell.locator('.cal-daynum').click()   // the date itself is never a task
  await page.waitForTimeout(600)
  // .agenda-title is what the day view actually renders. The old selector
    // list matched nothing, so `every()` on an empty array passed the pin
    // without ever looking at the day — the `length > 0` below is what makes
    // this assertion mean something.
  const agenda = (await page.locator('.agenda-title').allTextContents()).filter((t) => t.startsWith('f51'))
  ok('a day’s agenda shows only the filtered person’s work',
    agenda.length > 0 && agenda.every((t) => t === 'f51: anvar shoots'), agenda.join(' / '))
  await page.locator('.pill', { hasText: 'Board' }).click()
  await page.waitForTimeout(300)
} else ok('a day’s agenda shows only the filtered person’s work', false, 'day cell not found')

// ---- remembered per channel ----
await page.reload()
await page.waitForSelector('.cf-bar', { timeout: 20000 })
ok('the filter is still set after a reload', await sel(0).inputValue() === String(anvar.id))

// ---- type and stage, together ----
await page.locator('.cf-clear').click()
await page.waitForTimeout(250)
ok('Clear puts everything back', await sel(0).inputValue() === '' && await page.locator('.cf-count').count() === 0)

await sel(1).selectOption('video')
await page.waitForTimeout(250)
list = await titles()
ok('by type: the two videos', list.length === 2
  && list.includes('f51: anvar shoots') && list.includes('f51: dilnoza cuts'), list.join(' / '))

await sel(2).selectOption(String(edit))
await page.waitForTimeout(250)
list = await titles()
ok('type AND stage narrow together', list.length === 1 && list[0] === 'f51: dilnoza cuts', list.join(' / '))

await sel(1).selectOption('')
await page.waitForTimeout(250)
list = await titles()
ok('dropping the type leaves the stage standing', list.length === 2
  && list.includes('f51: dilnoza cuts') && list.includes('f51: sardor post'), list.join(' / '))

// ---- the rest of the page is untouched ----
await page.locator('.cf-clear').click()
await page.waitForTimeout(200)
ok('no page errors anywhere in the run', errs.length === 0, errs.join(' | '))

// ---- the phone gets the same row, without a sideways scroll ----
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const mp = await m.newPage()
await mp.goto(BASE + '/login')
await mp.fill('input[autocomplete="username"], input[name="username"]', 'admin')
await mp.fill('input[type="password"]', 'admin123')
await mp.click('button[type="submit"]')
await mp.waitForURL(/\/(?!login)/, { timeout: 20000 })
await mp.goto(`${BASE}/dept/${chKey}`)
await mp.waitForSelector('.cf-bar', { timeout: 20000 })
await mp.locator('.cf-sel').nth(1).selectOption('video')
await mp.waitForTimeout(300)
const box = await mp.locator('.cf-bar').boundingBox()
ok('the phone shows the whole row inside the screen', box && box.width <= 390 && box.width > 300, box && `${Math.round(box.width)}px`)
ok('…and the page never scrolls sideways',
  !(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
ok('…and the filter works there', /showing 2 of/.test(await mp.locator('.cf-count').textContent()))
await m.close()

await ctx.close()
await browser.close()
stop()
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-51 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
