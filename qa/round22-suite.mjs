// Round 22: the reviewer's queue on My Day (Ready work on your channels,
// one-tap Publish), the Ctrl/Cmd-K quick find (tasks open in place, pages
// navigate), and the tray's finishing touches (tap-Today scheduling, drag a
// pill back to unschedule).
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
for (const c of (await req('/content')).data.filter((c) => /x22:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
const statuses = (await req('/statuses')).data
const sid = (l) => statuses.find((s) => s.label.toLowerCase() === l).id
const rq = (await req('/content', 'POST', { title: 'x22: awaiting review', channels: ['instagram_main'], type: 'reel', status_id: sid('ready') })).data

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
// ---- 1) jas (SMM): review queue + one-tap publish ----
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'jas'); await p.fill('input[name="password"]', 'j1234')
await p.click('button[type="submit"]'); await p.waitForURL(/brief/, { timeout: 15000 })
await p.waitForTimeout(1000)
ok('the review queue greets the SMM', (await p.locator('.section-head', { hasText: 'Waiting for your review' }).count()) === 1)
const row = p.locator('.rq-row', { hasText: 'x22: awaiting review' })
ok('the Ready task on her channel is in it', (await row.count()) === 1)
await p.screenshot({ path: 'r22-review.png' })
await row.locator('.rq-pub').click()
await p.waitForTimeout(900)
const pub = (await req('/content')).data.find((x) => x.id === rq.id)
ok('one tap published it', !!pub.done_at && pub.status_id === statuses.find((s) => s.is_final).id)
ok('the row left the queue', (await p.locator('.rq-row', { hasText: 'x22: awaiting review' }).count()) === 0)

// ---- 2) quick find: Ctrl+K, task + page ----
await p.keyboard.press('Control+k')
await p.waitForSelector('.qf-input', { timeout: 5000 })
await p.fill('.qf-input', 'bootcamp')
await p.waitForTimeout(400)
ok('typing finds the task', (await p.locator('.qf-row', { hasText: 'SAT bootcamp' }).count()) >= 1)
await p.keyboard.press('Enter')
await p.waitForSelector('.modal', { timeout: 8000 })
ok('Enter opens the task right there', (await p.locator('.modal .cm-title').inputValue()).includes('SAT bootcamp'))
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
await p.keyboard.press('Control+k')
await p.waitForSelector('.qf-input', { timeout: 5000 })
await p.fill('.qf-input', 'statist')
await p.waitForTimeout(300)
await p.keyboard.press('Enter')
await p.waitForURL(/missed/, { timeout: 8000 })
ok('a page result navigates', p.url().includes('/missed'))
await p.close()

// ---- 3) tray: tap-Today schedules; drag a pill back to unschedule ----
const t2 = (await req('/content', 'POST', { title: 'x22: dateless', channels: ['youtube'], type: 'video' })).data
const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
a.on('pageerror', (e) => { fails++; console.log('ADMIN PAGE ERROR', e.message) })
await a.goto(BASE + '/login')
await a.fill('input[name="username"]', 'admin'); await a.fill('input[name="password"]', 'admin123')
await a.click('button[type="submit"]'); await a.waitForURL(/overview/, { timeout: 15000 })
await a.goto(BASE + '/dept/youtube'); await a.waitForTimeout(1200)
await a.locator('.pill', { hasText: 'Recording' }).click()
await a.waitForSelector('.cal-tray-chip', { timeout: 8000 })
await a.locator('.cal-tray-chip', { hasText: 'x22: dateless' }).locator('.qbtn', { hasText: 'Today' }).click()
await a.waitForTimeout(900)
const fmtT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
let t2b = (await req('/content')).data.find((x) => x.id === t2.id)
ok('the Today tap schedules the shoot', t2b.recording_date === fmtT, `got ${t2b.recording_date}`)
// now drag its pill back to the tray — by pointer, the way the calendar
// actually moves pills (mouse and finger take the same path)
await a.waitForTimeout(600)
let unscheduled = 'ok'
{
  // a crowded month can push today's cell below the fold — walk to the pill
  // first, the way a person would, then press it
  const pillLoc = a.locator('.rel-ev', { hasText: 'x22: dateless' })
  await pillLoc.scrollIntoViewIfNeeded().catch(() => {})
  await a.waitForTimeout(250)
  const pb = await pillLoc.boundingBox().catch(() => null)
  if (!pb) unscheduled = 'no pill'
  else {
    await a.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2)
    await a.mouse.down()
    await a.mouse.move(pb.x + pb.width / 2 + 14, pb.y + pb.height / 2 + 8, { steps: 3 })
    await a.waitForTimeout(200) // the tray reveals itself as a drop target mid-drag
    const tb = await a.locator('.cal-tray').boundingBox().catch(() => null)
    if (!tb) { unscheduled = 'no tray'; await a.mouse.up() }
    else {
      await a.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 })
      await a.mouse.up()
    }
  }
}
await a.waitForTimeout(900)
t2b = (await req('/content')).data.find((x) => x.id === t2.id)
ok('dragging the pill back to the tray unschedules it', unscheduled === 'ok' && t2b.recording_date === null, `${unscheduled}, date=${t2b.recording_date}`)
await a.close()
await browser.close()
for (const c of (await req('/content')).data.filter((c) => /x22:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
console.log(fails === 0 ? '\nRound-22 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
