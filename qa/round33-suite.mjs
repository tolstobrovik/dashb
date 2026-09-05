// Round 33: the talk lives on the task. One thread per piece — anyone who
// can see it may speak, the crew included — and every line reaches the rest
// of the task's people (and prior speakers) through the bell, never echoing
// back to its author. The reviewer's queue became a run-sheet: release-time
// order, times shown, the finished file's link one tap from the clipboard.
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
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + d * 864e5))
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x33:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
  for (const u of (await req('/users')).data.filter((u) => u.username === 'x33ed')) await req(`/users/${u.id}`, 'DELETE')
}
await cleanup()
const users = (await req('/users')).data
const jas = users.find((u) => u.username === 'jas')
const ed = (await req('/users', 'POST', { name: 'Erkin Editor', username: 'x33ed', password: 'e1234', role: 'editor' })).data
const t1 = (await req('/content', 'POST', { title: 'x33: talked video', channels: ['instagram_main'], type: 'video', assignee_ids: [jas.id], editor_id: ed.id })).data

// ---- 1) the API: speak, hear, no echo ----
const edT = await login('x33ed', 'e1234')
const posted = await req(`/content/${t1.id}/comments`, 'POST', { text: 'The cut is uploading — check the color pass' }, edT)
ok('the crew can speak on their task', posted.status === 201 && posted.data.author === 'Erkin Editor')
const jasT = await login('jas', 'j1234')
ok('the assignee hears it through the bell',
  (await req('/notifications', 'GET', null, jasT)).data.events.some((e) => /Erkin.*x33: talked video.*color pass/.test(e.text)))
ok('the author gets no echo',
  !(await req('/notifications', 'GET', null, edT)).data.events.some((e) => /color pass/.test(e.text)))
ok('the thread rides the full record', ((await req(`/content/${t1.id}`)).data.comments || []).length === 1)
ok('an empty line is refused', (await req(`/content/${t1.id}/comments`, 'POST', { text: '  ' })).status === 400)

// ---- 2) the run-sheet + the thread in the modal ----
const statuses = (await req('/statuses')).data
const readyId = statuses.find((s) => /^ready$/i.test(s.label)).id
await req('/content', 'POST', { title: 'x33: evening reel', channels: ['instagram_main'], type: 'reel', status_id: readyId, release_date: iso(0), release_time: '20:00', ready_link: 'https://drive.google.com/finished-cut' })
await req('/content', 'POST', { title: 'x33: morning post', channels: ['instagram_main'], type: 'post', status_id: readyId, release_date: iso(0), release_time: '09:00' })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ['clipboard-read', 'clipboard-write'] })
const p = await ctx.newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'jas'); await p.fill('input[name="password"]', 'j1234')
await p.click('button[type="submit"]'); await p.waitForURL(/brief/, { timeout: 15000 })
await p.waitForTimeout(1200)
const titles = await p.locator('.rq-row .ov-title').allTextContents()
ok('the run-sheet works down the clock', titles.indexOf('x33: morning post') < titles.indexOf('x33: evening reel'), titles.join(' | '))
ok('the slot time rides the row', (await p.locator('.rq-row', { hasText: 'morning post' }).textContent()).includes('09:00'))
await p.locator('.rq-row', { hasText: 'evening reel' }).locator('.rq-copy').click(); await p.waitForTimeout(400)
ok('one tap copies the finished file’s link',
  (await p.evaluate(() => navigator.clipboard.readText()).catch(() => '')) === 'https://drive.google.com/finished-cut')

await p.goto(BASE + `/brief?task=${t1.id}`); await p.waitForTimeout(1400)
ok('the thread renders in the modal', (await p.locator('.cm-comments .cmt-row', { hasText: 'color pass' }).count()) === 1)
// The task sheet is views now — Brief, Execution, Logistics, Talk — so a
// field is reached the way a person reaches it: open the view holding it
// first. Idempotent, and silent on a sheet short enough to show whole.
const cmTab = async (pg, name) => {
  // Round 91 hides a view nobody has been in, behind one "Add details"
  // control — so reaching one is two presses when it is empty and one when it
  // is not, exactly as it is for a person.
  const more = pg.locator('.cm-page-more')
  for (const pass of [0, 1]) {
    for (const n of name === 'Execution' ? ['Execution', 'Your part'] : [name]) {
      const tab = pg.locator('.cm-page-tab', { hasText: n })
      if (await tab.count()) { await tab.first().click(); await pg.waitForTimeout(200); return }
    }
    if (pass === 0 && await more.count()) { await more.first().click(); await pg.waitForTimeout(250) }
    else return
  }
}

await cmTab(p, 'Talk')
await p.fill('.cmt-input .input', 'Looks good — publishing tonight')
await p.locator('.cmt-input .btn').click(); await p.waitForTimeout(800)
// scoped to the thread: since round 36 the History block reuses .cmt-row styling
ok('a reply appends in place', (await p.locator('.cm-comments .cmt-row').count()) === 2)
await p.close()
await browser.close()
ok('…and reaches the earlier speaker',
  (await req('/notifications', 'GET', null, edT)).data.events.some((e) => /Jasmina.*publishing tonight/.test(e.text)))

// ---- 3) the board wears the count ----
const listed = (await req('/content')).data.find((c) => c.id === t1.id)
ok('lists carry comment_count for the board chip', listed.comment_count === 2)
await cleanup()
console.log(fails === 0 ? '\nRound-33 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
