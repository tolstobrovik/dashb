// Round 31: the bell (status-change events for everyone on the task, plus
// deadline reminders computed a day and a week out), calendar pills wearing
// their stage glyphs with killed work staying on the month — dimmed, struck,
// status written under the title — and crew views that fit the capability:
// an editor-only account never stares at an empty SHOOT column.
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
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + d * 864e5))
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x31:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
  for (const u of (await req('/users')).data.filter((u) => u.username === 'x31solo')) await req(`/users/${u.id}`, 'DELETE')
}
await cleanup()
const users = (await req('/users')).data
const jas = users.find((u) => u.username === 'jas')
const statuses = (await req('/statuses')).data
const delSt = statuses.find((s) => /^deleted$/i.test(s.label))
const shotSt = statuses.find((s) => /^shot$/i.test(s.label))

// ---- 1) the API: events + computed reminders ----
const moving = (await req('/content', 'POST', { title: 'x31: moving video', channels: ['instagram_main'], type: 'video', editor_id: jas.id })).data
await req(`/content/${moving.id}`, 'PATCH', { status_id: shotSt.id })
await req('/content', 'POST', { title: 'x31: due tomorrow', channels: ['instagram_main'], type: 'post', assignee_ids: [jas.id], release_date: iso(1) })
await req('/content', 'POST', { title: 'x31: due in a week', channels: ['instagram_main'], type: 'post', assignee_ids: [jas.id], release_date: iso(7) })
const jasT = await login('jas', 'j1234')
let notif = (await req('/notifications', 'GET', null, jasT)).data
ok('a status move writes the event for the crew', notif.events.some((e) => /x31: moving video.*Shot.*Admin/.test(e.text)))
ok('the mover gets no echo', !(await req('/notifications')).data.events.some((e) => /x31: moving video/.test(e.text)))
ok('the day-before reminder is computed', notif.reminders.some((r) => /x31: due tomorrow.*tomorrow/.test(r.text)))
ok('…and the week-before one', notif.reminders.some((r) => /x31: due in a week.*in a week/.test(r.text)))
await req('/notifications/read-all', 'POST', null, jasT)
notif = (await req('/notifications', 'GET', null, jasT)).data
ok('read-all quiets the events', notif.events.every((e) => !!e.read_at))

// ---- 2) the bell in the chrome ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'jas'); await p.fill('input[name="password"]', 'j1234')
await p.click('button[type="submit"]'); await p.waitForURL(/brief/, { timeout: 15000 })
await p.waitForTimeout(1200)
ok('the badge counts the fresh reminders', Number(await p.locator('.notif-badge').first().textContent().catch(() => 0)) >= 2)
await p.locator('.notif-wrap button').first().click(); await p.waitForTimeout(400)
ok('the panel lists them', (await p.locator('.notif-row').count()) >= 2)
await p.locator('.notif-row', { hasText: 'x31: due tomorrow' }).first().click()
await p.waitForURL(/todo\?task=/, { timeout: 8000 }); await p.waitForTimeout(1200)
ok('a row opens its task', (await p.locator('.modal .cm-title').inputValue().catch(() => '')).includes('x31: due tomorrow'))
await p.keyboard.press('Escape')
await p.close()

// ---- 3) killed work stays on the calendar, labeled ----
const dead = (await req('/content', 'POST', { title: 'x31: killed reel', channels: ['instagram_main'], type: 'reel', release_date: iso(2) })).data
await req(`/content/${dead.id}`, 'PATCH', { status_id: delSt.id })
const a = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
a.on('pageerror', (e) => { fails++; console.log('ADMIN PAGE ERROR', e.message) })
await a.goto(BASE + '/login')
await a.fill('input[name="username"]', 'admin'); await a.fill('input[name="password"]', 'admin123')
await a.click('button[type="submit"]'); await a.waitForURL(/overview/, { timeout: 15000 })
await a.goto(BASE + '/dept/instagram_main'); await a.waitForTimeout(1000)
await a.locator('.pill', { hasText: 'Releases' }).click(); await a.waitForTimeout(800)
const deadPill = a.locator('.rel-ev.cal-dead', { hasText: 'x31: killed reel' })
ok('the killed reel stays on the month', (await deadPill.count()) === 1)
ok('…with its status written under the title', ((await deadPill.textContent().catch(() => ''))).includes(delSt.label))
ok('every pill wears its stage glyph', (await a.locator('.rel-ev svg').count()) >= (await a.locator('.rel-ev').count()))
await a.close()

// ---- 4) an editor-only account gets one lane ----
await req('/users', 'POST', { name: 'Solo Editor', username: 'x31solo', password: 'e1234', role: 'editor' })
const e = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
e.on('pageerror', (err) => { fails++; console.log('EDITOR PAGE ERROR', err.message) })
await e.goto(BASE + '/login')
await e.fill('input[name="username"]', 'x31solo'); await e.fill('input[name="password"]', 'e1234')
await e.click('button[type="submit"]'); await e.waitForURL(/brief/, { timeout: 15000 })
await e.waitForTimeout(900)
ok('one lane, sized for one craft', (await e.locator('.cb-col').count()) === 1 && (await e.locator('.crew-board.one-lane').count()) === 1)
ok('no empty SHOOT column in sight', (await e.locator('.cb-col-head', { hasText: 'SHOOT' }).count()) === 0)
await e.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-31 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
