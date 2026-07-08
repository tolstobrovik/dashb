import { Router } from 'express'
import { db } from '../db.js'
import { authRequired, adminOnly } from '../auth.js'

const router = Router()
router.use(authRequired)

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'channel'

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM channels ORDER BY sort, id').all())
})

router.post('/', adminOnly, (req, res) => {
  const { label, icon = 'star' } = req.body || {}
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'Name is required' })
  let key = slugify(label)
  let n = 1
  while (db.prepare('SELECT 1 FROM channels WHERE key = ?').get(key)) key = `${slugify(label)}_${++n}`
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM channels').get().m
  const info = db.prepare('INSERT INTO channels (key, label, icon, sort) VALUES (?, ?, ?, ?)')
    .run(key, String(label).trim(), icon, maxSort + 1)
  res.status(201).json(db.prepare('SELECT * FROM channels WHERE id = ?').get(info.lastInsertRowid))
})

router.patch('/:id', adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Channel not found' })
  const { label, icon } = req.body || {}
  db.prepare('UPDATE channels SET label = ?, icon = ? WHERE id = ?')
    .run(label !== undefined ? String(label).trim() : row.label, icon ?? row.icon, row.id)
  res.json(db.prepare('SELECT * FROM channels WHERE id = ?').get(row.id))
})

router.post('/reorder', adminOnly, (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' })
  const upd = db.prepare('UPDATE channels SET sort = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))()
  res.json({ ok: true })
})

// Deleting a channel removes its metrics, history, content, and revokes it
// from members' access lists — all in one transaction.
router.delete('/:id', adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Channel not found' })
  db.transaction(() => {
    db.prepare('DELETE FROM metric_history WHERE tracker_id IN (SELECT id FROM trackers WHERE department = ?)').run(row.key)
    db.prepare('DELETE FROM trackers WHERE department = ?').run(row.key)
    db.prepare('DELETE FROM content WHERE channel = ?').run(row.key)
    for (const u of db.prepare('SELECT id, departments FROM users').all()) {
      const depts = JSON.parse(u.departments || '[]')
      if (depts.includes(row.key)) {
        db.prepare('UPDATE users SET departments = ? WHERE id = ?')
          .run(JSON.stringify(depts.filter((d) => d !== row.key)), u.id)
      }
    }
    db.prepare('DELETE FROM channels WHERE id = ?').run(row.id)
  })()
  res.json({ ok: true })
})

export default router
