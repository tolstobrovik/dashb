// Round 41: handed work rings its person. Creating a task with hats notifies
// every hat-holder (owner/operator/editor/designer, both channels — bell and
// Telegram) with the hat named and the date worth knowing; adding a hat later
// notifies only the NEW name; re-saving the same hat notifies nobody; the
// assigner never hears their own assignment; and a Pravki carries the actual
// note to the one who owes the fix. Self-contained: 4099 + mock 9985.
import { spawn } from 'child_process'
import { createHash } from 'crypto'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4099'
const B = BASE + '/api'
const MOCK = 'http://localhost:9985'
const TOKEN = 'x41-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

boot([SP + 'mock-tg.mjs'], { MOCK_PORT: '9985' })
boot(['/home/user/dashb/server/index.js'], {
  DATA_DIR: SP + 'tg41-' + Date.now(), PORT: '4099',
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
const m1 = (await req('/users', 'POST', { name: 'Mira One', username: 'x41a', password: 'probe123', role: 'member', departments: [chKey] })).data
const m2 = (await req('/users', 'POST', { name: 'Aziz Two', username: 'x41b', password: 'probe123', role: 'member', departments: [chKey] })).data
const T1 = await login('x41a', 'probe123')
const T2 = await login('x41b', 'probe123')
for (const [tok, chat] of [[T1, 111], [T2, 222]]) {
  const l = (await req('/telegram/link', 'POST', {}, tok)).data
  await hook({ message: { chat: { id: chat }, text: `/start ${l.code}` } })
}

// ---- creating with hats rings every hat-holder, with the hat named ----
const shootId = (await req('/statuses')).data.find((s) => /to shoot/i.test(s.label)).id
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + 864e5))
await reset()
const task = (await req('/content', 'POST', {
  title: 'x41: handed video', channels: [chKey], type: 'video',
  assignee_ids: [m1.id], editor_id: m2.id, status_id: shootId, recording_date: tomorrow,
})).data
let sent = await sentList()
const to1 = sent.find((s) => String(s.chat_id) === '111' && /📌/.test(s.text || ''))
const to2 = sent.find((s) => String(s.chat_id) === '222' && /📌/.test(s.text || ''))
ok('the owner hears about the fresh task', !!to1 && /you're the owner/.test(to1.text), to1?.text)
ok('…the editor too, with THEIR hat named', !!to2 && /you're the editor/.test(to2.text))
const humanDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
ok('…the shoot day rides along, human-sized', !!to2 && to2.text.includes(`shoot ${humanDate(tomorrow)}`))
ok('…and the task link', !!to2 && to2.text.includes(`/todo?task=${task.id}`))
const bell1 = (await req('/notifications', 'GET', undefined, T1)).data.events
ok('the in-app bell carries the assignment too', bell1.some((e) => e.kind === 'assigned' && /x41: handed video.*owner/.test(e.text)))

// ---- adding a hat later rings only the NEW name ----
await reset()
await req(`/content/${task.id}`, 'PATCH', { designer_id: m1.id })
sent = await sentList()
ok('the new designer hears it', sent.some((s) => String(s.chat_id) === '111' && /you're the designer/.test(s.text || '')))
ok('…the untouched editor stays quiet', !sent.some((s) => String(s.chat_id) === '222' && /📌/.test(s.text || '')))

// ---- re-saving the same hat rings nobody ----
await reset()
await req(`/content/${task.id}`, 'PATCH', { designer_id: m1.id, editor_id: m2.id })
ok('no news when nothing changed hands', !(await sentList()).some((s) => /📌/.test(s.text || '')))

// ---- moving a hat rings the new holder only ----
await reset()
await req(`/content/${task.id}`, 'PATCH', { editor_id: m1.id })
sent = await sentList()
ok('the hat’s new holder hears it', sent.some((s) => String(s.chat_id) === '111' && /you're the editor/.test(s.text || '')))
ok('…the previous holder is not pinged', !sent.some((s) => String(s.chat_id) === '222' && /📌/.test(s.text || '')))

// ---- self-assignment is silent ----
await reset()
await req('/content', 'POST', { title: 'x41: my own post', channels: [chKey], type: 'post', status_id: shootId }, T1)
ok('creating for yourself rings nobody', !(await sentList()).some((s) => /📌/.test(s.text || '')))

// ---- Pravki carries the note to the one who owes the fix ----
const readyId = (await req('/statuses')).data.find((s) => /^ready$/i.test(s.label)).id
await req(`/content/${task.id}`, 'PATCH', { status_id: readyId })
await reset()
await req(`/content/${task.id}/revisions`, 'POST', { note: 'перезаписать звук с 00:40', target: 'editor' })
sent = await sentList()
const fix = sent.find((s) => String(s.chat_id) === '111' && /🔧/.test(s.text || ''))
ok('the fixer gets the Pravki with the note', !!fix && /перезаписать звук с 00:40/.test(fix.text))
ok('…and the task link', !!fix && fix.text.includes(`/todo?task=${task.id}`))
const bellFix = (await req('/notifications', 'GET', undefined, T1)).data.events
ok('the bell carries the Pravki note too', bellFix.some((e) => e.kind === 'pravki' && /перезаписать звук/.test(e.text)))

stop()
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-41 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
