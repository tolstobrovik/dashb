// This round: giant whiteboard field, program creatives, the crew account
// (done / today / 1-3-7-30 day horizons / notes), and the missed-deadline page.
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
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
const today = fmt.format(new Date())
const add = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// ============ fixtures: a crew member with a full week ============
// pre-clean the crew fixture (a crashed run must not wedge the next)
for (const u of (await req('/users')).data.filter((u) => u.username === 'nod')) await req(`/users/${u.id}`, 'DELETE')
const nod = (await req('/users', 'POST', { name: 'Nodira Alieva', username: 'nod', password: 'n1234', role: 'crew' })).data
ok('crew user created', !!nod.id)
const mk = (b) => req('/content', 'POST', b)
const doneVid = (await mk({ title: 'Cut: spring gala highlights', channels: ['youtube'], type: 'video', editor_id: nod.id, recording_date: add(-6), release_date: add(-3) })).data
const recNow = (await mk({ title: 'Shoot: chemistry lab tour', channels: ['instagram_main'], type: 'video', operator_id: nod.id, recording_date: today, recording_time: '11:00', description: 'Bring the gimbal; prof wants the fume hoods in frame' })).data
const tmrw = (await mk({ title: 'Shoot: cafeteria b-roll', channels: ['youtube'], type: 'video', operator_id: nod.id, recording_date: add(1) })).data
const in3 = (await mk({ title: 'Edit: target promo v2', channels: ['target'], type: 'video', editor_id: nod.id, recording_date: add(-1), release_date: add(3), description: 'Cut to 30s, captions burned in' })).data
const in7 = (await mk({ title: 'Shoot: library opening', channels: ['telegram_main'], type: 'video', operator_id: nod.id, recording_date: add(6) })).data
const inMonth = (await mk({ title: 'Edit: admissions FAQ film', channels: ['youtube'], type: 'video', editor_id: nod.id, release_date: add(18) })).data
const crewMiss = (await mk({ title: 'Cut: overdue trailer', channels: ['youtube'], type: 'video', editor_id: nod.id, recording_date: add(-9), release_date: add(-2) })).data
const dueToday = (await mk({ title: 'Release: due today — not missed yet', channels: ['instagram_main'], type: 'post', assignee_id: nod.id, release_date: today })).data
await req(`/content/${doneVid.id}`, 'PATCH', { done: true, post_link: 'https://instagram.com/p/qa' })
ok('crew fixtures in place', [doneVid, recNow, tmrw, in3, in7, inMonth, crewMiss, dueToday].every((c) => c?.id))

// ============ missed rule, straight from the data ============
const all = (await req('/content')).data
const missed = (t) => t.release_date && t.release_date < today && (!t.done_at || t.done_at.slice(0, 10) > t.release_date)
ok('done-late still counts as missed (doneVid: released -3, done today)', missed(all.find((c) => c.id === doneVid.id)))
ok('due-today is NOT missed while the day lasts', !missed(all.find((c) => c.id === dueToday.id)))
ok('open overdue is missed', missed(all.find((c) => c.id === crewMiss.id)))

// ============ programs: creatives round-trip through the API ============
const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const prog = (await req('/programs', 'POST', {
  channel: 'target', name: 'August lead push', status: 'running', start_date: add(-3), end_date: add(12),
  creatives: [{ name: 'Hook A — parents', script: 'Open on campus gates, VO: "Your child\'s future…"', photo: px, photo_thumb: px }],
})).data
let crs = JSON.parse(prog.creatives || '[]')
ok('program stores its creatives', crs.length === 1 && crs[0].name === 'Hook A — parents' && crs[0].script.includes('campus gates'), prog.creatives?.slice(0, 60))
ok('creative photo survives as a data URL', crs[0].photo === px && crs[0].photo_thumb === px)
const patched = (await req(`/programs/${prog.id}`, 'PATCH', { creatives: [...crs, { name: 'Hook B — students', script: 'Fast cuts, trending audio' }] })).data
crs = JSON.parse(patched.creatives || '[]')
ok('PATCH appends a second creative', crs.length === 2 && crs[1].name === 'Hook B — students')
const junk = (await req(`/programs/${prog.id}`, 'PATCH', { creatives: [{ name: 'X', script: 'ok', photo: 'javascript:alert(1)' }] })).data
ok('non-image photo payloads are stripped', !JSON.parse(junk.creatives)[0].photo)
await req(`/programs/${prog.id}`, 'PATCH', { creatives: crs }) // restore the two good ones

// ============ the UI ============
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const mkPage = async (u, p, urlRe) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR (${u}): ${e.message}`) })
  page.on('dialog', (d) => d.accept())
  await page.goto(BASE + '/login')
  await page.fill('input[name="username"]', u)
  await page.fill('input[name="password"]', p)
  await page.click('button[type="submit"]')
  await page.waitForURL(urlRe, { timeout: 15000 }).catch(() => {})
  return { ctx, page }
}

// ---- crew account: the whole day + horizons + notes + done ----
{
  const { ctx, page } = await mkPage('nod', 'n1234', /brief/)
  ok('crew lands on My Day', page.url().includes('/brief'), page.url())
  await page.waitForSelector('.brief-title', { timeout: 10000 })
  await page.waitForTimeout(600)
  const txt = await page.locator('.content').textContent()
  ok('today: the shoot is listed with its hour', txt.includes('Shoot: chemistry lab tour') && txt.includes('11:00'))
  ok('notes for shooting ride on the row', txt.includes('Bring the gimbal'))
  const shootLane = page.locator('.cb-col').first()
  const editLane = page.locator('.cb-col').nth(1)
  ok('the day splits into folded sections per lane',
    (await page.locator('.cb-toggle', { hasText: 'Tomorrow' }).count()) === 2
    && (await page.locator('.cb-toggle', { hasText: 'Upcoming' }).count()) === 2)
  await shootLane.locator('.cb-toggle', { hasText: 'Tomorrow' }).click()
  await shootLane.locator('.cb-toggle', { hasText: 'Upcoming' }).click()
  await editLane.locator('.cb-toggle', { hasText: 'Upcoming' }).click()
  await page.waitForTimeout(250)
  ok('tomorrow holds the cafeteria shoot', (await shootLane.textContent()).includes('Shoot: cafeteria b-roll'))
  ok('the shoot lane’s upcoming holds the library opening', (await shootLane.textContent()).includes('Shoot: library opening'))
  const editTxt = await editLane.textContent()
  ok('the edit lane’s upcoming holds the target edit', editTxt.includes('Edit: target promo v2'))
  ok('…and the far-out FAQ film', editTxt.includes('Edit: admissions FAQ film'))
  ok('channel chips name the channel (Target visible)', /Target/.test(editTxt))
  await editLane.locator('.cb-toggle', { hasText: 'Done' }).click()
  await page.waitForTimeout(200)
  ok('what they have done: the finished cut shows up', (await editLane.textContent()).includes('Cut: spring gala highlights'))
  ok('overdue block links to the missed page', (await page.locator('a[href="/missed"]').count()) >= 1)
  ok('still no metrics anywhere', !/followers|views\b|Metrics/i.test(txt))
  await page.screenshot({ path: 'r-crew-brief.png', fullPage: true })

  // their own missed page
  await page.goto(BASE + '/missed')
  await page.waitForSelector('.brief-title', { timeout: 10000 })
  await page.waitForTimeout(600)
  const mtxt = await page.locator('.content').textContent()
  ok('crew missed page shows their overdue cut', mtxt.includes('Cut: overdue trailer') && /days? overdue/.test(mtxt))
  ok("crew missed page hides other people's misses", !mtxt.includes('Overdue: dorm life story series'))
  ok('due-today item is not condemned early', !mtxt.includes('due today — not missed yet'))
  ok('done-late lands under "Finished, but late"', mtxt.includes('Finished, but late') && mtxt.includes('Cut: spring gala highlights') && /done \d+ days? late/.test(mtxt))
  ok('crew see no responsible-name chips', (await page.locator('.chip-danger').count()) === 0)
  await page.screenshot({ path: 'r-crew-missed.png', fullPage: true })
  await ctx.close()
}

// ---- member's missed page: theirs and only theirs ----
{
  const { ctx, page } = await mkPage('jas', 'j1234', /brief/)
  await page.goto(BASE + '/missed')
  await page.waitForSelector('.brief-title', { timeout: 10000 })
  await page.waitForTimeout(600)
  const t2 = await page.locator('.content').textContent()
  ok('member sees their own overdue story', t2.includes('Overdue: dorm life story series'))
  ok('member sees their own late finish', t2.includes('IELTS webinar recap post'))
  ok("member does not see the crew's miss", !t2.includes('Cut: overdue trailer'))
  await ctx.close()
}

// ---- admin's missed page: everyone, with names ----
{
  const { ctx, page } = await mkPage('admin', 'admin123', /overview/)
  await page.goto(BASE + '/missed')
  await page.waitForSelector('.brief-title', { timeout: 10000 })
  await page.waitForTimeout(600)
  const t3 = await page.locator('.content').textContent()
  ok('admin sees the whole team', t3.includes('Cut: overdue trailer') && t3.includes('Overdue: dorm life story series') && t3.includes('The whole team'))
  ok('admin sees who was responsible', (await page.locator('.chip-danger').count()) >= 2 && t3.includes('Nodira') && t3.includes('Jasmina'))
  ok('sidebar carries the Missed link', (await page.locator('.sidebar a[href="/missed"]').count()) === 1)
  await page.screenshot({ path: 'r-admin-missed.png', fullPage: true })

  // ---- creatives in the program form ----
  await page.goto(BASE + '/dept/target')
  await page.waitForSelector('.gantt-row', { timeout: 10000 })
  const row = page.locator('.gantt-row', { hasText: 'August lead push' })
  ok('gantt row wears the creatives chip', (await row.textContent()).includes('2 creatives'))
  await row.locator('.gantt-label').click()
  await page.waitForSelector('.modal', { timeout: 8000 })
  ok('form lists both creatives', (await page.locator('.modal .creative-card').count()) === 2)
  ok('photo thumb renders in the card', (await page.locator('.modal .creative-thumb[src^="data:image"]').count()) === 1)
  await page.locator('.modal').getByRole('button', { name: 'Add creative' }).click()
  await page.locator('.modal .creative-card').nth(2).locator('input[placeholder="Creative name…"]').fill('Hook C — teachers')
  await page.locator('.modal .creative-card').nth(2).locator('textarea').fill('Testimonial, straight to camera')
  await page.locator('.modal').getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
  await page.waitForTimeout(500)
  const after = JSON.parse(((await req('/programs?channel=target')).data.find((p) => p.id === prog.id)).creatives)
  ok('a creative added through the form is saved', after.length === 3 && after[2].name === 'Hook C — teachers' && after[2].script.includes('Testimonial'))
  await page.screenshot({ path: 'r-creatives.png', fullPage: true })

  // ---- the whiteboard: a field you can run around ----
  await page.goto(BASE + '/admin')
  await page.getByRole('button', { name: 'Whiteboard' }).click()
  await page.waitForSelector('.board-inner', { timeout: 10000 })
  await page.waitForTimeout(800)
  const dims = await page.locator('.board-inner').evaluate((el) => ({ w: el.scrollWidth, h: el.scrollHeight }))
  ok('the field is 6000×4000 — room to run around', dims.w === 6000 && dims.h === 4000, JSON.stringify(dims))
  await page.locator('.board-canvas').evaluate((el) => { el.scrollLeft = 2200; el.scrollTop = 1400 })
  const before = await page.locator('.board-node').count()
  await page.getByRole('button', { name: 'Add role' }).click()
  await page.waitForSelector('.modal', { timeout: 8000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const nodes = await page.locator('.board-node').evaluateAll((els) => els.map((e) => ({ x: parseInt(e.style.left), y: parseInt(e.style.top) })))
  const fresh = nodes[nodes.length - 1]
  ok('a new card spawns where you are looking, not in the far corner',
    nodes.length === before + 1 && fresh.x >= 2200 && fresh.x <= 3200 && fresh.y >= 1400 && fresh.y <= 2200, JSON.stringify(fresh))
  await page.screenshot({ path: 'r-whiteboard.png' })
  await ctx.close()
}
await browser.close()

// ============ cleanup so the other suites' counts stay stable ============
for (const c of [doneVid, recNow, tmrw, in3, in7, inMonth, crewMiss, dueToday]) await req(`/content/${c.id}`, 'DELETE')
await req(`/programs/${prog.id}`, 'DELETE')
await req(`/users/${nod.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
