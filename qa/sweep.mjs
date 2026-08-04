// The whole-product sweep (not part of the gate loop — run by hand):
// every page × admin/member/crew × desktop/390px, watching for console
// errors, horizontal overflow and empty pages. Needs the seeded 4090 stack.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const crew = (await req('/users', 'POST', { name: 'Rustam Operator', username: 'rus', password: 'r1234', role: 'crew', crew_roles: ['operator', 'editor'] })).data
const ct = (await req('/content')).data.find((c) => c.type === 'video') || (await req('/content')).data[0]
if (ct && crew.id) await req(`/content/${ct.id}`, 'PATCH', { operator_id: crew.id })

const ROLES = [
  ['admin', 'admin123', ['/brief', '/overview', '/todo', '/missed', '/unassigned', '/docs', '/projects', '/dept/instagram_main', '/dept/youtube', '/crew', '/team', '/admin', '/profile']],
  ['jas', 'j1234', ['/brief', '/todo', '/missed', '/docs', '/dept/instagram_main', '/profile']],
  ['azi', 'a1234', ['/brief', '/todo', '/missed', '/docs', '/dept/telegram_uzb']],
  ['rus', 'r1234', ['/brief', '/profile']],
]
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const problems = []
for (const [u, pw, pages] of ROLES) {
  for (const [vw, vh, tag] of [[1440, 900, 'd'], [390, 844, 'm']]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } })
    const p = await ctx.newPage()
    let current = 'login'
    p.on('pageerror', (e) => problems.push(`${u} ${tag} ${current}: PAGEERROR ${e.message}`))
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404.*Not Found/.test(m.text())) problems.push(`${u} ${tag} ${current}: console ${m.text().slice(0, 120)}`) })
    await p.goto(BASE + '/login')
    await p.fill('input[name="username"]', u); await p.fill('input[name="password"]', pw)
    await p.click('button[type="submit"]'); await p.waitForURL(/brief|overview/, { timeout: 15000 })
    for (const path of pages) {
      current = path
      await p.goto(BASE + path); await p.waitForTimeout(900)
      const over = await p.evaluate(() => {
        const w = document.scrollingElement.scrollWidth - window.innerWidth
        return w > 2 ? w : 0
      })
      if (over) problems.push(`${u} ${tag} ${path}: H-OVERFLOW +${over}px`)
      const empty = await p.evaluate(() => document.querySelector('.content')?.innerText.trim().length ?? -1)
      if (empty === 0) problems.push(`${u} ${tag} ${path}: EMPTY PAGE`)
    }
    await ctx.close()
  }
}
await browser.close()
console.log(problems.length ? problems.join('\n') : 'SWEEP CLEAN — no console errors, no overflow, no empty pages')
