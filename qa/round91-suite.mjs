// Round 91: less on screen, and a "no" somebody can act on.
//
//   the no        A refusal was a reason and nothing else, which leaves the
//                 planner exactly where they were: a day nobody can do. Three
//                 steps now — what is in the way, a day you COULD do, or hand
//                 it back entirely, which empties the seat and puts the piece
//                 back in the pool for somebody else.
//   the sheet     Type and stage are one dropdown each instead of two chip
//                 walls, and a view nobody has been in is behind one control.
//   the counts    Dots, not sentences. Zero is not drawn.
//   the sidebar   Folded to start with, and you can pin what you actually use.
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
const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
const shootId = (await req('/statuses')).data.find((s) => /to shoot/i.test(s.label)).id
const op = (await req('/users', 'POST', { name: 'R91 Operator', username: `r91op${stamp}`, password: 'o1234', role: 'operator' })).data
const O = await login(`r91op${stamp}`, 'o1234')
let slot = 8
const booked = async (title) => (await req('/content', 'POST', {
  title, type: 'video', channels: ['instagram_main'], status_id: shootId, operator_id: op.id,
  recording_date: d(0), recording_time: `${String(slot += 2).padStart(2, '0')}:00`, recording_end: `${String(slot + 1).padStart(2, '0')}:00`,
  edit_ready_date: d(6), release_date: d(8),
  script: 'Open on the courtyard, then the interview at the entrance.',
  reference_links: ['https://example.com/ref'],
})).data

// ===================== the three-step no =====================
let t = await booked(`r91 a reason ${stamp}`)
ok('a no with nothing behind it is refused',
  (await req(`/content/${t.id}/confirm`, 'POST', { which: 'shoot', ok: false }, O)).status === 400)
ok('a no carrying a day they CAN do is taken',
  (await req(`/content/${t.id}/confirm`, 'POST', { which: 'shoot', ok: false, note: 'Exam that morning', alt: d(3) }, O)).status === 200)
let row = (await req(`/content/${t.id}`)).data
ok('…and the reason and the offer are both on the piece',
  row.shoot_ack === 'no' && /Exam/.test(row.shoot_ack_note || '') && row.shoot_alt === d(3),
  `${row.shoot_ack} · ${row.shoot_ack_note} · ${row.shoot_alt}`)
ok('…while the seat stays theirs, because it is a date problem', row.operator_id === op.id)
ok('a day that is not a day is refused',
  (await req(`/content/${t.id}/confirm`, 'POST', { which: 'shoot', ok: false, note: 'x', alt: 'next tuesday' }, O)).status === 400)

t = await booked(`r91 hand back ${stamp}`)
ok('offering a day AND handing it back is refused — they are different answers',
  (await req(`/content/${t.id}/confirm`, 'POST', { which: 'shoot', ok: false, note: 'no', alt: d(3), release: true }, O)).status === 400)
ok('handing it back is taken',
  (await req(`/content/${t.id}/confirm`, 'POST', { which: 'shoot', ok: false, note: 'I have left the team', release: true }, O)).status === 200)
row = (await req(`/content/${t.id}`)).data
ok('…the seat empties and the piece waits for somebody else', row.operator_id === null, String(row.operator_id))
ok('…carrying no trace of the refusal, so the next person is asked fresh',
  !row.shoot_ack && !row.shoot_ack_note && !row.shoot_alt,
  `${row.shoot_ack} · ${row.shoot_ack_note} · ${row.shoot_alt}`)
ok('…and only the person holding it may answer at all',
  (await req(`/content/${t.id}/confirm`, 'POST', { which: 'shoot', ok: false, note: 'x' }, await login('jas', 'j1234'))).status >= 400)

// ===================== the screens =====================
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const signIn = async (u, p) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
  await page.goto(BASE + '/login')
  await page.fill('input[name="username"]', u); await page.fill('input[name="password"]', p)
  await page.click('button[type="submit"]'); await page.waitForTimeout(2300)
  return { ctx, page }
}

// ---- the operator answering ----
const live = await booked(`r91 on screen ${stamp}`)
const { ctx: oc, page: op1 } = await signIn(`r91op${stamp}`, 'o1234')
await op1.goto(BASE + '/brief'); await op1.waitForTimeout(1700)
await op1.locator('.tcard, .ov-row, .cb-row', { hasText: `r91 on screen ${stamp}` }).first().click()
await op1.waitForSelector('.modal', { timeout: 8000 }); await op1.waitForTimeout(500)
{ const more = op1.locator('.cm-page-more'); if (await more.count()) { await more.first().click(); await op1.waitForTimeout(250) } }
{ const tab = op1.locator('.cm-page-tab', { hasText: 'Logistics' }); if (await tab.count()) { await tab.first().click(); await op1.waitForTimeout(300) } }
ok('the operator is asked about the day they were booked for', (await op1.locator('.bk').count()) >= 1)
await op1.locator('.bk button', { hasText: 'I can’t' }).first().click(); await op1.waitForTimeout(400)
ok('…saying no asks what is in the way', (await op1.locator('.bk-form textarea').count()) === 1)
ok('…offers a day they could do instead', (await op1.locator('.bk-alt-ask input[type="date"]').count()) === 1)
ok('…and a way to hand it back entirely', (await op1.locator('.bk-hand input').count()) === 1)
ok('…and sends nothing until there is a reason', await op1.locator('.bk-actions .btn-danger').isDisabled())
await op1.locator('.bk-form textarea').fill('Double-booked that morning')
await op1.locator('.bk-hand input').check(); await op1.waitForTimeout(300)
ok('…and choosing to hand it back closes the day box, because it is a different answer',
  await op1.locator('.bk-alt-ask input[type="date"]').isDisabled())
await op1.locator('.bk-actions .btn-danger').click(); await op1.waitForTimeout(1500)
ok('…which really empties the seat', (await req(`/content/${live.id}`)).data.operator_id === null)
await oc.close()

// ---- the sheet, the dots and the sidebar ----
const bare = (await req('/content', 'POST', { title: `r91 bare ${stamp}`, type: 'post', channels: ['instagram_main'] })).data
const { ctx: ac, page } = await signIn('admin', 'admin123')
const openHubs = (await page.locator('.nav-hub.open .nav-hub-head').allTextContents()).map((s) => s.trim())
ok('the sidebar starts folded but for the work', openHubs.length === 1 && /Work/.test(openHubs[0]), JSON.stringify(openHubs))
await page.locator('.side-edit-btn', { hasText: 'Personalize' }).click(); await page.waitForTimeout(400)
await page.locator('.side-edit-row', { hasText: 'Statistics' }).locator('.side-pin').click(); await page.waitForTimeout(300)
await page.locator('.side-edit-btn', { hasText: 'Done' }).click(); await page.waitForTimeout(400)
ok('…and what you pin sits at the top, out of its hub', (await page.locator('.nav-pins .nav-item').count()) === 1)

await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.tcard', { timeout: 12000 }); await page.waitForTimeout(700)
await page.locator('.tcard', { hasText: `r91 bare ${stamp}` }).first().click()
await page.waitForSelector('.modal', { timeout: 8000 }); await page.waitForTimeout(600)
const tabs = (await page.locator('.cm-page-tab').allTextContents()).map((s) => s.trim())
ok('a piece nobody has worked on shows only the Brief', tabs.length <= 1, JSON.stringify(tabs))
ok('…with one way into the rest', (await page.locator('.cm-page-more').count()) === 1)
await page.locator('.cm-page-more').click(); await page.waitForTimeout(400)
ok('…which opens them', (await page.locator('.cm-page-tab').count()) >= 3)
ok('type is one control, not a wall of chips', (await page.locator('.modal select.cm-pick').count()) >= 1)
ok('…and so is the stage', (await page.locator('.modal .cm-stage-pick select').count()) === 1)
ok('the chip walls are gone',
  (await page.locator('.modal .tchip').count()) === 0 && (await page.locator('.modal .stage-chip').count()) === 0)
await browser.close()

await req(`/content/${bare.id}`, 'DELETE')
await req(`/users/${op.id}`, 'DELETE')
console.log(fails === 0 ? '\nRound-91 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
