// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 38: the bot's admin panel. Self-contained (4095 + mock 9981): the
// admin sees the bridge and everyone's link state, unlinks a member by hand,
// broadcasts to the linked only; set-webhook teaches messages the public
// address, so the bell carries a tap-to-open task link from then on.
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { chromium } from 'playwright'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4095'
const B = BASE + '/api'
const MOCK = 'http://localhost:9981'
const TOKEN = 'x38-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

boot([SP + 'mock-tg.mjs'], { MOCK_PORT: '9981' })
boot([ROOT + '/server/index.js'], {
  DATA_DIR: SP + 'tg38-' + Date.now(), PORT: '4095',
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
const hook = async (update) => fetch(B + '/telegram/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
  body: JSON.stringify(update),
})

const chKey = (await req('/channels')).data[0]?.key
const member = (await req('/users', 'POST', { name: 'X38 Member', username: 'x38m', password: 'probe123', role: 'member', departments: [chKey] })).data
const MT = await login('x38m', 'probe123')

// ---- the admin picture ----
ok('the panel is the admin’s', (await req('/telegram/admin', 'GET', undefined, MT)).status === 403)
let adm = (await req('/telegram/admin')).data
ok('it knows the bot and the team', adm.enabled === true && adm.bot === 'SatashkentBot'
  && adm.members.some((m) => m.username === 'x38m' && m.linked === false))

// link the member the real way
const link = (await req('/telegram/link', 'POST', {}, MT)).data
await hook({ message: { chat: { id: 888 }, text: `/start ${link.code}` } })
adm = (await req('/telegram/admin')).data
ok('a fresh link shows up in the panel', adm.members.some((m) => m.username === 'x38m' && m.linked === true))

// ---- set-webhook teaches the public address → task links appear ----
await req('/telegram/set-webhook', 'POST', { url: 'https://dash.example.com/api/telegram/webhook' })
adm = (await req('/telegram/admin')).data
ok('the panel shows where the webhook points', adm.webhook?.url === 'https://dash.example.com/api/telegram/webhook'
  && adm.public_url === 'https://dash.example.com')
// Fixtures park on Shot, not To shoot: since round 66 the shooting stage is a
// BOOKING and demands a crew, three days and a brief. Shot is the same thing
// this suite actually wants — real work, past the Idea stage — without
// pretending to book a shoot these tests are not about.
const shotId = (await req('/statuses')).data.find((s) => /^shot$/i.test(s.label)).id
const editId = (await req('/statuses')).data.find((s) => /editing/i.test(s.label)).id
const task = (await req('/content', 'POST', { title: 'x38: linked video', channels: [chKey], type: 'video', assignee_ids: [member.id], status_id: shotId })).data
await fetch(MOCK + '/__reset', { method: 'POST' })
await req(`/content/${task.id}`, 'PATCH', { status_id: editId })
ok('the bell now carries a task link', (await sentList()).some((s) =>
  String(s.chat_id) === '888' && (s.text || '').includes(`https://dash.example.com/todo?task=${task.id}`)))

// ---- broadcast: linked only, admin only ----
ok('broadcast is the admin’s', (await req('/telegram/broadcast', 'POST', { text: 'nope' }, MT)).status === 403)
await fetch(MOCK + '/__reset', { method: 'POST' })
const cast = (await req('/telegram/broadcast', 'POST', { text: 'Планёрка в 15:00' })).data
const castSent = (await sentList()).filter((s) => s.method === 'sendMessage' && /Планёрка/.test(s.text || ''))
ok('the announcement reaches the linked only', cast.sent === 1 && castSent.length === 1 && String(castSent[0].chat_id) === '888')

// ---- admin unlink ----
ok('admin unlink needs admin', (await req('/telegram/admin/unlink', 'POST', { user_id: member.id }, MT)).status === 403)
await req('/telegram/admin/unlink', 'POST', { user_id: member.id })
adm = (await req('/telegram/admin')).data
ok('the panel reflects the unlink', adm.members.some((m) => m.username === 'x38m' && m.linked === false))
await fetch(MOCK + '/__reset', { method: 'POST' })
ok('a broadcast after unlink reaches nobody', (await req('/telegram/broadcast', 'POST', { text: 'echo?' })).data.sent === 0)

// ---- the tab itself ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.goto(BASE + '/admin'); await p.waitForTimeout(900)
await p.locator('.tabs .tab', { hasText: 'Telegram' }).click(); await p.waitForTimeout(1000)
ok('the tab shows the bot and the webhook', /(@SatashkentBot)[\s\S]*dash\.example\.com/.test(await p.locator('.card').first().textContent()))
ok('the team list renders with link states', (await p.locator('.alog-row', { hasText: 'X38 Member' }).count()) === 1)
ok('the broadcast line is there', (await p.locator('input[placeholder*="announcement"]').count()) === 1)
await p.close()
await browser.close()

stop()
console.log(fails === 0 ? '\nRound-38 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
