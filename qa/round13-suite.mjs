// This round: the Docs & KPIs page — per-person SOP/responsibility documents
// shared between the company and the person (both always see them), every KPI
// stamped with updated-by/at, crew accounts reaching the page from their top
// bar, and the admin's everything-in-one-place view.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

const PDF = 'data:application/pdf;base64,' + Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF').toString('base64')

const users = (await req('/users')).data
const mir = users.find((u) => u.username === 'mir')
const jas = users.find((u) => u.username === 'jas')
const tokMir = await login('mir', 'm1234')

for (const who of [mir.id, jas.id]) {
  for (const d of (await req(`/docs?user_id=${who}`)).data.filter((d) => /r13:/.test(d.title)))
    await req(`/docs/${d.id}`, 'DELETE')
  for (const k of (await req(`/kpis?user_id=${who}`)).data.filter((k) => /r13:/.test(k.name)))
    await req(`/kpis/${k.id}`, 'DELETE')
}
for (const u of users.filter((x) => x.username === 'r13cru'))
  await req(`/users/${u.id}`, 'DELETE')

// ---- documents: company → person ----
const up = await req('/docs', 'POST', { user_id: mir.id, kind: 'sop', title: 'r13: Editing SOP', file_name: 'editing-sop.pdf', data: PDF })
ok('admin uploads an SOP for a member', up.status === 201 && up.data.kind === 'sop')
ok('the list answer carries no file bytes', up.data.data === undefined)
const mirList = await req('/docs', 'GET', null, tokMir)
ok('the member ALWAYS sees their documents', mirList.status === 200 && mirList.data.some((d) => d.id === up.data.id))
ok('…without the bytes riding along', mirList.data.every((d) => d.data === undefined))
const fetched = await req(`/docs/${up.data.id}`, 'GET', null, tokMir)
ok('the member opens the file itself', fetched.status === 200 && fetched.data.data === PDF)
ok('a stranger’s folder is off-limits', (await req(`/docs?user_id=${jas.id}`, 'GET', null, tokMir)).status === 403)

const own = await req('/docs', 'POST', { kind: 'responsibility', title: 'r13: Signed responsibility sheet', file_name: 'signed.pdf', data: PDF }, tokMir)
ok('the member uploads to their own folder', own.status === 201 && own.data.user_id === mir.id)
ok('…but never to someone else’s', (await req('/docs', 'POST', { user_id: jas.id, kind: 'sop', title: 'r13: sneaky', file_name: 'x.pdf', data: PDF }, tokMir)).status === 403)
ok('junk uploads are rejected', (await req('/docs', 'POST', { user_id: mir.id, title: 'r13: nofile', file_name: 'x.pdf', data: 'hello' })).status === 400)
const admList = (await req(`/docs?user_id=${mir.id}`)).data
ok('admin sees both parties’ uploads in one shelf', admList.some((d) => d.id === up.data.id) && admList.some((d) => d.id === own.data.id))

// ---- KPIs: managed in one place, stamped ----
const kpi = await req('/kpis', 'POST', { user_id: mir.id, name: 'r13: Reels per week', target: '4', current: '2', unit: 'reels', notes: 'agreed at onboarding' })
ok('admin sets a KPI', kpi.status === 201 && kpi.data.updated_by === 1)
const before = kpi.data.updated_at
await new Promise((r) => setTimeout(r, 30))
const upd = await req(`/kpis/${kpi.data.id}`, 'PATCH', { current: '3' })
ok('updating stamps who + when', upd.status === 200 && upd.data.current === '3' && upd.data.updated_at > before)
ok('the member reads their own KPIs', (await req('/kpis', 'GET', null, tokMir)).data.some((k) => k.id === kpi.data.id))
ok('…but cannot write them', (await req('/kpis', 'POST', { user_id: mir.id, name: 'r13: self-serve' }, tokMir)).status === 403)
ok('…or peek at someone else’s', (await req(`/kpis?user_id=${jas.id}`, 'GET', null, tokMir)).status === 403)

// ============ UI ============
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })

ok('the sidebar leads to the new page', (await page.locator('.sidebar').textContent()).includes('Docs & KPIs'))
await page.goto(BASE + '/docs')
await page.waitForSelector('.docs-page', { timeout: 10000 })
await page.locator('.docs-who select').selectOption(String(mir.id))
await page.waitForSelector('.doc-card', { timeout: 8000 })
const pageTxt = await page.locator('.docs-page').textContent()
ok('the shelf shows the SOP with its date', pageTxt.includes('r13: Editing SOP') && pageTxt.includes('editing-sop.pdf'))
ok('the KPI row shows target, current and the update stamp', pageTxt.includes('r13: Reels per week') && pageTxt.includes('3 reels') && pageTxt.includes('Admin'))

await page.locator('.kpi-row', { hasText: 'r13: Reels per week' }).dblclick()
await page.waitForSelector('.modal', { timeout: 8000 })
await page.locator('.modal .kpi-form-row input').nth(1).fill('4')
await page.locator('.modal').getByRole('button', { name: 'Save' }).click()
await page.locator('.toast', { hasText: 'KPI saved' }).waitFor({ timeout: 6000 })
ok('KPI edits confirm after the server does', true)
await page.waitForTimeout(300)
ok('the row shows the fresh value', (await page.locator('.kpi-row', { hasText: 'r13: Reels per week' }).textContent()).includes('4 reels'))
await page.screenshot({ path: 'r13-docs.png' })

// the member's own view — no picker, their shelf right away
const page2 = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
page2.on('pageerror', (e) => { fails++; console.log(`✘ PAGE2 ERROR: ${e.message}`) })
await page2.goto(BASE + '/login')
await page2.fill('input[name="username"]', 'mir')
await page2.fill('input[name="password"]', 'm1234')
await page2.click('button[type="submit"]')
await page2.waitForURL(/brief|overview|dept|todo/, { timeout: 15000 })
await page2.goto(BASE + '/docs')
await page2.waitForSelector('.doc-card', { timeout: 10000 })
const memberTxt = await page2.locator('.docs-page').textContent()
ok('the member lands straight on their own shelf', memberTxt.includes('r13: Editing SOP') && memberTxt.includes('r13: Reels per week'))
ok('with no person picker offered', (await page2.locator('.docs-who').count()) === 0)
ok('and no Add-KPI button', !(await page2.locator('.docs-page').textContent()).includes('Add KPI'))
await page2.screenshot({ path: 'r13-member.png' })

// ============ every crew account reaches the page too ============
const cru13 = (await req('/users', 'POST', { name: 'Sardor Cutter', username: 'r13cru', password: 's1234', role: 'crew', crew_roles: ['editor', 'designer'] })).data
const pageCru = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
pageCru.on('pageerror', (e) => { fails++; console.log(`✘ CREW PAGE ERROR: ${e.message}`) })
await pageCru.goto(BASE + '/login')
await pageCru.fill('input[name="username"]', 'r13cru')
await pageCru.fill('input[name="password"]', 's1234')
await pageCru.click('button[type="submit"]')
await pageCru.waitForURL(/brief/, { timeout: 15000 })
ok('crew top bar offers Docs & KPIs', (await pageCru.locator('.solo-bar').textContent()).includes('Docs & KPIs'))
await pageCru.goto(BASE + '/docs')
await pageCru.waitForSelector('.docs-page', { timeout: 10000 })
ok('a crew account lands on their own shelf', (await pageCru.locator('.docs-page').textContent()).includes('Documents'))

// ============ the admin's everything view ============
const jasDoc = await req('/docs', 'POST', { user_id: jas.id, kind: 'other', title: 'r13: Jas contract', file_name: 'jas.pdf', data: PDF })
ok('second-person fixture in place', jasDoc.status === 201)
ok('the everything list is admin-only', (await req('/docs?all=1', 'GET', null, tokMir)).status === 403)
const allDocs = await req('/docs?all=1')
ok('admin pulls every document in one list', allDocs.status === 200
  && allDocs.data.some((d) => d.user_id === mir.id) && allDocs.data.some((d) => d.user_id === jas.id))
const page3 = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
page3.on('pageerror', (e) => { fails++; console.log(`✘ ALL PAGE ERROR: ${e.message}`) })
await page3.goto(BASE + '/login')
await page3.fill('input[name="username"]', 'admin')
await page3.fill('input[name="password"]', 'admin123')
await page3.click('button[type="submit"]')
await page3.waitForURL(/overview/, { timeout: 15000 })
await page3.goto(BASE + '/docs')
await page3.waitForSelector('.docs-page', { timeout: 10000 })
await page3.locator('.docs-who select').selectOption('0')
await page3.waitForSelector('.doc-card', { timeout: 8000 })
const allTxt = await page3.locator('.docs-page').textContent()
ok('one shelf holds both people’s papers, named', allTxt.includes('r13: Editing SOP') && allTxt.includes('r13: Jas contract')
  && allTxt.includes('Mirabbos') && allTxt.includes('Jasmina'))
ok('uploads wait for a person to be picked', !allTxt.includes('Upload'))
ok('the KPI table gains a Person column', (await page3.locator('.kpi-table.kpi-all').count()) === 1)
await page3.screenshot({ path: 'r13-all.png' })
await browser.close()

// ============ cleanup ============
for (const who of [mir.id, jas.id]) {
  for (const d of (await req(`/docs?user_id=${who}`)).data.filter((d) => /r13:/.test(d.title)))
    await req(`/docs/${d.id}`, 'DELETE')
  for (const k of (await req(`/kpis?user_id=${who}`)).data.filter((k) => /r13:/.test(k.name)))
    await req(`/kpis/${k.id}`, 'DELETE')
}
await req(`/users/${cru13.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-13 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
