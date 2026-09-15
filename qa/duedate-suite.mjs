// Two things a board has to get right about a task: WHEN it is next due, and
// WHO may move it while it is still only an idea.
//
//   THE DAY A TASK IS WAITING ON. Every list that answered "when is this due?"
//   answered `release_date || recording_date` — the release day, for any task
//   that has one. A shoot booked for the 16th on a piece going out on the 21st
//   was therefore listed as the 21st: the person who booked the shoot read
//   their own booking back as a different day. Worse, "late" was decided
//   against that same release day, so a shoot day that came and went was never
//   late while the release was still a week out — the one deadline that cannot
//   be recovered was the one the board would not raise.
//
//   AN IDEA IS NOBODY'S PROPERTY. The server has allowed anybody who can see a
//   thought to move it along for a while (`wasAnIdea`), and the board agrees.
//   The task MENU did not: its stage picker unlocked on move_tasks alone, so a
//   content maker could drag an idea across the board but not move the task
//   they had open. Section C is the menu catching up.
//
// Self-contained: port 4132.
import { spawn } from 'child_process'
import { chromium } from 'playwright'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = new URL('.', import.meta.url).pathname
const PORT = 4132
const B = `http://localhost:${PORT}`

let fails = 0
const found = []
const ok = (id, n, c, x = '') => {
  if (!c) { fails++; found.push(`${id} ${n}${x ? ` — ${x}` : ''}`) }
  console.log(`${c ? '✔' : '✘ FAIL'} [${id}] ${n}${x ? ` — ${x}` : ''}`)
}
const procs = []
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })
procs.push(spawn(process.execPath, [ROOT + '/server/index.js'],
  { env: { ...process.env, DATA_DIR: SP + 'dd-' + Date.now(), PORT: String(PORT) }, stdio: 'ignore' }))
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(B + '/api/health')).ok) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500))
}

const login = async (u, p) => (await (await fetch(B + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (path, method = 'GET', body, tok = T) => {
  const r = await fetch(B + '/api' + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (n) => {
  const d = new Date(Date.now() + 5 * 3600e3)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const today = day(0)
const stamp = Date.now().toString().slice(-6)

console.log('\n=== A. the day a task is waiting on ===')
const { nextDue, dueKind } = await import(ROOT + '/client/src/lib/due.js')
// The shape from the report: a shoot on the 16th, a release on the 21st.
const booked = { recording_date: day(2), edit_ready_date: day(4), release_date: day(7) }
ok('A1', 'a booked shoot is waiting on its SHOOT day, not its release day',
  nextDue(booked, today) === day(2), `${nextDue(booked, today)} — the shoot is ${day(2)}, the release ${day(7)}`)
ok('A2', '…and the board can say which day that is', dueKind(booked) === 'shoot', String(dueKind(booked)))
// Once the shoot has happened it stops being what the task waits on.
ok('A3', 'a shoot that happened hands the wait to the cut',
  nextDue({ ...booked, shot_at: new Date().toISOString() }, today) === day(4),
  String(nextDue({ ...booked, shot_at: new Date().toISOString() }, today)))
ok('A4', '…and a cut handed over hands it to the release',
  nextDue({ ...booked, shot_at: 'x', ready_at: 'y' }, today) === day(7),
  String(nextDue({ ...booked, shot_at: 'x', ready_at: 'y' }, today)))
ok('A5', 'a task with only a release day is waiting on that',
  nextDue({ release_date: day(3) }, today) === day(3))
ok('A6', 'a task with no days at all is waiting on nothing',
  nextDue({}, today) === null, String(nextDue({}, today)))
ok('A7', 'a task with no days does not throw on a missing task either',
  nextDue(null, today) === null)

// The late reading — the half of this that was silently wrong.
const missed = { recording_date: day(-3), edit_ready_date: day(-1), release_date: day(7) }
ok('A8', 'a MISSED shoot day is what a task is late against',
  nextDue(missed, today) === day(-3),
  `${nextDue(missed, today)} — the old reading said ${missed.release_date}, which is not even late`)
ok('A9', '…so the board calls it late instead of calling it fine',
  nextDue(missed, today) < today, `${nextDue(missed, today)} vs ${today}`)
ok('A10', 'a shoot that was missed but HAPPENED is not held against the task',
  nextDue({ ...missed, shot_at: 'x' }, today) === day(-1),
  String(nextDue({ ...missed, shot_at: 'x' }, today)))
// Everything answered for and nothing left: a row still has to say something.
ok('A11', 'a task with every day answered for still has a date to show',
  nextDue({ recording_date: day(-5), shot_at: 'x' }, today) === day(-5),
  String(nextDue({ recording_date: day(-5), shot_at: 'x' }, today)))
ok('A12', 'the days are read in order, not in the order they were written',
  nextDue({ release_date: day(7), recording_date: day(2), edit_ready_date: day(4) }, today) === day(2))

console.log('\n=== B. and the board actually reads it that way ===')
// The half of this that was silent: a shoot day that came and went while the
// release was still ahead counted as nothing at all. The Overview's "Past its
// day" is the number that was wrong, and it is on the first screen anybody
// opens.
const stages = (await req('/statuses')).data
const shoot = stages.find((s) => /shoot/i.test(s.label))
const idea = stages[0]
const ch = (await req('/channels')).data.find((c) => c.format === 'social').key
const op = (await req('/users', 'POST', {
  name: `Due Op ${stamp}`, username: `duop${stamp}`, password: 'probe-only-123', role: 'operator', departments: [ch] })).data

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const signIn = async (u, p) => {
  // Cleared first: the app sends an already-signed-in browser straight off
  // /login, so the second sign-in of a run finds no form to fill.
  await page.goto(B + '/login')
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch { /* fine */ } })
  await page.goto(B + '/login')
  await page.waitForSelector('input[type="password"]', { timeout: 15000 })
  await page.fill('input[type="text"]', u)
  await page.fill('input[type="password"]', p)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(1600)
}
const lateCount = async () => {
  await page.goto(B + '/overview')
  await page.waitForTimeout(2400)
  // The card's OWN value element, not the first number anywhere near it: a
  // looser read passed while the rule behind it was broken, which is worse
  // than no test at all.
  return page.evaluate(() => {
    const card = [...document.querySelectorAll('.stat-card')]
      .find((c) => /Past its day|Просроч|o‘tib|otib/i.test(c.querySelector('.stat-card-label')?.textContent || ''))
    if (!card) return null
    const v = card.querySelector('.stat-card-value')?.textContent.trim()
    return v !== undefined && /^\d+$/.test(v) ? Number(v) : null
  })
}
await signIn('admin', 'admin123')
const before = await lateCount()
ok('B1', 'the Overview shows a count of what is past its day', before !== null, String(before))
// A shoot that was missed three days ago, on a piece not due out for a week.
await req('/content', 'POST', {
  title: `LATE ${stamp}`, channels: [ch], type: 'reel', status_id: shoot.id, operator_id: op.id,
  recording_date: day(-3), recording_time: '10:00', edit_ready_date: day(4), release_date: day(7),
  script: 'Open on the gate, walk to the library, three lines to camera about the course.',
  reference_text: 'https://example.com/ref' })
const after = await lateCount()
ok('B2', 'a missed SHOOT day counts as late even though the release is a week out',
  after === before + 1, `${before} → ${after} — the old reading compared today with ${day(7)} and found nothing wrong`)
ok('B3', 'nothing on the page threw', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log('\n=== C. an idea is nobody’s property ===')
// A content maker: on the channel, allowed to deliver work, NOT allowed to
// move tasks. The person this whole section is about.
const NONE = { manage_content: false, move_tasks: false, review_publish: false, request_changes: true,
  deliver_work: true, edit_metrics: false, manage_metrics: false, manage_layout: false, manage_ambassadors: false }
const maker = (await req('/users', 'POST', {
  name: `Maker ${stamp}`, username: `mkr${stamp}`, password: 'probe-only-123',
  role: 'member', departments: [ch], permissions: NONE })).data
const MK = await login(`mkr${stamp}`, 'probe-only-123')
// An idea created by somebody else, so the maker is not its assignee either.
const thought = (await req('/content', 'POST', {
  title: `THOUGHT ${stamp}`, channels: [ch], type: 'post', status_id: idea.id })).data
ok('C1', 'the server lets a content maker move an idea along',
  (await req(`/content/${thought.id}`, 'PATCH', { status_id: shoot.id }, MK)).status === 200)
// …and a piece that is NOT an idea stays shut to them, which is the rule the
// exception is an exception to.
const made = (await req('/content', 'POST', {
  title: `MADE ${stamp}`, channels: [ch], type: 'post', status_id: shoot.id })).data
ok('C2', '…but not a piece that has left the idea stage',
  (await req(`/content/${made.id}`, 'PATCH', { status_id: stages[2].id }, MK)).status === 403)

// Now the menu, which is where the report came from.
const idea2 = (await req('/content', 'POST', {
  title: `MENU ${stamp}`, channels: [ch], type: 'post', status_id: idea.id })).data
await signIn(`mkr${stamp}`, 'probe-only-123')
await page.goto(B + `/dept/${ch}`)
await page.waitForTimeout(2200)
await page.locator(`text=MENU ${stamp}`).first().click()
await page.waitForTimeout(1600)
const picker = page.locator('select[data-pick="stage"]')
ok('C3', 'the task menu opens on the idea', (await picker.count()) === 1)
ok('C4', 'and its stage picker is NOT greyed out for a content maker',
  (await picker.isDisabled()) === false, `disabled=${await picker.isDisabled()}`)
await picker.selectOption(String(shoot.id))
await page.waitForTimeout(400)
// Unlocking the picker is half an answer: the change also needs somewhere to
// go. A content maker used to get a read-only menu with no Save button at all.
const save = page.locator('button.btn-primary', { hasText: /Save|Сохран|Saqla/ })
ok('C5', 'and there is a Save button to commit the move with', (await save.count()) > 0)
await save.first().click()
await page.waitForTimeout(2200)
// Moving a thought onto a working stage raises the handover gate — the board
// asking WHO is doing this. That is a question, not a refusal, and answering
// it is part of the move. Before the fix nothing happened here at all: the
// menu had no Save button and the picker was grey, so the gate was never
// reached and the card never left the column.
ok('C6', 'the move is accepted and the board asks who is shooting it',
  (await page.locator('.gate-people').count()) > 0
  || (await page.locator('button.btn-primary', { hasText: /Hand over/i }).count()) > 0,
  JSON.stringify((await page.locator('[role=dialog], .modal').allTextContents()).map((x) => x.slice(0, 60))))
const person = page.locator('.gate-person')
if (await person.count()) { await person.first().click(); await page.waitForTimeout(500) }
for (let i = 0; i < 5; i++) {
  const go = page.locator('button.btn-primary', { hasText: /hand over|move|next|confirm|done/i })
  if (!(await go.count()) || await go.first().isDisabled()) break
  await go.first().click()
  await page.waitForTimeout(1100)
  const p2 = page.locator('.gate-person')
  if (await p2.count()) { await p2.first().click(); await page.waitForTimeout(400) }
}
await page.waitForTimeout(1200)
const landed = (await req(`/content/${idea2.id}`)).data
ok('C7', 'and it really lands on the new stage',
  landed.status_id === shoot.id, `stage ${landed.status_id}, wanted ${shoot.id}`)

// The same menu on a piece that is NOT an idea stays locked, so this did not
// hand out move_tasks by the back door.
await page.goto(B + `/dept/${ch}`)
await page.waitForTimeout(2000)
await page.locator(`text=MADE ${stamp}`).first().click()
await page.waitForTimeout(1600)
ok('C8', 'a piece past the idea stage still has its picker locked',
  (await page.locator('select[data-pick="stage"]').isDisabled()) === true)
ok('C9', 'still nothing threw', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
console.log(`\n${'='.repeat(58)}`)
if (found.length) {
  console.log(`${found.length} FINDING(S):`)
  found.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
} else {
  console.log('Due-date suite clean.')
}
process.exit(fails ? 1 : 0)
