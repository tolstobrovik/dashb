// Round 48: the reminders an admin keeps ready. Nudges worth repeating —
// "is the week planned?", "does every task carry its brief?" — written once,
// fired at anybody on the spot, or left to arrive by themselves on chosen
// weekdays at a chosen hour (Tashkent). Plus the fault an admin reported:
// delivery links were hidden on task types that "shouldn't" have them, so a
// recording link on a post was invisible to the very people who review it.
// Self-contained: its own stack on 4104 (which also serves the UI) + mock 9996.
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { chromium } from 'playwright'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4104'
const B = BASE + '/api'
const MOCK = 'http://localhost:9996'
const TOKEN = 'x48-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })

boot([SP + 'mock-tg.mjs'], { MOCK_PORT: '9996' })
boot(['/home/user/dashb/server/index.js'], {
  DATA_DIR: SP + 'tg48-' + Date.now(), PORT: '4104',
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
const hook = (update) => fetch(B + '/telegram/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
  body: JSON.stringify(update),
})

const chKey = (await req('/channels')).data[0]?.key
const m1 = (await req('/users', 'POST', { name: 'Rem One', username: 'x48a', password: 'probe123', role: 'member', departments: [chKey] })).data
const m2 = (await req('/users', 'POST', { name: 'Rem Two', username: 'x48b', password: 'probe123', role: 'member', departments: [chKey] })).data
for (const [u, chat] of [[await login('x48a', 'probe123'), 801], [await login('x48b', 'probe123'), 802]]) {
  const l = (await req('/telegram/link', 'POST', {}, u)).data
  await hook({ message: { chat: { id: chat }, text: `/start ${l.code}` } })
}

// ---- a starter set arrives written, and switched off ----
const seeded = (await req('/telegram/templates')).data
ok('the admin starts with reminders already written', seeded.length >= 5, `${seeded.length} ready`)
ok('…and none of them fire until asked', seeded.every((t) => t.enabled === false))
ok('…each knowing its day and hour', seeded.some((t) => t.days.length > 0 && typeof t.hour === 'number'))

// ---- send one, to exactly the people chosen ----
const tpl = seeded[0]
await reset()
let out = await req(`/telegram/templates/${tpl.id}/send`, 'POST', { user_ids: [m1.id] })
let s = await sentList()
ok('a reminder goes to just the person picked', out.data.sent === 1 && s.length === 1 && String(s[0].chat_id) === '801')
ok('…carrying its own words, titled', /<b>/.test(s[0]?.text || '') && s[0].text.includes(tpl.title))
await reset()
out = await req(`/telegram/templates/${tpl.id}/send`, 'POST', {})
ok('…or to its whole audience when nobody is picked', out.data.sent === 2 && (await sentList()).length === 2)

// ---- the schedule: fires on its day, once ----
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
await req(`/telegram/templates/${tpl.id}`, 'PATCH', { days: [weekday], hour: 0, enabled: true })
await reset()
await fetch(BASE + '/api/cron/daily')
ok('a due reminder leaves by itself', (await sentList()).filter((x) => (x.text || '').includes(tpl.title)).length === 2)
await reset()
await fetch(BASE + '/api/cron/daily')
ok('…exactly once a day, however often the clock is checked', (await sentList()).filter((x) => (x.text || '').includes(tpl.title)).length === 0)
ok('…and it remembers the day it went out', (await req('/telegram/templates')).data.find((t) => t.id === tpl.id).last_sent === today)

// ---- a reminder that is not due today stays put ----
const other = seeded[1]
await req(`/telegram/templates/${other.id}`, 'PATCH', { days: [(weekday + 3) % 7], hour: 0, enabled: true })
await reset()
await fetch(BASE + '/api/cron/daily')
ok('a reminder for another day keeps quiet', !(await sentList()).some((x) => (x.text || '').includes(other.title)))

// ---- writing one by hand ----
const mine = (await req('/telegram/templates', 'POST', {
  title: 'Fix your schedule', text: 'Пара минут — и неделя спокойная 🙂', audience: 'role:member', days: [1], hour: 8,
})).data
ok('an admin can write their own', !!mine.id && mine.audience === 'role:member')
ok('…and only an admin can', (await req('/telegram/templates', 'POST', { title: 'x', text: 'y' }, await login('x48a', 'probe123'))).status === 403)
ok('a reminder needs words', (await req('/telegram/templates', 'POST', { title: 'only a name' })).status === 400)
await req(`/telegram/templates/${mine.id}`, 'DELETE')
ok('…and can be dropped', !(await req('/telegram/templates')).data.some((t) => t.id === mine.id))

// ================= the UI: the panel, and the files =================
const sts = (await req('/statuses')).data
const stage = (re) => sts.find((x) => re.test(x.label)).id
// a POST that was filmed: its recording and edit links must not hide
const post = (await req('/content', 'POST', {
  title: 'x48: filmed post', channels: [chKey], type: 'post', status_id: stage(/editing/i),
  shot_link: 'https://drive.google.com/RAW', ready_link: 'https://drive.google.com/CUT', design_link: 'https://drive.google.com/ART',
})).data

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })

await p.goto(BASE + `/todo?task=${post.id}`); await p.waitForTimeout(1600)
const files = p.locator('.file-links .file-link')
ok('every delivery link shows on the task, whatever its type', (await files.count()) === 3, `${await files.count()} shown`)
ok('…each opening the real file', (await p.locator('.file-link[href="https://drive.google.com/RAW"]').count()) === 1 &&
  (await p.locator('.file-link[href="https://drive.google.com/CUT"]').count()) === 1)
ok('…and they are told apart by colour', (await p.locator('.fl-shot').evaluate((el) => getComputedStyle(el).backgroundColor)) !==
  (await p.locator('.fl-edit').evaluate((el) => getComputedStyle(el).backgroundColor)))
ok('…standing well apart', parseFloat(await p.locator('.file-links').evaluate((el) => getComputedStyle(el).gap)) >= 10)
await p.keyboard.press('Escape')

await p.goto(BASE + '/admin'); await p.waitForTimeout(900)
await p.locator('.tab', { hasText: 'Telegram' }).click(); await p.waitForTimeout(1200)
ok('the panel lists the reminders', (await p.locator('.rem-row').count()) >= 5, `${await p.locator('.rem-row').count()} rows`)
const row = p.locator('.rem-row', { hasText: 'Does every task carry its brief?' })
ok('…each saying when it arrives and who hears it', /every|on demand/.test(await row.locator('.rem-sub').textContent() || ''))
await row.locator('button', { hasText: 'Send' }).click()
await p.waitForTimeout(700)
ok('Send opens a chooser of connected people', (await p.locator('.modal .checkbox-chip').count()) === 2)
await p.locator('.modal .checkbox-chip', { hasText: 'Rem Two' }).click()
await reset()
await p.locator('.modal button', { hasText: 'Send to 1' }).click()
await p.waitForTimeout(1200)
const only = await sentList()
ok('…and sends to exactly the ones left ticked', only.length === 1 && String(only[0].chat_id) === '801', JSON.stringify(only.map((x) => x.chat_id)))
await p.screenshot({ path: SP + 'r48-reminders.png' })
await p.close()
await browser.close()

for (const proc of procs) { try { proc.kill('SIGKILL') } catch { /* gone */ } }
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-48 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
