import { Router } from 'express'
import { all, get, run, batch } from '../db.js'
import { authRequired, wrap } from '../auth.js'

// Personal tasks — every account's private checklist in the To-Do section.
// Strictly owner-scoped: nobody else can list, read or touch them (not even
// the admin), and they never appear on channel boards, calendars or plans.
const router = Router()
router.use(authRequired)

const MAX_OPEN = 500 // sanity cap per person

const cleanTitle = (v) => String(v ?? '').trim().slice(0, 300)
const cleanNote = (v) => String(v ?? '').slice(0, 2000)
const cleanDate = (v) => {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const s = String(v)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined
}

router.get('/', wrap(async (req, res) => {
  res.json(await all(
    'SELECT * FROM personal_tasks WHERE user_id = ? ORDER BY pinned DESC, sort, created_at DESC',
    req.user.id,
  ))
}))

router.post('/', wrap(async (req, res) => {
  const b = req.body || {}
  const title = cleanTitle(b.title)
  if (!title) return res.status(400).json({ error: 'Give the task a title' })
  const due = cleanDate(b.due_date)
  if (due === undefined && b.due_date !== undefined) return res.status(400).json({ error: 'Bad date' })
  const n = (await get('SELECT COUNT(*) AS n FROM personal_tasks WHERE user_id = ?', req.user.id)).n
  if (n >= MAX_OPEN) return res.status(400).json({ error: 'Too many personal tasks — clean up some old ones first' })
  const info = await run(`
    INSERT INTO personal_tasks (user_id, title, note, due_date, pinned, sort, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `, req.user.id, title, cleanNote(b.note), due ?? null, b.pinned ? 1 : 0, new Date().toISOString())
  res.status(201).json(await get('SELECT * FROM personal_tasks WHERE id = ?', info.lastInsertRowid))
}))

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM personal_tasks WHERE id = ? AND user_id = ?', req.params.id, req.user.id)
  if (!row) return res.status(404).json({ error: 'Task not found' })
  const b = req.body || {}

  let title = row.title
  if (b.title !== undefined) {
    title = cleanTitle(b.title)
    if (!title) return res.status(400).json({ error: 'Give the task a title' })
  }
  const note = b.note !== undefined ? cleanNote(b.note) : row.note
  let due = row.due_date
  if (b.due_date !== undefined) {
    due = cleanDate(b.due_date)
    if (due === undefined) return res.status(400).json({ error: 'Bad date' })
  }
  const pinned = b.pinned !== undefined ? (b.pinned ? 1 : 0) : row.pinned
  let doneAt = row.done_at
  if (b.done !== undefined) doneAt = b.done ? (row.done_at || new Date().toISOString()) : null

  await run(
    'UPDATE personal_tasks SET title = ?, note = ?, due_date = ?, pinned = ?, done_at = ? WHERE id = ?',
    title, note, due, pinned, doneAt, row.id,
  )
  res.json(await get('SELECT * FROM personal_tasks WHERE id = ?', row.id))
}))

router.delete('/:id', wrap(async (req, res) => {
  const row = await get('SELECT id FROM personal_tasks WHERE id = ? AND user_id = ?', req.params.id, req.user.id)
  if (!row) return res.status(404).json({ error: 'Task not found' })
  await run('DELETE FROM personal_tasks WHERE id = ?', row.id)
  res.json({ ok: true })
}))

// Persist a drag-reorder: sort follows the given order. Only the caller's own
// tasks are touched — foreign ids are simply ignored by the WHERE clause.
router.post('/reorder', wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : []
  if (ids.length) {
    await batch(ids.map((id, i) =>
      ['UPDATE personal_tasks SET sort = ? WHERE id = ? AND user_id = ?', i, id, req.user.id]))
  }
  res.json({ ok: true })
}))

export default router
