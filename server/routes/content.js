import { Router } from 'express'
import { all, get, run, batch, bumpPlan, CONTENT_TYPES } from '../db.js'
import { authRequired, canAccessDept, can, wrap } from '../auth.js'

const router = Router()
router.use(authRequired)

const parse = (row) => row && {
  ...row,
  channels: JSON.parse(row.channels || '[]'),
  checklist: JSON.parse(row.checklist || '[]'),
}
const finalStatus = () => get('SELECT * FROM statuses WHERE is_final = 1 ORDER BY sort')
const isFinal = async (statusId) => !!(await get('SELECT 1 AS x FROM statuses WHERE id = ? AND is_final = 1', statusId))

// A member touches a task when it sits on one of their channels (or is theirs).
const canTouch = (user, row) =>
  user.role === 'admin' ||
  row.assignee_id === user.id ||
  JSON.parse(row.channels || '[]').some((ch) => (user.departments || []).includes(ch))

const cleanChannels = async (v) => {
  const arr = [...new Set((Array.isArray(v) ? v : []).map(String))]
  if (arr.length === 0) return []
  const existing = new Set((await all(
    `SELECT key FROM channels WHERE key IN (${arr.map(() => '?').join(',')})`, ...arr)).map((r) => r.key))
  return arr.filter((ch) => existing.has(ch))
}

router.get('/', wrap(async (req, res) => {
  const { department, mine } = req.query
  let rows = (await all('SELECT * FROM content ORDER BY todo_sort, created_at DESC')).map(parse)
  if (req.user.role !== 'admin') {
    const set = new Set(req.user.departments)
    rows = rows.filter((c) => c.channels.some((ch) => set.has(ch)) || c.assignee_id === req.user.id)
  }
  if (department) rows = rows.filter((c) => c.channels.includes(department))
  if (mine === 'true') rows = rows.filter((c) => c.assignee_id === req.user.id)
  res.json(rows)
}))

router.post('/', wrap(async (req, res) => {
  const {
    title, type = 'post', status_id = null,
    recording_date = null, recording_time = null, release_date = null, release_time = null,
    description = '', photo = null, checklist = [],
  } = req.body || {}
  const channels = await cleanChannels(req.body?.channels ?? (req.body?.channel ? [req.body.channel] : []))
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Give the task a title' })
  if (channels.length === 0) return res.status(400).json({ error: 'Pick at least one platform' })
  if (!channels.every((ch) => canAccessDept(req.user, ch))) return res.status(403).json({ error: 'Not your channel' })
  if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to add tasks' })
  const safeType = CONTENT_TYPES.includes(type) ? type : 'post'

  const status = status_id || (await get('SELECT id FROM statuses ORDER BY sort, id'))?.id || null
  const maxSort = (await get('SELECT COALESCE(MAX(todo_sort), -1) AS m FROM content')).m
  const info = await run(`
    INSERT INTO content (title, channels, type, assignee_id, created_by, status_id,
      recording_date, recording_time, release_date, release_time, description, photo, checklist, todo_sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    String(title).trim(), JSON.stringify(channels), safeType, req.user.id, req.user.id, status,
    recording_date || null, recording_time || null, release_date || null, release_time || null,
    description, photo || null, JSON.stringify(Array.isArray(checklist) ? checklist : []),
    maxSort + 1, new Date().toISOString(),
  )
  // A new task raises each channel's plan: 15/16 → 15/17.
  for (const ch of channels) await bumpPlan(ch, safeType, { target: +1 }, true)
  res.status(201).json(parse(await get('SELECT * FROM content WHERE id = ?', info.lastInsertRowid)))
}))

// Reorder the to-do list (drag): ids in display order.
router.post('/todo-reorder', wrap(async (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' })
  const rows = await all(`SELECT * FROM content WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ordered = ids.map((id) => byId.get(Number(id))).filter((r) => r && canTouch(req.user, r))
  await batch(ordered.map((r, i) => ['UPDATE content SET todo_sort = ? WHERE id = ?', i, r.id]))
  res.json({ ok: true })
}))

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })

  const body = req.body || {}
  const isAssignee = row.assignee_id === req.user.id
  const oldChannels = JSON.parse(row.channels || '[]')
  const patch = {}

  // Moving between stages / days needs the move_tasks right.
  if (body.status_id !== undefined && body.status_id !== row.status_id) {
    if (!can(req.user, 'move_tasks')) return res.status(403).json({ error: 'You can see the board but can’t move tasks — ask an admin' })
    patch.status_id = body.status_id
  }

  // Editing details needs manage_content.
  const detailFields = ['title', 'type', 'recording_time', 'release_time', 'description', 'photo']
  const wantsDetails = detailFields.some((f) => body[f] !== undefined) || body.channels !== undefined
  if (wantsDetails && !can(req.user, 'manage_content'))
    return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
  for (const f of detailFields) if (body[f] !== undefined) patch[f] = body[f]
  if (patch.type !== undefined && !CONTENT_TYPES.includes(patch.type)) patch.type = 'post'

  if (body.channels !== undefined) {
    const next = await cleanChannels(body.channels)
    if (next.length === 0) return res.status(400).json({ error: 'Pick at least one platform' })
    if (!next.every((ch) => canAccessDept(req.user, ch))) return res.status(403).json({ error: 'Not your channel' })
    patch.channels = JSON.stringify(next)
  }

  // Calendar drags send only a date → allowed with move_tasks too.
  for (const f of ['recording_date', 'release_date']) {
    if (body[f] !== undefined) {
      if (!can(req.user, 'manage_content') && !can(req.user, 'move_tasks'))
        return res.status(403).json({ error: 'You don’t have permission to move dates' })
      patch[f] = body[f] || null
    }
  }

  // Assignees may always tick their own checklist.
  if (body.checklist !== undefined) {
    if (!can(req.user, 'manage_content') && !isAssignee)
      return res.status(403).json({ error: 'Only the assignee can edit this checklist' })
    patch.checklist = JSON.stringify(Array.isArray(body.checklist) ? body.checklist : [])
  }

  // done: true/false — the to-do checkbox. Same as dragging to the final stage.
  if (body.done !== undefined) {
    if (!isAssignee && !can(req.user, 'move_tasks'))
      return res.status(403).json({ error: 'You don’t have permission to complete this' })
    const fin = await finalStatus()
    if (body.done) {
      if (fin) patch.status_id = fin.id
      patch.done_at = row.done_at || new Date().toISOString()
    } else {
      patch.done_at = null
      if (fin && (patch.status_id ?? row.status_id) === fin.id) {
        const lastNonFinal = await get('SELECT id FROM statuses WHERE is_final = 0 ORDER BY sort DESC, id DESC')
        if (lastNonFinal) patch.status_id = lastNonFinal.id
      }
    }
  }

  if (Object.keys(patch).length === 0) return res.json(parse(row))

  // Derive done_at from status moves into/out of the final stage.
  const nextStatus = patch.status_id ?? row.status_id
  if (patch.done_at === undefined) {
    if ((await isFinal(nextStatus)) && !row.done_at) patch.done_at = new Date().toISOString()
    if (!(await isFinal(nextStatus)) && row.done_at) patch.done_at = null
  }

  const keys = Object.keys(patch)
  await run(`UPDATE content SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`, ...keys.map((k) => patch[k]), row.id)

  // ---- keep the channel plans in sync ----
  const wasDone = !!row.done_at
  const nowDone = patch.done_at !== undefined ? !!patch.done_at : wasDone
  const newChannels = patch.channels !== undefined ? JSON.parse(patch.channels) : oldChannels
  const newType = patch.type !== undefined ? patch.type : row.type

  if (patch.channels !== undefined || patch.type !== undefined) {
    // Moved to other platforms / another type: walk the old plans back, then
    // count toward the new ones (carrying the completion along if done).
    for (const ch of oldChannels) await bumpPlan(ch, row.type, { target: -1, current: wasDone ? -1 : 0 })
    for (const ch of newChannels) await bumpPlan(ch, newType, { target: +1, current: nowDone ? +1 : 0 }, true)
  } else if (!wasDone && nowDone) {
    for (const ch of newChannels) await bumpPlan(ch, newType, { current: +1 }, true) // 15/16 → 16/16
  } else if (wasDone && !nowDone) {
    for (const ch of newChannels) await bumpPlan(ch, newType, { current: -1 })
  }

  res.json(parse(await get('SELECT * FROM content WHERE id = ?', row.id)))
}))

router.delete('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const allowed = req.user.role === 'admin' || (can(req.user, 'manage_content') && canTouch(req.user, row))
  if (!allowed) return res.status(403).json({ error: 'You don’t have permission to delete this' })
  // Removing a task lowers each channel's plan again (and its count if done).
  for (const ch of JSON.parse(row.channels || '[]'))
    await bumpPlan(ch, row.type, { target: -1, current: row.done_at ? -1 : 0 })
  await run('DELETE FROM content WHERE id = ?', row.id)
  res.json({ ok: true })
}))

export default router
