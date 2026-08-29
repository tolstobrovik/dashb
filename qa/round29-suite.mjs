// Round 29: the workflow's little levers. Duplicate spawns the recurring
// piece (brief, crew, platforms kept — dates, stage, delivery cleared);
// every task has a pasteable link (…/brief?task=id) that opens it on arrival;
// and a timetable drag can be taken back from its toast (Undo).
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
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + d * 864e5))
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x29/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
  for (const u of (await req('/users')).data.filter((u) => u.username === 'x29ed')) await req(`/users/${u.id}`, 'DELETE')
}
await cleanup()
const src = (await req('/content', 'POST', { title: 'x29: rubric video', channels: ['youtube'], type: 'video', format: 'Vlog', rubrika: 'Campus life', script: 'Scene one.', release_date: iso(2), recording_date: iso(1) })).data

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ['clipboard-read', 'clipboard-write'] })
const p = await ctx.newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })

// ---- 1) the pasteable task link ----
await p.goto(BASE + `/brief?task=${src.id}`); await p.waitForTimeout(1400)
ok('a pasted link opens its task', (await p.locator('.modal .cm-title').inputValue().catch(() => '')) === 'x29: rubric video')
await p.locator('.modal button[aria-label="Copy link"]').click(); await p.waitForTimeout(400)
const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '')
ok('Copy link writes the task URL', clip.includes(`/brief?task=${src.id}`))

// ---- 2) Duplicate from the modal ----
await p.locator('.modal .btn-ghost', { hasText: 'Duplicate' }).click(); await p.waitForTimeout(900)
// Round 78 renamed what a duplicate is called. "(copy)" was one name however
// many copies you made, so a second press produced a second row with the same
// title as the first; it is "Duplicate 1", "Duplicate 2" now, numbered by the
// server so two people pressing at once cannot both get Duplicate 1.
const copy = (await req('/content')).data.find((c) => /^x29: rubric video Duplicate \d+$/.test(c.title))
ok('Duplicate spawns the copy, numbered', !!copy, copy?.title || 'no copy')
ok('…brief, crew and platforms kept', copy?.format === 'Vlog' && copy?.rubrika === 'Campus life' && copy?.script === 'Scene one.' && copy?.channels.includes('youtube'))
ok('…dates and completion cleared', copy?.release_date == null && copy?.recording_date == null && copy?.done_at == null)

// ---- 3) Undo on a timetable drag ----
const ed = (await req('/users', 'POST', { name: 'Umid Editor', username: 'x29ed', password: 'u1234', role: 'crew', crew_roles: ['editor'] })).data
const cut = (await req('/content', 'POST', { title: 'x29: cut', channels: ['youtube'], type: 'video', editor_id: ed.id, edit_ready_date: iso(1) })).data
await p.goto(BASE + '/crew'); await p.waitForTimeout(900)
await p.locator('.pill', { hasText: 'Timetable' }).click()
await p.waitForSelector('.crew-tt', { timeout: 8000 })
const dragged = await p.evaluate(([title, dayIso]) => {
  const card = [...document.querySelectorAll('.tt-shoot')].find((el) => el.textContent.includes(title))
  const row = [...document.querySelectorAll('.crew-tt tbody tr')].find((r) => r.querySelector('.tt-who b')?.textContent === 'Umid')
  if (!card || !row) return 'missing'
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
  const cell = [...row.querySelectorAll('td')].slice(1)[Math.round((Date.parse(dayIso) - Date.parse(todayIso)) / 864e5)]
  if (!cell) return 'no cell'
  const dt = new DataTransfer()
  card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
  cell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  cell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return 'ok'
}, ['x29: cut', iso(4)])
await p.waitForTimeout(800)
ok('the drag lands', dragged === 'ok' && (await req('/content')).data.find((c) => c.id === cut.id).edit_ready_date === iso(4))
ok('the toast offers Undo', (await p.locator('.toast-act', { hasText: 'Undo' }).count()) === 1)
await p.locator('.toast-act', { hasText: 'Undo' }).click(); await p.waitForTimeout(800)
ok('Undo puts the deadline back', (await req('/content')).data.find((c) => c.id === cut.id).edit_ready_date === iso(1))
await p.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-29 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
