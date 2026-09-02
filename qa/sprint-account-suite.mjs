// Round 85: the week keeps what it promised.
//
// The question that started this round was "what if the team changes or
// deletes their deadlines?" — and the answer the board gave was: nothing
// stops them, and nothing records it. Three separate holes:
//
//   · the freeze was checked against whichever week was CURRENT, so while
//     this week was open every finished week was open with it — a task from
//     a closed sprint could be un-ticked, re-dated or deleted by anybody
//   · a promised day could be moved by the person who promised it, quietly
//   · deleting a task took it off the week's count after the week was over,
//     so a closed sprint's numbers changed under whoever was reading them
//
// Each one is checked here against a live server, because each was invisible
// from the screen: the board looked right and did the wrong thing underneath.
//
// Self-contained: port 4135, its own data directory, its own browser pass.
import { spawn } from 'child_process'
import { chromium } from 'playwright'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const PORT = 4135
const BASE = `http://localhost:${PORT}`
const A = `${BASE}/api`
const dir = mkdtempSync(join(tmpdir(), 'spa-'))
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
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(A + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const { createClient } = await import('@libsql/client')
const db = createClient({ url: `file:${join(dir, 'dashboard.db')}`, intMode: 'number' })

// Owner is a row in sprint_owners and NOTHING else — the platform admin flag
// is deliberately not inherited by this module. So the owner in this suite is
// a real one, and the admin is used to prove the flag does not leak.
await req('/users', 'POST', { name: 'Sprint Member', username: 'spm', password: 'pass1234', role: 'member' })
const M = await login('spm', 'pass1234')
const OW = (await req('/users', 'POST', { name: 'Sprint Owner', username: 'spo', password: 'pass1234', role: 'member' })).data
await req(`/sprints/owners/${OW.id}`, 'PUT', { owner: true })
const O = await login('spo', 'pass1234')
ok('an admin is not a sprint owner', (await req('/sprints/current')).data.owner === false)
ok('…and the owner is', (await req('/sprints/current', 'GET', null, O)).data.owner === true)

const mk = async (title, tok) => (await req('/sprints/tasks', 'POST', { title }, tok)).data.tasks.find((t) => t.title === title)
const one = async (id) => (await req('/sprints/current')).data.tasks.find((t) => t.id === id)

// ---- 1) a finished week is finished for everybody but an owner -------------
// The freeze used to be read off whichever sprint was CURRENT, whoever the
// task belonged to. A task answers to its OWN week.
const WEEK = 7 * 86400e3
const past = await mk('spa: last week', M)
const cur = (await req('/sprints/current')).data.sprint
await db.execute({
  sql: `INSERT INTO sprints (code, start_at, freeze_at, meeting_at, status, created_at)
        VALUES (?, ?, ?, ?, 'closed', ?)`,
  args: ['S000',
    new Date(Date.parse(cur.start_at) - WEEK).toISOString(),
    new Date(Date.parse(cur.freeze_at) - WEEK).toISOString(),
    new Date(Date.parse(cur.meeting_at) - WEEK).toISOString(),
    new Date(Date.parse(cur.start_at) - WEEK).toISOString()],
})
const old = (await db.execute("SELECT id FROM sprints WHERE code = 'S000'")).rows[0].id
await db.execute({ sql: 'UPDATE sprint_task_sprints SET sprint_id = ? WHERE task_id = ?', args: [old, past.id] })

const oldPatch = await req(`/sprints/tasks/${past.id}`, 'PATCH', { title: 'spa: rewritten' }, M)
ok('a task on a CLOSED week cannot be edited from an open one', oldPatch.status === 423,
  `${oldPatch.status} ${oldPatch.data.error || ''}`)
const oldDrop = await req(`/sprints/tasks/${past.id}`, 'DELETE', { reason: 'tidying' }, M)
ok('…nor dropped', oldDrop.status === 423, String(oldDrop.status))
ok('…and the owner still can', (await req(`/sprints/tasks/${past.id}`, 'PATCH', { title: 'spa: owner fixed it' }, O)).status === 200)

// ---- 2) a day that was promised ---------------------------------------------
// Every task is born with the week's end on it. That is the calendar, not a
// promise anybody made, so putting a FIRST real date on a task stays open to
// everybody — otherwise nothing could ever be scheduled.
const s0 = (await req('/sprints/current')).data.sprint
const weekEnd = s0.freeze_at.slice(0, 10)
const t1 = await mk('spa: a day', M)
ok('a new task carries the week’s end', t1.deadline === weekEnd, `${t1.deadline} vs ${weekEnd}`)
ok('anybody may put the first real day on it',
  (await req(`/sprints/tasks/${t1.id}`, 'PATCH', { deadline: '2027-03-04' }, M)).status === 200)
ok('…and it sticks', (await one(t1.id)).deadline === '2027-03-04')

const moved = await req(`/sprints/tasks/${t1.id}`, 'PATCH', { deadline: '2027-09-09' }, M)
ok('but moving it afterwards is refused', moved.status === 403, String(moved.status))
ok('…and the refusal says what to ask for',
  moved.data.ask_to_move?.from === '2027-03-04' && moved.data.ask_to_move?.to === '2027-09-09',
  JSON.stringify(moved.data.ask_to_move))
ok('…and the day did not move', (await one(t1.id)).deadline === '2027-03-04')
const cleared = await req(`/sprints/tasks/${t1.id}`, 'PATCH', { deadline: '' }, M)
ok('clearing a promised day counts as moving it', cleared.status === 403, String(cleared.status))
ok('…so it is still there', (await one(t1.id)).deadline === '2027-03-04')
// Everything else on the card stays the member's to change: this is a rule
// about one field, not a task the team has lost.
ok('the rest of the card is still theirs',
  (await req(`/sprints/tasks/${t1.id}`, 'PATCH', { description: 'still mine' }, M)).status === 200)
ok('an owner moves the day', (await req(`/sprints/tasks/${t1.id}`, 'PATCH', { deadline: '2027-09-09' }, O)).status === 200)
ok('…and it moved', (await one(t1.id)).deadline === '2027-09-09')

// ---- 3) dropped, not deleted -------------------------------------------------
// /history counts a week's tasks live. Deleting a row therefore changed a
// FINISHED week's numbers under whoever was reading them.
const t2 = await mk('spa: dropped one', M)
const before = (await req('/sprints/history')).data.find((w) => w.id === s0.id)
const dropped = await req(`/sprints/tasks/${t2.id}`, 'DELETE', { reason: 'the client cancelled' }, M)
ok('a member may drop a task on the open week', dropped.status === 200, String(dropped.status))
const board = (await req('/sprints/current')).data
ok('it leaves the board', !board.tasks.some((t) => t.id === t2.id))
ok('…and lands in the dropped list with its reason',
  board.dropped.some((d) => d.id === t2.id && d.dropped_reason === 'the client cancelled' && d.dropped_by),
  JSON.stringify(board.dropped))
const after = (await req('/sprints/history')).data.find((w) => w.id === s0.id)
ok('the week still promised what it promised', after.tasks === before.tasks, `${before.tasks} -> ${after.tasks}`)
ok('…and says how many were dropped', after.dropped === 1, String(after.dropped))
ok('dropping it twice is refused', (await req(`/sprints/tasks/${t2.id}`, 'DELETE', {}, M)).status === 409)
// A dropped task is out of everybody's way, including its own author's — it
// must not be edited back into the week by the back door.
ok('a dropped task cannot be edited by a member',
  (await req(`/sprints/tasks/${t2.id}`, 'PATCH', { title: 'sneaking back' }, M)).status === 423)

const bad = await req(`/sprints/tasks/${t2.id}/restore`, 'POST', {}, M)
ok('a member cannot put it back', bad.status === 403, `${bad.status} ${bad.data.error || ''}`)
ok('an owner can', (await req(`/sprints/tasks/${t2.id}/restore`, 'POST', {}, O)).status === 200)
const back = (await req('/sprints/current')).data
ok('…and it is back on the board', back.tasks.some((t) => t.id === t2.id))
ok('…and out of the dropped list', !back.dropped.some((d) => d.id === t2.id))
ok('restoring what is not dropped is refused', (await req(`/sprints/tasks/${t2.id}/restore`, 'POST', {}, O)).status === 409)

// ---- 4) the paper trail ------------------------------------------------------
const log = (await req('/sprints/activity')).data
const kinds = log.map((e) => e.kind)
ok('the log holds the deadline move, the drop and the restore',
  kinds.includes('deadline') && kinds.includes('dropped') && kinds.includes('restored'), JSON.stringify(kinds))
const dl = log.find((e) => e.kind === 'deadline')
ok('…the move says where from and where to', dl.old_value === '2027-03-04' && dl.new_value === '2027-09-09',
  `${dl.old_value} -> ${dl.new_value}`)
ok('…and who made it', dl.user_name === 'Sprint Owner', dl.user_name)
ok('the drop carries the reason', log.find((e) => e.kind === 'dropped')?.note === 'the client cancelled')
ok('the log names the task, so a deleted row still reads',
  log.every((e) => typeof e.task_title === 'string' && e.task_title.length > 0))
ok('newest first', Date.parse(log[0].created_at) >= Date.parse(log[log.length - 1].created_at))
ok('a member may read it — this is for the Saturday meeting, not for owners',
  (await req('/sprints/activity', 'GET', null, M)).status === 200)
ok('another week’s log is another week’s',
  (await req(`/sprints/activity?sprint=${old}`)).data.length !== log.length)
// A first day set by a member is not a move and must not clutter the record.
ok('setting a first day is not logged as a move',
  log.filter((e) => e.kind === 'deadline').length === 1, String(log.filter((e) => e.kind === 'deadline').length))

// ---- 5) on the screen --------------------------------------------------------
// A context per person: signing in twice in one context lands on a page that
// has no login form on it, and the second person is really the first.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const open = async (user) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
  await page.route('**/*', (r) => (/localhost/.test(r.request().url()) ? r.continue() : r.abort()))
  await page.goto(`${BASE}/login`)
  await page.fill('input[name="username"]', user)
  await page.fill('input[name="password"]', 'pass1234')
  await page.click('button[type="submit"]')
  // A member lands on the brief, an owner on whatever their role opens on —
  // all this needs is that the sign-in finished.
  await page.waitForURL(/overview|brief|todo|dept/, { timeout: 20000 })
  await page.goto(`${BASE}/sprints`)
  await page.waitForTimeout(1700)
  return page
}

const t3 = await mk('spa: on screen', M)
const mp = await open('spm')

// Drop one from the card, with a reason, the way a person would.
await mp.locator('.sp-card', { hasText: 'spa: on screen' }).click(); await mp.waitForTimeout(700)
ok('the card offers Drop, not Delete', (await mp.locator('.modal-foot button', { hasText: 'Drop it' }).count()) === 1)
await mp.locator('.modal-foot button', { hasText: 'Drop it' }).click(); await mp.waitForTimeout(600)
ok('…and asks what happened', (await mp.locator('.modal-head h3', { hasText: 'Drop this task?' }).count()) === 1)
await mp.fill('.sp-drop-why', 'we are doing it next week')
await mp.locator('.modal-foot button', { hasText: 'Drop it' }).last().click(); await mp.waitForTimeout(1600)
ok('the card leaves the board', (await mp.locator('.sp-card', { hasText: 'spa: on screen' }).count()) === 0)
ok('…and the reason it left is on the page',
  (await mp.locator('.sp-dropped-tbl tbody tr', { hasText: 'we are doing it next week' }).count()) === 1,
  (await mp.locator('.sp-dropped-tbl tbody').innerText().catch(() => 'no table')).replace(/\n/g, ' | '))
ok('a member is told who can put it back', (await mp.locator('.sp-dropped-note').count()) === 1)
ok('…and is not offered the button', (await mp.locator('.sp-dropped-tbl button').count()) === 0)
// The record of a board that does not include what you just did is a record
// nobody reads twice — the log refreshes with the board.
ok('what changed is on the page, and includes the drop just made',
  /Sprint Member/.test(await mp.locator('.sp-log').innerText()),
  (await mp.locator('.sp-log').innerText().catch(() => 'no log')).slice(0, 160).replace(/\n/g, ' | '))

// The promised day, on the screen that has to explain itself.
await mp.locator('.sp-card', { hasText: 'spa: a day' }).click(); await mp.waitForTimeout(700)
ok('a promised day cannot be typed over', await mp.locator('.sp-deadline-field input').isDisabled())
ok('…and the page says why, rather than looking broken', (await mp.locator('.sp-day-locked').count()) === 1)

const op = await open('spo')
ok('an owner is offered the button', (await op.locator('.sp-dropped-tbl button', { hasText: 'Put it back' }).count()) === 1)
await op.locator('.sp-dropped-tbl button', { hasText: 'Put it back' }).click(); await op.waitForTimeout(1600)
ok('…and one press puts it back', (await op.locator('.sp-card', { hasText: 'spa: on screen' }).count()) === 1)
ok('…and the restore is in the log', /put it back/.test(await op.locator('.sp-log').innerText()))
await op.locator('.sp-card', { hasText: 'spa: a day' }).click(); await op.waitForTimeout(700)
ok('an owner may type the day', !(await op.locator('.sp-deadline-field input').isDisabled()))
ok('…and is not shown the note', (await op.locator('.sp-day-locked').count()) === 0)

await browser.close()
srv.kill()
try { rmSync(dir, { recursive: true, force: true }) } catch { /* fine */ }
console.log(fails === 0 ? '\nSprint accountability suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
