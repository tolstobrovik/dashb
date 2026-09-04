// This round: missed filters & stats, the crew deck, hour-booked shoots with
// double-booking warnings, working schedules, and the team & hiring page.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
const today = fmt.format(new Date())
const add = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// ============ pre-clean: a crashed earlier run must not poison this one ============
for (const u of (await req('/users')).data.filter((u) => ['rav', 'off1', 'x1', 'zar', 'tst'].includes(u.username)))
  await req(`/users/${u.id}`, 'DELETE')
for (const c of (await req('/content')).data.filter((c) =>
  /rector interview|campus drone|Same day, no hours|Conflict UI probe|Wrong-day|Member tries|Night shoot/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
for (const n of (await req('/hiring')).data) await req(`/hiring/${n.id}`, 'DELETE')

// ============ working schedules on accounts ============
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const rav = (await req('/users', 'POST', {
  name: 'Ravshan Umarov', username: 'rav', password: 'r1234', role: 'operator',
  phone: '+998 90 555 44 33', position: 'Videographer', work_start: '09:00', work_end: '18:00', work_days: ALL_DAYS,
})).data
ok('operator created with schedule + phone + position', rav.id && rav.work_start === '09:00' && rav.phone === '+998 90 555 44 33' && rav.position === 'Videographer', JSON.stringify(rav).slice(0, 120))
ok('bad hours refused', (await req('/users', 'POST', { name: 'X', username: 'x1', password: 'x1234', work_start: '25:00' })).status === 400)
ok('day ends before it starts refused', (await req(`/users/${rav.id}`, 'PATCH', { work_start: '18:00', work_end: '09:00' })).status === 400)
const RT = await login('rav', 'r1234')
const meUp = (await req('/users/me', 'PATCH', { phone: '+998 91 000 11 22', work_end: '19:00' }, RT)).data
ok('crew edit their own schedule & phone', meUp.phone === '+998 91 000 11 22' && meUp.work_end === '19:00')
await req(`/users/${rav.id}`, 'PATCH', { work_end: '18:00' }) // back to 18:00 for the tests below

// ============ hour-booked shoots + the double-booking guard ============
const mk = (b, t = T) => req('/content', 'POST', b, t)
const A = (await mk({ title: 'Shoot: rector interview', channels: ['youtube'], type: 'video', operator_id: rav.id, recording_date: today, recording_time: '10:00', recording_end: '11:00' })).data
ok('shoot stored with from–to hours', A.recording_time === '10:00' && A.recording_end === '11:00')
ok('end before start refused', (await mk({ title: 'X', channels: ['youtube'], operator_id: rav.id, recording_date: today, recording_time: '12:00', recording_end: '11:30' })).status === 400)

const clash = await mk({ title: 'Shoot: campus drone pass', channels: ['instagram_main'], type: 'video', operator_id: rav.id, recording_date: today, recording_time: '10:30', recording_end: '11:30' })
ok('overlapping shoot answers 409 with details', clash.status === 409 && clash.data.conflicts?.length === 1 && clash.data.conflicts[0].title === 'Shoot: rector interview', JSON.stringify(clash.data).slice(0, 140))
ok('the admin is offered the bypass', clash.data.can_force === true)
const forced = await mk({ title: 'Shoot: campus drone pass', channels: ['instagram_main'], type: 'video', operator_id: rav.id, recording_date: today, recording_time: '10:30', recording_end: '11:30', force: true })
ok('admin forces the double-booking through', forced.status === 201)

ok('outside working hours answers 409', (await mk({ title: 'Night shoot', channels: ['youtube'], operator_id: rav.id, recording_date: today, recording_time: '19:00', recording_end: '20:00' })).status === 409)
const off = (await req('/users', 'POST', {
  name: 'Dayoff Tester', username: 'off1', password: 'o1234', role: 'operator',
  work_days: [new Date(`${today}T12:00:00Z`).getUTCDay()], // works ONLY today’s weekday
})).data
const offClash = await mk({ title: 'Wrong-day shoot', channels: ['youtube'], operator_id: off.id, recording_date: add(1), recording_time: '10:00' })
ok('shoot on a day off answers 409', offClash.status === 409 && /doesn’t work that day/.test(offClash.data.error || ''), offClash.data.error)

const JT = await login('jas', 'j1234')
const memberClash = await mk({ title: 'Member tries the same slot', channels: ['instagram_main'], operator_id: rav.id, recording_date: today, recording_time: '10:15', recording_end: '10:45' }, JT)
ok('member gets the warning too — with no bypass', memberClash.status === 409 && memberClash.data.can_force === false)
ok('member force flag is ignored', (await mk({ title: 'Member tries force', channels: ['instagram_main'], operator_id: rav.id, recording_date: today, recording_time: '10:15', recording_end: '10:45', force: true }, JT)).status === 409)

ok('PATCH into a clash answers 409', (await req(`/content/${A.id}`, 'PATCH', { recording_time: '10:45' })).status === 409)
ok('PATCH to a clean slot sails through', (await req(`/content/${A.id}`, 'PATCH', { recording_time: '13:00', recording_end: '14:00' })).status === 200)
ok('nudging within your own old slot is fine (self excluded)', (await req(`/content/${A.id}`, 'PATCH', { recording_time: '13:30', recording_end: '14:30' })).status === 200)
// back into the (intended) double-booked morning for the deck checks below
ok('admin re-forces the restored overlap', (await req(`/content/${A.id}`, 'PATCH', { recording_time: '10:00', recording_end: '11:00', force: true })).status === 200)
const B2 = (await mk({ title: 'Same day, no hours', channels: ['youtube'], operator_id: rav.id, recording_date: today })).data
ok('shoots without hours never clash', !!B2.id)

// give rav one edit so the deck shows a cut queue
const cut = (await mk({ title: 'Edit: rector interview cut', channels: ['youtube'], type: 'video', editor_id: rav.id, release_date: add(2) })).data

// ============ hiring API ============
ok('hiring is admin-only', (await req('/hiring', 'GET', null, JT)).status === 403)
const need = (await req('/hiring', 'POST', { title: 'Motion designer', note: 'Reels animations', priority: true })).data
ok('need created', need.id && need.status === 'open' && need.priority === 1)
ok('bad status refused', (await req(`/hiring/${need.id}`, 'PATCH', { status: 'ghosted' })).status === 400)
ok('marked hired', (await req(`/hiring/${need.id}`, 'PATCH', { status: 'hired' })).data.status === 'hired')
await req(`/hiring/${need.id}`, 'DELETE')
ok('deleted', (await req('/hiring')).data.every((n) => n.id !== need.id))

// ============ the UI ============
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
const page = await ctx.newPage()

// The crew seats are searchable pickers now, not <select> elements: typing in
// a select jumps to the first match instead of narrowing, which is what was
// wrong with it. Drive it the way a person does — open, type, press the row.
const ppPick = async (root, name) => {
  await root.click()
  await page.waitForSelector('.pp-pop', { timeout: 8000 })
  await page.fill('.pp-pop .pp-search .input', name)
  await page.waitForTimeout(200)
  await page.locator('.pp-pop .pp-row', { hasText: name }).first().click()
  await page.waitForTimeout(250)
}
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })

// ---- missed: filters and the numbers ----
await page.goto(BASE + '/missed')
await page.waitForSelector('.miss-stats', { timeout: 10000 })
await page.waitForTimeout(600)
ok('stat tiles render', (await page.locator('.miss-stat').count()) >= 3)
ok('period pills: day / week / custom', await page.locator('.pill', { hasText: 'Last 7 days' }).count() === 1 && await page.locator('.miss-filters .pill', { hasText: 'Custom…' }).count() === 1)
const allTxt = await page.locator('.content').textContent()
ok('admin sees every miss before filtering', allTxt.includes('Overdue: dorm life story series') && allTxt.includes('Campus vlog #12'))

await page.locator('.pill.pill-person', { hasText: 'Mirabbos' }).click()
await page.waitForTimeout(300)
const mirTxt = await page.locator('.content').textContent()
ok('person filter: only Mirabbos’s misses stay', mirTxt.includes('Campus vlog #12') && !mirTxt.includes('Overdue: dorm life story series'))
await page.locator('.pill', { hasText: 'Everyone' }).click()
await page.waitForTimeout(200)

const ytPill = page.locator('.miss-filters .pill', { hasText: 'YouTube' })
if (await ytPill.count()) {
  await ytPill.first().click()
  await page.waitForTimeout(300)
  const ytTxt = await page.locator('.content').textContent()
  ok('channel filter: instagram-only miss hidden', ytTxt.includes('Campus vlog #12') && !ytTxt.includes('Overdue: dorm life story series'))
  await page.locator('.miss-filters .pill', { hasText: 'All' }).first().click()
} else ok('channel filter pill present', false, 'no YouTube pill')
await page.waitForTimeout(200)

await page.locator('.miss-filters .pill', { hasText: 'Custom…' }).click()
await page.locator('.miss-custom input').first().fill(add(-90))
await page.locator('.miss-custom input').last().fill(add(-60))
await page.waitForTimeout(300)
ok('custom period: nothing that old → zeros', (await page.locator('.miss-stat:has(span:text-is("missed in this period")) b').textContent()) === '0')
await page.locator('.pill', { hasText: 'All time' }).click()
await page.waitForTimeout(200)
await page.screenshot({ path: 'r3-missed.png', fullPage: true })

// ---- the crew deck ----
await page.goto(BASE + '/crew')
await page.waitForSelector('.crew-card', { timeout: 10000 })
await page.waitForTimeout(500)
const ravCard = page.locator('.crew-card', { hasText: 'Ravshan Umarov' })
ok('operator has a deck card', (await ravCard.count()) === 1)
ok('load badge + meter present', (await ravCard.locator('.load-badge').count()) === 1 && /shoot hours booked/.test(await ravCard.locator('.crew-meter-txt').textContent()))
const ravTxt = await ravCard.textContent()
ok('the forced double-booking is flagged as a clash', /1 time clash/.test(ravTxt), ravTxt.match(/\d+ time clash\w*/)?.[0])
ok('the cut queue is counted', /1 in the cut/.test(ravTxt))
await page.locator('.pill', { hasText: 'Timetable' }).click()
await page.waitForSelector('.crew-tt', { timeout: 8000 })
const ttTxt = await page.locator('.crew-tt').textContent()
ok('today’s shoots ride the timetable with hours', ttTxt.includes('10:00–11:00') && ttTxt.includes('10:30–11:30'), ttTxt.slice(0, 100))
await page.screenshot({ path: 'r3-crew.png', fullPage: true })
await page.locator('.pill', { hasText: 'Deck' }).click()
await page.waitForTimeout(300)

// admin edits a schedule right from the deck
await ravCard.locator('button[aria-label="Edit schedule"]').click()
await page.waitForSelector('.modal', { timeout: 8000 })
await page.locator('.modal .sched-field input').last().fill('20:00')
await page.locator('.modal').getByRole('button', { name: 'Save schedule' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(400)
ok('deck schedule edit persisted', (await req('/users')).data.find((u) => u.id === rav.id).work_end === '20:00')

// ---- team & hiring ----
await page.goto(BASE + '/team')
await page.waitForSelector('.team-grid', { timeout: 10000 })
await page.waitForTimeout(500)
ok('team stat tiles render', (await page.locator('.miss-stat').count()) === 4)
const ravTeam = page.locator('.team-card', { hasText: 'Ravshan Umarov' })
ok('operator card: position + phone + schedule, no transparency', (await ravTeam.textContent()).includes('Videographer')
  && (await ravTeam.locator('a[href^="tel:"]').count()) === 1
  && /09:00–20:00/.test(await ravTeam.textContent()))
ok('role badges are on', (await page.locator('.role-badge.rb-operator').count()) >= 1 && (await page.locator('.role-badge.rb-admin').count()) === 1)
const gaps = await page.locator('.hire-gap').allTextContents()
ok('gap suggestions include the missing editor', gaps.some((g) => g.includes('Editor')), gaps.join(' | '))

// one click puts a gap on the board
await page.locator('.hire-gap', { hasText: 'Editor' }).first().click()
await page.waitForTimeout(400)
ok('gap became an open position', (await page.locator('.hire-card', { hasText: 'Editor' }).count()) >= 1)

// hand-made need with the urgent flame
await page.locator('.hire-add input').first().fill('Motion designer')
await page.locator('.hire-add input').nth(1).fill('Owns reels animations end to end')
await page.locator('.hire-flame').click()
await page.locator('.hire-add').getByRole('button', { name: 'Add' }).click()
await page.waitForTimeout(400)
ok('urgent need renders hot', (await page.locator('.hire-card.hot', { hasText: 'Motion designer' }).count()) === 1)
await page.screenshot({ path: 'r3-team.png', fullPage: true })
await page.locator('.hire-card', { hasText: 'Motion designer' }).getByRole('button', { name: 'Hired' }).click()
await page.waitForTimeout(400)
ok('hired moves off the open board', (await page.locator('.hire-card.hot', { hasText: 'Motion designer' }).count()) === 0
  && (await page.locator('.content').textContent()).includes('Recently hired'))

// edit a member card
const jasCard = page.locator('.team-card', { hasText: 'Jasmina' })
await jasCard.locator('button[aria-label="Edit"]').click()
await page.waitForSelector('.modal', { timeout: 8000 })
await page.locator('.modal input[placeholder*="Videographer"]').fill('SMM lead')
await page.locator('.modal input[type="tel"]').fill('+998 90 111 22 33')
await page.locator('.modal').getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(400)
ok('member card edit persisted', (await jasCard.textContent()).includes('SMM lead') && (await jasCard.locator('a[href^="tel:"]').count()) === 1)

// ---- the task modal: from–to hours + the conflict warning ----
const probe = (await mk({ title: 'Conflict UI probe', channels: ['instagram_main'], type: 'video' })).data
// The to-do list always shows your own tasks, whatever the channel dashboards
// are configured to display — the stable way to reach the task modal.
await page.goto(BASE + '/dept/instagram_main')
await page.waitForSelector('.tcard', { timeout: 12000 })
await page.waitForTimeout(500)
await page.locator('.tcard', { hasText: 'Conflict UI probe' }).first().click()
await page.waitForSelector('.modal', { timeout: 8000 })
ok('shoot row has from–to time inputs', (await page.locator('.modal .dates-block .drow').first().locator('input[type="time"]').count()) === 2)
await ppPick(page.locator('.modal .crew-row .pp-field').first(), 'Ravshan Umarov')
await page.locator('.modal .dates-block input[type="date"]').first().fill(today)
await page.locator('.modal .dates-block .drow').first().locator('input[type="time"]').first().fill('10:30')
await page.locator('.modal .dates-block .drow').first().locator('input[type="time"]').last().fill('11:15')
await page.locator('.modal').getByRole('button', { name: 'Save changes' }).click()
await page.waitForSelector('.conflict-box', { timeout: 8000 })
const cbox = await page.locator('.conflict-box').textContent()
ok('warning names the clashing shoots', cbox.includes('Shoot: rector interview') && cbox.includes('Shoot: campus drone pass'))
await page.screenshot({ path: 'r3-conflict.png' })
await page.locator('.conflict-box').getByRole('button', { name: 'Schedule anyway' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(400)
const probeNow = (await req('/content')).data.find((c) => c.id === probe.id)
ok('admin pushed it through — hours saved', probeNow.operator_id === rav.id && probeNow.recording_time === '10:30' && probeNow.recording_end === '11:15')

// ---- profile: own schedule section ----
const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 950 } })
const p2 = await ctx2.newPage()
await p2.goto(BASE + '/login')
await p2.fill('input[name="username"]', 'rav')
await p2.fill('input[name="password"]', 'r1234')
await p2.click('button[type="submit"]')
await p2.waitForURL(/brief/, { timeout: 15000 })
await p2.goto(BASE + '/profile')
await p2.waitForSelector('.wd-row', { timeout: 8000 })
ok('profile shows the working-schedule editor', (await p2.locator('.wd-chip').count()) === 7 && (await p2.locator('.wd-chip.on').count()) === 7)
const crewSide = await p2.locator('.sidebar, header').first().textContent()
ok('crew see no Video crew / Team links', !crewSide.includes('Video crew') && !crewSide.includes('Team & hiring'))
await ctx2.close()
await browser.close()

// ============ cleanup ============
for (const c of (await req('/content')).data.filter((c) =>
  ['Shoot: rector interview', 'Shoot: campus drone pass', 'Same day, no hours', 'Edit: rector interview cut', 'Conflict UI probe'].includes(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
for (const n of (await req('/hiring')).data) await req(`/hiring/${n.id}`, 'DELETE')
await req(`/users/${rav.id}`, 'DELETE')
await req(`/users/${off.id}`, 'DELETE')
await req(`/users/${(await req('/users')).data.find((u) => u.username === 'jas').id}`, 'PATCH', { position: null, phone: null })

console.log(fails === 0 ? '\nRound-3 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
