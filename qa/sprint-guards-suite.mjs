// Sprints: the seven things a QA pass found before it shipped.
//
// Every check here is a bug that was real, reproduced, and fixed. They are
// kept because six of the seven were invisible from the screen — the board
// looked right and did the wrong thing underneath.
//
// The first one is the reason this file exists. The board used to answer "the
// newest active sprint", not "this week". So on Monday morning, after a
// Saturday nobody had closed, it still showed last week — which is past its
// freeze — and the whole team was locked out of a read-only board until
// somebody restarted the server. That is a Monday where nobody can work.
//
// Self-contained: port 4118, its own data directory.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
import { spawn } from 'child_process'
import { join } from 'path'

const SP = new URL('.', import.meta.url).pathname
const DATA = SP + 'sg-' + Date.now()
const B = 'http://localhost:4118/api'

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })
procs.push(spawn(process.execPath, [ROOT + '/server/index.js'],
  { env: { ...process.env, DATA_DIR: DATA, PORT: '4118' }, stdio: 'ignore' }))
const wait = async () => {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(B + '/health')).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
if (!await wait()) { console.log('✘ FAIL the api never came up'); process.exit(1) }

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t || T}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const { createClient } = await import('@libsql/client')
const db = createClient({ url: `file:${join(DATA, 'dashboard.db')}`, intMode: 'number' })
const mk = async (title) => (await req('/sprints/tasks', 'POST', { title })).data.tasks.find((t) => t.title === title)
const one = async (id) => (await req('/sprints/current')).data.tasks.find((t) => t.id === id)

await req('/users', 'POST', { name: 'Nodira', username: 'nodira', password: 'pass1234', role: 'member' })
const N = await login('nodira', 'pass1234')

// ---------- 1. the Monday nobody closed ----------
const WEEK = 7 * 86400e3
const start = (await req('/sprints/current')).data.sprint
await db.execute({
  sql: 'UPDATE sprints SET start_at = ?, freeze_at = ?, meeting_at = ?, code = ? WHERE id = ?',
  args: [new Date(Date.parse(start.start_at) - WEEK).toISOString(),
    new Date(Date.parse(start.freeze_at) - WEEK).toISOString(),
    new Date(Date.parse(start.meeting_at) - WEEK).toISOString(),
    'S' + (Number(start.code.slice(1)) - 1), start.id],
})
const monday = (await req('/sprints/current')).data
ok('a week nobody closed does not hold the board', monday.sprint.start_at === start.start_at,
  `${monday.sprint.code} ${monday.sprint.start_at}`)
ok('…so the board is not frozen on a Monday', monday.frozen === false)
ok('…and an ordinary member can still put work on it',
  (await req('/sprints/tasks', 'POST', { title: 'Work in the new week' }, N)).status === 201)
ok('…on exactly one row for the week',
  (await db.execute({ sql: 'SELECT COUNT(*) c FROM sprints WHERE start_at = ?', args: [start.start_at] })).rows[0].c === 1)

// ---------- 2. a task pulled back out of Done drops its proof ----------
let t = await mk('Finished then reopened')
await req(`/sprints/tasks/${t.id}`, 'PATCH', { status: 'done', result_type: 'link', result_link: 'https://satashkent.uz/x' })
await req(`/sprints/tasks/${t.id}`, 'PATCH', { status: 'in_progress' })
let now = await one(t.id)
ok('reopening a finished task drops the result it claimed',
  now.result_type === null && now.result_link === '', JSON.stringify({ ty: now.result_type, l: now.result_link }))
ok('…and it is asked for a new one to go back',
  (await req(`/sprints/tasks/${t.id}`, 'PATCH', { status: 'done' })).status === 422)

// ---------- 3. a title is a line on a card ----------
const long = await req('/sprints/tasks', 'POST', { title: 'x'.repeat(5000) })
ok('a five-thousand-character title is cut to fit a card',
  long.data.tasks.find((x) => x.title.startsWith('xxx'))?.title.length === 200)

// ---------- 4. a deadline is a date ----------
t = await mk('Deadline guard')
const wasDay = (await one(t.id)).deadline
ok('a deadline that is not a date is refused',
  (await req(`/sprints/tasks/${t.id}`, 'PATCH', { deadline: 'next tuesday-ish' })).status === 400)
ok('…and the one it had is untouched', (await one(t.id)).deadline === wasDay)
ok('…while a real date is taken',
  (await req(`/sprints/tasks/${t.id}`, 'PATCH', { deadline: '2027-01-04' })).status === 200
  && (await one(t.id)).deadline === '2027-01-04')

// ---------- 5. a checklist item needs a task to belong to ----------
ok('a checklist item on a task that does not exist is refused',
  (await req('/sprints/tasks/999999/checklist', 'POST', { text: 'orphan' })).status === 404)
ok('…and none was written',
  (await db.execute({ sql: 'SELECT COUNT(*) c FROM sprint_checklist_items WHERE task_id = ?', args: [999999] })).rows[0].c === 0)

// ---------- 6. a promoted task cannot go back to being invisible ----------
t = await mk('Status guard')
ok('a board task cannot be moved back to "idea"',
  (await req(`/sprints/tasks/${t.id}`, 'PATCH', { status: 'idea' })).status === 400)
ok('…so it is still where it was', (await one(t.id)).status === 'todo')
ok('nor to a status nobody has heard of',
  (await req(`/sprints/tasks/${t.id}`, 'PATCH', { status: 'nearly' })).status === 400)

// ---------- 7. leaving blocked still clears the reason ----------
t = await mk('Blocked then finished')
await req(`/sprints/tasks/${t.id}`, 'PATCH', { status: 'blocked', blocker_reason: 'Priority changed' })
await req(`/sprints/tasks/${t.id}`, 'PATCH', { status: 'done', result_type: 'text', result_text: 'y'.repeat(120) })
now = await one(t.id)
ok('finishing a blocked task clears what it was waiting on',
  now.status === 'done' && now.blocker_reason === '', JSON.stringify(now.blocker_reason))

console.log(fails === 0 ? '\nSprint guards suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
