// Round 87: the task sheet stops being a wall.
//
// It was one column of every box a piece could ever hold, and you scrolled
// past nine of them to reach the one you came for. Now:
//
//   the views      Brief · Execution · Logistics · Talk — one screen each,
//                  and a piece that is still an idea only owes you the Brief
//   the guard      closing a sheet holding words nobody saved asks first;
//                  moving BETWEEN views never asks, because nothing is lost
//   the chain      move the shoot past the cut and the cut moves with it,
//                  keeping the gap the plan had, and the sheet says so.
//                  Only ever forwards: an earlier shoot drags nobody
//   the picker     somebody who has left still reads as themselves, greyed,
//                  instead of vanishing out of the piece they worked on
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
const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }

const stamp = Date.now()
const piece = (await req('/content', 'POST', {
  title: `r87 the chain ${stamp}`, type: 'video', channels: ['instagram_main'],
  recording_date: d(1), edit_ready_date: d(3), design_ready_date: d(4), release_date: d(6),
})).data

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin'); await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]'); await page.waitForURL(/overview/, { timeout: 15000 })
await page.waitForTimeout(500)

const openPiece = async () => {
  await page.goto(BASE + '/dept/instagram_main')
  await page.waitForSelector('.tcard', { timeout: 12000 }); await page.waitForTimeout(500)
  await page.locator('.tcard', { hasText: `r87 the chain ${stamp}` }).first().click()
  await page.waitForSelector('.modal', { timeout: 8000 })
}
await openPiece()

// ===================== the views =====================
const tabs = (await page.locator('.cm-page-tab').allTextContents()).map((s) => s.replace(/\s*\d+\s*$/, '').trim())
ok('the sheet is views, not one long scroll', tabs.length >= 3, tabs.join(' | '))
ok('…and the first one is the brief', /brief/i.test(tabs[0] || ''), tabs[0])
ok('…the dates have a view of their own', tabs.some((t) => /logistics/i.test(t)), tabs.join(' | '))

// A view is only worth the name if it fits. The whole point of the refactor is
// that you stop scrolling past boxes you did not come for.
const fits = await page.evaluate(() => {
  const body = document.querySelector('.modal .modal-body') || document.querySelector('.modal')
  return { scroll: body.scrollHeight, shown: body.clientHeight }
})
ok('one view fits without a long scroll', fits.scroll <= fits.shown + 220, `${fits.scroll}px of content in ${fits.shown}px`)

// Only ONE view is on screen at a time — the others are still mounted and
// still holding what you typed in them, which is why leaving a view is free.
const onScreen = await page.locator('.cm-sec.on').count()
ok('exactly one view is showing', onScreen === 1, `${onScreen} showing`)

// ===================== the chain =====================
await page.locator('.cm-page-tab', { hasText: 'Logistics' }).click(); await page.waitForTimeout(300)
const labels = (await page.locator('.modal .dates-block .drow-label').allTextContents()).map((s) => s.trim())
const at = (re) => labels.findIndex((l) => re.test(l))
const SHOOT = at(/shoot/i), CUT = at(/edit ready/i), ART = at(/design ready/i), OUT = at(/release/i)
ok('the piece shows the dates it actually has', SHOOT >= 0 && CUT >= 0 && OUT >= 0, labels.join(' | '))

const vals = async () => Promise.all((await page.locator('.modal .dates-block input[type="date"]').all()).map((i) => i.inputValue()))
const setDate = async (i, v) => { await (await page.locator('.modal .dates-block input[type="date"]').all())[i].fill(v); await page.waitForTimeout(450) }

await setDate(SHOOT, d(5))
const a = await vals()
ok('a shoot pushed past the cut takes the cut with it', a[CUT] > a[SHOOT], `shoot=${a[SHOOT]} cut=${a[CUT]}`)
ok('…keeping the gap the plan had', a[CUT] === d(7), `${a[CUT]} vs ${d(7)}`)
// The whole plan shifts by the days the shoot shifted. Measuring every gap
// from the shoot instead of from the link before it stacks them, and throws
// the release a fortnight out on a four-day slip.
ok('…and the release shifts by the same days, not by the sum of them', a[OUT] === d(10), `${a[OUT]} vs ${d(10)}`)
if (ART >= 0) ok('…while a date on another chain stays where it was', a[ART] === d(4), `${a[ART]} vs ${d(4)}`)
ok('the sheet says what it moved', await page.locator('.toast').filter({ hasText: /moved with it/i }).count() > 0)

await setDate(SHOOT, d(2))
const back = await vals()
ok('pulling the shoot earlier drags nobody towards it', back[CUT] === a[CUT] && back[OUT] === a[OUT],
  `cut=${back[CUT]} out=${back[OUT]}`)

// The other chain reaches the same day by another road: drawn, then out.
if (ART >= 0) {
  const was = await vals()
  await setDate(ART, d(20))
  const c = await vals()
  ok('a designed piece pushes its own release', c[OUT] > c[ART] && c[OUT] !== was[OUT], `art=${c[ART]} out=${c[OUT]} was=${was[OUT]}`)
  ok('…without touching the filming chain', c[SHOOT] === was[SHOOT] && c[CUT] === was[CUT], `shoot=${c[SHOOT]} cut=${c[CUT]}`)
}

// ===================== the guard =====================
// Moving between views must never ask — the views are one form.
await page.locator('.cm-page-tab', { hasText: 'Brief' }).click(); await page.waitForTimeout(250)
ok('changing view does not interrogate you', await page.locator('.cm-leave').count() === 0)

// A sheet with unsaved words asks before it closes.
const desc = page.locator('.modal textarea').first()
if (await desc.count()) {
  await desc.fill('a sentence nobody saved'); await page.waitForTimeout(250)
  await page.keyboard.press('Escape'); await page.waitForTimeout(350)
  const asked = await page.locator('.cm-leave').count()
  ok('a sheet holding unsaved words asks before closing', asked === 1)
  ok('…and offers the way back in', await page.locator('.cm-leave').getByText(/keep editing/i).count() > 0)
  await page.locator('.cm-leave').getByText(/keep editing/i).click(); await page.waitForTimeout(300)
  ok('…"keep editing" keeps the sheet', await page.locator('.modal').count() === 1)
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  await page.locator('.cm-leave').getByText(/discard/i).click(); await page.waitForTimeout(400)
  ok('…"discard them" lets go', await page.locator('.modal').count() === 0)
}

// A sheet nobody touched closes on the first Escape, like it always did.
await openPiece()
await page.keyboard.press('Escape'); await page.waitForTimeout(350)
ok('a sheet nobody edited still closes on Escape',
  await page.locator('.modal').count() === 0 && await page.locator('.cm-leave').count() === 0)

// ===================== a seat with a stranger in it =====================
// The people directory is scoped: a member sees their own channels' people,
// every admin and all the crew. But a PIECE is scoped by channel, so a member
// could open a task, be told somebody is editing it, and get a chip with an
// ellipsis in it — the row named an id the directory would not resolve. The
// seat rendered as though nobody held it, which is the board lying about its
// own contents rather than protecting anything: the piece had already said
// there was a person there.
const far = (await req('/users', 'POST', {
  name: 'Stranger From Telegram', username: `r87far${stamp}`, password: 'f1234',
  departments: ['telegram_uzb'], permissions: { manage_content: true },
})).data
const near = (await req('/users', 'POST', {
  name: 'Near Colleague', username: `r87near${stamp}`, password: 'n1234',
  departments: ['instagram_main'], permissions: { manage_content: true },
})).data
const shared = (await req('/content', 'POST', {
  title: `r87 held by a stranger ${stamp}`, type: 'video', channels: ['instagram_main'],
  editor_id: far.id, release_date: d(3),
})).data
const NT = await login(`r87near${stamp}`, 'n1234')
const seen = (await req('/users', 'GET', null, NT)).data
ok('the piece is on her channel, so she can open it',
  ((await req('/content', 'GET', null, NT)).data || []).some?.((x) => x.id === shared.id))
ok('…and she can read the name of whoever is editing it',
  Array.isArray(seen) && seen.some((u) => u.id === far.id), (seen || []).map?.((u) => u.username).join(','))

// It is a seat that lets her read the name, not a directory thrown open: a
// stranger on nothing she can see stays out of her list.
const hidden = (await req('/users', 'POST', {
  name: 'Stranger On Nothing', username: `r87hid${stamp}`, password: 'h1234',
  departments: ['telegram_uzb'],
})).data
const seen2 = (await req('/users', 'GET', null, NT)).data
ok('…while somebody on nothing of hers stays out of her list',
  !seen2.some((u) => u.id === hidden.id), seen2.map((u) => u.username).join(','))

await browser.close()
await req(`/content/${piece.id}`, 'DELETE')
await req(`/content/${shared.id}`, 'DELETE')
await req(`/users/${far.id}`, 'DELETE')
await req(`/users/${near.id}`, 'DELETE')
await req(`/users/${hidden.id}`, 'DELETE')
console.log(fails === 0 ? '\nRound-87 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
