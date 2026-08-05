// Round 40: the messages grow up. Every Telegram line carries its task link
// IMMEDIATELY — before the admin ever presses Activate, the link borrows the
// address the triggering request arrived on; after activation the remembered
// public origin wins. Status moves name who moved and the release day; the
// comment cut shows who spoke on what; the nightly digest links every line.
// Self-contained: 4098 + mock 9984.
import { spawn } from 'child_process'
import { createHash } from 'crypto'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4098'
const B = BASE + '/api'
const MOCK = 'http://localhost:9984'
const TOKEN = 'x40-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

boot([SP + 'mock-tg.mjs'], { MOCK_PORT: '9984' })
boot(['/home/user/dashb/server/index.js'], {
  DATA_DIR: SP + 'tg40-' + Date.now(), PORT: '4098',
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

const chKey = (await req('/channels')).data[0]?.key
const member = (await req('/users', 'POST', { name: 'X40 Member', username: 'x40m', password: 'probe123', role: 'member', departments: [chKey] })).data
const MT = await login('x40m', 'probe123')
const link = (await req('/telegram/link', 'POST', {}, MT)).data
await hook({ message: { chat: { id: 900 }, text: `/start ${link.code}` } })

// ---- links immediately: NO set-webhook has happened on this stack ----
const shootId = (await req('/statuses')).data.find((s) => /to shoot/i.test(s.label)).id
const editId = (await req('/statuses')).data.find((s) => /editing/i.test(s.label)).id
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + 864e5))
const task = (await req('/content', 'POST', {
  title: 'x40: rich video', channels: [chKey], type: 'video',
  assignee_ids: [member.id], status_id: shootId, release_date: tomorrow,
})).data
await reset()
await req(`/content/${task.id}`, 'PATCH', { status_id: editId })
let m = (await sentList()).find((s) => String(s.chat_id) === '900' && /🔔/.test(s.text || ''))
ok('the very first bell already carries the link', !!m && m.text.includes(`http://localhost:4098/todo?task=${task.id}`), m?.text)
ok('…names who moved it', !!m && /by Admin/.test(m.text))
ok('…and the release day', !!m && m.text.includes(`release ${tomorrow}`))

// ---- the comment cut: who spoke, on what, the words, the link ----
await reset()
await req(`/content/${task.id}/comments`, 'POST', { text: 'интро переснимаем завтра' })
m = (await sentList()).find((s) => String(s.chat_id) === '900' && /💬/.test(s.text || ''))
ok('a comment names the speaker and the task', !!m && /💬 Admin — «x40: rich video»:/.test(m.text))
ok('…quotes the words on their own line', !!m && /\nинтро переснимаем завтра/.test(m.text))
ok('…and links the task', !!m && m.text.includes(`/todo?task=${task.id}`))

// ---- once activated, the remembered origin wins over the request host ----
await req('/telegram/set-webhook', 'POST', { url: 'https://team.example.org/api/telegram/webhook' })
await reset()
await req(`/content/${task.id}`, 'PATCH', { status_id: shootId })
m = (await sentList()).find((s) => String(s.chat_id) === '900' && /🔔/.test(s.text || ''))
ok('after Activate the public origin takes over', !!m && m.text.includes(`https://team.example.org/todo?task=${task.id}`)
  && !m.text.includes('localhost:4098'))

// ---- the nightly digest links every line ----
await reset()
const cron = await (await fetch(BASE + '/api/cron/daily')).json()
m = (await sentList()).find((s) => String(s.chat_id) === '900' && /Deadlines/.test(s.text || ''))
ok('the digest still fires', cron.reminded === 1 && !!m)
ok('…and each line carries its own link', !!m && m.text.includes(`https://team.example.org/todo?task=${task.id}`))

stop()
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-40 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
