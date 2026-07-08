import { Router } from 'express'
import { db, snapshotTracker, CONTENT_TYPES } from '../db.js'
import { authRequired, canAccessDept, can, requirePerm } from '../auth.js'

const cleanType = (v) => (CONTENT_TYPES.includes(v) && v !== 'other' ? v : null)

const router = Router()
router.use(authRequired)

const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0 }
const channelExists = (key) => !!db.prepare('SELECT 1 FROM channels WHERE key = ?').get(key)

router.get('/', (req, res) => {
  const { department } = req.query
  let rows = db.prepare('SELECT * FROM trackers ORDER BY department, sort, id').all()
  if (req.user.role !== 'admin') {
    const set = new Set(req.user.departments)
    rows = rows.filter((t) => set.has(t.department))
  }
  if (department) rows = rows.filter((t) => t.department === department)
  res.json(rows)
})

// Snapshots for the growth comparison: all history rows for one channel.
router.get('/history', (req, res) => {
  const { department } = req.query
  if (!department || !canAccessDept(req.user, department)) return res.status(403).json({ error: 'Not your channel' })
  const rows = db.prepare(`
    SELECT h.tracker_id, h.date, h.value FROM metric_history h
    JOIN trackers t ON t.id = h.tracker_id
    WHERE t.department = ? ORDER BY h.date
  `).all(department)
  res.json(rows)
})

router.post('/', requirePerm('manage_metrics'), (req, res) => {
  const { department, label, current = 0, target = 1, unit = '', period = 'monthly', content_type = null } = req.body || {}
  if (!channelExists(department) || !label) return res.status(400).json({ error: 'channel and label are required' })
  if (!canAccessDept(req.user, department)) return res.status(403).json({ error: 'Not your channel' })
  const ct = cleanType(content_type)
  if (ct && db.prepare('SELECT 1 FROM trackers WHERE department = ? AND content_type = ?').get(department, ct))
    return res.status(400).json({ error: `This channel already has a ${ct} plan` })
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM trackers WHERE department = ?').get(department).m
  const info = db.prepare(`
    INSERT INTO trackers (department, label, current, target, unit, period, content_type, sort, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(department, label.trim(), toInt(current), Math.max(1, toInt(target)), unit, period, ct, maxSort + 1, new Date().toISOString())
  snapshotTracker(info.lastInsertRowid)
  res.status(201).json(db.prepare('SELECT * FROM trackers WHERE id = ?').get(info.lastInsertRowid))
})

router.post('/reorder', requirePerm('manage_layout'), (req, res) => {
  const { department, ids } = req.body || {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' })
  if (!canAccessDept(req.user, department)) return res.status(403).json({ error: 'Not your channel' })
  const upd = db.prepare('UPDATE trackers SET sort = ? WHERE id = ? AND department = ?')
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id, department)))()
  res.json({ ok: true })
})

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM trackers WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Metric not found' })
  if (!canAccessDept(req.user, row.department)) return res.status(403).json({ error: 'Not your channel' })

  const body = req.body || {}
  const patch = {}
  if (body.current !== undefined) {
    // Plan metrics fill from completed tasks — only an admin may correct them.
    if (row.content_type && req.user.role !== 'admin')
      return res.status(403).json({ error: 'This plan fills from completed tasks — move the task to the final stage' })
    if (!can(req.user, 'edit_metrics')) return res.status(403).json({ error: 'You don’t have permission to change values' })
    patch.current = Math.max(0, toInt(body.current))
  }
  const defFields = ['label', 'target', 'unit', 'period', 'content_type']
  if (defFields.some((f) => body[f] !== undefined)) {
    if (!can(req.user, 'manage_metrics')) return res.status(403).json({ error: 'You don’t have permission to edit metrics' })
    if (body.label !== undefined) patch.label = String(body.label).trim()
    if (body.target !== undefined) patch.target = Math.max(1, toInt(body.target))
    if (body.unit !== undefined) patch.unit = String(body.unit)
    if (body.period !== undefined) patch.period = String(body.period)
    if (body.content_type !== undefined) {
      const ct = cleanType(body.content_type)
      if (ct && db.prepare('SELECT 1 FROM trackers WHERE department = ? AND content_type = ? AND id != ?').get(row.department, ct, row.id))
        return res.status(400).json({ error: `This channel already has a ${ct} plan` })
      patch.content_type = ct
    }
  }
  // Any number of metrics can be pinned to the top of the channel page.
  if (body.is_primary !== undefined) {
    if (!can(req.user, 'manage_layout')) return res.status(403).json({ error: 'You don’t have permission to change the layout' })
    patch.is_primary = body.is_primary ? 1 : 0
  }
  if (Object.keys(patch).length === 0) return res.json(row)
  patch.updated_at = new Date().toISOString()
  const keys = Object.keys(patch)
  db.prepare(`UPDATE trackers SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`).run(...keys.map((k) => patch[k]), row.id)
  if (patch.current !== undefined) snapshotTracker(row.id)
  res.json(db.prepare('SELECT * FROM trackers WHERE id = ?').get(row.id))
})

router.delete('/:id', requirePerm('manage_metrics'), (req, res) => {
  const row = db.prepare('SELECT * FROM trackers WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Metric not found' })
  if (!canAccessDept(req.user, row.department)) return res.status(403).json({ error: 'Not your channel' })
  db.prepare('DELETE FROM trackers WHERE id = ?').run(row.id)
  res.json({ ok: true })
})

export default router
