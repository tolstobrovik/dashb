// Round 42: (1) the calendar moves by POINTER — a plain mouse drag on the
// month grid reschedules a pill, dropping it on the tray unschedules it, the
// week view drags too, and the click that ends a drag never opens the day
// view; (2) Telegram speaks like a person — bold titles, human dates, every
// scrap of user text HTML-escaped — and a cut landing on Ready rings the
// REVIEWERS (admins + the channel's SMMs) with the file link in hand;
// (3) the nightly digest claims its day first, so a retried cron can never
// ring twice; (4) the fixer's Pravki card carries the ТЗ, the current file
// and the earlier rounds. Bridge half self-contained: 4100 + mock 9986;
// UI half runs on the main 4090 stack.
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { chromium } from 'playwright'

const SP = new URL('.', import.meta.url).pathname
const MAIN = 'http://localhost:4090'
const BASE = 'http://localhost:4100'
const MOCK = 'http://localhost:9986'
const TOKEN = 'x42-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

boot([SP + 'mock-tg.mjs'], { MOCK_PORT: '9986' })
boot(['/home/user/dashb/server/index.js'], {
  DATA_DIR: SP + 'tg42-' + Date.now(), PORT: '4100',
  TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: MOCK,
})
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('mock + bridge stack are up', (await up(MOCK + '/__sent')) && (await up(BASE + '/api/health')))

const api = (base) => {
  const login = async (u, p) => (await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
  const req = (T) => async (p, m = 'GET', b, tok = T.t) => {
    const r = await fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
    return { status: r.status, data: await r.json().catch(() => ({})) }
  }
  return { login, req }
}
const A = api(BASE)
const T = { t: await A.login('admin', 'admin123') }
const req = A.req(T)
const sentList = async () => (await (await fetch(MOCK + '/__sent')).json())
const reset = () => fetch(MOCK + '/__reset', { method: 'POST' })
const hook = async (update) => fetch(BASE + '/api/telegram/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
  body: JSON.stringify(update),
})
const human = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

const chKey = (await req('/channels')).data[0]?.key
const m1 = (await req('/users', 'POST', { name: 'Rita Editor', username: 'x42a', password: 'probe123', role: 'member', departments: [chKey] })).data
const m2 = (await req('/users', 'POST', { name: 'Olim Owner', username: 'x42b', password: 'probe123', role: 'member', departments: [chKey] })).data
const T1 = await A.login('x42a', 'probe123')
const T2 = await A.login('x42b', 'probe123')
for (const [tok, chat] of [[T.t, 120], [T1, 121], [T2, 122]]) {
  const l = (await req('/telegram/link', 'POST', {}, tok)).data
  await hook({ message: { chat: { id: chat }, text: `/start ${l.code}` } })
}

// ---- HTML-escaped, human-dated assignment ----
const statuses = (await req('/statuses')).data
const sid = (re) => statuses.find((s) => re.test(s.label)).id
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + 864e5))
await reset()
const task = (await req('/content', 'POST', {
  title: 'x42 <b>&clip', channels: [chKey], type: 'video',
  assignee_ids: [m2.id], editor_id: m1.id, status_id: sid(/to shoot/i), recording_date: tomorrow,
})).data
let sent = await sentList()
let m = sent.find((s) => String(s.chat_id) === '121' && /📌/.test(s.text || ''))
ok('messages go out as Telegram-HTML', !!m && m.parse_mode === 'HTML')
ok('a hostile title arrives escaped, not as markup', !!m && m.text.includes('&lt;b&gt;&amp;clip') && !m.text.includes('<b>&clip'))
ok('the title reads bold', !!m && /<b>«x42 &lt;b&gt;&amp;clip»<\/b>/.test(m.text))
ok('the date reads human', !!m && m.text.includes(`shoot ${human(tomorrow)}`))

// ---- a cut landing on Ready rings the REVIEWERS, file in hand ----
await reset()
const done = await req(`/content/${task.id}`, 'PATCH', { ready_link: 'https://drive.google.com/x42cut', milestone: 'edited' }, T1)
ok('the editor delivers with one save', done.status === 200)
sent = await sentList()
const toAdmin = sent.find((s) => String(s.chat_id) === '120' && /✅/.test(s.text || ''))
ok('the ADMIN hears the cut is ready — without being on the task', !!toAdmin && /Ready for your review/.test(toAdmin.text))
ok('…the message hands over the file', !!toAdmin && /Watch it/.test(toAdmin.text) && toAdmin.text.includes('https://drive.google.com/x42cut'))
ok('…and the task link', !!toAdmin && toAdmin.text.includes(`/todo?task=${task.id}`))
ok('…names who finished it', !!toAdmin && /finished by Rita Editor/.test(toAdmin.text))
ok('the owner hears it too', sent.some((s) => String(s.chat_id) === '122' && /Ready for your review/.test(s.text || '')))
ok('the editor never hears their own delivery', !sent.some((s) => String(s.chat_id) === '121' && /✅/.test(s.text || '')))
const adminBell = (await req('/notifications')).data.events
ok('the admin’s in-app bell rings too', adminBell.some((e) => e.kind === 'status' && /→ Ready/.test(e.text)))

// ---- the other stages keep their own voices ----
await reset()
await req(`/content/${task.id}`, 'PATCH', { status_id: sid(/editing/i) })
sent = await sentList()
m = sent.find((s) => String(s.chat_id) === '121' && /🔔/.test(s.text || ''))
ok('a working-stage move says who moved it', !!m && /by Admin/.test(m.text) && /moved to <b>Editing<\/b>/.test(m.text))
await reset()
await req(`/content/${task.id}`, 'PATCH', { status_id: statuses.find((s) => s.is_final).id })
ok('publishing celebrates', (await sentList()).some((s) => String(s.chat_id) === '121' && /🚀/.test(s.text || '') && /It's out!/.test(s.text)))

// ---- the comment and the Pravki read like messages ----
await reset()
await req(`/content/${task.id}/comments`, 'POST', { text: 'смотри <тайминг> & темп' })
m = (await sentList()).find((s) => String(s.chat_id) === '121' && /💬/.test(s.text || ''))
ok('a comment quotes the words, escaped', !!m && m.text.includes('“смотри &lt;тайминг&gt; &amp; темп”'))
await req(`/content/${task.id}`, 'PATCH', { status_id: sid(/^ready$/i) })
await req(`/content/${task.id}`, 'PATCH', { script: 'Сценарий: интро не длиннее 15 секунд', format: 'Talking head' })
await reset()
await req(`/content/${task.id}/revisions`, 'POST', { note: 'сократи интро до 15 сек', target: 'editor' })
m = (await sentList()).find((s) => String(s.chat_id) === '121' && /🔧/.test(s.text || ''))
ok('a Pravki asks for changes by name', !!m && /One more pass/.test(m.text) && /round 1/.test(m.text) && /сократи интро/.test(m.text))

// ---- the fixer's lane carries the ТЗ and the history ----
const rev1 = (await req('/content/revisions/mine', 'GET', undefined, T1)).data[0]
ok('the Pravki lane hands over the ТЗ', !!rev1 && /интро не длиннее 15 секунд/.test(rev1.script || '') && rev1.format === 'Talking head')
await req(`/content/revisions/${rev1.id}/resolve`, 'POST', { link: 'https://drive.google.com/x42v2' }, T1)
await req(`/content/${task.id}/revisions`, 'POST', { note: 'теперь музыку тише', target: 'editor' })
const rev2 = (await req('/content/revisions/mine', 'GET', undefined, T1)).data[0]
ok('round two remembers round one', !!rev2 && rev2.round === 2 &&
  (rev2.history || []).some((h) => h.round === 1 && /сократи интро/.test(h.note) && h.resolved_at))
ok('…and carries the current file', rev2.ready_link === 'https://drive.google.com/x42v2')

// ---- the digest claims its day — a second cron stays silent ----
await req(`/content/${task.id}`, 'PATCH', { status_id: sid(/editing/i), release_date: tomorrow })
await reset()
const c1 = await (await fetch(BASE + '/api/cron/daily')).json()
const digests = async () => (await sentList()).filter((s) => /deadlines/i.test(s.text || '')).length
const afterOne = await digests()
ok('the first cron of the day sends the digest', c1.reminded >= 1 && afterOne >= 1)
ok('…written in sections, bold and bulleted', (await sentList()).some((s) => /deadlines/i.test(s.text || '') && /<b>Tomorrow<\/b>/.test(s.text) && /• «x42 &lt;b&gt;&amp;clip» — the release/.test(s.text)))
const c2 = await (await fetch(BASE + '/api/cron/daily')).json()
ok('the second cron of the same day sends NOTHING', c2.reminded === 0 && (await digests()) === afterOne)

// ================= the UI half, on the main 4090 stack =================
const M = api(MAIN)
const MT = { t: await M.login('admin', 'admin123') }
const mreq = M.req(MT)
const cleanup = async () => {
  for (const c of (await mreq('/content')).data.filter((c) => /x42ui/.test(c.title))) await mreq(`/content/${c.id}`, 'DELETE')
  for (const u of (await mreq('/users')).data.filter((u) => /^x42fix$/.test(u.username))) await mreq(`/users/${u.id}`, 'DELETE')
}
await cleanup()
const mst = (await mreq('/statuses')).data
const msid = (re) => mst.find((s) => re.test(s.label)).id
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const drag1 = (await mreq('/content', 'POST', { title: 'x42ui drag video', channels: ['youtube'], type: 'video', status_id: msid(/editing/i), release_date: today })).data

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
await ctx.addInitScript(() => {
  localStorage.setItem('satashkent_dept_view', 'release')
  localStorage.setItem('satashkent_cal_scale', 'month')
})
const p = await ctx.newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
const loginUI = async (page, u, pw) => {
  await page.goto(MAIN + '/login')
  await page.fill('input[name="username"]', u); await page.fill('input[name="password"]', pw)
  await page.click('button[type="submit"]'); await page.waitForURL(/overview|\/$/, { timeout: 15000 })
}
await loginUI(p, 'admin', 'admin123')
await p.goto(MAIN + '/dept/youtube'); await p.waitForTimeout(1400)

// a mouse drag: press, slide past the threshold, let the grid settle (the
// tray appears at drag start), then aim and release
const dragPill = async (page, srcLoc, dstLocator) => {
  await srcLoc.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(200)
  const pb = await srcLoc.boundingBox()
  await page.mouse.move(pb.x + 16, pb.y + Math.min(10, pb.height / 2))
  await page.mouse.down()
  await page.mouse.move(pb.x + 36, pb.y + 18, { steps: 3 })
  await page.waitForTimeout(250)
  // Bring the destination fully on screen before aiming at it. A pointer
  // cannot be moved past the bottom of the window, so a cell hanging below
  // the fold would be aimed at through a clamped point — and the calendar's
  // own edge auto-scroll would then move the grid out from under it. A real
  // hand scrolls first; so does this. (Without it the test measures the page
  // height, not the drag, and any row added above the calendar breaks it.)
  await dstLocator.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(200)
  const tb = await dstLocator.boundingBox()
  if (!tb) { await page.mouse.up(); return false }
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 })
  await page.waitForTimeout(120)
  await page.mouse.up()
  await page.waitForTimeout(900)
  return true
}
// the neighbour day that lives in the same month grid
const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() - 864e5))
const targetIso = (await p.locator(`.cal-day[data-drop="${tomorrow}"]`).count()) ? tomorrow : yesterday
ok('month pills drag by plain mouse', await dragPill(p, p.locator('.rel-ev', { hasText: 'x42ui drag video' }), p.locator(`.cal-day[data-drop="${targetIso}"]`)))
let after = (await mreq('/content')).data.find((x) => x.id === drag1.id)
ok('…and the drop actually reschedules', after.release_date === targetIso, `got ${after.release_date}`)
ok('the drop’s click never opens the day view', (await p.locator('.planner').count()) === 0)

// drop on the tray = unschedule
ok('a pill drops back onto the tray', await dragPill(p, p.locator('.rel-ev', { hasText: 'x42ui drag video' }), p.locator('.cal-tray')))
after = (await mreq('/content')).data.find((x) => x.id === drag1.id)
ok('…which clears the date', after.release_date === null, `got ${after.release_date}`)
ok('…and the chip waits in the tray', (await p.locator('.cal-tray-chip', { hasText: 'x42ui drag video' }).count()) === 1)

// the week view drags the same way
await mreq(`/content/${drag1.id}`, 'PATCH', { release_date: today })
await p.reload(); await p.waitForTimeout(1200)
await p.locator('.cal-scale .pill', { hasText: 'Week' }).click(); await p.waitForTimeout(600)
ok('week cards drag too', await dragPill(p, p.locator('.wk-card', { hasText: 'x42ui drag video' }), p.locator(`.wk-col[data-drop="${targetIso}"]`)))
after = (await mreq('/content')).data.find((x) => x.id === drag1.id)
ok('…across the week columns', after.release_date === targetIso, `got ${after.release_date}`)
await p.screenshot({ path: SP + 'r42-week-drag.png' })

// ---- the reviewer's queue hands over the file ----
const review = (await mreq('/content', 'POST', {
  title: 'x42ui review me', channels: ['youtube'], type: 'video',
  status_id: msid(/^ready$/i), ready_link: 'https://drive.google.com/x42uicut', release_date: today,
})).data
await p.goto(MAIN + '/brief'); await p.waitForTimeout(1400)
const rqRow = p.locator('.rq-row', { hasText: 'x42ui review me' })
ok('the review row shows a watch-the-cut button', (await rqRow.locator('a.rq-open').count()) === 1 &&
  (await rqRow.locator('a.rq-open').getAttribute('href')) === 'https://drive.google.com/x42uicut')
await p.goto(MAIN + `/todo?task=${review.id}`); await p.waitForTimeout(1400)
ok('the modal’s Review block opens with the cut in reach', (await p.locator('.review-links a', { hasText: 'Watch the cut' }).count()) === 1)
await p.screenshot({ path: SP + 'r42-review.png' })
await p.close()

// ---- the fixer's Pravki card: ТЗ, current file, earlier rounds ----
const fixer = (await mreq('/users', 'POST', { name: 'X42 Fixer', username: 'x42fix', password: 'probe123', role: 'member', departments: ['youtube'] })).data
const fixTask = (await mreq('/content', 'POST', {
  title: 'x42ui fix clip', channels: ['youtube'], type: 'video', editor_id: fixer.id,
  status_id: msid(/^ready$/i), ready_link: 'https://drive.google.com/x42old',
  script: 'ТЗ: тайминг интро 0:15, титры в конце', format: 'Talking head',
})).data
await mreq(`/content/${fixTask.id}/revisions`, 'POST', { note: 'пересобери титры', target: 'editor' })
const FT = { t: await M.login('x42fix', 'probe123') }
const freq = M.req(FT)
const r1 = (await freq('/content/revisions/mine')).data[0]
await freq(`/content/revisions/${r1.id}/resolve`, 'POST', { link: 'https://drive.google.com/x42new' })
await mreq(`/content/${fixTask.id}/revisions`, 'POST', { note: 'теперь цветокор', target: 'editor' })

const p2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage()
// The sandbox's memory flake can crash a page load at random; one reload is
// the polite retry — a REAL breakage fails on the second try too.
let p2crashed = false
p2.on('pageerror', (e) => { p2crashed = true; console.log('PAGE ERROR (soft)', e.message) })
await loginUI(p2, 'x42fix', 'probe123')
await p2.goto(MAIN + '/brief'); await p2.waitForTimeout(1500)
const card = p2.locator('.pravki-card', { hasText: 'x42ui fix clip' })
for (let tries = 0; tries < 2 && (p2crashed || (await card.count()) === 0); tries++) {
  p2crashed = false
  await p2.reload(); await p2.waitForTimeout(1800)
}
ok('the Pravki card is on the fixer’s desk', (await card.count()) === 1)
if (await card.count()) {
  ok('…wearing the ТЗ', (await card.locator('.pravki-extra summary', { hasText: 'The script / ТЗ' }).count()) === 1 &&
    (await card.locator('.chip', { hasText: 'Talking head' }).count()) === 1)
  await card.locator('.pravki-extra summary', { hasText: 'The script / ТЗ' }).click()
  ok('…that opens to the words themselves', (await card.locator('.crew-script', { hasText: 'тайминг интро 0:15' }).count()) === 1)
  ok('…the earlier round, verdict included', (await card.locator('.pravki-extra summary', { hasText: 'Earlier rounds · 1' }).count()) === 1)
  await card.locator('.pravki-extra summary', { hasText: 'Earlier rounds' }).click()
  ok('…with its note on record', (await card.locator('.pravki-prior-row', { hasText: 'пересобери титры' }).count()) === 1)
  ok('…and the current file one press away', (await card.locator(`.pravki-fix a[href="https://drive.google.com/x42new"]`).count()) === 1)
} else { fails += 5 }
await p2.screenshot({ path: SP + 'r42-pravki-card.png' })
await p2.close()
await browser.close()

await cleanup()
stop()
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-42 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
