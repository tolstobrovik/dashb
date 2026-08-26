// Sprints, step 3: the backlog and the promote flow.
//
// The backlog is not a table. An idea is a task with no week — status 'idea'
// and no row in sprint_task_sprints — which is why promoting one needs no
// delete and can never leave a stray row behind. These checks go at the API
// rather than the screen, because the rule that matters ("only an owner may
// promote") has to hold against a client that is old, wrong, or curl.
//
// The owner row is inserted straight into the database on purpose: there is no
// route that grants ownership, and there should not be one.
//
// Self-contained: port 4116, its own data directory.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
import { spawn } from 'child_process'
import { join } from 'path'

const SP = new URL('.', import.meta.url).pathname
const DATA = SP + 'sb-' + Date.now()
const B = 'http://localhost:4116/api'

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })

const api = spawn(process.execPath, [ROOT + '/server/index.js'],
  { env: { ...process.env, DATA_DIR: DATA, PORT: '4116' }, stdio: 'ignore' })
procs.push(api)

const wait = async () => {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(B + '/health')).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
if (!await wait()) { console.log('✘ FAIL the api never came up'); process.exit(1) }

const login = async (u, p) => (await (await fetch(B + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})).json()).token
const req = async (p, m = 'GET', b, t) => {
  const r = await fetch(B + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

// Straight to the database, the way the owner row is meant to be created.
const { createClient } = await import('@libsql/client')
const db = createClient({ url: `file:${join(DATA, 'dashboard.db')}`, intMode: 'number' })

const ADMIN = await login('admin', 'admin123')

// Two ordinary people. Neither is a sprint owner; one of them is a platform
// admin, which is exactly the thing that must NOT grant ownership.
await req('/users', 'POST', {
  name: 'Dilnoza', username: 'dilnoza', password: 'pass1234', role: 'member',
}, ADMIN)
const DILNOZA = await login('dilnoza', 'pass1234')
const users = (await req('/users', 'GET', null, ADMIN)).data
const dil = users.find((u) => u.username === 'dilnoza')
// The six, read from the API rather than retyped, so the guide is checked
// against what the server actually accepts.
const BLOCKER_REASONS_CHECK = (await req('/sprints/current', 'GET', null, ADMIN)).data.blockerReasons
const adm = users.find((u) => u.username === 'admin')

// ---------- an idea is anybody's to write down ----------
ok('the backlog starts empty', (await req('/sprints/backlog', 'GET', null, ADMIN)).data.items.length === 0)

let r = await req('/sprints/backlog', 'POST', { title: 'Try a campus podcast' }, DILNOZA)
ok('anybody can write an idea down', r.status === 201 && r.data.items.length === 1, String(r.status))
const idea = r.data.items[0]
ok('…and it carries who added it', idea.added_by === 'Dilnoza' && idea.created_by === dil.id,
  JSON.stringify(idea.added_by))
ok('…and when', /^\d{4}-\d{2}-\d{2}T/.test(idea.created_at || ''), String(idea.created_at))
ok('an idea with no title is refused',
  (await req('/sprints/backlog', 'POST', { title: '   ' }, DILNOZA)).status === 400)

// ---------- an idea is not on the board and counts towards nothing ----------
const board = (await req('/sprints/current', 'GET', null, ADMIN)).data
ok('an idea is not on the board', !board.tasks.some((t) => t.id === idea.id), JSON.stringify(board.tasks.length))
ok('…and nobody is on the strip because of it', board.people.length === 0)
const raw = await db.execute({ sql: 'SELECT status, deadline FROM sprint_tasks WHERE id = ?', args: [idea.id] })
ok('…and it has no deadline of its own', raw.rows[0].status === 'idea' && raw.rows[0].deadline === null,
  JSON.stringify(raw.rows[0]))

// ---------- promoting is owner-only, and a platform admin is not an owner ----------
r = await req(`/sprints/backlog/${idea.id}/promote`, 'POST', {}, DILNOZA)
ok('a member cannot promote', r.status === 403, `${r.status} ${r.data.error || ''}`)
r = await req(`/sprints/backlog/${idea.id}/promote`, 'POST', {}, ADMIN)
ok('…and neither can a platform admin who is not a sprint owner', r.status === 403, String(r.status))
ok('…the idea is untouched by a refused promotion',
  (await req('/sprints/backlog', 'GET', null, ADMIN)).data.items.length === 1)

// The owner row, inserted by hand — there is no route that does this.
await db.execute({ sql: 'INSERT INTO sprint_owners (user_id) VALUES (?)', args: [adm.id] })
ok('the board now knows the admin is an owner', (await req('/sprints/current', 'GET', null, ADMIN)).data.owner === true)
ok('…and the backlog agrees', (await req('/sprints/backlog', 'GET', null, ADMIN)).data.owner === true)
ok('…while everybody else is still not one', (await req('/sprints/backlog', 'GET', null, DILNOZA)).data.owner === false)

r = await req(`/sprints/backlog/${idea.id}/promote`, 'POST', {}, ADMIN)
ok('an owner promotes it', r.status === 200, `${r.status} ${r.data.error || ''}`)
ok('…and it leaves the backlog', r.data.items.length === 0, JSON.stringify(r.data.items.map((i) => i.title)))
ok('…coming back in the board\'s own shape',
  r.data.task && r.data.task.id === idea.id && r.data.task.status === 'todo'
    && Array.isArray(r.data.task.assignees) && r.data.task.checklist
    && r.data.task.checklist.total === 0,
  JSON.stringify(r.data.task))

const after = (await req('/sprints/current', 'GET', null, ADMIN)).data
const promoted = after.tasks.find((t) => t.id === idea.id)
ok('it lands in To Do on this week\'s board', !!promoted && promoted.status === 'todo')
ok('…with the sprint freeze as its deadline', promoted.deadline === after.sprint.freeze_at.slice(0, 10),
  String(promoted?.deadline))
ok('…and nobody assigned yet', promoted.assignees.length === 0)
const weeks = await db.execute({ sql: 'SELECT * FROM sprint_task_sprints WHERE task_id = ?', args: [idea.id] })
ok('…on exactly one week', weeks.rows.length === 1 && weeks.rows[0].sprint_id === after.sprint.id,
  JSON.stringify(weeks.rows))

// ---------- promoting twice, and promoting nothing ----------
r = await req(`/sprints/backlog/${idea.id}/promote`, 'POST', {}, ADMIN)
ok('promoting the same one twice is refused', r.status === 409, `${r.status} ${r.data.error || ''}`)
ok('promoting something that is not there is a 404',
  (await req('/sprints/backlog/99999/promote', 'POST', {}, ADMIN)).status === 404)
const weeks2 = await db.execute({ sql: 'SELECT * FROM sprint_task_sprints WHERE task_id = ?', args: [idea.id] })
ok('…and the refused second promotion left no second week row', weeks2.rows.length === 1)

// ---------- the freeze does not reach the backlog ----------
// An idea belongs to no week, so there is no week of it to freeze. A board
// task is a different matter, and this is where the two must not be confused.
await db.execute({
  sql: 'UPDATE sprints SET freeze_at = ? WHERE status = ?',
  args: [new Date(Date.now() - 3600e3).toISOString(), 'active'],
})
ok('the board reads as frozen', (await req('/sprints/current', 'GET', null, DILNOZA)).data.frozen === true)
ok('a member cannot add a task to a frozen week',
  (await req('/sprints/tasks', 'POST', { title: 'too late' }, DILNOZA)).status === 423)
r = await req('/sprints/backlog', 'POST', { title: 'An idea for next week' }, DILNOZA)
ok('…but can still write an idea down', r.status === 201 && r.data.items.length === 1, String(r.status))
const late = r.data.items[0]
ok('and an owner can still promote after the freeze',
  (await req(`/sprints/backlog/${late.id}/promote`, 'POST', {}, ADMIN)).status === 200)
ok('…while a member still cannot',
  (await req(`/sprints/backlog/${idea.id}/promote`, 'POST', {}, DILNOZA)).status === 403)

// ---------- isolation ----------
ok('ideas never reach the content board',
  !(await req('/content', 'GET', null, ADMIN)).data.some((c) => c.title === 'Try a campus podcast'))
ok('the users table was not written to',
  (await req('/users', 'GET', null, ADMIN)).data.length === users.length)
const owners = await db.execute('SELECT * FROM sprint_owners')
ok('…and ownership is still the one row that was inserted by hand', owners.rows.length === 1)

// ---------- the guide the ? button opens ----------
// It states the rules the server enforces. If the two ever disagree, the one
// people read is the one that is wrong, so the numbers are checked here
// against the numbers the code uses.
const { SPRINT_GUIDE } = await import(ROOT + '/client/src/lib/sprintGuide.js')
const langs = Object.keys(SPRINT_GUIDE)
ok('the guide exists in all three languages', langs.length === 3 && langs.every((l) => SPRINT_GUIDE[l].length === 12),
  JSON.stringify(langs.map((l) => `${l}:${SPRINT_GUIDE[l].length}`)))
const flat = (l) => SPRINT_GUIDE[l].flatMap((x) => [x.h, ...(x.p || []), ...(x.list || []), ...(x.after || [])])
const dashed = langs.filter((l) => flat(l).some((line) => /[\u2013\u2014]/.test(line) || /\s-\s/.test(line)))
ok('…and none of it uses a dash as punctuation', dashed.length === 0, dashed.join(', '))
const en = flat('en').join(' ')
ok('…it states the freeze the server enforces', en.includes('Saturday at 12:00'))
ok('…the hundred characters the server counts', en.includes('100 characters'))
ok('…and every one of the six blocker reasons',
  BLOCKER_REASONS_CHECK.every((r) => en.includes(r)),
  JSON.stringify(BLOCKER_REASONS_CHECK.filter((r) => !en.includes(r))))

console.log(fails === 0 ? '\nSprint backlog suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
