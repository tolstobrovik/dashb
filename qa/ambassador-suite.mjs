// The ambassador programme.
//
// A student with a login to one page. Everything this suite checks is a way
// that could go wrong quietly:
//
//   · the page is not the protection — the SERVER refuses an ambassador the
//     rest of the dashboard, at the one place every request passes through
//   · a new role must not leak into the pickers that hand out staff work
//   · a rejected idea is the SAME card coming round again, not a new row, or
//     the argument scatters across rows nobody can line up afterwards
//   · the terms are copied at approval and never move again: what somebody
//     was promised cannot be edited by changing their record later
//   · nothing pre-fills the amount, because a number a machine worked out is
//     a number nobody agreed to
//
// Self-contained: port 4143, its own data directory, its own browser pass.
import { spawn } from 'child_process'
import { chromium } from 'playwright'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const PORT = 4143
const BASE = `http://localhost:${PORT}`
const A = `${BASE}/api`
const dir = mkdtempSync(join(tmpdir(), 'amb-'))
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const srv = spawn(process.execPath, [join(ROOT, 'server/index.js')],
  { env: { ...process.env, DATA_DIR: dir, PORT: String(PORT) }, stdio: 'ignore' })
process.on('exit', () => { try { srv.kill('SIGKILL') } catch { /* gone */ } })
const up = async () => {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${A}/health`)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
if (!(await up())) { console.log('✘ FAIL the api never came up'); process.exit(1) }

const login = async (u, p) => (await (await fetch(`${A}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
// A token that failed to resolve must never quietly become the admin's — a
// probe that falls back like that reports every refusal as a leak.
const req = async (p, m = 'GET', b, t) => {
  const bearer = t === undefined ? T : t
  if (!bearer) throw new Error('no token — a login failed')
  const r = await fetch(A + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

const person = (await req('/users', 'POST', {
  name: 'Dilnoza', username: 'dilnoza', password: 'pass1234', role: 'ambassador',
})).data
ok('an ambassador account can be made', person.id > 0 && person.role === 'ambassador', JSON.stringify(person.role))
ok('…and holds no crew capability', Array.isArray(person.crew_roles) && person.crew_roles.length === 0)
ok('…and none of a member’s rights', Object.keys(person.permissions || {}).length === 0,
  JSON.stringify(person.permissions))
const D = await login('dilnoza', 'pass1234')
ok('…and can sign in', !!D)

// ---- 1) the rest of the dashboard is not theirs -------------------------------
const SHUT = ['/content', '/sprints/current', '/reports/pay', '/reports/stats', '/users', '/channels',
  '/docs', '/projects', '/campaigns', '/statuses', '/notifications', '/warnings', '/telegram/status']
let leaks = []
for (const p of SHUT) {
  const r = await req(p, 'GET', null, D)
  if (r.status !== 403) leaks.push(`${p}:${r.status}`)
}
ok('every other page is refused, by the server', leaks.length === 0, leaks.join(', '))
ok('…and the refusal says so plainly',
  (await req('/content', 'GET', null, D)).data.error === 'This is not part of your page')
ok('their own session still answers', (await req('/auth/me', 'GET', null, D)).status === 200)
ok('the admin list is not theirs either', (await req('/ambassadors', 'GET', null, D)).status === 403)
// Writes too — a gate that only reads is not a gate.
ok('nor may they write anywhere else',
  (await req('/content', 'POST', { title: 'sneaking in' }, D)).status === 403)

// ---- 2) a new role must not leak into the team --------------------------------
const staff = (await req('/sprints/people')).data
ok('an ambassador is not offered as somebody to give a sprint task to',
  !staff.some((u) => u.id === person.id), JSON.stringify(staff.map((u) => u.name)))

// ---- 3) setting them up -------------------------------------------------------
ok('before setup their page says so, rather than breaking',
  (await req('/ambassadors/me', 'GET', null, D)).status === 404)
ok('the admin sees the account as not set up',
  (await req('/ambassadors')).data.unset.some((u) => u.user_id === person.id))
ok('setting details is refused to the ambassador',
  (await req(`/ambassadors/person/${person.id}`, 'PUT', { university: 'Mine' }, D)).status === 403)
ok('an admin sets them', (await req(`/ambassadors/person/${person.id}`, 'PUT', {
  university: 'Westminster', telegram: '@dilnoza', default_posts_own: true, default_collaborator: true,
})).status === 200)
// A staff account is not an ambassador, whatever anybody PUTs.
const member = (await req('/users', 'POST', {
  name: 'Staff Person', username: 'staffp', password: 'pass1234', role: 'member',
})).data
ok('a member cannot be turned into one by the back door',
  (await req(`/ambassadors/person/${member.id}`, 'PUT', { university: 'X' })).status === 400)

// ---- 4) sending an idea -------------------------------------------------------
const thin = await req('/ambassadors/me/cards', 'POST', { format: 'Reel', script: 'a video' }, D)
ok('two words is not a script', thin.status === 400, `${thin.status} ${thin.data.error || ''}`)
ok('nor is a video with no kind',
  (await req('/ambassadors/me/cards', 'POST', { format: '', script: 'x'.repeat(60) }, D)).status === 400)
ok('a reference that is not a link is refused',
  (await req('/ambassadors/me/cards', 'POST', {
    format: 'Reel', script: 'x'.repeat(60), reference_url: 'ask me on telegram',
  }, D)).status === 400)
const SCRIPT = 'Walking tour of the campus, five spots, talking to two students on the way about why they chose it.'
ok('a real one goes through', (await req('/ambassadors/me/cards', 'POST', {
  format: 'Reel', script: SCRIPT, reference_url: 'https://instagram.com/p/x', planned_date: '2027-03-04',
}, D)).status === 201)
let me = (await req('/ambassadors/me', 'GET', null, D)).data
ok('it is waiting for our answer', me.cards[0].state === 'waiting' && me.cards[0].version === 1)
ok('their two numbers start at nothing', me.posted_this_month === 0 && me.earned_this_month === 0)

// ---- 5) the inbox -------------------------------------------------------------
let inbox = (await req('/ambassadors')).data.inbox
ok('one thing is waiting on us', inbox.length === 1)
ok('…with the name and the university on it', inbox[0].name === 'Dilnoza' && inbox[0].university === 'Westminster')
ok('…and the boxes pre-ticked from their usual terms',
  inbox[0].defaults.posts_own === true && inbox[0].defaults.collaborator === true && inbox[0].defaults.we_edit === false,
  JSON.stringify(inbox[0].defaults))
ok('…with nothing in the amount for a first video', inbox[0].recent_amounts.length === 0)
ok('a card carries no amount until somebody types one', inbox[0].amount === null)

// ---- 6) needs changes ---------------------------------------------------------
const bare = await req(`/ambassadors/cards/${inbox[0].id}/changes`, 'POST', { feedback: '   ' })
ok('a refusal with nothing behind it is refused', bare.status === 400, `${bare.status} ${bare.data.error || ''}`)
ok('an ambassador cannot decide their own card',
  (await req(`/ambassadors/cards/${inbox[0].id}/changes`, 'POST', { feedback: 'fine' }, D)).status === 403)
ok('with a reason it goes back',
  (await req(`/ambassadors/cards/${inbox[0].id}/changes`, 'POST',
    { feedback: 'Filmed without a confirmed script' })).status === 200)
me = (await req('/ambassadors/me', 'GET', null, D)).data
ok('they are told what needs changing', me.cards[0].state === 'needs_changes'
  && me.cards[0].feedback === 'Filmed without a confirmed script')
ok('and it is off our queue', (await req('/ambassadors')).data.inbox.length === 0)

// ---- 7) sending it again is the SAME card -------------------------------------
ok('sending it again',
  (await req(`/ambassadors/me/cards/${me.cards[0].id}`, 'PATCH',
    { script: `${SCRIPT} Now with the confirmed script, saying SATashkent out loud at the library.` }, D)).status === 200)
me = (await req('/ambassadors/me', 'GET', null, D)).data
ok('…leaves ONE card, not two', me.cards.length === 1, String(me.cards.length))
ok('…counted as the second try', me.cards[0].version === 2 && me.cards[0].state === 'waiting')
ok('…with the old feedback cleared off it', me.cards[0].feedback === '')
ok('a card nobody asked about cannot be re-sent',
  (await req(`/ambassadors/me/cards/${me.cards[0].id}`, 'PATCH', { script: 'x'.repeat(60) }, D)).status === 409)

// ---- 8) approval, and the lock --------------------------------------------------
inbox = (await req('/ambassadors')).data.inbox
const noAmount = await req(`/ambassadors/cards/${inbox[0].id}/approve`, 'POST', { posts_own: true })
ok('approving with no amount is refused', noAmount.status === 400, `${noAmount.status} ${noAmount.data.error || ''}`)
ok('…and nor will nought do',
  (await req(`/ambassadors/cards/${inbox[0].id}/approve`, 'POST', { amount: 0 })).status === 400)
ok('an ambassador cannot approve their own',
  (await req(`/ambassadors/cards/${inbox[0].id}/approve`, 'POST', { amount: 750000 }, D)).status === 403)
ok('an admin approves it', (await req(`/ambassadors/cards/${inbox[0].id}/approve`, 'POST',
  { amount: 750000, posts_own: true, collaborator: true })).status === 200)
me = (await req('/ambassadors/me', 'GET', null, D)).data
const card = me.cards[0]
ok('they can film it, for the amount that was typed',
  card.state === 'can_film' && card.amount === 750000, `${card.state} ${card.amount}`)
ok('…carrying the terms it was approved with',
  card.posts_own === true && card.collaborator === true && card.we_edit === false)

// THE LOCK. Changing their record afterwards must never reach into a card that
// has already been promised.
await req(`/ambassadors/person/${person.id}`, 'PUT', {
  university: 'Westminster', default_posts_own: false, default_collaborator: false, default_we_edit: true,
})
const after = (await req('/ambassadors/me', 'GET', null, D)).data.cards[0]
ok('changing their usual terms later cannot reach the card',
  after.posts_own === true && after.collaborator === true && after.we_edit === false && after.amount === 750000,
  JSON.stringify({ p: after.posts_own, c: after.collaborator, w: after.we_edit, a: after.amount }))
ok('approving twice is refused', (await req(`/ambassadors/cards/${card.id}/approve`, 'POST', { amount: 1 })).status === 409)
ok('and it is off our queue', (await req('/ambassadors')).data.inbox.length === 0)
// What was paid last time is offered as plain text on the NEXT one.
await req('/ambassadors/me/cards', 'POST', { format: 'Vlog', script: SCRIPT }, D)
ok('the next card is shown what they were paid before',
  JSON.stringify((await req('/ambassadors')).data.inbox[0].recent_amounts) === '[750000]')

// ---- 9) a paused ambassador ----------------------------------------------------
await req(`/ambassadors/person/${person.id}`, 'PUT', { university: 'Westminster', status: 'paused' })
ok('a paused ambassador cannot send more', (await req('/ambassadors/me/cards', 'POST',
  { format: 'Reel', script: SCRIPT }, D)).status === 403)
ok('…but can still read their own page', (await req('/ambassadors/me', 'GET', null, D)).status === 200)
await req(`/ambassadors/person/${person.id}`, 'PUT', { university: 'Westminster', status: 'active' })

// ---- 10) on the screen ----------------------------------------------------------
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const open = async (user, pass) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
  await page.route('**/*', (r) => (/localhost/.test(r.request().url()) ? r.continue() : r.abort()))
  await page.goto(`${BASE}/login`)
  await page.fill('input[name="username"]', user)
  await page.fill('input[name="password"]', pass)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(2600)
  return page
}

const mine = await open('dilnoza', 'pass1234')
ok('an ambassador lands on their own page', mine.url().endsWith('/ambassador'), mine.url())
ok('…with no sidebar', (await mine.locator('.sidebar').count()) === 0)
ok('…and two numbers on it', (await mine.locator('.amb-num').count()) === 2)
ok('…and one green button', (await mine.locator('.amb-send').count()) === 1)
const said = await mine.locator('.amb-card-line').allTextContents()
ok('a card says what is happening in a sentence',
  said.some((t) => /You can film this\. 750 000 so'm/.test(t)), JSON.stringify(said))
// Clause 9 is a list of words this board must never say to a student. A card
// says what is happening in a sentence; it does not wear a system label.
const BANNED = /can_film|needs_changes|\bpending\b|under review|\bapproved\b|\bconfirmed\b|\brejected\b|\bdeclined\b|submitted for verification|\bverified\b/i
ok('…and never one of the words this board does not use',
  !said.some((t) => BANNED.test(t)), JSON.stringify(said.filter((t) => BANNED.test(t))))
// A pasted link to anywhere else lands them back on their page rather than on
// a blank one full of refusals.
for (const path of ['/releases', '/sprints', '/admin', '/docs']) {
  await mine.goto(BASE + path); await mine.waitForTimeout(900)
  if (!mine.url().endsWith('/ambassador')) { fails++; console.log(`✘ FAIL ${path} did not send them back — ${mine.url()}`) }
}
ok('every other address sends them back to their page', true)

const boss = await open('admin', 'admin123')
await boss.goto(`${BASE}/ambassador`); await boss.waitForTimeout(1900)
ok('the admin has a door to it', (await boss.locator('.sidebar a[href="/ambassador"]').count()) === 1)
ok('…and sees the queue', (await boss.locator('.amb-row').count()) === 1)
await boss.locator('.amb-row-head').first().click(); await boss.waitForTimeout(700)
ok('opening one shows the script', (await boss.locator('.amb-script').count()) === 1)
ok('the amount starts empty, every time', (await boss.locator('.amb-amount .input').inputValue()) === '')
ok('Approve is off until somebody types one', await boss.locator('.amb-actions .btn-go').isDisabled())
ok('Needs changes is off while the box is empty',
  await boss.locator('.amb-actions .btn').nth(1).isDisabled())
await boss.locator('.amb-quick .btn').first().click(); await boss.waitForTimeout(300)
ok('…and one press fills it from the contract',
  !(await boss.locator('.amb-actions .btn').nth(1).isDisabled()))
await boss.fill('.amb-amount .input', '900000'); await boss.waitForTimeout(300)
await boss.locator('.amb-actions .btn-go').click(); await boss.waitForTimeout(600)
ok('approving asks once, in one line',
  /Approve Dilnoza at 900 000 so'm\?/.test(await boss.locator('.modal-body p').innerText()),
  (await boss.locator('.modal-body p').innerText()).slice(0, 80))

await browser.close()
srv.kill()
try { rmSync(dir, { recursive: true, force: true }) } catch { /* fine */ }
console.log(fails === 0 ? '\nAmbassador suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
