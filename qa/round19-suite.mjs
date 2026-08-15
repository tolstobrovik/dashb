// Round 19: the personal sidebar (hide channels, drag your own order, all
// remembered per browser) and one-tap crew milestones — a tick applies
// instantly, no separate Save click.
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

// ---- 1) sidebar personalization (admin, desktop) ----
// Channel names are read live — earlier suites in the gate rename channels.
const chans = (await req('/channels')).data
const hideA = chans[2], hideB = chans[4], dragMe = chans[chans.length - 1], firstChan0 = chans[0]
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.waitForTimeout(600)
ok('Personalize toggle sits under the channels', (await p.locator('.side-edit-btn', { hasText: 'Personalize' }).count()) === 1)
await p.locator('.side-edit-btn', { hasText: 'Personalize' }).click()
ok('edit mode lists every channel with an eye', (await p.locator('.side-edit-row.grp-channels').count()) === chans.length)
// hide Telegram Uzb + Target
await p.locator('.side-edit-row.grp-channels', { hasText: hideA.label }).locator('.side-eye').last().click()
await p.locator('.side-edit-row.grp-channels', { hasText: hideB.label }).locator('.side-eye').last().click()
// drag YouTube to the top
await p.locator('.side-edit-row.grp-channels', { hasText: dragMe.label }).dragTo(p.locator('.side-edit-row.grp-channels').first())
await p.locator('.side-edit-btn', { hasText: 'Done' }).click()
const side1 = await p.locator('.sidebar nav').textContent()
ok('hidden channels left the sidebar', !side1.includes(hideA.label) && !side1.includes(hideB.label))
ok('badge shows how many are hidden', side1.includes('2 hidden'))
const firstChan = await p.locator('.sidebar .nav-item', { hasText: dragMe.label }).boundingBox()
const igChan = await p.locator('.sidebar .nav-item', { hasText: firstChan0.label }).boundingBox()
ok('dragged channel sits above the old first', firstChan && igChan && firstChan.y < igChan.y)
// persistence across reload
await p.reload(); await p.waitForSelector('.sidebar nav', { timeout: 10000 }); await p.waitForTimeout(800)
const side2 = await p.locator('.sidebar nav').textContent()
ok('preferences survive a reload', !side2.includes(hideA.label) && side2.includes('2 hidden'))
// hidden channel still reachable by URL (view-only preference)
await p.goto(BASE + `/dept/${hideB.key}`); await p.waitForTimeout(900)
ok('hidden channel page still opens by URL', (await p.locator('.topbar h1').textContent()).includes(hideB.label))
// reset
await p.locator('.side-edit-btn', { hasText: /Personalize/ }).click()
await p.locator('.side-edit-btn', { hasText: 'Reset' }).click()
await p.locator('.side-edit-btn', { hasText: 'Done' }).click()
ok('reset restores everything', (await p.locator('.sidebar nav').textContent()).includes(hideA.label))
await p.screenshot({ path: 'v19-sidebar.png' })
await ctx.close()

// ---- 2) instant crew milestone (one tap, no Save) ----
const op = (await req('/users', 'POST', { name: 'Odil Operator', username: 'x19op', password: 'o1234', role: 'operator' })).data
const fmtT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const t1 = (await req('/content', 'POST', { title: 'x19: tick shoot', channels: ['youtube'], type: 'video', operator_id: op.id, recording_date: fmtT, recording_time: '16:00', edit_ready_date: fmtT, release_date: fmtT })).data
const c = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
c.on('pageerror', (e) => { fails++; console.log('CREW PAGE ERROR', e.message) })
await c.goto(BASE + '/login')
await c.fill('input[name="username"]', 'x19op'); await c.fill('input[name="password"]', 'o1234')
await c.click('button[type="submit"]'); await c.waitForURL(/brief/, { timeout: 15000 }); await c.waitForTimeout(900)
await c.locator('.cb-row', { hasText: 'x19: tick shoot' }).click()
await c.waitForSelector('.modal', { timeout: 8000 })
await c.locator('.modal .do-tick', { hasText: 'Mark as shot' }).click()
await c.waitForTimeout(900)
const statuses = (await req('/statuses')).data
const shotId = statuses.find((s) => /^shot$/i.test(s.label)).id
const after = (await req('/content')).data.find((x) => x.id === t1.id)
ok('one tap marked it Shot — no Save click', after.status_id === shotId, `status=${after.status_id}`)
ok('the modal stayed open for link drops', (await c.locator('.modal').count()) === 1)
ok('a toast confirmed it', /shot/i.test(await c.locator('.toasts').textContent().catch(() => '')))
await c.screenshot({ path: 'v19-instant-tick.png' })
await browser.close()

// cleanup
for (const x of (await req('/content')).data.filter((x) => /x19:/.test(x.title))) await req(`/content/${x.id}`, 'DELETE')
await req(`/users/${op.id}`, 'DELETE')
console.log(fails === 0 ? '\nRound-19 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
