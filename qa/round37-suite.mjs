// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 37: the Telegram bridge. Self-contained — boots its own server (4093)
// against a mock Telegram API (9979) with a test token, then pins the whole
// journey: status → link deep-link → webhook /start (secret-checked) → the
// bell mirrored on status moves and comments → nightly deadline push →
// admin-only setWebhook → unlink. Nothing here touches the 4090 stack.
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { chromium } from 'playwright'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4093'
const B = BASE + '/api'
const MOCK = 'http://localhost:9979'
const TOKEN = 'x37-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

// ---- boot the private stack ----
const procs = []
const boot = (args, env) => {
  const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' })
  procs.push(p)
  return p
}
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

boot([SP + 'mock-tg.mjs'], { MOCK_PORT: '9979' })
boot([ROOT + '/server/index.js'], {
  DATA_DIR: SP + 'tgdata-' + Date.now(), PORT: '4093',
  TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: MOCK,
})
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('mock Telegram is up', await up(MOCK + '/__sent'))
ok('the 4093 stack is up', await up(BASE + '/api/health'))

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const sentList = async () => (await (await fetch(MOCK + '/__sent')).json())
const hook = async (update, secret = SECRET) => fetch(B + '/telegram/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
  body: JSON.stringify(update),
})

// ---- status + link ----
const st0 = (await req('/telegram/status')).data
ok('the bridge reports enabled with the bot’s name', st0.enabled === true && st0.bot === 'SatashkentBot')

const chKey = (await req('/channels')).data[0]?.key
const member = (await req('/users', 'POST', { name: 'X37 Member', username: 'x37m', password: 'probe123', role: 'member', departments: [chKey] })).data
const MT = await login('x37m', 'probe123')
const link = (await req('/telegram/link', 'POST', {}, MT)).data
ok('Connect mints a t.me deep link with a code', /^https:\/\/t\.me\/SatashkentBot\?start=[0-9a-f]{16}$/.test(link.url || ''))

// ---- the webhook ----
const code = link.url.split('start=')[1]
const bad = await hook({ message: { chat: { id: 777 }, text: `/start ${code}` } }, 'wrong-secret')
ok('a webhook without the derived secret bounces', bad.status === 403)
await hook({ message: { chat: { id: 777 }, text: `/start ${code}` } })
ok('Start with the code links the account', (await req('/telegram/status', 'GET', undefined, MT)).data.linked === true)
ok('…and the bot said hello', (await sentList()).some((s) => s.method === 'sendMessage' && String(s.chat_id) === '777' && /Connected/.test(s.text || '')))

// ---- the mirrored bell ----
const shootId = (await req('/statuses')).data.find((s) => /to shoot/i.test(s.label)).id
const editId = (await req('/statuses')).data.find((s) => /editing/i.test(s.label)).id
const task = (await req('/content', 'POST', { title: 'x37: bridge video', channels: [chKey], type: 'video', assignee_ids: [member.id], status_id: shootId, operator_id: 1, recording_date: '2031-03-03', edit_ready_date: '2031-03-05', release_date: '2031-03-07' })).data
await fetch(MOCK + '/__reset', { method: 'POST' })
await req(`/content/${task.id}`, 'PATCH', { status_id: editId })
let sent = await sentList()
ok('a status move rings in Telegram', sent.some((s) => String(s.chat_id) === '777' && /x37: bridge video.*Editing/.test(s.text || '')), JSON.stringify(sent.map((s) => s.text)))
await req(`/content/${task.id}/comments`, 'POST', { text: 'посмотри интро ещё раз' })
sent = await sentList()
ok('a comment rings in Telegram', sent.some((s) => String(s.chat_id) === '777' && /посмотри интро/.test(s.text || '')))

// ---- the nightly deadline push ----
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + 864e5))
await req(`/content/${task.id}`, 'PATCH', { release_date: tomorrow })
await fetch(MOCK + '/__reset', { method: 'POST' })
const cron = await (await fetch(BASE + '/api/cron/daily')).json()
sent = await sentList()
ok('the nightly cron pushes deadline reminders', cron.reminded === 1 && sent.some((s) => String(s.chat_id) === '777' && /deadlines[\s\S]*Tomorrow[\s\S]*x37: bridge video» — the release/.test(s.text || '')))

// ---- admin-only webhook activation + test line ----
ok('setWebhook is the admin’s button', (await req('/telegram/set-webhook', 'POST', {}, MT)).status === 403)
await fetch(MOCK + '/__reset', { method: 'POST' })
const sw = (await req('/telegram/set-webhook', 'POST', { url: 'https://dash.example.com/api/telegram/webhook' })).data
sent = await sentList()
ok('setWebhook carries the derived secret', sw.ok === true && sent.some((s) => s.method === 'setWebhook' && s.secret_token === SECRET && /dash\.example\.com/.test(s.url || '')))
await req('/telegram/test', 'POST', {}, MT)
ok('the test line reaches the member', (await sentList()).some((s) => String(s.chat_id) === '777' && /bridge works/.test(s.text || '')))

// ---- unlink ----
await req('/telegram/unlink', 'POST', {}, MT)
ok('unlink forgets the chat', (await req('/telegram/status', 'GET', undefined, MT)).data.linked === false)
await fetch(MOCK + '/__reset', { method: 'POST' })
await req(`/content/${task.id}`, 'PATCH', { status_id: shootId })
ok('an unlinked member is left in peace', !(await sentList()).some((s) => String(s.chat_id) === '777'))

// ---- the Profile card ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'x37m'); await p.fill('input[name="password"]', 'probe123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview|brief|todo/, { timeout: 15000 })
await p.goto(BASE + '/profile'); await p.waitForTimeout(1000)
ok('Profile offers Connect Telegram', (await p.locator('button', { hasText: 'Connect Telegram' }).count()) === 1)
await p.close()
await browser.close()

stop()
console.log(fails === 0 ? '\nRound-37 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
