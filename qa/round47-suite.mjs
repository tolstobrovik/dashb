// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 47: the bot audited end to end. Two faults it turned up, now pinned:
// the bot met every message but /start and /stop with SILENCE, which reads
// exactly like a bot that has died; and a member who blocked it stayed
// "connected" forever, so the dashboard kept promising notifications Telegram
// would never deliver and kept calling an API that had already said no.
// Self-contained: 4102 + mock 9994.
import { spawn } from 'child_process'
import { createHash } from 'crypto'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4102'
const B = BASE + '/api'
const MOCK = 'http://localhost:9994'
const TOKEN = 'x47-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })

boot([SP + 'mock-tg.mjs'], { MOCK_PORT: '9994' })
boot([ROOT + '/server/index.js'], {
  DATA_DIR: SP + 'tg47-' + Date.now(), PORT: '4102',
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
const block = (ids) => fetch(MOCK + '/__block', { method: 'POST', body: JSON.stringify(ids) })
const hook = (update) => fetch(B + '/telegram/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
  body: JSON.stringify(update),
})

const chKey = (await req('/channels')).data[0]?.key
const m1 = (await req('/users', 'POST', { name: 'Bot One', username: 'x47a', password: 'probe123', role: 'member', departments: [chKey] })).data
const m2 = (await req('/users', 'POST', { name: 'Bot Two', username: 'x47b', password: 'probe123', role: 'member', departments: [chKey] })).data
const T1 = await login('x47a', 'probe123')
const T2 = await login('x47b', 'probe123')
for (const [tok, chat] of [[T1, 701], [T2, 702]]) {
  const l = (await req('/telegram/link', 'POST', {}, tok)).data
  await hook({ message: { chat: { id: chat }, text: `/start ${l.code}` } })
}

// ---- the bot is never silent ----
await reset()
await hook({ message: { chat: { id: 909 }, text: 'привет, а ты кто?' } })
let s = await sentList()
ok('a stranger’s message is answered', s.length === 1 && /Profile → Telegram/.test(s[0].text || ''), JSON.stringify(s[0]?.text || '').slice(0, 80))
await reset()
await hook({ message: { chat: { id: 701 }, text: '/help' } })
s = await sentList()
ok('a linked member is answered by name', s.length === 1 && /Bot One/.test(s[0].text || ''), JSON.stringify(s[0]?.text || '').slice(0, 80))
ok('…and told what the bot brings, and how to stop', /📌/.test(s[0]?.text || '') && /\/stop/.test(s[0]?.text || ''))
ok('…without being told to reconnect — they already are', !/Connect/.test(s[0]?.text || ''))

// ---- a member who blocked the bot ----
const sts = (await req('/statuses')).data
const stage = (re) => sts.find((x) => re.test(x.label)).id
const task = (await req('/content', 'POST', {
  title: 'x47: blocked-chat clip', channels: [chKey], type: 'video',
  assignee_ids: [m1.id], editor_id: m2.id, status_id: stage(/^shot$/i),
})).data
await block(['702'])
await reset()
await req(`/content/${task.id}`, 'PATCH', { status_id: stage(/editing/i) })
s = await sentList()
ok('one blocked chat does not silence the others', s.some((x) => String(x.chat_id) === '701' && !x.rejected),
  `delivered to ${s.filter((x) => !x.rejected).map((x) => x.chat_id).join(',') || 'nobody'}`)
ok('…and the refusal is not retried in plain text', s.filter((x) => String(x.chat_id) === '702').length === 1)
const admin = (await req('/telegram/admin')).data
ok('…the blocked member is no longer counted as connected', admin.members.find((u) => u.id === m2.id)?.linked === false)
ok('…while everyone else keeps their link', admin.members.find((u) => u.id === m1.id)?.linked === true)
await block([])
ok('…and they can connect again from Profile', !!(await req('/telegram/link', 'POST', {}, T2)).data.url)

// ---- the awkward lengths still behave (regression guard) ----
await reset()
await req(`/content/${task.id}/comments`, 'POST', { text: 'о'.repeat(3000) })
const long = (await sentList()).find((x) => /💬/.test(x.text || ''))
ok('a runaway comment is still delivered', !!long && long.rejected !== 'bad-html')
ok('…with its task link intact', !!long && /Open the task/.test(long.text))

for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } }
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-47 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
