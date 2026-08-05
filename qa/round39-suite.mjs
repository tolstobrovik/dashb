// Round 39: the bridge under fire — every scenario a real team hits. A
// linked member re-links from a NEW chat and the old one goes quiet; /start
// with no code or a foreign code gets a hint, never a crash; /stop twice is
// polite both times; a task in Deleted stays out of the nightly digest; a
// runaway-long text is clipped under Telegram's 4096 limit; and the Profile
// buttons can't double-fire. Self-contained: 4097 + mock 9983.
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { chromium } from 'playwright'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4097'
const B = BASE + '/api'
const MOCK = 'http://localhost:9983'
const TOKEN = 'x39-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

boot([SP + 'mock-tg.mjs'], { MOCK_PORT: '9983' })
boot(['/home/user/dashb/server/index.js'], {
  DATA_DIR: SP + 'tg39-' + Date.now(), PORT: '4097',
  TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: MOCK,
})
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('mock + stack are up', (await up(MOCK + '/__sent')) && (await up(BASE + '/api/health')))

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const sentList = async () => (await (await fetch(MOCK + '/__sent')).json())
const reset = () => fetch(MOCK + '/__reset', { method: 'POST' })
const hook = async (update) => fetch(B + '/telegram/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
  body: JSON.stringify(update),
})
const msg = (chat, text) => hook({ message: { chat: { id: chat }, text } })

const chKey = (await req('/channels')).data[0]?.key
const member = (await req('/users', 'POST', { name: 'X39 Member', username: 'x39m', password: 'probe123', role: 'member', departments: [chKey] })).data
const MT = await login('x39m', 'probe123')

// ---- lost visitors get hints, never crashes ----
await reset()
await msg(500, '/start')
ok('/start with no code gets the hint', (await sentList()).some((s) => String(s.chat_id) === '500' && /Profile → Telegram/.test(s.text || '')))
await reset()
await msg(500, '/start deadbeefdeadbeef')
ok('/start with a foreign code gets the hint too', (await sentList()).some((s) => String(s.chat_id) === '500' && /Profile → Telegram/.test(s.text || '')))
await reset()
await msg(500, '/stop')
const stopped = await sentList()
ok('/stop from a stranger answers politely', stopped.every((s) => !/crash|error/i.test(s.text || '')))
ok('random chatter is ignored quietly', (await msg(500, 'привет бот')).status === 200)

// ---- link, then RE-link from a new phone ----
const l1 = (await req('/telegram/link', 'POST', {}, MT)).data
await msg(700, `/start ${l1.code}`)
ok('first link lands', (await req('/telegram/status', 'GET', undefined, MT)).data.linked === true)
const l2 = (await req('/telegram/link', 'POST', {}, MT)).data
ok('re-Connect mints a fresh code', l2.code !== l1.code)
await reset()
await msg(701, `/start ${l2.code}`)
ok('the new chat takes over', (await sentList()).some((s) => String(s.chat_id) === '701' && /Connected/.test(s.text || '')))
await reset()
await msg(700, `/start ${l1.code}`)
ok('the OLD code is dead after re-linking', (await sentList()).some((s) => String(s.chat_id) === '700' && /Profile → Telegram/.test(s.text || '')))

// the bell follows the person to the new chat only
const shootId = (await req('/statuses')).data.find((s) => /to shoot/i.test(s.label)).id
const editId = (await req('/statuses')).data.find((s) => /editing/i.test(s.label)).id
const task = (await req('/content', 'POST', { title: 'x39: moved phone video', channels: [chKey], type: 'video', assignee_ids: [member.id], status_id: shootId })).data
await reset()
await req(`/content/${task.id}`, 'PATCH', { status_id: editId })
const afterMove = await sentList()
ok('the bell rings the new chat', afterMove.some((s) => String(s.chat_id) === '701'))
ok('…and never the old one', !afterMove.some((s) => String(s.chat_id) === '700'))

// ---- /stop twice: polite both times, and quiet after ----
await reset()
await msg(701, '/stop')
ok('/stop unlinks', (await req('/telegram/status', 'GET', undefined, MT)).data.linked === false)
ok('…with a farewell', (await sentList()).some((s) => String(s.chat_id) === '701' && /Disconnected/.test(s.text || '')))
await reset()
await msg(701, '/stop')
ok('a second /stop does not crash', true)
await req(`/content/${task.id}`, 'PATCH', { status_id: shootId })
ok('a stopped chat hears nothing more', !(await sentList()).some((s) => String(s.chat_id) === '701' && /🔔/.test(s.text || '')))

// ---- the nightly digest skips killed work ----
const l3 = (await req('/telegram/link', 'POST', {}, MT)).data
await msg(702, `/start ${l3.code}`)
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + 864e5))
await req(`/content/${task.id}`, 'PATCH', { release_date: tomorrow })
const deadId = (await req('/statuses')).data.find((s) => /^deleted$/i.test(s.label)).id
const killed = (await req('/content', 'POST', { title: 'x39: killed launch', channels: [chKey], type: 'post', assignee_ids: [member.id], release_date: tomorrow, status_id: deadId })).data
await reset()
await fetch(BASE + '/api/cron/daily')
const digest = (await sentList()).find((s) => String(s.chat_id) === '702' && /Deadlines/.test(s.text || ''))
ok('the digest names the live release', !!digest && /moved phone video/.test(digest.text))
ok('…and never the killed one', !!digest && !/killed launch/.test(digest.text))

// ---- runaway text is clipped under Telegram's 4096 ----
await reset()
await req('/telegram/broadcast', 'POST', { text: 'Ж'.repeat(2990) })
const big = (await sentList()).find((s) => /Ж/.test(s.text || ''))
ok('a huge broadcast still goes out', !!big)
ok('…clipped under the 4096 limit', !!big && big.text.length <= 4096)
await req(`/content/${killed.id}`, 'DELETE')

// ---- the Profile buttons cannot double-fire ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'x39m'); await p.fill('input[name="password"]', 'probe123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview|brief|todo/, { timeout: 15000 })
await p.goto(BASE + '/profile'); await p.waitForTimeout(1000)
await reset()
// hammer Send a test five times as fast as the DOM allows
const testBtn = p.locator('button', { hasText: 'Send a test' })
ok('the linked card shows Send a test', (await testBtn.count()) === 1)
for (let i = 0; i < 5; i++) await testBtn.click({ force: true }).catch(() => {})
await p.waitForTimeout(1200)
const hello = (await sentList()).filter((s) => /bridge works/.test(s.text || ''))
ok('five frantic clicks send ONE test line', hello.length === 1, `sent=${hello.length}`)
await p.close()
await browser.close()

stop()
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-39 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
