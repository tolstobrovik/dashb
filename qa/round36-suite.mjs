// Round 36: (1) the month calendar hides nothing — a crowded day grows its
// row, every pill shows, each wearing its type icon and stage glyph; (2) the
// paper trail — every change is written down as a sentence, shown on the task
// (History) and across the team (Admin → History), surviving deletion.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x36:|v36:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
  for (const u of (await req('/users')).data.filter((u) => u.username === 'x36probe')) await req(`/users/${u.id}`, 'DELETE')
}
await cleanup()
const statuses = (await req('/statuses')).data
const sid = (re) => statuses.find((s) => re.test(s.label))?.id
const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())

// ---- 1) the paper trail, API side ----
const hist = (await req('/content', 'POST', {
  title: 'x36: history video', channels: ['youtube'], type: 'video',
  status_id: sid(/to shoot/i), recording_date: iso, recording_time: '10:00',
})).data
await req(`/content/${hist.id}`, 'PATCH', { recording_time: '11:00' })
await req(`/content/${hist.id}`, 'PATCH', { status_id: sid(/editing/i) })
const full = (await req(`/content/${hist.id}`)).data
const acts = full.activity || []
ok('the task carries its paper trail', acts.length >= 3, `rows=${acts.length}`)
ok('a created row opens it', acts.some((a) => a.kind === 'created'))
const timeRow = acts.find((a) => a.field === 'recording_time')
ok('the shoot-time change keeps from → to', !!timeRow && timeRow.old_value === '10:00' && timeRow.new_value === '11:00')
const stageRow = acts.find((a) => a.field === 'stage')
ok('a stage move records both labels', !!stageRow && /to shoot/i.test(stageRow.old_value || '') && /editing/i.test(stageRow.new_value || ''))
ok('rows remember who did it', acts.every((a) => a.user_name === 'Admin'))

// deletion survives on the team log by title
const doomed = (await req('/content', 'POST', { title: 'x36: doomed post', channels: ['youtube'], type: 'post', status_id: sid(/to shoot/i) })).data
await req(`/content/${doomed.id}`, 'DELETE')
const log = (await req('/content/activity/all')).data
ok('the team log keeps a deleted task by name', log.some((a) => a.kind === 'deleted' && a.content_title === 'x36: doomed post'))

// members never read the whole-team log
await req('/users', 'POST', { name: 'X36 Probe', username: 'x36probe', password: 'probe123', role: 'member', departments: ['youtube'] })
const PT = await login('x36probe', 'probe123')
ok('the team log is admin-only', (await req('/content/activity/all', 'GET', undefined, PT)).status === 403)

// ---- 2) the crowded month day ----
for (let i = 0; i < 6; i++) {
  await req('/content', 'POST', {
    title: `x36: piece ${i + 1}`, channels: ['youtube'], type: ['post', 'reel', 'video', 'story', 'post', 'video'][i],
    release_date: iso, release_time: `1${i}:00`, status_id: sid([/to shoot/i, /shot/i, /editing/i, /ready/i, /published/i, /deleted/i][i]),
  })
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
await ctx.addInitScript(() => {
  localStorage.setItem('satashkent_dept_view', 'release')
  localStorage.setItem('satashkent_cal_scale', 'month')
})
const p = await ctx.newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.waitForTimeout(800)
await p.goto(BASE + '/dept/youtube'); await p.waitForTimeout(1200)
const cell = p.locator('.cal-day.today')
ok('every piece of a crowded day shows', (await cell.locator('.rel-ev', { hasText: 'x36:' }).count()) === 6)
ok('no "+N more" hides work anywhere', (await p.locator('.cal-more').count()) === 0)
const pill = cell.locator('.rel-ev', { hasText: 'x36: piece 1' })
ok('a pill wears its type icon and stage glyph', (await pill.locator('svg').count()) === 2)

// ---- 3) the paper trail, UI side ----
await p.goto(BASE + `/todo?task=${hist.id}`); await p.waitForTimeout(1300)
const hsec = p.locator('.cm-history')
ok('the modal shows History', (await hsec.count()) === 1)
ok('…with the change as a sentence', /10:00 → 11:00/.test((await hsec.textContent().catch(() => '')) || ''))

await p.goto(BASE + '/admin'); await p.waitForTimeout(900)
await p.locator('.tabs .tab', { hasText: 'History' }).click(); await p.waitForTimeout(900)
ok('Admin → History lists the team log', (await p.locator('.alog-row').count()) > 0)
ok('…including the deleted task', (await p.locator('.alog-row', { hasText: 'x36: doomed post' }).count()) > 0)

await p.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-36 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
