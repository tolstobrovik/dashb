import { Router } from 'express'
import { db, bumpPlan, CONTENT_TYPES } from '../db.js'
import { authRequired, canAccessDept, can } from '../auth.js'

const router = Router()
router.use(authRequired)

const parse = (row) => row && {
  ...row,
  channels: JSON.parse(row.channels || '[]'),
  checklist: JSON.parse(row.checklist || '[]'),
}
const channelExists = (key) => !!db.prepare('SELECT 1 FROM channels WHERE key = ?').get(key)
const finalStatus = () => db.prepare('SELECT * FROM statuses WHERE is_final = 1 ORDER BY sort').get()
const isFinal = (statusId) => !!db.prepare('SELECT 1 FROM statuses WHERE id = ? AND is_final = 1').get(statusId)

// A member touches a task when it sits on one of their channels (or is theirs).
const canTouch = (user, row) =>
  user.role === 'admin' ||
  row.assignee_id === user.id ||
  JSON.parse(row.channels || '[]').some((ch) => (user.departments || []).includes(ch))

const cleanChannels = (v) => {
  const arr = [...new Set((Array.isArray(v) ? v : []).map(String))]
  return arr.filter(channelExists)
}

router.get('/', (req, res) => {
  const { department, mine } = req.query
  let rows = db.prepare('SELECT * FROM content ORDER BY todo_sort, created_at DESC').all().map(parse)
  if (req.user.role !== 'admin') {
    const set = new Set(req.user.departments)
    rows = rows.filter((c) => c.channels.some((ch) => set.has(ch)) || c.assignee_id === req.user.id)
  }
  if (department) rows = rows.filter((c) => c.channels.includes(department))
  if (mine === 'true') rows = rows.filter((c) => c.assignee_id === req.user.id)
  res.json(rows)
})

router.post('/', (req, res) => {
  const {
    title, type = 'post', status_id = null,
    recording_date = null, recording_time = null, release_date = null, release_time = null,
    description = '', photo = null, checklist = [],
  } = req.body || {}
  const channels = cleanChannels(req.body?.channels ?? (req.body?.channel ? [req.body.channel] : []))
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Give the task a title' })
  if (channels.length === 0) return res.status(400).json({ error: 'Pick at least one platform' })
  if (!channels.every((ch) => canAccessDept(req.user, ch))) return res.status(403).json({ error: 'Not your channel' })
  if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to add tasks' })
  const safeType = CONTENT_TYPES.includes(type) ? type : 'post'

  const status = status_id || db.prepare('SELECT id FROM statuses ORDER BY sort, id').get()?.id || null
  const maxSort = db.prepare('SELECT COALESCE(MAX(todo_sort), -1) AS m FROM content').get().m
  const info = db.prepare(`
    INSERT INTO content (title, channels, type, assignee_id, created_by, status_id,
      recording_date, recording_time, release_date, release_time, description, photo, checklist, todo_sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(title).trim(), JSON.stringify(channels), safeType, req.user.id, req.user.id, status,
    recording_date || null, recording_time || null, release_date || null, release_time || null,
    description, photo || null, JSON.stringify(Array.isArray(checklist) ? checklist : []),
    maxSort + 1, new Date().toISOString(),
  )
  // A new task raises each channel's plan: 15/16 → 15/17.
  for (const ch of channels) bumpPlan(ch, safeType, { target: +1 }, true)
  res.status(201).json(parse(db.prepare('SELECT * FROM content WHERE id = ?').get(info.lastInsertRowid)))
})

// Reorder the to-do list (drag): ids in display order.
router.post('/todo-reorder', (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' })
  const upd = db.prepare('UPDATE content SET todo_sort = ? WHERE id = ?')
  const rows = ids
    .map((id) => db.prepare('SELECT * FROM content WHERE id = ?').get(id))
    .filter((r) => r && canTouch(req.user, r))
  db.transaction(() => rows.forEach((r, i) => upd.run(i, r.id)))()
  res.json({ ok: true })
})

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id)
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
    const next = cleanChannels(body.channels)
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
    const fin = finalStatus()
    if (body.done) {
      if (fin) patch.status_id = fin.id
      patch.done_at = row.done_at || new Date().toISOString()
    } else {
      patch.done_at = null
      if (fin && (patch.status_id ?? row.status_id) === fin.id) {
        const lastNonFinal = db.prepare('SELECT id FROM statuses WHERE is_final = 0 ORDER BY sort DESC, id DESC').get()
        if (lastNonFinal) patch.status_id = lastNonFinal.id
      }
    }
  }

  if (Object.keys(patch).length === 0) return res.json(parse(row))

  // Derive done_at from status moves into/out of the final stage.
  const nextStatus = patch.status_id ?? row.status_id
  if (patch.done_at === undefined) {
    if (isFinal(nextStatus) && !row.done_at) patch.done_at = new Date().toISOString()
    if (!isFinal(nextStatus) && row.done_at) patch.done_at = null
  }

  const keys = Object.keys(patch)
  db.prepare(`UPDATE content SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`)
    .run(...keys.map((k) => patch[k]), row.id)

  // ---- keep the channel plans in sync ----
  const wasDone = !!row.done_at
  const nowDone = patch.done_at !== undefined ? !!patch.done_at : wasDone
  const newChannels = patch.channels !== undefined ? JSON.parse(patch.channels) : oldChannels
  const newType = patch.type !== undefined ? patch.type : row.type

  if (patch.channels !== undefined || patch.type !== undefined) {
    // Moved to other platforms / another type: walk the old plans back, then
    // count toward the new ones (carrying the completion along if done).
    for (const ch of oldChannels) bumpPlan(ch, row.type, { target: -1, current: wasDone ? -1 : 0 })
    for (const ch of newChannels) bumpPlan(ch, newType, { target: +1, current: nowDone ? +1 : 0 }, true)
  } else if (!wasDone && nowDone) {
    for (const ch of newChannels) bumpPlan(ch, newType, { current: +1 }, true) // 15/16 → 16/16
  } else if (wasDone && !nowDone) {
    for (const ch of newChannels) bumpPlan(ch, newType, { current: -1 })
  }

  res.json(parse(db.prepare('SELECT * FROM content WHERE id = ?').get(row.id)))
})

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const allowed = req.user.role === 'admin' || (can(req.user, 'manage_content') && canTouch(req.user, row))
  if (!allowed) return res.status(403).json({ error: 'You don’t have permission to delete this' })
  // Removing a task lowers each channel's plan again (and its count if done).
  for (const ch of JSON.parse(row.channels || '[]'))
    bumpPlan(ch, row.type, { target: -1, current: row.done_at ? -1 : 0 })
  db.prepare('DELETE FROM content WHERE id = ?').run(row.id)
  res.json({ ok: true })
})

export default router
