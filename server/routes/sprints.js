import { Router } from 'express'
import { all, get, run, batch, ensureCurrentSprint } from '../db.js'
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
// exactly five things: closing a sprint, editing after the freeze, promoting
// from the backlog, moving a day somebody already promised, and putting a
// dropped task back. Everything else is open to any signed-in user.
const router = Router()
router.use(authRequired)

const now = () => new Date().toISOString()
const isOwner = async (userId) => !!(await get('SELECT 1 AS x FROM sprint_owners WHERE user_id = ?', userId))

// The week on screen is decided by the calendar, not by whether anybody
// pressed a button. This used to read "the newest active sprint", which meant
// that on Monday morning — after a Saturday nobody closed — the board still
// showed last week. Last week is past its freeze, so the whole team was
// locked out of a read-only board until somebody restarted the server. The
// week is a fact about the date; it is looked up as one.
async function currentSprint() {
  const week = weekOf()
  const row = await get('SELECT * FROM sprints WHERE start_at = ?', week.start_at)
  if (row) return row
  await ensureCurrentSprint()
  return get('SELECT * FROM sprints WHERE start_at = ?', week.start_at)
}

const BLOCKER_REASONS = [
  'Waiting on teammate', 'Waiting on external party', 'Budget or approval',
  'Scope was too big', 'Priority changed', 'Did not start',
]
const BOARD = ['todo', 'in_progress', 'blocked', 'done']
// A title is a line on a card. Five thousand characters of one is not a title,
// it is a denial of service against the person trying to read the board.
const MAX_TITLE = 200
const cleanTitle = (v) => String(v ?? '').trim().slice(0, MAX_TITLE)
// A deadline is a Tashkent day. "next tuesday-ish" was being stored and then
// rendered on the card as "t tuesday-ish", because the card shows a slice.
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))
// The day a week ends on — the deadline every new task starts with.
const weekEnd = (sprint) => String(sprint?.freeze_at || '').slice(0, 10)

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

// The week a task actually belongs to. The freeze was being checked against
// the CURRENT sprint for every write, whoever the task belonged to — so while
// this week was open, every finished week was open with it: a task from a
// closed sprint could be un-ticked, re-dated or deleted by anybody. A task
// answers to its own week.
async function sprintOfTask(taskId) {
  return get(`
    SELECT s.* FROM sprint_task_sprints ts
    JOIN sprints s ON s.id = ts.sprint_id
    WHERE ts.task_id = ?
    ORDER BY s.start_at DESC LIMIT 1
  `, taskId)
}

// 3. After the freeze the week is history for everybody but an owner.
async function frozenProblem(sprint, userId) {
  if (!isFrozen(sprint)) return null
  if (await isOwner(userId)) return null
  return sprint.status === 'closed'
    ? 'This sprint is closed'
    : 'This sprint froze at noon on Saturday — an owner can still change it'
}

// Every change worth arguing about later, written down: a deadline moved, a
// result un-ticked, a task dropped. The sprint board had no paper trail at
// all, so none of it could be read back at the Saturday meeting.
async function logSprint(user, task, sprintId, kind, oldV, newV, note = '') {
  await run(`
    INSERT INTO sprint_activity (task_id, task_title, sprint_id, user_id, user_name, kind, old_value, new_value, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, task.id, task.title || '', sprintId ?? null, user.id, user.name || '', kind,
  oldV == null ? null : String(oldV), newV == null ? null : String(newV), note, now())
}

// ---- reading the week --------------------------------------------------------
// One round trip builds the whole screen: four queries, assembled here, so
// opening the board is one request and not one per task.
async function readSprint(sprint, userId) {
  const everything = await all(`
    SELECT t.*, ts.outcome
    FROM sprint_task_sprints ts
    JOIN sprint_tasks t ON t.id = ts.task_id
    WHERE ts.sprint_id = ?
    ORDER BY t.created_at, t.id
  `, sprint.id)
  // Dropped work leaves the columns and stays on the week. The board is for
  // what is being done; the record is for what was promised.
  //
  // Dropped ON THIS WEEK, though. A task can run for three weeks before
  // somebody gives up on it, and the two weeks that carried it did not drop
  // it: they promised it and worked on it, and their boards should still read
  // that way. (A row with no week on its drop predates the column and is
  // treated as dropped everywhere — never the other way round, so a dropped
  // task cannot reappear in a column.)
  const droppedHere = (r) => !!r.dropped_at && (r.dropped_sprint_id == null || r.dropped_sprint_id === sprint.id)
  const rows = everything.filter((r) => !droppedHere(r))
  const dropped = everything.filter(droppedHere)
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
    dropped: dropped.map((r) => ({
      id: r.id, title: r.title, status: r.status, deadline: r.deadline,
      dropped_at: r.dropped_at, dropped_by: r.dropped_by, dropped_reason: r.dropped_reason,
      dropped_sprint_id: r.dropped_sprint_id,
    })),
    people: strip,
    blockerReasons: BLOCKER_REASONS,
  }
}

router.get('/current', wrap(async (req, res) => {
  const sprint = await currentSprint()
  res.json(await readSprint(sprint, req.user.id))
}))

// Every week there has been, newest first, for the picker in the header.
// Cheap enough to send whole: this is one row per week, so a board three years
// old is a hundred and fifty rows.
router.get('/history', wrap(async (req, res) => {
  const rows = await all(`
    SELECT s.id, s.code, s.start_at, s.freeze_at, s.meeting_at, s.status,
           (SELECT COUNT(*) FROM sprint_task_sprints ts WHERE ts.sprint_id = s.id) AS tasks,
           (SELECT COUNT(*) FROM sprint_task_sprints ts
              JOIN sprint_tasks t ON t.id = ts.task_id
             WHERE ts.sprint_id = s.id AND t.status = 'done'
               AND NOT (t.dropped_at IS NOT NULL
                        AND (t.dropped_sprint_id IS NULL OR t.dropped_sprint_id = s.id))) AS done,
           -- Counted, not hidden: a week that promised twelve and dropped two
           -- reads as twelve promised and two dropped, for ever. Against the
           -- week that DROPPED it, not against every week that carried it.
           (SELECT COUNT(*) FROM sprint_task_sprints ts
              JOIN sprint_tasks t ON t.id = ts.task_id
             WHERE ts.sprint_id = s.id AND t.dropped_at IS NOT NULL
               AND (t.dropped_sprint_id IS NULL OR t.dropped_sprint_id = s.id)) AS dropped
    FROM sprints s ORDER BY s.start_at DESC
  `)
  const now = Date.now()
  res.json(rows.map((r) => ({
    ...r,
    label: weekLabel(r),
    current: Date.parse(r.start_at) <= now && now < Date.parse(r.start_at) + 7 * 86400e3,
  })))
}))

// One week by its id, in exactly the shape the board reads. A past week comes
// back frozen, because its freeze is in the past, which is what makes it
// read only without a second rule saying so.
//
// Registered after the named routes above and guarded to digits, so /current,
// /people, /backlog and /history are never mistaken for a sprint id.
router.get('/:id(\\d+)', wrap(async (req, res) => {
  const sprint = await get('SELECT * FROM sprints WHERE id = ?', req.params.id)
  if (!sprint) return res.status(404).json({ error: 'No such sprint' })
  res.json(await readSprint(sprint, req.user.id))
}))

// ---- who owns sprints ----------------------------------------------------
// The one place the platform Admin flag means anything in this module, and it
// means administering the module rather than being an owner of it. An admin
// can say who the owners are; that does not make the admin one. It was always
// meant to be set by hand in the database, which is fine for the first row and
// no way to run a team.
router.get('/owners', wrap(async (_req, res) => {
  res.json((await all('SELECT user_id FROM sprint_owners')).map((r) => r.user_id))
}))

router.put('/owners/:userId', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const id = Number(req.params.userId)
  if (!(await get('SELECT id FROM users WHERE id = ?', id))) {
    return res.status(404).json({ error: 'No such person' })
  }
  if (req.body?.owner) {
    // The unique index makes a second insert a no-op rather than a duplicate.
    try { await run('INSERT INTO sprint_owners (user_id) VALUES (?)', id) } catch { /* already one */ }
  } else {
    await run('DELETE FROM sprint_owners WHERE user_id = ?', id)
  }
  res.json((await all('SELECT user_id FROM sprint_owners')).map((r) => r.user_id))
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
  const title = cleanTitle(req.body?.title)
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
  const task = await get('SELECT * FROM sprint_tasks WHERE id = ?', req.params.id)
  if (!task) return res.status(404).json({ error: 'No such task' })
  // The task's own week decides whether it is still open, not whichever week
  // happens to be current.
  const sprint = (await sprintOfTask(task.id)) || (await currentSprint())
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  const owner = await isOwner(req.user.id)
  if (task.dropped_at && !owner)
    return res.status(423).json({ error: 'This task was dropped from the week — an owner can put it back' })

  const body = req.body || {}
  const set = {}
  const logs = []
  if (body.title !== undefined) {
    const title = cleanTitle(body.title)
    if (!title) return res.status(400).json({ error: 'A task needs a title' })
    // Renaming is the other quiet way to change what a week promised: "Ship
    // the campaign" becomes "Draft an idea" and the record reads as though
    // that is what was ever asked for. Anybody may still do it — this is a
    // board, not a contract — but it is written down.
    if (title !== task.title) logs.push(['title', task.title, title])
    set.title = title
  }
  if (body.description !== undefined) set.description = String(body.description)
  if (body.is_growth !== undefined) set.is_growth = body.is_growth ? 1 : 0
  if (body.deadline !== undefined) {
    if (body.deadline && !isDay(String(body.deadline))) {
      return res.status(400).json({ error: 'A deadline is a date — YYYY-MM-DD' })
    }
    const next = body.deadline || null
    // A day that somebody CHOSE is a promise, and a promise the person who
    // made it can quietly move is not one — the same rule the content side has
    // had since round 67. Setting a first real day stays open to everybody, so
    // work can still be scheduled; clearing one counts as moving it.
    //
    // The week's own end does not count as chosen. Every task is born with the
    // freeze day on it, so treating that as a promise would mean nobody but an
    // owner could ever put a day on a task at all — and the board has always
    // read it the same way: a card only shows a deadline when it differs from
    // the week end.
    const promised = !!task.deadline && task.deadline !== weekEnd(sprint)
    const moving = promised && String(next ?? '') !== String(task.deadline)
    if (moving && !owner) {
      return res.status(403).json({
        error: 'That day is already promised — ask a sprint owner to move it, and say what happened.',
        ask_to_move: { field: 'deadline', from: task.deadline, to: next },
      })
    }
    if (moving) logs.push(['deadline', task.deadline, next])
    set.deadline = next
  }

  // The status moves, and the two that cost something ask for it first.
  if (body.status !== undefined) {
    const next = String(body.status)
    // Only the four columns. 'idea' used to be accepted here, which moved the
    // task off the board while leaving its week row in place — so it showed
    // in no column, in no backlog, and nowhere at all. An idea is a task that
    // has never been promoted, not a place a promoted one can go back to.
    if (!BOARD.includes(next)) return res.status(400).json({ error: 'Unknown status' })
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
    // And the same going the other way. A task pulled back out of Done kept
    // the link it was finished with, so it sat in In Progress still carrying
    // proof of a result it no longer has — and would be asked for a new one
    // anyway the moment it went back.
    if (next !== 'done' && task.status === 'done') {
      set.result_type = null; set.result_link = ''; set.result_text = ''; set.result_attachment_id = null
    }
    // Only the move that UNDOES something. A card going To Do → In Progress →
    // Done is the week working, and writing all of it down would bury the two
    // lines that matter under thirty that do not. A task coming back OUT of
    // Done is a result un-ticked, which is the thing somebody may want to ask
    // about on Saturday.
    if (task.status === 'done' && next !== 'done') logs.push(['status', task.status, next])
    set.status = next
  }

  const keys = Object.keys(set)
  if (keys.length) {
    set.updated_at = now()
    await run(`UPDATE sprint_tasks SET ${[...keys, 'updated_at'].map((k) => `${k}=?`).join(', ')} WHERE id = ?`,
      ...[...keys, 'updated_at'].map((k) => set[k]), task.id)
  }
  for (const [kind, oldV, newV] of logs) await logSprint(req.user, task, sprint.id, kind, oldV, newV)

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

// DROPPED, not deleted.
//
// This used to remove the row outright — and /history counts tasks live off
// sprint_task_sprints, so a closed week went from twelve tasks to eleven the
// moment somebody tidied one away, with nothing to say it had happened. A
// week's record that changes after the week is over is not a record.
//
// So the task leaves the BOARD and stays in the COUNT: off the columns, out of
// everybody's way, still on its week, with who dropped it and when written
// down. An owner can put it back.
router.delete('/tasks/:id', wrap(async (req, res) => {
  const task = await get('SELECT * FROM sprint_tasks WHERE id = ?', req.params.id)
  if (!task) return res.status(404).json({ error: 'No such task' })
  const sprint = (await sprintOfTask(task.id)) || (await currentSprint())
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  if (task.dropped_at) return res.status(409).json({ error: 'That task is already dropped' })

  const reason = String(req.body?.reason ?? '').trim().slice(0, 600)
  await run(`UPDATE sprint_tasks
                SET dropped_at = ?, dropped_by = ?, dropped_reason = ?, dropped_sprint_id = ?, updated_at = ?
              WHERE id = ?`,
  now(), req.user.id, reason, sprint.id, now(), task.id)
  await logSprint(req.user, task, sprint.id, 'dropped', task.status, null, reason)
  // The task's OWN week comes back, not whichever is current — an owner
  // tidying a closed sprint was being handed this week's board in reply, so
  // the screen silently jumped forward while the header still said the week
  // they were reading. Every other write on this router answers with the week
  // it wrote to; these two now do the same.
  res.json(await readSprint(sprint, req.user.id))
}))

// Putting one back. An owner's call, because dropping is the team's and
// undoing somebody else's tidy-up is not.
router.post('/tasks/:id/restore', wrap(async (req, res) => {
  const task = await get('SELECT * FROM sprint_tasks WHERE id = ?', req.params.id)
  if (!task) return res.status(404).json({ error: 'No such task' })
  if (!(await isOwner(req.user.id)))
    return res.status(403).json({ error: 'Only a sprint owner can put a dropped task back' })
  if (!task.dropped_at) return res.status(409).json({ error: 'That task is not dropped' })
  await run(`UPDATE sprint_tasks
                SET dropped_at = NULL, dropped_by = NULL, dropped_reason = '', dropped_sprint_id = NULL, updated_at = ?
              WHERE id = ?`, now(), task.id)
  const sprint = (await sprintOfTask(task.id)) || (await currentSprint())
  await logSprint(req.user, task, sprint.id, 'restored', null, task.status)
  res.json(await readSprint(sprint, req.user.id))
}))

// What was changed after the fact on this week, newest first — the thing to
// read out on Saturday when a number does not look like it did.
router.get('/activity', wrap(async (req, res) => {
  const sprint = req.query.sprint ? await get('SELECT * FROM sprints WHERE id = ?', req.query.sprint) : await currentSprint()
  if (!sprint) return res.json([])
  res.json(await all(`
    SELECT id, task_id, task_title, user_id, user_name, kind, old_value, new_value, note, created_at
    FROM sprint_activity WHERE sprint_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 200
  `, sprint.id))
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

// Promotion is one of the five owner-only actions. It gives the idea a week
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
// The week being READ, which is not always the current one: opening a task
// from a sprint three weeks ago has to show that week's items, not this
// week's. Everything that WRITES still works on the current week only.
async function viewedSprint(req) {
  const asked = Number(req.query?.sprint)
  if (asked) {
    const row = await get('SELECT * FROM sprints WHERE id = ?', asked)
    if (row) return row
  }
  return currentSprint()
}

router.get('/tasks/:id/checklist', wrap(async (req, res) => {
  const sprint = await viewedSprint(req)
  res.json(await all(
    'SELECT * FROM sprint_checklist_items WHERE task_id = ? AND sprint_id = ? ORDER BY position, id',
    req.params.id, sprint.id))
}))

router.post('/tasks/:id/checklist', wrap(async (req, res) => {
  // The task's own week, not whichever is current — see sprintOfTask.
  const sprint = (await sprintOfTask(req.params.id)) || (await currentSprint())
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  // Without this, POST to /tasks/999999/checklist returned 201 and left a row
  // hanging off a task that has never existed.
  if (!(await get('SELECT id FROM sprint_tasks WHERE id = ?', req.params.id))) {
    return res.status(404).json({ error: 'No such task' })
  }
  const text = String(req.body?.text || '').trim().slice(0, 500)
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
  const item = await get('SELECT * FROM sprint_checklist_items WHERE id = ?', req.params.itemId)
  if (!item) return res.status(404).json({ error: 'No such item' })
  // The item knows which week it belongs to; that is the week that decides.
  const sprint = (await get('SELECT * FROM sprints WHERE id = ?', item.sprint_id)) || (await currentSprint())
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
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
  const sprint = (await sprintOfTask(req.params.id)) || (await currentSprint())
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
  const item = await get('SELECT * FROM sprint_checklist_items WHERE id = ?', req.params.itemId)
  if (!item) return res.json({ ok: true })
  const sprint = (await get('SELECT * FROM sprints WHERE id = ?', item.sprint_id)) || (await currentSprint())
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
  // The task's own week, not whichever is current — see sprintOfTask.
  const sprint = (await sprintOfTask(req.params.id)) || (await currentSprint())
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
  const f = await get('SELECT * FROM sprint_attachments WHERE id = ?', req.params.fileId)
  if (!f) return res.status(404).json({ error: 'No such file' })
  const sprint = (await sprintOfTask(f.task_id)) || (await currentSprint())
  const stop = await frozenProblem(sprint, req.user.id)
  if (stop) return res.status(423).json({ error: stop })
  // A file that a task points at as its result cannot quietly vanish from
  // under it — that would leave a task marked done with nothing behind it.
  const usedBy = await get('SELECT id FROM sprint_tasks WHERE result_attachment_id = ?', f.id)
  if (usedBy) return res.status(409).json({ error: 'That file is the result of a finished task' })
  await run('DELETE FROM sprint_attachments WHERE id = ?', f.id)
  res.json({ ok: true })
}))

export default router
