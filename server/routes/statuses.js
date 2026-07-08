import { Router } from 'express'
import { db } from '../db.js'
import { authRequired, adminOnly } from '../auth.js'

const router = Router()
router.use(authRequired)

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM statuses ORDER BY sort, id').all())
})

router.post('/', adminOnly, (req, res) => {
  const { label, color = '#8b8388' } = req.body || {}
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'Name is required' })
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM statuses').get().m
  const info = db.prepare('INSERT INTO statuses (label, color, sort, is_final) VALUES (?, ?, ?, 0)')
    .run(String(label).trim(), color, maxSort + 1)
  res.status(201).json(db.prepare('SELECT * FROM statuses WHERE id = ?').get(info.lastInsertRowid))
})

router.patch('/:id', adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Status not found' })
  const { label, color, is_final } = req.body || {}
  if (is_final) db.prepare('UPDATE statuses SET is_final = 0').run() // only one final stage
  db.prepare('UPDATE statuses SET label = ?, color = ?, is_final = ? WHERE id = ?').run(
    label !== undefined ? String(label).trim() : row.label,
    color ?? row.color,
    is_final !== undefined ? (is_final ? 1 : 0) : row.is_final,
    row.id,
  )
  res.json(db.prepare('SELECT * FROM statuses WHERE id = ?').get(row.id))
})

router.post('/reorder', adminOnly, (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' })
  const upd = db.prepare('UPDATE statuses SET sort = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))()
  res.json({ ok: true })
})

router.delete('/:id', adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Status not found' })
  const fallback = db.prepare('SELECT id FROM statuses WHERE id != ? ORDER BY sort, id').get(row.id)
  if (!fallback) return res.status(400).json({ error: 'At least one stage must remain' })
  db.transaction(() => {
    db.prepare('UPDATE content SET status_id = ? WHERE status_id = ?').run(fallback.id, row.id)
    db.prepare('DELETE FROM statuses WHERE id = ?').run(row.id)
  })()
  res.json({ ok: true })
})

export default router
