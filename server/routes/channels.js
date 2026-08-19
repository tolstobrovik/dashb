import { Router } from 'express'
import { all, get, run, batch, taskChildDeletes } from '../db.js'
import { authRequired, adminOnly, can, wrap } from '../auth.js'

const router = Router()
router.use(authRequired)

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'channel'

// Sections a channel dashboard can show, in any order. The client renders
// exactly this set — keep the two lists in step.
export const DASH_WIDGETS = ['programs', 'metrics', 'growth', 'campaigns', 'timetable', 'upcoming', 'done', 'content']

// The head of each department rides along (live name/avatar for the UI).
router.get('/', wrap(async (req, res) => {
  res.json(await all(`
    SELECT c.*, u.name AS head_name, u.color AS head_color, u.avatar AS head_avatar
    FROM channels c LEFT JOIN users u ON u.id = c.head_id
    ORDER BY c.sort, c.id
  `))
}))

const cleanHead = async (v) => {
  if (v == null || v === '') return null
  const id = Number(v)
  if (!(await get('SELECT 1 AS x FROM users WHERE id = ?', id))) throw Object.assign(new Error('Head not found'), { status: 400 })
  return id
}

router.post('/', adminOnly, wrap(async (req, res) => {
  const { label, icon = 'star', head_id = null } = req.body || {}
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'Name is required' })
  let head
  try { head = await cleanHead(head_id) } catch (e) { return res.status(400).json({ error: e.message }) }
  let key = slugify(label)
  let n = 1
  while (await get('SELECT 1 AS x FROM channels WHERE key = ?', key)) key = `${slugify(label)}_${++n}`
  const maxSort = (await get('SELECT COALESCE(MAX(sort), -1) AS m FROM channels')).m
  const info = await run('INSERT INTO channels (key, label, icon, head_id, sort) VALUES (?, ?, ?, ?, ?)',
    key, String(label).trim(), icon, head, maxSort + 1)
  res.status(201).json(await get('SELECT * FROM channels WHERE id = ?', info.lastInsertRowid))
}))

router.patch('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT * FROM channels WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Channel not found' })
  const { label, icon, head_id } = req.body || {}
  let head = row.head_id
  if (head_id !== undefined) {
    try { head = await cleanHead(head_id) } catch (e) { return res.status(400).json({ error: e.message }) }
  }
  await run('UPDATE channels SET label = ?, icon = ?, head_id = ? WHERE id = ?',
    label !== undefined ? String(label).trim() : row.label, icon ?? row.icon, head, row.id)
  res.json(await get('SELECT * FROM channels WHERE id = ?', row.id))
}))

// Which sections this channel's page shows, and in what order. The admin can
// shape any channel; a member with the layout right can shape their own.
router.patch('/:id/dashboard', wrap(async (req, res) => {
  const row = await get('SELECT * FROM channels WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Channel not found' })
  const allowed = req.user.role === 'admin' ||
    (can(req.user, 'manage_layout') && (req.user.departments || []).includes(row.key))
  if (!allowed) return res.status(403).json({ error: 'You can’t customize this channel’s dashboard' })
  const list = req.body?.dashboard
  if (!Array.isArray(list)) return res.status(400).json({ error: 'dashboard must be an array of section keys' })
  const clean = [...new Set(list.map(String))].filter((k) => DASH_WIDGETS.includes(k))
  if (clean.length === 0) return res.status(400).json({ error: 'Keep at least one section on the dashboard' })
  await run('UPDATE channels SET dashboard = ? WHERE id = ?', JSON.stringify(clean), row.id)
  res.json(await get('SELECT * FROM channels WHERE id = ?', row.id))
}))

router.post('/reorder', adminOnly, wrap(async (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' })
  await batch(ids.map((id, i) => ['UPDATE channels SET sort = ? WHERE id = ?', i, id]))
  res.json({ ok: true })
}))

// Deleting a channel removes its metrics, history and content, and revokes it
// from members' access lists — all in one transaction. Tasks that also live on
// other channels just lose this one; sole-channel tasks are deleted.
router.delete('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT * FROM channels WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Channel not found' })
  const stmts = [
    ['DELETE FROM metric_history WHERE tracker_id IN (SELECT id FROM trackers WHERE department = ?)', row.key],
    ['DELETE FROM trackers WHERE department = ?', row.key],
    ['DELETE FROM programs WHERE channel = ?', row.key],
  ]
  for (const c of await all('SELECT id, channels FROM content')) {
    const chs = JSON.parse(c.channels || '[]')
    if (!chs.includes(row.key)) continue
    const left = chs.filter((k) => k !== row.key)
    if (left.length) {
      stmts.push(['UPDATE content SET channels = ? WHERE id = ?', JSON.stringify(left), c.id])
    } else {
      // The task had nowhere else to live, so it goes — and everything it was
      // carrying goes with it, the same way a task deleted by hand does.
      stmts.push(...taskChildDeletes(c.id))
      stmts.push(['DELETE FROM content WHERE id = ?', c.id])
    }
  }
  for (const u of await all('SELECT id, departments FROM users')) {
    const depts = JSON.parse(u.departments || '[]')
    if (depts.includes(row.key)) {
      stmts.push(['UPDATE users SET departments = ? WHERE id = ?', JSON.stringify(depts.filter((d) => d !== row.key)), u.id])
    }
  }
  stmts.push(['DELETE FROM channels WHERE id = ?', row.id])
  await batch(stmts)
  res.json({ ok: true })
}))

export default router
