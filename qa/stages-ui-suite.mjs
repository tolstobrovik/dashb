// The board and the task sheet agreeing with the two stage rules — because a
// control that looks usable and then answers 403 reads as the app being
// broken, not as "not your call".
//
// Wants a seeded stack on 4090 (qa/seed.mjs) and the accounts qa/stages-suite
// makes; it runs that suite's setup itself so it stands alone.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const API = BASE + '/api'
let fails = 0
const ok = (c, m, x) => { console.log((c ? '✔ ' : '✘ ') + m + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); if (!c) fails++ }
const login = async (u, p) => (await (await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b) => (await (await fetch(API + p, {
  method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` },
  body: b ? JSON.stringify(b) : undefined })).json().catch(() => ({})))

const ch = 'instagram_main'
const mkUser = async (b) => {
  const made = await req('/users', 'POST', b)
  if (made?.id) return made
  const all = await req('/users')
  const found = (Array.isArray(all) ? all : []).find((u) => u.username === b.username)
  return found ? await req(`/users/${found.id}`, 'PATCH', { role: b.role, departments: b.departments, permissions: b.permissions }) : {}
}
await mkUser({ name: 'Nadia Nomover', username: 'st_nobody', password: 'n1234', role: 'member', departments: [ch], permissions: { move_tasks: false, manage_content: false } })
await mkUser({ name: 'Mansur Mover', username: 'st_mover', password: 'm1234', role: 'member', departments: [ch], permissions: { move_tasks: true } })

const statuses = await req('/statuses')
const S = (re) => statuses.find((s) => re.test(s.label))
const idea = S(/idea/i), editing = S(/editing/i), ready = S(/^ready$/i)
const stamp = Date.now()
const mk = (b) => req('/content', 'POST', { channels: [ch], type: 'post', ...b })
const anIdea = await mk({ title: `ui idea ${stamp}`, status_id: idea.id })
const inEdit = await mk({ title: `ui editing ${stamp}`, status_id: editing.id })
const atReady = await mk({ title: `ui ready ${stamp}`, status_id: ready.id })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const signIn = async (u, p) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
  await page.goto(BASE + '/login')
  await page.fill('input[name="username"]', u)
  await page.fill('input[name="password"]', p)
  await page.click('button[type="submit"]')
  await page.waitForURL((x) => !/\/login/.test(x.pathname), { timeout: 20000 })
  return { ctx, page }
}

// ---- the board: an idea is draggable even with no move_tasks --------------
{
  const { ctx, page } = await signIn('st_nobody', 'n1234')
  await page.goto(`${BASE}/dept/${ch}`)
  await page.waitForSelector('.board, .pill-group', { timeout: 20000 })
  await page.waitForTimeout(1200)
  const boardPill = page.locator('.pill-group .pill', { hasText: 'Board' }).first()
  if (await boardPill.count()) { await boardPill.click(); await page.waitForTimeout(1200) }
  const card = (title) => page.locator('.tcard').filter({ hasText: title }).first()
  ok(await card(anIdea.title).count() === 1, 'the idea card is on the board for a member with no rights')
  ok(await card(anIdea.title).getAttribute('draggable') === 'true', '…and it can be picked up')
  ok(await card(inEdit.title).getAttribute('draggable') === 'false', 'while work past Idea cannot', await card(inEdit.title).getAttribute('draggable'))
  await ctx.close()
}

// ---- the sheet: the days on work in progress are shut --------------------
{
  const { ctx, page } = await signIn('st_mover', 'm1234')
  const openTask = async (id) => {
    await page.goto(`${BASE}/brief?task=${id}`)
    await page.waitForSelector('.modal', { timeout: 20000 })
    await page.waitForTimeout(1000)
  }
  // An idea: the release day is empty and typeable.
  await openTask(anIdea.id)
  let rel = page.locator('.drow[data-field="release_date"]').first()
  ok(await rel.locator('input[type="date"]').isDisabled() === false, 'an idea still takes a first day')
  ok(await rel.locator('.drow-quick').count() === 1, '…with the Today / Tomorrow shortcuts')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)

  // In Editing: shut, and it says why rather than letting a day be typed.
  await openTask(inEdit.id)
  rel = page.locator('.drow[data-field="release_date"]').first()
  ok(await rel.locator('input[type="date"]').isDisabled() === true, 'work being edited will not take one')
  ok(await rel.locator('.drow-quick').count() === 0, '…the shortcuts are gone with it')
  const why = await rel.locator('.drow-promised').textContent().catch(() => '')
  ok(/being made/i.test(why), '…and the row says why', why.trim())
  ok(await rel.locator('.qbtn-ask').count() === 0, 'no "Ask to move" on a day that was never promised')
  ok((await rel.getAttribute('class')).includes('drow-locked'), 'the row reads as locked')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)

  // Past the band: editable again.
  await openTask(atReady.id)
  rel = page.locator('.drow[data-field="release_date"]').first()
  ok(await rel.locator('input[type="date"]').isDisabled() === false, 'and work at Ready takes one again')
  await ctx.close()
}

// ---- an admin is never frozen --------------------------------------------
{
  const { ctx, page } = await signIn('admin', 'admin123')
  await page.goto(`${BASE}/brief?task=${inEdit.id}`)
  await page.waitForSelector('.modal', { timeout: 20000 })
  await page.waitForTimeout(1000)
  const rel = page.locator('.drow[data-field="release_date"]').first()
  ok(await rel.locator('input[type="date"]').isDisabled() === false, 'an admin still sets the day on work in progress')
  await ctx.close()
}

await browser.close()
console.log(fails ? `\nFAILED ${fails}` : '\nStage-rules UI suite clean.')
process.exit(fails ? 1 : 0)
