// Round 89: the ambassador programme becomes a job somebody can hold.
//
// Running it meant being an admin of the whole board, so it could not be
// handed to the person actually doing it: checking students' posts and signing
// new ones up does not need the power to delete a channel or rewrite the
// pipeline. There was no account you could make for a reviewer.
//
//   the job      `manage_ambassadors`, off by default. It opens the queue,
//                answers cards, sets terms, and makes the student logins
//   the door     in the sidebar for whoever holds it — and in the top bar of
//                the one-channel shell, which has no sidebar at all
//   the form     signing a student up is on the programme page, because the
//                Admin panel is not a door this person has
//   the fence    and nothing else moves. Not a colleague's account, not a
//                role, not a permission, not their own
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
const stamp = Date.now()

// ===================== the job exists and can be given =====================
const rev = (await req('/users', 'POST', {
  name: 'Programme Reviewer', username: `r89rev${stamp}`, password: 'r1234',
  departments: ['instagram_main'], permissions: { manage_ambassadors: true },
})).data
ok('an admin can hand the programme to somebody', !!rev.id, JSON.stringify(rev.error || rev.id))
ok('…and the permission is stored', rev.permissions?.manage_ambassadors === true)
const R = await login(`r89rev${stamp}`, 'r1234')
ok('…who can sign in', !!R)

// ===================== and can do the job =====================
ok('the reviewer opens the programme queue', (await req('/ambassadors', 'GET', null, R)).status === 200)
const stu = await req('/users', 'POST', {
  name: 'Signed-Up Student', username: `r89stu${stamp}`, password: 's1234', role: 'ambassador',
}, R)
ok('…signs a student up', stu.status === 201, `${stu.status} ${stu.data.error || ''}`)
const terms = await req(`/ambassadors/person/${stu.data.id}`, 'PUT', { amount: 150000, active: true, university: 'INHA' }, R)
ok('…sets their terms', terms.status === 200 || terms.status === 201, `${terms.status} ${terms.data.error || ''}`)
ok('…and the student is in the queue',
  ((await req('/ambassadors', 'GET', null, R)).data.people || []).some((p) => p.user_id === stu.data.id))

// The whole point of the job: answering work.
const S = await login(`r89stu${stamp}`, 's1234')
const sent = await req('/ambassadors/me/cards', 'POST', {
  format: 'reel', reference_url: 'https://instagram.com/p/r89a',
  script: 'Campus tour with the dean, two questions at the entrance, then a walk through the library.',
}, S)
ok('the student sends work in', sent.status === 201, `${sent.status} ${sent.data.error || ''}`)
const inbox = (await req('/ambassadors', 'GET', null, R)).data.inbox || []
ok('…it lands in the reviewer’s queue', inbox.length >= 1, `${inbox.length} waiting`)
if (inbox[0]) {
  ok('…the reviewer can approve it',
    (await req(`/ambassadors/cards/${inbox[0].id}/approve`, 'POST', { amount: 150000 }, R)).status === 200)
  ok('…and the student is told they can film',
    ((await req('/ambassadors/me', 'GET', null, S)).data.cards || []).some((c) => c.state === 'can_film'))
} else { ok('…the reviewer can approve it', false, 'nothing in the queue to answer') }
const second = await req('/ambassadors/me/cards', 'POST', {
  format: 'post', reference_url: 'https://instagram.com/p/r89b',
  script: 'Second idea, a short piece about the dorms and what the rooms are actually like.',
}, S)
ok('a second card is sent', second.status === 201, `${second.status} ${second.data.error || ''}`)
const inbox2 = (await req('/ambassadors', 'GET', null, R)).data.inbox || []
if (inbox2[0]) {
  ok('…and can be sent back with notes',
    (await req(`/ambassadors/cards/${inbox2[0].id}/changes`, 'POST', { feedback: 'Show the rooms, not the corridor.' }, R)).status === 200)
} else { ok('…and can be sent back with notes', false, 'no second card in the queue') }

// ===================== and NOTHING else =====================
// The carve-out in routes/users.js is the whole reason this permission is
// safe to give away. Every one of these is a way onto the rest of the board.
const denied = async (what, call) => {
  const r = await call()
  ok(what, r.status === 403, `${r.status} ${r.data.error || ''}`)
}
await denied('the reviewer cannot make an admin', () => req('/users', 'POST', {
  name: 'No', username: `r89a${stamp}`, password: 'x1234', role: 'admin' }, R))
await denied('…nor a colleague', () => req('/users', 'POST', {
  name: 'No', username: `r89b${stamp}`, password: 'x1234', role: 'member' }, R))
await denied('…nor a crew hat', () => req('/users', 'POST', {
  name: 'No', username: `r89c${stamp}`, password: 'x1234', role: 'editor' }, R))
await denied('…nor an ambassador carrying rights', () => req('/users', 'POST', {
  name: 'No', username: `r89d${stamp}`, password: 'x1234', role: 'ambassador',
  permissions: { manage_users: true } }, R))
await denied('…nor one holding channels', () => req('/users', 'POST', {
  name: 'No', username: `r89e${stamp}`, password: 'x1234', role: 'ambassador',
  departments: ['instagram_main'] }, R))
const colleague = (await req('/users')).data.find((u) => u.username === 'jas')
await denied('…nor rename a colleague', () => req(`/users/${colleague.id}`, 'PATCH', { name: 'Renamed' }, R))
await denied('…nor delete one', () => req(`/users/${colleague.id}`, 'DELETE', null, R))
await denied('…nor turn a colleague into a student', () => req(`/users/${colleague.id}`, 'PATCH', { role: 'ambassador' }, R))
await denied('…nor promote their own student', () => req(`/users/${stu.data.id}`, 'PATCH', { role: 'admin' }, R))
await denied('…nor grant themselves anything', () => req(`/users/${rev.id}`, 'PATCH', { permissions: { manage_users: true } }, R))
await denied('…nor make a channel', () => req('/channels', 'POST', { label: 'No' }, R))
ok('a member without the job still cannot open the queue',
  (await req('/ambassadors', 'GET', null, await login('jas', 'j1234'))).status === 403)

// What they CAN do to their own students, which is the rest of the job.
ok('the reviewer can rename their student',
  (await req(`/users/${stu.data.id}`, 'PATCH', { name: 'Renamed Student' }, R)).status === 200)

// ===================== the door and the form =====================
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', `r89rev${stamp}`); await page.fill('input[name="password"]', 'r1234')
await page.click('button[type="submit"]'); await page.waitForTimeout(2200)

// This reviewer works on ONE channel, so they get the top-bar shell rather
// than a sidebar — the shell where a sidebar-only door does not exist. Read
// what is actually on screen, not a node CSS may be hiding at this width.
const chrome = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('.sidebar a, .topbar a, .topbar button, .mob-tabs a, .mob-tabs button')) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) out.push((el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
  }
  return out.join(' | ')
})
ok('the reviewer is given a door to the programme', /Ambassadors/.test(chrome), chrome.slice(0, 170))
ok('…and not one to the Admin panel', !/Admin panel/i.test(chrome), chrome.slice(0, 170))

await page.goto(BASE + '/ambassador'); await page.waitForTimeout(1600)
ok('the programme page opens for them', (await page.locator('.amb-admin').count()) === 1, page.url())
const add = page.locator('button').filter({ hasText: 'Sign up an ambassador' })
ok('…and offers to sign somebody up', (await add.count()) >= 1)
await add.first().click(); await page.waitForTimeout(500)
ok('…which opens a form', (await page.locator('.modal').count()) === 1)
const boxes = await page.locator('.modal input.input').all()
await boxes[0].fill('Browser Student'); await boxes[1].fill(`r89ui${stamp}`); await boxes[2].fill('b1234')
await page.locator('.modal button').filter({ hasText: 'Make the account' }).click()
await page.waitForTimeout(1800)
const made = (await req('/users')).data.find((u) => u.username === `r89ui${stamp}`)
ok('the account is really made, as an ambassador', !!made && made.role === 'ambassador', made ? `role=${made.role}` : 'not found')
ok('…and their terms open straight after, so the job is one flow',
  (await page.locator('.modal').count()) === 1)
await browser.close()

// ---- cleanup ----
if (made) await req(`/users/${made.id}`, 'DELETE')
await req(`/users/${stu.data.id}`, 'DELETE')
await req(`/users/${rev.id}`, 'DELETE')
console.log(fails === 0 ? '\nRound-89 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
