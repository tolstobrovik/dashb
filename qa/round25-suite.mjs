// Round 25: the perfection pass. Overview wears a quiet strip pointing at the
// Unassigned page while gaps exist; the most-misses tile on Statistics is a
// shortcut straight into that person's receipts; and the /missed page fits a
// phone again (the chevron was poking past the edge).
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x25:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
}
await cleanup()
const users = (await req('/users')).data
const jas = users.find((u) => u.username === 'jas')
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + d * 864e5))
// Seeds start in Shot: Idea-stage tasks sit out the gap views (round 35), and
// since round 66 the shooting stage is a BOOKING that refuses exactly the
// holes this page exists to show. Work logged after the fact is where those
// holes really live now, and Shot is where it lands.
const shootId = (await req('/statuses')).data.find((s) => /^editing$/i.test(s.label)).id
await req('/content', 'POST', { title: 'x25: gap video', channels: ['youtube'], type: 'video', status_id: shootId })
await req('/content', 'POST', { title: 'x25: late post', channels: ['instagram_main'], type: 'post', assignees: [jas.id], designer_id: jas.id, release_date: iso(-1), status_id: shootId })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.waitForTimeout(1000)
ok('Overview wears the gap strip', (await p.locator('.ov-gaps').count()) === 1)
ok('…with a live count', /\d+ tasks? waiting/.test(await p.locator('.ov-gaps').textContent()))
await p.locator('.ov-gaps').click()
await p.waitForURL(/unassigned/, { timeout: 8000 })
ok('the strip lands on Unassigned', p.url().includes('/unassigned'))
await p.waitForTimeout(1200)
ok('and the gap task is there', (await p.locator('.ov-row', { hasText: 'x25: gap video' }).count()) === 1)

await p.goto(BASE + '/missed'); await p.waitForTimeout(1200)
const tile = p.locator('.miss-stat-btn')
ok('the most-misses tile is a button', (await tile.count()) === 1)
await tile.click(); await p.waitForTimeout(500)
ok('…that opens that person’s receipts', (await p.locator('.miss-person-tasks .ov-row').count()) >= 1)
await p.close()

// the phone fit: no horizontal scroll on /missed at 390px
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
await m.goto(BASE + '/login')
await m.fill('input[name="username"]', 'admin'); await m.fill('input[name="password"]', 'admin123')
await m.click('button[type="submit"]'); await m.waitForURL(/overview/, { timeout: 15000 })
await m.goto(BASE + '/missed'); await m.waitForTimeout(1000)
const over = await m.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth)
ok('statistics fits a phone', over <= 2, `overflow ${over}px`)
await m.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-25 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
