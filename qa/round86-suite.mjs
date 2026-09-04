// Round 86: what the board is used for, and three walls that had no door.
//
//   usage          minutes on the platform and buttons pressed, per person
//                  per DAY — and a panel only whoever runs the board can read
//   the link wall  a one-tap finish refused for the missing published link
//                  OPENS the task on that box instead of stopping at an alert
//   the over-ask   a form sends every box it holds; sending an untouched
//                  number you may not write used to get the whole save refused
//   the picker     it closes when you pick somebody (it sat in a <label>, and
//                  the browser forwards a click inside a label to its control)
//   the clutter    a filter with nothing behind it is not offered to the
//                  people who cannot act on it; the admin still sees the zero
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
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())

// ---- pre-clean + fixtures --------------------------------------------------
for (const c of (await req('/content')).data.filter((c) => /r86:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
for (const u of (await req('/users')).data.filter((u) => ['r86hand', 'r86op'].includes(u.username)))
  await req(`/users/${u.id}`, 'DELETE')
const hand = (await req('/users', 'POST', {
  name: 'Rita Eightysix', username: 'r86hand', password: 'r1234', role: 'member',
  departments: ['instagram_main'], permissions: { manage_content: true, review_publish: true },
})).data
const oper = (await req('/users', 'POST', {
  name: 'Olim Eightysix', username: 'r86op', password: 'r1234', role: 'crew', crew_roles: ['operator', 'editor'],
})).data
ok('fixtures in place', !!hand.id && !!oper.id)
const HT = await login('r86hand', 'r1234')

// ===================== 1) the usage heartbeat =====================
ok('a beat is accepted', (await req('/usage/beat', 'POST', { seconds: 60, taps: { 'r86 Publish': 3 }, pages: { '/r86': 2 } }, HT)).status === 200)
ok('a second beat adds to the same day', (await req('/usage/beat', 'POST', { seconds: 45, taps: { 'r86 Publish': 2 } }, HT)).status === 200)
// The board is not a stopwatch that can be wound by hand: one beat covers a
// minute, and a claim of eleven hours is worth three minutes.
ok('a wild claim is clamped', (await req('/usage/beat', 'POST', { seconds: 40000 }, HT)).status === 200)
const panel = (await req(`/usage?from=${day}&to=${day}`)).data
const mine = (panel.rows || []).find((r) => r.id === hand.id)
ok('the panel counts the minutes', mine && mine.seconds === 60 + 45 + 180, mine && String(mine.seconds))
ok('…and the presses', mine && mine.taps === 5, mine && String(mine.taps))
// Exactly five: the counts left behind by an earlier run of this suite went
// out with the account they belonged to.
ok('the busiest button is named', (panel.buttons || []).some((b) => b.action === 'r86 Publish' && b.n === 5),
  JSON.stringify((panel.buttons || []).slice(0, 3)))
ok('a screen is counted apart from a button', (panel.pages || []).some((p) => p.action === '/r86' && p.n === 2))
ok('somebody who never opened it is still listed, at zero',
  (panel.rows || []).some((r) => r.id === oper.id && r.seconds === 0))
ok('a member cannot read the panel', (await req(`/usage?from=${day}&to=${day}`, 'GET', null, HT)).status === 403)
// Nothing here reconstructs a sitting: the row carries totals and the last
// minute of the day, and no path, title or word anybody typed.
ok('the row says how much, not what',
  mine && !('page' in mine) && !('title' in mine) && Object.keys(mine).sort().join(',')
    === 'avatar,color,days,id,last_at,name,role,seconds,taps', mine && Object.keys(mine).sort().join(','))

// ===================== 2) the form stops over-asking =====================
// A piece at Ready that Rita may edit but was never handed. Saving it sends
// every box the sheet holds — including `views`, which only an admin or the
// person it is FOR may write. An untouched number is not a change.
const statuses = (await req('/statuses')).data
const ready = statuses.find((s) => /^ready$/i.test(s.label))
const fin = statuses.find((s) => s.is_final)
const piece = (await req('/content', 'POST', {
  title: 'r86: waiting at ready', channels: ['instagram_main'], type: 'reel', status_id: ready.id,
  operator_id: oper.id, editor_id: oper.id, recording_date: day, release_date: day,
})).data
ok('an untouched views box no longer refuses the save',
  (await req(`/content/${piece.id}`, 'PATCH', { views: null, script: 'r86 script' }, HT)).status === 200)
ok('…nor an untouched skip rate',
  (await req(`/content/${piece.id}`, 'PATCH', { skip_rate: null, tz: 'r86 tz' }, HT)).status === 200)
// The permission itself is untouched: writing a DIFFERENT number is still
// somebody else's business.
ok('actually writing a number she may not is still refused',
  (await req(`/content/${piece.id}`, 'PATCH', { views: 1234 }, HT)).status === 403)
// The rule is general, not a patch on two boxes: every gated field takes it.
// Olim films this piece and holds no other rights — sending back the boxes
// exactly as they are must not stand between him and his own delivery link.
const OT = await login('r86op', 'r1234')
const asStored = (row) => ({
  reference_text: row.reference_text || '', script: row.script || '', tz: row.tz || '',
  post_link: row.post_link || '', face_id: row.face_id ?? null,
  ready_link: row.ready_link || '', design_link: row.design_link || '',
  views: row.views ?? null, skip_rate: row.skip_rate ?? null,
})
const held = (await req('/content')).data.find((c) => c.id === piece.id)
const echo = await req(`/content/${piece.id}`, 'PATCH',
  { ...asStored(held), shot_link: 'https://drive.google.com/file/d/r86raw/view' }, OT)
ok('the boxes he never touched do not block his own delivery link',
  echo.status === 200, `${echo.status} ${echo.data.error || ''}`)
ok('…and the link landed', /r86raw/.test((await req('/content')).data.find((c) => c.id === piece.id).shot_link || ''))
// Each of them, one at a time, still refuses a real change.
for (const [field, value] of [['reference_text', 'a different mood'], ['script', 'different words'], ['post_link', 'https://example.com/other']]) {
  const r = await req(`/content/${piece.id}`, 'PATCH', { [field]: value }, OT)
  ok(`changing ${field} is still his to be refused`, r.status === 403, `${r.status} ${r.data.error || ''}`)
}

// ===================== 3) the published-link wall =====================
ok('publishing with no link is refused, and says which box',
  (await req(`/content/${piece.id}`, 'PATCH', { status_id: fin.id }, HT)).data.needs === 'post_link')

// ===================== the browser =====================
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })
await page.waitForTimeout(500)

// ---- 4) the picker closes when you pick somebody --------------------------
// It sat inside a <label>, and a click on anything inside a label is forwarded
// by the browser to that label's control — the picker's own button — which
// reopened the list the instant a name was chosen. The second seat then got
// the first seat's still-open popup.
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.tcard', { timeout: 12000 })
await page.waitForTimeout(600)
await page.locator('.tcard', { hasText: 'r86: waiting at ready' }).first().click()
await page.waitForSelector('.modal .crew-field', { timeout: 8000 })
const seat = (i) => page.locator('.modal .crew-field .pp-field').nth(i)
await seat(0).click()
await page.waitForSelector('.pp-pop', { timeout: 8000 })
await page.fill('.pp-pop .pp-search .input', 'Olim')
await page.waitForTimeout(200)
await page.locator('.pp-pop .pp-row', { hasText: 'Olim' }).first().click()
await page.waitForTimeout(350)
ok('the picker closes when a name is chosen', (await page.locator('.pp-pop').count()) === 0)
await seat(1).click()
await page.waitForSelector('.pp-pop', { timeout: 8000 })
ok('…so the next seat opens its own list, alone', (await page.locator('.pp-pop').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
// The face is not a hat: two seats, whoever else is named on the piece.
ok('the face box is not counted as a third crew seat', (await page.locator('.modal .crew-field').count()) === 2)
ok('…and it is there under its own name', (await page.locator('.modal .face-field').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// ---- 5) the tick that cannot be answered opens the task -------------------
await page.locator('.tcard', { hasText: 'r86: waiting at ready' }).first().click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
await page.locator('.ctx-item', { hasText: 'Mark as done' }).click()
await page.waitForTimeout(900)
ok('a refused finish opens the task on the link box',
  (await page.locator('.modal [data-field="post_link"] input').count()) === 1
  && !(await req('/content')).data.find((c) => c.id === piece.id).done_at)
await page.fill('.modal [data-field="post_link"] input', 'https://instagram.com/p/r86')
await page.locator('.modal').getByRole('button', { name: 'Save changes' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(500)
await page.locator('.tcard', { hasText: 'r86: waiting at ready' }).first().click({ button: 'right' })
await page.waitForSelector('.ctx-menu', { timeout: 5000 })
await page.locator('.ctx-item', { hasText: 'Mark as done' }).click()
await page.waitForTimeout(900)
ok('with the link pasted, one tap finishes it',
  !!(await req('/content')).data.find((c) => c.id === piece.id).done_at)

// ---- 6) the board's person filter narrows instead of jumping --------------
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.cf-bar', { timeout: 10000 })
await page.waitForTimeout(500)
await page.locator('.cf-bar .cf-person .pp-field').click()
await page.waitForSelector('.pp-pop', { timeout: 8000 })
const before = await page.locator('.pp-pop .pp-row').count()
await page.fill('.pp-pop .pp-search .input', 'Olim')
await page.waitForTimeout(250)
const after = await page.locator('.pp-pop .pp-row').count()
ok('typing a name shortens the list rather than jumping', after >= 1 && after < before, `${before} → ${after}`)
await page.locator('.pp-pop .pp-row', { hasText: 'Olim' }).first().click()
await page.waitForTimeout(700)
ok('and the board is filtered to that person',
  (await page.locator('.cf-bar .cf-person .pp-field').textContent()).includes('Olim'))
await page.keyboard.press('Escape')

// ---- 7) the Usage tab ------------------------------------------------------
await page.goto(BASE + '/admin')
await page.waitForTimeout(1200)
await page.locator('.tab', { hasText: 'Usage' }).click()
await page.waitForTimeout(1400)
ok('the Usage tab lists a row per person', (await page.locator('.usage-tbl tbody tr').count()) >= 3)
const rita = page.locator('.usage-tbl tbody tr', { hasText: 'Rita Eightysix' })
ok('it spells the time in minutes, not seconds', /\d+m/.test(await rita.textContent()), await rita.textContent())
await rita.click()
await page.waitForTimeout(500)
ok('one click narrows to what that person presses',
  (await page.locator('.usage-buttons').textContent()).includes('r86 Publish'))
await page.screenshot({ path: 'r86-usage.png', fullPage: true })

// ---- 8) an empty filter is not offered to somebody who cannot act on it ----
// The admin keeps the zero: an empty shelf is a fact about the team's
// paperwork, and a fact has to be visible to be noticed.
await page.goto(BASE + '/docs')
await page.waitForSelector('.docs-filters', { timeout: 10000 })
await page.waitForTimeout(500)
const adminKinds = await page.locator('.docs-filters .pill-group .pill').allTextContents()
ok('the admin sees every shelf, including the empty ones',
  adminKinds.some((k) => /· 0$/.test(k)), adminKinds.join(' | '))
const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 950 } })
const p2 = await ctx2.newPage()
await p2.goto(BASE + '/login')
await p2.fill('input[name="username"]', 'r86hand')
await p2.fill('input[name="password"]', 'r1234')
await p2.click('button[type="submit"]')
await p2.waitForURL(/brief/, { timeout: 15000 })
await p2.goto(BASE + '/docs')
await p2.waitForSelector('.docs-filters', { timeout: 10000 })
await p2.waitForTimeout(600)
const herKinds = await p2.locator('.docs-filters .pill-group .pill').allTextContents()
// "All" is the anchor and always stays — it is how she sees she has no
// paperwork at all. The empty SHELVES are what goes.
ok('she is not offered a shelf with nothing on it',
  herKinds.filter((k) => !/^All/.test(k)).every((k) => !/· 0$/.test(k)), herKinds.join(' | '))
await ctx2.close()

await browser.close()
// ---- cleanup ---------------------------------------------------------------
await req(`/content/${piece.id}`, 'DELETE')
await req(`/users/${hand.id}`, 'DELETE')
await req(`/users/${oper.id}`, 'DELETE')
console.log(fails === 0 ? '\nRound-86 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
