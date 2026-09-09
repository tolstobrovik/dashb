// Round 26: filters on the Unassigned page — a date window, a person, a
// channel, and the gap kinds themselves, where each kind-pill cycles
// include → exclude → off. Excluding a kind stops it counting: a task whose
// only hole is excluded leaves the page; tasks with other holes stay.
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
  for (const c of (await req('/content')).data.filter((c) => /x26:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
}
await cleanup()
const users = (await req('/users')).data
const jas = users.find((u) => u.username === 'jas')
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + d * 864e5))
// three shapes: a post today whose ONLY hole is the designer; a reel on jas
// missing only its editor; a dateless video missing nearly everything —
// All in Shot: round 35 keeps Idea-stage tasks off the gap views, and since
// round 66 the shooting stage is a BOOKING that refuses exactly the holes this
// page exists to show — work logged after the fact is where they live now.
const shootId = (await req('/statuses')).data.find((s) => /^shot$/i.test(s.label)).id
await req('/content', 'POST', { title: 'x26: designer post', channels: ['telegram_main'], type: 'post', assignee_ids: [jas.id], release_date: iso(0), status_id: shootId })
await req('/content', 'POST', { title: 'x26: editor reel', channels: ['instagram_main'], type: 'reel', assignee_ids: [jas.id], operator_id: jas.id, release_date: iso(1), recording_date: iso(0), status_id: shootId })
await req('/content', 'POST', { title: 'x26: dateless video', channels: ['youtube'], type: 'video', status_id: shootId })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.goto(BASE + '/unassigned'); await p.waitForTimeout(1200)
const row = (t) => p.locator('.ov-row', { hasText: t })
ok('all three seeded gaps at rest', (await row('x26: designer post').count()) === 1
  && (await row('x26: editor reel').count()) === 1 && (await row('x26: dateless video').count()) === 1)

// date window
await p.locator('.pill', { hasText: 'Today' }).click(); await p.waitForTimeout(400)
ok('Today keeps today’s post', (await row('x26: designer post').count()) === 1)
ok('…and hides the undated video', (await row('x26: dateless video').count()) === 0)
await p.locator('.pill', { hasText: 'Any date' }).click(); await p.waitForTimeout(300)

// channel
await p.locator('.miss-filters .pill', { hasText: 'YouTube' }).click(); await p.waitForTimeout(400)
ok('the channel pill narrows to its channel', (await row('x26: dateless video').count()) === 1
  && (await row('x26: designer post').count()) === 0)
await p.locator('.miss-filters .pill', { hasText: 'All' }).first().click(); await p.waitForTimeout(300)

// person
await p.selectOption('.gap-person', String(jas.id)); await p.waitForTimeout(400)
ok('the person filter keeps her tasks', (await row('x26: designer post').count()) === 1
  && (await row('x26: editor reel').count()) === 1)
ok('…and drops the task she isn’t on', (await row('x26: dateless video').count()) === 0)
await p.selectOption('.gap-person', '0'); await p.waitForTimeout(300)

// gap kinds: include, then exclude
const des = p.locator('.pill', { hasText: 'Designer' })
await des.click(); await p.waitForTimeout(400)
ok('include-Designer keeps only designer gaps', (await row('x26: designer post').count()) === 1
  && (await row('x26: editor reel').count()) === 0)
await des.click(); await p.waitForTimeout(400)
ok('exclude-Designer drops the designer-only post', (await row('x26: designer post').count()) === 0)
ok('…but keeps tasks with other holes', (await row('x26: editor reel').count()) === 1
  && (await row('x26: dateless video').count()) === 1)
ok('the pill wears the strike', (await p.locator('.pill-not', { hasText: 'Designer' }).count()) === 1)
await p.locator('.pill-clear').click(); await p.waitForTimeout(400)
ok('Clear brings everything home', (await row('x26: designer post').count()) === 1
  && (await row('x26: editor reel').count()) === 1 && (await row('x26: dateless video').count()) === 1)
await p.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-26 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
