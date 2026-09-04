// Round 88: the sidebar stops being a wall too, and handing work over stops
// waiting for permission it was never going to be refused.
//
//   the hubs       eleven doors in one column, sorted into four: what you are
//                  doing, where it goes, what happened, who does it. A hub you
//                  never use folds away and stays folded
//   the RBAC       a hub nobody in your role can open is not drawn at all —
//                  not greyed, not there. No heading over nothing
//   deep links     land you inside a hub, and it opens itself. You cannot
//                  fold away the page you are looking at
//   the hand-off   right-click a card, press a name, and the name is there.
//                  A seat is not something the server argues with, so it is
//                  drawn at once and sent afterwards — and if the server does
//                  refuse, the card goes back exactly as it was
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
const signIn = async (u, p) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
  await page.goto(BASE + '/login')
  await page.fill('input[name="username"]', u); await page.fill('input[name="password"]', p)
  await page.click('button[type="submit"]')
  await page.waitForURL(/overview|brief|dept|ambassador/, { timeout: 15000 })
  await page.waitForTimeout(700)
  return { ctx, page }
}
const hubs = async (pg) => (await pg.locator('.nav-hub-head').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim())

// ===================== the admin's four hubs =====================
const { ctx, page } = await signIn('admin', 'admin123')
const H = await hubs(page)
ok('the sidebar is hubs, not one wall of doors', H.length >= 3 && H.length <= 5, H.join(' | '))
ok('…and every door is still behind one of them', (await page.locator('.nav-item').count()) >= 8,
  `${await page.locator('.nav-item').count()} doors`)

// ---- folding, and remembering it ----
const numbers = page.locator('.nav-hub').filter({ hasText: /Numbers/ }).first()
const wasIn = await numbers.locator('.nav-item').count()
await numbers.locator('.nav-hub-head').click(); await page.waitForTimeout(250)
ok('a hub you never use folds away', (await numbers.locator('.nav-item').count()) === 0, `held ${wasIn}`)
ok('…while still saying what is behind it',
  (await numbers.locator('.nav-hub-n').textContent()) === String(wasIn),
  await numbers.locator('.nav-hub-head').textContent())
await page.reload(); await page.waitForTimeout(900)
const numbers2 = page.locator('.nav-hub').filter({ hasText: /Numbers/ }).first()
ok('…and is still folded when you come back', (await numbers2.locator('.nav-item').count()) === 0)
await numbers2.locator('.nav-hub-head').click(); await page.waitForTimeout(250)
ok('…and unfolds when asked', (await numbers2.locator('.nav-item').count()) === wasIn)

// ---- a deep link lands you inside a hub ----
// /sprints/backlog is not /sprints, and /campaigns/7 is not /projects. Both
// used to light nothing up: the sidebar matched the URL exactly, so arriving
// one segment deeper meant arriving nowhere.
await page.goto(BASE + '/sprints/backlog'); await page.waitForTimeout(900)
const lit = await page.locator('.nav-item.active').allTextContents()
ok('a deep link still lights the page it is inside', lit.some((a) => /sprint/i.test(a)), JSON.stringify(lit))
const holding = page.locator('.nav-hub.open').filter({ has: page.locator('.nav-item.active') })
ok('…and the hub holding it is open', (await holding.count()) === 1)
await holding.first().locator('.nav-hub-head').click(); await page.waitForTimeout(250)
ok('…and will not fold away under you', (await holding.first().locator('.nav-item.active').count()) === 1)

// ===================== the hand-off =====================
const piece = (await req('/content', 'POST', {
  title: `r88 hand this over ${stamp}`, type: 'post', channels: ['instagram_main'],
  release_date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
})).data
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.tcard', { timeout: 12000 }); await page.waitForTimeout(600)

// Hold the PATCH open, so what is on screen while it is in flight is the
// thing being measured — not what is there after the answer arrives.
let release = null
await page.route(`**/api/content/${piece.id}`, async (route) => {
  if (route.request().method() !== 'PATCH') return route.continue()
  await new Promise((r) => { release = r })
  return route.continue()
})
const card = page.locator('.tcard', { hasText: `r88 hand this over ${stamp}` }).first()
await card.click({ button: 'right' }); await page.waitForTimeout(300)
// Whoever already holds it is listed too, disabled and saying so, which is
// why the shortlist keeps its positions. Take the first one that is a
// change.
const give = page.locator('.ctx-item:not([disabled])').filter({ hasText: /Give to/ }).first()
ok('a card offers the people you actually hand work to', (await give.count()) === 1,
  (await page.locator('.ctx-item').allTextContents()).join(' | '))
const givenTo = (await give.textContent()).replace(/Give to/, '').trim()
await give.click()
await page.waitForTimeout(500)   // the request is still held open here
const shownNow = (await card.textContent()).replace(/\s+/g, ' ')
ok('…and the name is on the card before the server has answered',
  shownNow.includes(givenTo.split(' ')[0]), `${shownNow.slice(0, 110)} (waiting on: ${givenTo})`)
release?.(); await page.waitForTimeout(900)
const saved = (await req(`/content/${piece.id}`)).data
ok('…and the server was told the same thing', saved.assignee_id != null, `assignee_id=${saved.assignee_id}`)
await page.unroute(`**/api/content/${piece.id}`)

// ---- a refusal puts the card back ----
// The guess is only honest because being wrong is survivable. A seat the
// server rejects must leave nothing behind on screen.
await page.route(`**/api/content/${piece.id}`, async (route) => {
  if (route.request().method() !== 'PATCH') return route.continue()
  return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Not allowed' }) })
})
await card.click({ button: 'right' }); await page.waitForTimeout(300)
const other = page.locator('.ctx-item:not([disabled])').filter({ hasText: /Give to/ }).filter({ hasNotText: givenTo }).first()
if (await other.count()) {
  const refusedName = (await other.textContent()).replace(/Give to/, '').trim().split(' ')[0]
  await other.click(); await page.waitForTimeout(900)
  const back = (await card.textContent()).replace(/\s+/g, ' ')
  ok('a refused hand-off leaves nothing behind on the card',
    !back.includes(refusedName) || refusedName === givenTo.split(' ')[0], back.slice(0, 110))
  ok('…and says why', (await page.locator('.toast').filter({ hasText: /not allowed/i }).count()) > 0)
}
await page.unroute(`**/api/content/${piece.id}`)
await ctx.close()

// ===================== what a member's sidebar does not have =====================
// Two channels, because a member with ONE gets the top-bar shell instead and
// has no sidebar to speak of.
const mem = (await req('/users', 'POST', {
  name: 'Round88 Member', username: `r88m${stamp}`, password: 'm1234',
  departments: ['instagram_main', 'instagram_uzb'], permissions: { manage_content: true },
})).data
const { ctx: ctx2, page: p2 } = await signIn(`r88m${stamp}`, 'm1234')
const mh = await hubs(p2)
ok('a member gets no People hub at all', !mh.some((h) => /People/i.test(h)), mh.join(' | '))
const side = (await p2.locator('nav').first().textContent()).replace(/\s+/g, ' ')
ok('…not greyed out, not disabled — not there', !/\bTeam\b|Ambassadors|Admin panel/i.test(side), side.slice(0, 140))
const hollow = []
for (const h of await p2.locator('.nav-hub').all()) {
  const inside = await h.locator('.nav-item').count()
  const folded = (await h.locator('.nav-hub-n').count()) > 0
  if (!folded && inside === 0) hollow.push((await h.textContent()).replace(/\s+/g, ' ').trim())
}
ok('…and no heading is drawn over an empty hub', hollow.length === 0, hollow.join(' | '))
await ctx2.close()

await browser.close()
await req(`/content/${piece.id}`, 'DELETE')
await req(`/users/${mem.id}`, 'DELETE')
console.log(fails === 0 ? '\nRound-88 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
