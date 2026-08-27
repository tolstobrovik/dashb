// Every screen, and every Admin tab, watching for what a page THROWS rather
// than what it shows.
//
// This exists because of a bug no other suite could see: an effect that
// returned a Promise instead of a cleanup function, so React called the
// Promise when the tab was left. It threw on UNMOUNT, which means opening the
// tab was fine, using it was fine, and the error only arrived when you moved
// on. Every test that opened one tab at a time passed.
//
// Rides the shared 4090 stack, which regress.sh has already seeded.
import { chromium } from 'playwright'
const B = 'http://localhost:4090'
const login = async (u, p) => (await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const api = async (p, m = 'GET', b) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const tag = Math.random().toString(36).slice(2, 6)
await api('/users', 'POST', { name: 'Sweep Member', username: 'sw' + tag, password: 'pass1234', role: 'member' })

const PAGES = ['/', '/brief', '/todo', '/releases', '/recordings', '/missed', '/missed-tasks',
  '/unassigned', '/docs', '/sprints', '/sprints/backlog', '/projects', '/crew', '/team', '/admin', '/profile']
const TABS = ['Team', 'Tasks', 'Whiteboard', 'Channels', 'Pipeline', 'Reports', 'Pay', 'Attendance', 'Language help', 'History', 'Telegram']

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
let problems = 0
const run = async (who, user, pass, pages) => {
  const p = await b.newPage({ viewport: { width: 1440, height: 950 } })
  const seen = []
  p.on('pageerror', (e) => seen.push(`${p.url().replace(B, '')} THREW ${e.message.slice(0, 110)}`))
  p.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !/favicon|fonts\.googleapis|ERR_CONNECTION_RESET|Failed to load resource/.test(t)) {
      seen.push(`${p.url().replace(B, '')} CONSOLE ${t.slice(0, 110)}`)
    }
  })
  p.on('response', (r) => {
    if (r.status() >= 500) seen.push(`${r.request().method()} ${r.url().replace(B, '')} → ${r.status()}`)
  })
  await p.goto(B + '/login')
  await p.fill('input[name=username]', user); await p.fill('input[name=password]', pass)
  await p.click('button[type=submit]'); await p.waitForTimeout(2400)
  for (const path of pages) {
    await p.goto(B + path); await p.waitForTimeout(1300)
    if (path === '/admin') {
      for (const t of TABS) {
        const tab = p.locator('.tab', { hasText: new RegExp(`^\\s*${t}\\s*$`, 'i') })
        if (await tab.count()) { await tab.first().click(); await p.waitForTimeout(1500) }
      }
    }
  }
  await p.close()
  const uniq = [...new Set(seen)]
  console.log(`${who}: ${uniq.length ? uniq.length + ' PROBLEMS' : 'clean'}`)
  for (const s of uniq.slice(0, 12)) console.log('   ' + s)
  problems += uniq.length
}
await run('admin ', 'admin', 'admin123', PAGES)
await run('member', 'sw' + tag, 'pass1234', ['/', '/brief', '/todo', '/missed', '/missed-tasks', '/docs', '/sprints', '/sprints/backlog', '/profile'])
await b.close()
console.log(problems === 0 ? '\nSweep clean.' : `\n${problems} problems`)
process.exit(problems ? 1 : 0)
