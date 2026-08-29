// Round 35: ideas are brainstorm material — a task in the Idea stage never
// nags on the Unassigned page or in Overview's gap strip; the gaps start to
// count the moment it moves into real work (To shoot onward).
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
  for (const c of (await req('/content')).data.filter((c) => /x35:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
}
await cleanup()
const statuses = (await req('/statuses')).data
// "Real work" is Shot rather than To shoot since round 66: the shooting stage
// is a BOOKING now, and a properly booked shoot has its crew and its days by
// definition — so it has no gaps left to show, which would test nothing. Shot
// is the same step in this round's terms (out of the brainstorm, into the
// pipeline) and still carries the holes the gap views exist for.
const shotId = statuses.find((s) => /^editing$/i.test(s.label)).id
const me = (await req('/auth/me')).data.user
// an idea with every gap in the book (default status = the Idea stage)
const idea = (await req('/content', 'POST', { title: 'x35: idea video', channels: ['youtube'], type: 'video' })).data

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.waitForTimeout(1000)
const stripN = async () => {
  const el = p.locator('.ov-gaps')
  if ((await el.count()) === 0) return 0
  return Number(((await el.textContent()).match(/(\d+)\s+task/) || [0, 0])[1])
}
const beforeN = await stripN()
await p.goto(BASE + '/unassigned'); await p.waitForTimeout(1100)
ok('an Idea-stage task never reaches Unassigned', (await p.locator('.ov-row', { hasText: 'x35: idea video' }).count()) === 0)
// Move it into real work — now the gaps are real. Landing on Shot names the
// editor (footage with nobody cutting it is refused since round 66); the days
// are still missing, and those are the gaps this round is about.
await req(`/content/${idea.id}`, 'PATCH', { editor_id: me.id })
const movedIn = await req(`/content/${idea.id}`, 'PATCH', { status_id: shotId })
ok('the idea really moved into real work', movedIn.status === 200, `${movedIn.status} ${movedIn.data.error || ''}`)
await p.reload(); await p.waitForTimeout(1100)
ok('…but the moment it leaves the brainstorm, it appears', (await p.locator('.ov-row', { hasText: 'x35: idea video' }).count()) === 1)
await p.goto(BASE + '/overview'); await p.waitForTimeout(1100)
ok('Overview’s strip agrees — the idea joined the count only now', (await stripN()) === beforeN + 1, `${beforeN} → ${await stripN()}`)
await p.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-35 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
