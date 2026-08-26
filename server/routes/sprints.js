import { Router } from 'express'
import { all, get, run, batch, sprintTaskChildDeletes, ensureCurrentSprint } from '../db.js'
import { authRequired, wrap } from '../auth.js'
import { weekOf, isFrozen, weekLabel } from '../sprintweek.js'

// Sprints — the weekly board.
//
// ISOLATION. This router reads the users table for id, name and avatar and
// touches nothing else outside its own sprint_ tables. It writes to users
// never. Nothing here is content, no release logic is borrowed, and no other
// part of the platform reads from these tables.
//
// PERMISSION. Owner is a row in sprint_owners and nothing else — the platform
// Admin flag is deliberately not inherited, so an admin who is not an owner
// works under the same freeze as everybody else. Owner is required for
// exactly three things: closing a sprint, editing after the freeze, and
// promoting from the backlog. Everything else is open to any signed-in user.
const router = Router()
router.use(authRequired)

const now = () => new Date().toISOString()
const isOwner = async (userId) => !!(await get('SELECT 1 AS x FROM sprint_owners WHERE user_id = ?', userId))

// The week on screen. Created on demand as well as at boot, so a board that
// has been asleep since Friday opens on Monday's sprint rather than on none.
async function currentSprint() {
  const active = await get("SELECT * FROM sprints WHERE status = 'active' ORDER BY start_at DESC LIMIT 1")
  if (active) return active
  await ensureCurrentSprint()
  return get("SELECT * FROM sprints WHERE status = 'active' ORDER BY start_at DESC LIMIT 1")
}

const BLOCKER_REASONS = [
  'Waiting on teammate', 'Waiting on external party', 'Budget or approval',
  'Scope was too big', 'Priority changed', 'Did not start',
]
const STATUSES = ['idea', 'todo', 'in_progress', 'blocked', 'done']
const BOARD = ['todo', 'in_progress', 'blocked', 'done']

// ---- the three enforcements -------------------------------------------------
// Server side, every one of them: a client can be old, wrong or bypassed, and
// "the UI would not let you" is not a rule.

// 1. Done requires a result. One of the three, and really one of the three —
//    a link that is not a link and a hundred characters of spaces are both a
//    task marked finished with nothing behind it.
async function resultProblem(taskId, body) {
  const kind = String(body?.result_type || '')
  if (kind === 'link') {
    const link = String(body.result_link || '').trim()
    let ok = false
    try { const u = new URL(link); ok = u.protocol === 'http:' || u.protocol === 'https:' } catch { ok = false }
    if (!ok) return 'A result link has to be a real address — http:// or https://'
    return null
  }
  if (kind === 'text') {
    const text = String(body.result_text || '').trim()
    if (text.length < 100) return `A written result needs at least 100 characters — this one has ${text.length}`
    return null
  }
  if (kind === 'file') {
    const id = Number(body.result_attachment_id)
    if (!id) return 'Attach the file first'
    const file = await get('SELECT id FROM sprint_attachments WHERE id = ? AND task_id = ?', id, taskId)
    if (!file) return 'That file is not on this task'
    return null
  }
  return 'Finishing a task needs a result: a link, a file, or a hundred words about what happened'
}

// 2. Blocked requires a reason, and one of the six — free text here would
//    become "blocked" and tell nobody anything.
const blockerProblem = (body) =>
  BLOCKER_REASONS.includes(String(body?.blocker_reason || ''))
    ? null
    : 'Blocked needs a reason — pick one of the six'

// 3. After the freeze the week is history for everybody but an owner.
async function frozenProblem(sprint, userId) {
  if (!isFrozen(sprint)) return null
  if (await isOwner(userId)) return null
  return sprint.status === 'closed'
    ? 'This sprint is closed'
    : 'This sprint froze at noon on Saturday — an owner can still change it'
}

// ---- reading the week --------------------------------------------------------
// One round trip builds the whole screen: four queries, assembled here, so
// opening the board is one request and not one per task.
async function readSprint(sprint, userId) {
  const rows = await all(`
    SELECT t.*, ts.outcome
    FROM sprint_task_sprints ts
    JOIN sprint_tasks t ON t.id = ts.task_id
    WHERE ts.sprint_id = ?
    ORDER BY t.created_at, t.id
  `, sprint.id)
  const ids = rows.map((r) => r.id)
  const inList = ids.length ? `(${ids.map(() => '?').join(',')})` : '(NULL)'

  const assignees = ids.length
    ? await all(`SELECT task_id, user_id FROM sprint_task_assignees WHERE task_id IN ${inList}`, ...ids) : []
  // Checklist counts for THIS week only — the whole point of the slice.
  const checks = ids.length
    ? await all(`SELECT task_id, done FROM sprint_checklist_items WHERE sprint_id = ? AND task_id IN ${inList}`,
      sprint.id, ...ids) : []
  // How many weeks each task has run, for the carried label.
  const weeks = ids.length
    ? await all(`SELECT task_id, COUNT(*) AS n FROM sprint_task_sprints WHERE task_id IN ${inList} GROUP BY task_id`,
      ...ids) : []
  const weekOfTask = Object.fromEntries(weeks.map((w) => [w.task_id, w.n]))

  const byTask = {}
  for (const a of assignees) (byTask[a.task_id] ||= []).push(a.user_id)
  const counts = {}
  for (const c of checks) {
    const e = (counts[c.task_id] ||= { done: 0, total: 0 })
    e.total += 1
    if (c.done) e.done += 1
  }

  const tasks = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    is_growth: !!r.is_growth,
    deadline: r.deadline,
    result_type: r.result_type,
    result_link: r.result_link,
    result_text: r.result_text,
    result_attachment_id: r.result_attachment_id,
    blocker_reason: r.blocker_reason,
    blocker_note: r.blocker_note,
    carried_count: r.carried_count,
    outcome: r.outcome,
    assignees: byTask[r.id] || [],
    checklist: counts[r.id] || { done: 0, total: 0 },
    sprints_run: weekOfTask[r.id] || 1,
    created_by: r.created_by,
  }))

  // The person strip is DERIVED: whoever holds a task this week is on it, and
  // nobody else. There is no membership list to fall out of step with the work.
  const people = {}
  for (const t of tasks) {
    for (const uid of t.assignees) {
      const p = (people[uid] ||= { user_id: uid, assigned: 0, done: 0, blocked: 0 })
      p.assigned += 1
      if (t.status === 'done') p.done += 1
      if (t.status === 'blocked') p.blocked += 1
    }
  }
  const ids2 = Object.keys(people).map(Number)
  const who = ids2.length
    ? await all(`SELECT id, name, avatar, color FROM users WHERE id IN (${ids2.map(() => '?').join(',')})`, ...ids2)
    : []
  const nameOf = Object.fromEntries(who.map((u) => [u.id, u]))
  const strip = ids2
    .map((id) => ({ ...people[id], ...(nameOf[id] || { name: 'Someone who left', avatar: null, color: null }) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))

  return {
    sprint: { ...sprint, label: weekLabel(sprint) },
    frozen: isFrozen(sprint),
    owner: await isOwner(userId),
    tasks,
    people: strip,
    blockerReasons: BLOCKER_REASONS,
  }
}

router.get('/current', wrap(async (req, res) => {
  const sprint = await currentSprint()
  res.json(await readSprint(sprint, req.user.id))
}))

// The assignee picker, straight off the platform users table. Read only, and
// the only place this module looks outside itself.
router.get('/people', wrap(async (_req, res) => {
  res.json(await all('SELECT id, name, avatar, color FROM users ORDER BY name'))
}))

// ---- writing -----------------------------------------------------------------

// Adding a task is one field: a title in the To Do column. Everything else is
// optional and can be filled in later, or never.
router.post('/tasks', wrap(async (req, res) => {
  const sprint = await currentSprint()
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  const title = String(req.body?.title || '').trim()
  if (!title) return res.status(400).json({ error: 'A task needs a title' })

  const stamp = now()
  const info = await run(
    `INSERT INTO sprint_tasks (title, description, status, is_growth, deadline, created_by, created_at, updated_at)
     VALUES (?, '', 'todo', 0, ?, ?, ?, ?)`,
    title, sprint.freeze_at.slice(0, 10), req.user.id, stamp, stamp)
  const id = info.lastInsertRowid
  await run('INSERT INTO sprint_task_sprints (task_id, sprint_id, outcome) VALUES (?, ?, NULL)', id, sprint.id)
  res.status(201).json(await readSprint(sprint, req.user.id))
}))

const FIELDS = ['title', 'description', 'is_growth', 'deadline']

router.patch('/tasks/:id', wrap(async (req, res) => {
  const sprint = await currentSprint()
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  const task = await get('SELECT * FROM sprint_tasks WHERE id = ?', req.params.id)
  if (!task) return res.status(404).json({ error: 'No such task' })

  const body = req.body || {}
  const set = {}
  if (body.title !== undefined) {
    const title = String(body.title).trim()
    if (!title) return res.status(400).json({ error: 'A task needs a title' })
    set.title = title
  }
  if (body.description !== undefined) set.description = String(body.description)
  if (body.is_growth !== undefined) set.is_growth = body.is_growth ? 1 : 0
  if (body.deadline !== undefined) set.deadline = body.deadline || null

  // The status moves, and the two that cost something ask for it first.
  if (body.status !== undefined) {
    const next = String(body.status)
    if (!STATUSES.includes(next)) return res.status(400).json({ error: 'Unknown status' })
    if (next === 'done' && task.status !== 'done') {
      const problem = await resultProblem(task.id, body)
      if (problem) return res.status(422).json({ error: problem, needs: 'result' })
      set.result_type = String(body.result_type)
      set.result_link = set.result_type === 'link' ? String(body.result_link).trim() : ''
      set.result_text = set.result_type === 'text' ? String(body.result_text).trim() : ''
      set.result_attachment_id = set.result_type === 'file' ? Number(body.result_attachment_id) : null
    }
    if (next === 'blocked' && task.status !== 'blocked') {
      const problem = blockerProblem(body)
      if (problem) return res.status(422).json({ error: problem, needs: 'blocker', reasons: BLOCKER_REASONS })
      set.blocker_reason = String(body.blocker_reason)
      set.blocker_note = String(body.blocker_note || '')
    }
    // Leaving blocked clears the reason: a card sitting in Done still wearing
    // "waiting on a teammate" is a lie the next reader has to unpick.
    if (next !== 'blocked' && task.status === 'blocked') { set.blocker_reason = ''; set.blocker_note = '' }
    set.status = next
  }

  const keys = Object.keys(set)
  if (keys.length) {
    set.updated_at = now()
    await run(`UPDATE sprint_tasks SET ${[...keys, 'updated_at'].map((k) => `${k}=?`).join(', ')} WHERE id = ?`,
      ...[...keys, 'updated_at'].map((k) => set[k]), task.id)
  }

  // Assignees arrive as the whole list, which is what a multi-picker knows.
  if (Array.isArray(body.assignees)) {
    const wanted = [...new Set(body.assignees.map(Number).filter(Boolean))]
    const real = wanted.length
      ? (await all(`SELECT id FROM users WHERE id IN (${wanted.map(() => '?').join(',')})`, ...wanted)).map((u) => u.id)
      : []
    await run('DELETE FROM sprint_task_assignees WHERE task_id = ?', task.id)
    if (real.length) {
      await batch(real.map((uid) => ['INSERT INTO sprint_task_assignees (task_id, user_id) VALUES (?, ?)', task.id, uid]))
    }
  }
  res.json(await readSprint(sprint, req.user.id))
}))

router.delete('/tasks/:id', wrap(async (req, res) => {
  const sprint = await currentSprint()
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  const task = await get('SELECT id FROM sprint_tasks WHERE id = ?', req.params.id)
  if (!task) return res.status(404).json({ error: 'No such task' })
  await batch([...sprintTaskChildDeletes(task.id), ['DELETE FROM sprint_tasks WHERE id = ?', task.id]])
  res.json(await readSprint(sprint, req.user.id))
}))

// ---- the backlog -------------------------------------------------------------
// An idea is a task with no week: status 'idea' and no row in
// sprint_task_sprints. That is the whole definition — there is no separate
// backlog table to drift out of step, and the moment an idea is promoted it
// stops matching this query without anything having to be deleted.
async function readBacklog(userId) {
  const items = await all(`
    SELECT t.id, t.title, t.created_at, t.created_by,
           u.name AS added_by, u.avatar AS added_avatar, u.color AS added_color
    FROM sprint_tasks t
    LEFT JOIN users u ON u.id = t.created_by
    WHERE t.status = 'idea'
      AND NOT EXISTS (SELECT 1 FROM sprint_task_sprints ts WHERE ts.task_id = t.id)
    ORDER BY t.created_at DESC, t.id DESC
  `)
  return { items, owner: await isOwner(userId) }
}

router.get('/backlog', wrap(async (req, res) => {
  res.json(await readBacklog(req.user.id))
}))

// Anybody can put an idea down, and the freeze does not apply here: an idea
// belongs to no week, so there is no week of it to be frozen.
router.post('/backlog', wrap(async (req, res) => {
  const title = String(req.body?.title || '').trim()
  if (!title) return res.status(400).json({ error: 'An idea needs a title' })
  const stamp = now()
  await run(
    `INSERT INTO sprint_tasks (title, description, status, is_growth, deadline, created_by, created_at, updated_at)
     VALUES (?, '', 'idea', 0, NULL, ?, ?, ?)`,
    title, req.user.id, stamp, stamp)
  res.status(201).json(await readBacklog(req.user.id))
}))

// Promotion is one of the three owner-only actions. It gives the idea a week
// and a status; the owner sets the assignee and the checklist in the modal
// that opens straight afterwards.
router.post('/backlog/:id/promote', wrap(async (req, res) => {
  if (!(await isOwner(req.user.id))) {
    return res.status(403).json({ error: 'Only a sprint owner can promote an idea' })
  }
  const task = await get('SELECT * FROM sprint_tasks WHERE id = ?', req.params.id)
  if (!task) return res.status(404).json({ error: 'No such idea' })
  const already = await get('SELECT 1 AS x FROM sprint_task_sprints WHERE task_id = ?', task.id)
  if (task.status !== 'idea' || already) {
    return res.status(409).json({ error: 'That one is already in a sprint' })
  }

  const sprint = await currentSprint()
  await run('UPDATE sprint_tasks SET status = ?, deadline = ?, updated_at = ? WHERE id = ?',
    'todo', sprint.freeze_at.slice(0, 10), now(), task.id)
  await run('INSERT INTO sprint_task_sprints (task_id, sprint_id, outcome) VALUES (?, ?, NULL)', task.id, sprint.id)

  // The promoted task comes back in the board's own shape rather than a second
  // one assembled here, so the modal that opens is reading the same task the
  // board would hand it.
  const board = await readSprint(sprint, req.user.id)
  res.json({ ...(await readBacklog(req.user.id)), task: board.tasks.find((t) => t.id === task.id) || null })
}))

// ---- the weekly checklist ----------------------------------------------------
// Items belong to a task AND a week. A task in its third sprint shows the
// three things committed for THIS week, not the eleven it has ever had.
router.get('/tasks/:id/checklist', wrap(async (req, res) => {
  const sprint = await currentSprint()
  res.json(await all(
    'SELECT * FROM sprint_checklist_items WHERE task_id = ? AND sprint_id = ? ORDER BY position, id',
    req.params.id, sprint.id))
}))

router.post('/tasks/:id/checklist', wrap(async (req, res) => {
  const sprint = await currentSprint()
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  const text = String(req.body?.text || '').trim()
  if (!text) return res.status(400).json({ error: 'An item needs words' })
  const last = await get(
    'SELECT COALESCE(MAX(position), -1) AS p FROM sprint_checklist_items WHERE task_id = ? AND sprint_id = ?',
    req.params.id, sprint.id)
  const info = await run(
    'INSERT INTO sprint_checklist_items (task_id, sprint_id, text, done, position) VALUES (?, ?, ?, 0, ?)',
    req.params.id, sprint.id, text, (last?.p ?? -1) + 1)
  res.status(201).json(await get('SELECT * FROM sprint_checklist_items WHERE id = ?', info.lastInsertRowid))
}))

router.patch('/checklist/:itemId', wrap(async (req, res) => {
  const sprint = await currentSprint()
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  const item = await get('SELECT * FROM sprint_checklist_items WHERE id = ?', req.params.itemId)
  if (!item) return res.status(404).json({ error: 'No such item' })
  const set = {}
  if (req.body?.text !== undefined) {
    const text = String(req.body.text).trim()
    if (!text) return res.status(400).json({ error: 'An item needs words' })
    set.text = text
  }
  if (req.body?.done !== undefined) {
    set.done = req.body.done ? 1 : 0
    set.done_at = req.body.done ? now() : null
  }
  if (req.body?.position !== undefined) set.position = Number(req.body.position) || 0
  const keys = Object.keys(set)
  if (keys.length) {
    await run(`UPDATE sprint_checklist_items SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id = ?`,
      ...keys.map((k) => set[k]), item.id)
  }
  res.json(await get('SELECT * FROM sprint_checklist_items WHERE id = ?', item.id))
}))

// Reorder arrives as the whole list of ids, in the order they now sit.
router.put('/tasks/:id/checklist/order', wrap(async (req, res) => {
  const sprint = await currentSprint()
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  const ids = (req.body?.ids || []).map(Number).filter(Boolean)
  if (ids.length) {
    await batch(ids.map((id, i) => [
      'UPDATE sprint_checklist_items SET position = ? WHERE id = ? AND task_id = ? AND sprint_id = ?',
      i, id, req.params.id, sprint.id,
    ]))
  }
  res.json(await all(
    'SELECT * FROM sprint_checklist_items WHERE task_id = ? AND sprint_id = ? ORDER BY position, id',
    req.params.id, sprint.id))
}))

router.delete('/checklist/:itemId', wrap(async (req, res) => {
  const sprint = await currentSprint()
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  await run('DELETE FROM sprint_checklist_items WHERE id = ?', req.params.itemId)
  res.json({ ok: true })
}))

// ---- files -------------------------------------------------------------------
// The bytes live in the row, the same way the platform's own attachments do:
// this deployment has no file storage and no CDN. Five megabytes of real file,
// measured before encoding — base64 is a third bigger and the limit is about
// the file somebody chose, not about the arithmetic.
const MAX_FILE = 5 * 1024 * 1024
router.post('/tasks/:id/files', wrap(async (req, res) => {
  const sprint = await currentSprint()
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  const task = await get('SELECT id FROM sprint_tasks WHERE id = ?', req.params.id)
  if (!task) return res.status(404).json({ error: 'No such task' })

  const data = String(req.body?.data || '')
  const name = String(req.body?.name || 'file').slice(0, 200)
  if (!/^data:[^;]*;base64,/.test(data)) return res.status(400).json({ error: 'Send the file as a data URI' })
  const b64 = data.slice(data.indexOf(',') + 1)
  const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)
  if (bytes > MAX_FILE) {
    return res.status(413).json({ error: `That file is ${(bytes / 1048576).toFixed(1)} MB — the limit is 5 MB` })
  }
  const mime = data.slice(5, data.indexOf(';'))
  const info = await run(
    'INSERT INTO sprint_attachments (task_id, name, mime, size, data, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    task.id, name, mime, bytes, data, req.user.id, now())
  res.status(201).json(await get('SELECT id, task_id, name, mime, size, uploaded_by, created_at FROM sprint_attachments WHERE id = ?', info.lastInsertRowid))
}))

router.get('/tasks/:id/files', wrap(async (req, res) => {
  res.json(await all(
    'SELECT id, task_id, name, mime, size, uploaded_by, created_at FROM sprint_attachments WHERE task_id = ? ORDER BY id',
    req.params.id))
}))

// The bytes themselves, asked for only when somebody opens one.
router.get('/files/:fileId', wrap(async (req, res) => {
  const f = await get('SELECT * FROM sprint_attachments WHERE id = ?', req.params.fileId)
  if (!f) return res.status(404).json({ error: 'No such file' })
  res.json(f)
}))

router.delete('/files/:fileId', wrap(async (req, res) => {
  const sprint = await currentSprint()
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  const f = await get('SELECT * FROM sprint_attachments WHERE id = ?', req.params.fileId)
  if (!f) return res.status(404).json({ error: 'No such file' })
  // A file that a task points at as its result cannot quietly vanish from
  // under it — that would leave a task marked done with nothing behind it.
  const usedBy = await get('SELECT id FROM sprint_tasks WHERE result_attachment_id = ?', f.id)
  if (usedBy) return res.status(409).json({ error: 'That file is the result of a finished task' })
  await run('DELETE FROM sprint_attachments WHERE id = ?', f.id)
  res.json({ ok: true })
}))

export default router
