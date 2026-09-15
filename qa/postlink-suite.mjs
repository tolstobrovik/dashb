// Where a piece went live: anyone on the task may write it down, and one post
// lives on one task.
//
// Three defects this pins shut. (1) The published-link box was drawn only
// when the piece was already at Ready or out — pick Published in the stage
// dropdown and save, and the refusal named a box that was never on screen.
// (2) The box was disabled unless you held manage_content, while the server
// took review_publish too — an SMM who could make the move could not type the
// link. (3) Nothing stopped the same address landing on two tasks, which is
// two "published" rows for one reel: double views, double pay.
//
// Wants a seeded stack on 4090 (qa/seed.mjs).
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const API = BASE + '/api'
let fails = 0
const ok = (c, m, x) => { console.log((c ? '✔ ' : '✘ ') + m + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); if (!c) fails++ }
const login = async (u, p) => (await (await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const call = async (p, tok, m = 'GET', b) => {
  const r = await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const req = async (p, m = 'GET', b) => (await call(p, T, m, b)).data

// ---- people --------------------------------------------------------------
const ch = 'instagram_main'
const mkUser = async (b) => {
  const made = await req('/users', 'POST', b)
  if (made?.id) return made
  const found = ((await req('/users')) || []).find((u) => u.username === b.username)
  return found ? await req(`/users/${found.id}`, 'PATCH', { role: b.role, crew_roles: b.crew_roles, departments: b.departments, permissions: b.permissions }) : {}
}
// Can move, cannot edit, cannot publish: the person who used to meet the wall with no pen.
const plain = await mkUser({ name: 'Polina Plain', username: 'pl_plain', password: 'p1234', role: 'member', departments: [ch], permissions: { manage_content: false, review_publish: false, move_tasks: true } })
// The SMM: may publish, may not edit. The server took their link; the box did not.
const smm = await mkUser({ name: 'Sitora Smm', username: 'pl_smm', password: 's1234', role: 'member', departments: [ch], permissions: { manage_content: false, review_publish: true, move_tasks: false } })
// Crew, no rights at all — the one who actually uploaded it.
const editor = await mkUser({ name: 'Eldor Editor', username: 'pl_editor', password: 'e1234', role: 'editor', crew_roles: ['editor'] })
const operator = await mkUser({ name: 'Otabek Operator', username: 'pl_operator', password: 'o1234', role: 'operator', crew_roles: ['operator'] })
// Not on this channel at all.
const outsider = await mkUser({ name: 'Oybek Outsider', username: 'pl_out', password: 'x1234', role: 'member', departments: ['youtube'], permissions: {} })
ok(!!(plain.id && smm.id && editor.id && operator.id && outsider.id), 'five accounts: mover, SMM, editor, operator, outsider')
const PLAIN = await login('pl_plain', 'p1234'), SMM = await login('pl_smm', 's1234')
const EDITOR = await login('pl_editor', 'e1234'), OPER = await login('pl_operator', 'o1234'), OUT = await login('pl_out', 'x1234')

const statuses = await req('/statuses')
const S = (re) => statuses.find((s) => re.test(s.label))
const editing = S(/editing/i), ready = S(/^ready$/i), published = statuses.find((s) => s.is_final)
// Stories carry no crew gate (operator/editor want reels and videos, the
// designer wants posts), so the only wall between them and Published is the link.
const stamp = Date.now()
const mk = (b) => req('/content', 'POST', { channels: [ch], type: 'story', ...b })
const L = (n) => `https://www.instagram.com/p/PL${stamp}${n}/`

// ---- the pen is everyone's -----------------------------------------------
{
  const t = await mk({ title: `pl pen ${stamp}`, status_id: editing.id, editor_id: editor.id, operator_id: operator.id })
  for (const [who, tok, n] of [['a mover with no edit right', PLAIN, 'a'], ['the SMM who may only publish', SMM, 'b'], ['the editor, who holds no right', EDITOR, 'c'], ['the operator', OPER, 'd']]) {
    const r = await call(`/content/${t.id}`, tok, 'PATCH', { post_link: L(n) })
    ok(r.status === 200 && r.data.post_link === L(n), `${who} writes where it went`, r.status === 200 ? undefined : r.data?.error)
  }
  const r = await call(`/content/${t.id}`, OUT, 'PATCH', { post_link: L('z') })
  ok(r.status === 403, 'somebody not on the channel still cannot', r.status)
  const bad = await call(`/content/${t.id}`, PLAIN, 'PATCH', { post_link: 'just words' })
  ok(bad.status === 400 && bad.data.needs === 'post_link', 'a non-link is refused and names the box', bad.data)
  await req(`/content/${t.id}`, 'PATCH', { post_link: '' })
}

// ---- one post, one task ----------------------------------------------------
// (POST /content does not read post_link — the address is a fact recorded
// after the piece exists — so it is written with a second call.)
const first = await req(`/content/${(await mk({ title: `pl first ${stamp}`, status_id: editing.id })).id}`, 'PATCH', { post_link: L('u') })
ok(first.post_link === L('u'), 'the first task takes the address')
const second = await mk({ title: `pl second ${stamp}`, status_id: editing.id })
{
  const r = await call(`/content/${second.id}`, PLAIN, 'PATCH', { post_link: L('u') })
  ok(r.status === 400, 'the same address on a second task is refused', r.status)
  ok(r.data.needs === 'post_link', '…and the refusal names the box')
  ok(r.data.twin?.id === first.id, '…and the task that has it', r.data.twin)
  ok(new RegExp(first.title).test(r.data.error || ''), '…by name, in the sentence', r.data.error)
}
// The same page, written five ways.
const base = L('u') // https://www.instagram.com/p/PL…u/
const variants = {
  'without www.': base.replace('www.', ''),
  'without the trailing slash': base.replace(/\/$/, ''),
  'in capitals': base.toUpperCase().replace('HTTPS://WWW.INSTAGRAM.COM', 'https://WWW.Instagram.com'),
  'with a #fragment': base + '#comments',
  'without a scheme': base.replace('https://', ''),
}
for (const [how, v] of Object.entries(variants)) {
  const r = await call(`/content/${second.id}`, PLAIN, 'PATCH', { post_link: v })
  ok(r.status === 400 && r.data.twin?.id === first.id, `the same page ${how} is still the same post`, r.status === 400 ? undefined : v)
}
{
  const r = await call(`/content/${second.id}`, PLAIN, 'PATCH', { post_link: 'https://youtube.com/watch?v=' + stamp })
  const r2 = await call(`/content/${first.id}`, T, 'PATCH', { post_link: 'https://youtube.com/watch?v=' + stamp + 'x' })
  ok(r.status === 200 && r2.status === 200, 'but a different query string is a different address (youtube ?v=)', [r.status, r2.status])
  await req(`/content/${first.id}`, 'PATCH', { post_link: L('u') })
  await req(`/content/${second.id}`, 'PATCH', { post_link: '' })
}
{
  const r = await call(`/content/${first.id}`, T, 'PATCH', { post_link: L('u') })
  ok(r.status === 200, 'a task re-saving its own address is not its own twin', r.status)
  const cleared = await call(`/content/${first.id}`, T, 'PATCH', { post_link: '' })
  ok(cleared.status === 200 && cleared.data.post_link === null, 'clearing it works')
  const r3 = await call(`/content/${second.id}`, PLAIN, 'PATCH', { post_link: L('u') })
  ok(r3.status === 200, '…and frees the address for another task', r3.status)
  await req(`/content/${second.id}`, 'PATCH', { post_link: '' })
  await req(`/content/${first.id}`, 'PATCH', { post_link: L('u') })
}

// ---- the wall, and the pen in the same hand -------------------------------
{
  // Reaching Published is the reviewer's move (review_publish), so the wall
  // is met by the SMM; a mover without that right is stopped earlier, by a
  // different sentence, and rightly.
  const t = await mk({ title: `pl wall ${stamp}`, status_id: editing.id })
  const stopped = await call(`/content/${t.id}`, PLAIN, 'PATCH', { status_id: published.id })
  ok(stopped.status === 403 && /reviewer/i.test(stopped.data.error || ''), 'a mover without review_publish is told it is the reviewer’s move', stopped.data?.error)
  const r = await call(`/content/${t.id}`, SMM, 'PATCH', { status_id: published.id })
  ok(r.status === 400 && r.data.needs === 'post_link', 'Published without a link is still a wall', r.data)
  const dup = await call(`/content/${t.id}`, SMM, 'PATCH', { status_id: published.id, post_link: L('u') })
  ok(dup.status === 400 && dup.data.twin?.id === first.id, 'moving with somebody else’s address is refused before the move', dup.data?.error)
  const own = await call(`/content/${t.id}`, SMM, 'PATCH', { status_id: published.id, post_link: L('w') })
  ok(own.status === 200 && own.data.status_id === published.id, 'link and move in one breath goes through', own.status === 200 ? undefined : own.data?.error)
  const still = await req(`/content/${t.id}`)
  ok(still.post_link === L('w') && still.status_id === published.id, 'and both landed')
  // The one-tap finish carries the same rule.
  const t2 = await mk({ title: `pl done ${stamp}`, status_id: editing.id })
  const d = await call(`/content/${t2.id}`, PLAIN, 'PATCH', { done: true, post_link: L('u') })
  ok(d.status === 400 && d.data.twin?.id === first.id, '"done" with a used address is refused too', d.data?.error)
}

// ---- the sheet -----------------------------------------------------------
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const open = async (u, p, taskId, viewport = { width: 1500, height: 1000 }) => {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
  await page.goto(BASE + '/login')
  await page.fill('input[name="username"]', u); await page.fill('input[name="password"]', p)
  await page.click('button[type="submit"]')
  await page.waitForURL((x) => !/\/login/.test(x.pathname), { timeout: 20000 })
  await page.goto(`${BASE}/brief?task=${taskId}`)
  await page.waitForSelector('.modal', { timeout: 20000 })
  await page.waitForTimeout(900)
  return { ctx, page }
}
const field = (page) => page.locator('.modal [data-field="post_link"]').first()
const saveBtn = (page) => page.locator('.modal button.btn-primary').filter({ hasText: /save/i }).first()

// A channel manager, from Editing: picks Published, sees the box BEFORE
// saving — and sees it, not merely has it in the DOM behind the fold.
{
  const t = await mk({ title: `pl sheet ${stamp}`, status_id: editing.id })
  const { ctx, page } = await open('jas', 'j1234', t.id)
  ok(await field(page).count() === 0, 'at Editing the box is not drawn yet')
  await page.selectOption('select[data-pick="stage"]', String(published.id))
  await page.waitForTimeout(700)
  ok(await field(page).count() === 1, 'picking Published in the dropdown draws it before any save')
  const seen = await field(page).boundingBox()
  ok(!!seen && seen.height > 0, '…in view, not folded behind the details button', seen && Math.round(seen.height))
  ok(await field(page).locator('input').isDisabled() === false, '…and it is typeable')
  await saveBtn(page).click()
  await page.waitForTimeout(1200)
  ok(await page.locator('.modal').count() === 1, 'saving with it empty keeps the sheet open')
  ok((await field(page).locator('input').getAttribute('class') || '').includes('field-bad'), '…and lands on the box')
  ok(/Paste the link/i.test(await page.locator('.modal').textContent()), '…with the sentence', (await page.locator('.modal').textContent()).match(/Paste[^.]*/)?.[0])
  await field(page).locator('input').fill(L('s'))
  await saveBtn(page).click()
  await page.waitForTimeout(1500)
  const after = await req(`/content/${t.id}`)
  ok(after.status_id === published.id && after.post_link === L('s'), 'paste, save: published with its address', [after.status_id, after.post_link])
  await ctx.close()
}
// The same, on a phone: the box is on a page that was not showing.
{
  const t = await mk({ title: `pl phone ${stamp}`, status_id: editing.id })
  const { ctx, page } = await open('jas', 'j1234', t.id, { width: 390, height: 844 })
  const strip = page.locator('.modal .cm-pages, .modal .cm-strip').first()
  await page.selectOption('select[data-pick="stage"]', String(published.id)).catch(() => {})
  await saveBtn(page).click().catch(async () => { await page.locator('.modal button').filter({ hasText: /save/i }).first().click() })
  await page.waitForTimeout(1400)
  const box = await field(page).boundingBox()
  ok(!!box && box.height > 0, 'on a phone the refusal turns to the page the box is on', box)
  await ctx.close()
}
// The SMM at Ready: the box is drawn and — the old bug — no longer disabled.
{
  const t = await mk({ title: `pl smm ${stamp}`, status_id: ready.id })
  const { ctx, page } = await open('pl_smm', 's1234', t.id)
  ok(await field(page).count() === 1, 'at Ready the SMM sees the box')
  ok(!!(await field(page).boundingBox()), '…on the page the sheet opened on, not behind a fold')
  ok(await field(page).locator('input').isDisabled() === false, '…and can type in it (it used to be greyed out for them)')
  const publishBtn = page.locator('.modal button.btn-primary').filter({ hasText: /publish/i }).first()
  ok(await publishBtn.count() === 1, 'the one-tap Publish is theirs')
  // The review page is folded behind "Add details" by design; a person opens it.
  // Publish lives on the Review page, behind "Add details" and a tab — by
  // design (Phase 4). A person presses both; so does the suite.
  const more = page.locator('.modal .cm-add-details')
  if (await more.count()) { await more.click(); await page.waitForTimeout(500) }
  // The Review page's tab reads "Execution" (and "Your part" to crew).
  const reviewTab = page.locator('.modal .cm-page-tab').filter({ hasText: /execution|your part/i }).first()
  if (await reviewTab.count()) { await reviewTab.click(); await page.waitForTimeout(500) }
  ok(!!(await publishBtn.boundingBox()), '…and is in view once the Review page is open')
  await publishBtn.click()
  await page.waitForTimeout(1200)
  ok((await field(page).locator('input').getAttribute('class') || '').includes('field-bad'), 'pressing it with the box empty lands on the box')
  await field(page).locator('input').fill(L('m'))
  // The refusal turned the sheet to the box (on Brief); Publish is on
  // Execution, so a person turns back before pressing it again.
  await reviewTab.click(); await page.waitForTimeout(400)
  await publishBtn.click()
  await page.waitForTimeout(1500)
  const out = await req(`/content/${t.id}`)
  ok(out.status_id === published.id && out.post_link === L('m'), 'paste, turn back, Publish: out, with its address', [out.status_id, out.post_link])
  await ctx.close()
}
// The editor, who used to be refused by the server.
{
  const t = await mk({ title: `pl editor ${stamp}`, status_id: ready.id, editor_id: editor.id })
  const { ctx, page } = await open('pl_editor', 'e1234', t.id)
  ok(await field(page).count() === 1 && await field(page).locator('input').isDisabled() === false, 'the editor has the pen too')
  await field(page).locator('input').fill(L('e'))
  await saveBtn(page).click()
  await page.waitForTimeout(1500)
  ok((await req(`/content/${t.id}`)).post_link === L('e'), '…and their save lands')
  await ctx.close()
}
// The path from the report: right-click a card, "Mark as done", no address.
// The refusal opens the sheet on the box — and the box has to be in view,
// not merely mounted behind the fold.
{
  const t = await mk({ title: `pl board ${stamp}`, status_id: ready.id })
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
  await page.goto(BASE + '/login')
  await page.fill('input[name="username"]', 'jas'); await page.fill('input[name="password"]', 'j1234')
  await page.click('button[type="submit"]')
  await page.waitForURL((x) => !/\/login/.test(x.pathname), { timeout: 20000 })
  await page.goto(`${BASE}/dept/${ch}`)
  await page.waitForSelector('.pill-group', { timeout: 20000 })
  const boardPill = page.locator('.pill-group .pill', { hasText: 'Board' }).first()
  if (await boardPill.count()) { await boardPill.click(); await page.waitForTimeout(900) }
  const card = page.locator('.tcard').filter({ hasText: t.title }).first()
  ok(await card.count() === 1, 'the piece is on the board')
  await card.click({ button: 'right' })
  await page.waitForTimeout(400)
  const done = page.locator('.ctx-item').filter({ hasText: /mark as done/i }).first()
  ok(await done.count() === 1, 'right-click offers Mark as done')
  await done.click()
  await page.waitForSelector('.modal', { timeout: 15000 })
  await page.waitForTimeout(1200)
  const box = await field(page).boundingBox()
  ok(!!box && box.height > 0, 'the refusal opens the sheet with the box IN VIEW', box && Math.round(box.height))
  ok((await field(page).locator('input').getAttribute('class') || '').includes('field-bad'), '…marked as the thing being asked for')
  await field(page).locator('input').fill(L('k'))
  await saveBtn(page).click()
  await page.waitForTimeout(1500)
  const out = await req(`/content/${t.id}`)
  ok(out.post_link === L('k'), 'paste and save from there lands the address', out.post_link)
  await ctx.close()
}

// A duplicate, pasted in the sheet.
{
  const t = await mk({ title: `pl dupsheet ${stamp}`, status_id: ready.id })
  const { ctx, page } = await open('jas', 'j1234', t.id)
  await field(page).locator('input').fill(L('u'))
  await saveBtn(page).click()
  await page.waitForTimeout(1400)
  ok(await page.locator('.modal').count() === 1, 'a used address keeps the sheet open')
  ok((await field(page).locator('input').getAttribute('class') || '').includes('field-bad'), '…lands on the box')
  ok(new RegExp(first.title).test(await page.locator('.modal').textContent()), '…and names the task that has it')
  ok((await req(`/content/${t.id}`)).post_link == null, '…and nothing was written')
  await ctx.close()
}
await browser.close()
console.log(fails ? `\nFAILED ${fails}` : '\nPublished-link suite clean.')
process.exit(fails ? 1 : 0)
