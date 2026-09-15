// Whose page is it: does aiming a page at an account kind actually change who
// gets the door, and does the Admin panel column save what it says it saves.
//
// Two shells to check, because the board has two. A non-admin with at most one
// channel — which is what a designer with no channels is — gets the solo top
// bar and the phone's More sheet; everybody else gets the sidebar. Both draw
// their doors through shows(), and so does the route guard, so a page that is
// not yours should be missing from the menu AND bounce you home from its own
// address.
//
// Wants a seeded stack on 4090 (qa/seed.mjs). It resets the page rules to the
// shipped ones on the way in and puts Sprints back on the way out, so it can
// be run twice in a row and answer the same thing both times.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const API = BASE + '/api'
let fails = 0
const ok = (c, m, x) => { console.log((c ? '✔ ' : '✘ ') + m + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); if (!c) fails++ }

const login = async (u, p) => (await (await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  const d = await r.json().catch(() => ({}))
  if (r.status >= 400) console.log('  ERR', m, p, r.status, JSON.stringify(d).slice(0, 160))
  return d
}

// --- two crew accounts, one of each capability, plus a plain member ---
const mkUser = async (b) => {
  const made = await req('/users', 'POST', b)
  if (made?.id) return made
  const all = await req('/users')
  return (Array.isArray(all) ? all : []).find((u) => u.username === b.username) || {}
}
const des = await mkUser({ name: 'Dilnoza Designer', username: 'des', password: 'd1234', role: 'designer', crew_roles: ['designer'] })
const opr = await mkUser({ name: 'Otabek Operator', username: 'opr', password: 'o1234', role: 'operator', crew_roles: ['operator'] })
const both = await mkUser({ name: 'Bek Both', username: 'both', password: 'b1234', role: 'crew', crew_roles: ['operator', 'designer'] })
ok(des.id && opr.id && both.id, 'three crew accounts made', { des: des.crew_roles, opr: opr.crew_roles, both: both.crew_roles })

// Start from the shipped rules whatever a previous run left behind, so this
// check answers the same question every time it is asked.
await req('/fields', 'POST', { pages: Object.fromEntries(['overview','releases','recordings','missed','design','docs','sprints','projects','crew','team'].map((k) => [k, true])), page_audience: { design: ['designer'], sprints: [] } })
const f0 = await req('/fields')
ok(Array.isArray(f0.page_audience?.design), 'the server answers an audience per page', f0.page_audience?.design)
ok(JSON.stringify(f0.page_audience.design) === '["designer"]', 'Design ships aimed at designers', f0.page_audience.design)
ok(JSON.stringify(f0.page_audience.sprints) === '[]', 'Sprints ships open to everyone', f0.page_audience.sprints)

// Two shells, one rule. A non-admin with at most one channel gets the solo top
// bar and the phone's More sheet instead of a sidebar — which is exactly the
// shell a channel-less designer lands in — and both draw their doors through
// shows(). So read whichever one this account got.
const navOf = async (ctx, user, pass) => {
  const p = await ctx.newPage()
  await p.goto(BASE + '/login')
  await p.fill('input[name="username"]', user)
  await p.fill('input[name="password"]', pass)
  await p.click('button[type="submit"]')
  await p.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 15000 }).catch(() => {})
  await p.waitForSelector('.sidebar, .solo-bar, header', { timeout: 15000 })
  await p.waitForTimeout(1200)
  const side = p.locator('.sidebar')
  if (await side.count()) {
    // Clicking a hub toggles it, so only the folded ones get a click.
    for (const h of await p.locator('.nav-hub:not(.open) .nav-hub-head').all()) { try { await h.click() } catch {} }
    await p.waitForTimeout(400)
    return { p, shell: 'sidebar', text: await side.textContent() }
  }
  // Solo: the top bar carries some doors and the More sheet carries the rest.
  let text = await p.locator('header').first().textContent()
  const more = p.locator('.mob-tab, .solo-link, button').filter({ hasText: /^More$/ }).first()
  if (await more.count()) {
    try { await more.click(); await p.waitForTimeout(500); text += ' ' + (await p.locator('.mob-sheet').textContent()) } catch {}
  }
  return { p, shell: 'solo', text }
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const bounced = async (p, path) => {
  await p.goto(BASE + path)
  await p.waitForTimeout(1500)
  return new URL(p.url()).pathname
}

// ---------- default rules: Design is the designer's, Sprints is everyone's ----------
{
  const ctx = await browser.newContext()
  const { p, text } = await navOf(ctx, 'des', 'd1234')
  ok(/Design/.test(text), 'designer: Design is in their nav')
  ok(/Sprint/i.test(text), 'designer: Sprints is in their nav')
  ok(await bounced(p, '/design') === '/design', 'designer: /design opens')
  await ctx.close()
}
{
  const ctx = await browser.newContext()
  const { p, text } = await navOf(ctx, 'opr', 'o1234')
  ok(!/Design/.test(text), 'operator: Design is NOT in their nav')
  ok(/Sprint/i.test(text), 'operator: Sprints still is')
  ok(await bounced(p, '/design') !== '/design', 'operator: /design bounces home', await bounced(p, '/design'))
  await ctx.close()
}
{
  const ctx = await browser.newContext()
  const { text } = await navOf(ctx, 'both', 'b1234')
  ok(/Design/.test(text), 'operator+designer: Design is theirs too')
  await ctx.close()
}
{
  const ctx = await browser.newContext()
  const { p, text } = await navOf(ctx, 'jas', 'j1234')
  ok(!/Design/.test(text), 'member: Design is NOT in the sidebar')
  ok(await bounced(p, '/design') !== '/design', 'member: /design bounces home')
  await ctx.close()
}
{
  const ctx = await browser.newContext()
  const { p, text } = await navOf(ctx, 'admin', 'admin123')
  ok(/Design/.test(text), 'admin: Design is in the sidebar, always')
  ok(await bounced(p, '/design') === '/design', 'admin: /design opens')
  await ctx.close()
}

// ---------- the Admin panel column: aim Sprints at designers ----------
{
  const ctx = await browser.newContext()
  const { p } = await navOf(ctx, 'admin', 'admin123')
  await p.goto(BASE + '/admin')
  await p.waitForTimeout(1500)
  await p.locator('.tab', { hasText: 'Settings' }).click()
  await p.waitForTimeout(1400)
  const rows = p.locator('.pages-tbl tbody tr')
  ok(await rows.count() === 10, 'the pages table still lists every page', await rows.count())
  const rowOf = (label) => p.locator(`.pages-tbl tbody tr:has(b:text-is("${label}"))`)
  const sprintRow = rowOf('Sprints')
  ok(await sprintRow.count() === 1, 'the Sprints row is picked by its own label, not by the chips in it')
  ok(await sprintRow.locator('.aud-chips').count() === 1, 'Sprints has an audience cell')
  ok((await sprintRow.locator('.stat-sub').last().textContent()).trim() === 'Everyone', 'Sprints reads "Everyone" before anyone is ticked')
  await sprintRow.locator('.checkbox-chip').filter({ hasText: 'Designers' }).click()
  await p.waitForTimeout(1200)
  const after = await req('/fields')
  ok(JSON.stringify(after.page_audience.sprints) === '["designer"]', 'ticking Designers stored the audience', after.page_audience.sprints)
  await p.reload()
  await p.waitForTimeout(1800)
  await p.locator('.tab', { hasText: 'Settings' }).click()
  await p.waitForTimeout(1400)
  const row2 = rowOf('Sprints')
  const chip = row2.locator('.checkbox-chip').filter({ hasText: 'Designers' }).first()
  ok((await chip.getAttribute('class')).includes('on'), 'and the tick survives a reload')
  // The Design row: switching the page OFF makes its audience moot.
  const designRow = rowOf('Design')
  ok(await designRow.count() === 1, 'and so is the Design row')
  await designRow.locator('.switch').click()
  await p.waitForTimeout(1200)
  ok((await designRow.locator('.aud-chips').getAttribute('class')).includes('is-moot'), 'a page switched off greys its audience out')
  ok(await designRow.locator('.checkbox-chip input').first().isDisabled(), 'and stops taking clicks')
  await designRow.locator('.switch').click() // put it back
  await p.waitForTimeout(1200)
  await ctx.close()
}

// ---------- the aim now bites ----------
{
  const ctx = await browser.newContext()
  const { p, text } = await navOf(ctx, 'opr', 'o1234')
  ok(!/Sprint/i.test(text), 'operator: Sprints is gone now it is aimed at designers')
  ok(await bounced(p, '/sprints') !== '/sprints', 'operator: /sprints bounces home')
  await ctx.close()
}
{
  const ctx = await browser.newContext()
  const { text } = await navOf(ctx, 'des', 'd1234')
  ok(/Sprint/i.test(text), 'designer: Sprints is still theirs')
  await ctx.close()
}
{
  const ctx = await browser.newContext()
  const { p, text } = await navOf(ctx, 'admin', 'admin123')
  ok(/Sprint/i.test(text), 'admin: Sprints stays, whoever it is aimed at')
  ok(await bounced(p, '/sprints') === '/sprints', 'admin: /sprints still opens')
  await ctx.close()
}

// ---------- a stale client cannot write nonsense ----------
{
  const bad = await req('/fields', 'POST', { page_audience: { sprints: ['designer', 'wizard'], nosuchpage: ['member'] } })
  ok(JSON.stringify(bad.page_audience.sprints) === '["designer"]', 'an unknown audience word is dropped, not stored', bad.page_audience.sprints)
  ok(bad.page_audience.nosuchpage === undefined, 'an unknown page key is not stored either')
  const asOpr = await login('opr', 'o1234')
  const r = await fetch(API + '/fields', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${asOpr}` }, body: JSON.stringify({ page_audience: { design: [] } }) })
  ok(r.status === 403, 'and only an admin may aim a page at all', r.status)
}

// put Sprints back the way it shipped
await req('/fields', 'POST', { page_audience: { sprints: [] } })
await browser.close()
console.log(fails ? `\nFAILED ${fails}` : '\nRBAC check clean.')
process.exit(fails ? 1 : 0)
