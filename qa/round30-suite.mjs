// Round 30: the design pass. Every working board column grew a foot input —
// type a title, Enter, the task lands in that stage on that channel, and the
// input stays put for the next one. Published and Deleted columns don't
// offer it (you plan work, you don't create it finished), and only people
// with manage_content see it at all.
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
  for (const c of (await req('/content')).data.filter((c) => /x30:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
  for (const u of (await req('/users')).data.filter((u) => u.username === 'x30nope')) await req(`/users/${u.id}`, 'DELETE')
}
await cleanup()
// Members hold manage_content by default — the negative probe needs it
// explicitly withdrawn.
await req('/users', 'POST', { name: 'No-Edit Member', username: 'x30nope', password: 'n1234', role: 'member', departments: ['telegram_uzb'], permissions: { manage_content: false } })
const statuses = (await req('/statuses')).data
const working = statuses.filter((s) => !s.is_final && !/^deleted$/i.test(s.label.trim()))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.goto(BASE + '/dept/youtube'); await p.waitForTimeout(1100)
ok('every working column offers quick add — finished ones don’t',
  (await p.locator('.board-quick-btn').count()) === working.length,
  `${await p.locator('.board-quick-btn').count()} vs ${working.length}`)
// add into the second working column, not the default first stage
const col = p.locator('.board-col', { hasText: working[1].label }).first()
await col.locator('.board-quick-btn').click()
await col.locator('.board-quick-input').fill('x30: straight into the stage')
await col.locator('.board-quick-input').press('Enter')
await p.waitForTimeout(900)
const made = (await req('/content')).data.find((c) => c.title === 'x30: straight into the stage')
ok('Enter lands the task in that very stage', !!made && made.status_id === working[1].id)
ok('…on this channel', !!made && made.channels.length === 1 && made.channels[0] === 'youtube')
ok('…and the card is already on the board', (await col.locator('.tcard', { hasText: 'x30: straight into the stage' }).count()) === 1)
ok('the input stays for the next title', (await col.locator('.board-quick-input').count()) === 1
  && (await col.locator('.board-quick-input').inputValue()) === '')
await col.locator('.board-quick-input').press('Escape')
ok('Escape folds it back', (await col.locator('.board-quick-btn').count()) === 1)
await p.close()

// no manage_content — no foot inputs
const m = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
await m.goto(BASE + '/login')
await m.fill('input[name="username"]', 'x30nope'); await m.fill('input[name="password"]', 'n1234')
await m.click('button[type="submit"]'); await m.waitForURL(/brief/, { timeout: 15000 })
await m.goto(BASE + '/dept/telegram_uzb'); await m.waitForTimeout(1100)
ok('no quick add without manage_content', (await m.locator('.board-quick-btn').count()) === 0)
await m.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-30 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
