import { Router } from 'express'
import { db } from '../db.js'
import { authRequired, adminOnly } from '../auth.js'

// Campaign plan — admin only (it lives in the admin panel).
const router = Router()
router.use(authRequired, adminOnly)

const parse = (row) => row && {
  ...row,
  ongoing: !!row.ongoing,
  months: JSON.parse(row.months || '[]'),
}
const cleanMonths = (v) =>
  JSON.stringify((Array.isArray(v) ? v : []).filter((s) => /^\d{4}-\d{2}$/.test(s)).sort())

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM campaigns ORDER BY sort, id').all().map(parse))
})

router.post('/', (req, res) => {
  const b = req.body || {}
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Give the campaign a name' })
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM campaigns').get().m
  const info = db.prepare(`
    INSERT INTO campaigns (name, timing, channel, audience, goal, notes, duration, owner, status, ongoing, months, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(b.name).trim(), b.timing || '', b.channel || '', b.audience || '', b.goal || '', b.notes || '',
    b.duration === 'long' ? 'long' : 'short', b.owner || '', b.status || '',
    b.ongoing ? 1 : 0, cleanMonths(b.months), maxSort + 1,
  )
  res.status(201).json(parse(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid)))
})

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const b = req.body || {}
  const patch = {}
  for (const f of ['timing', 'channel', 'audience', 'goal', 'notes', 'owner', 'status'])
    if (b[f] !== undefined) patch[f] = String(b[f])
  if (b.name !== undefined) {
    if (!String(b.name).trim()) return res.status(400).json({ error: 'Give the campaign a name' })
    patch.name = String(b.name).trim()
  }
  if (b.duration !== undefined) patch.duration = b.duration === 'long' ? 'long' : 'short'
  if (b.ongoing !== undefined) patch.ongoing = b.ongoing ? 1 : 0
  if (b.months !== undefined) patch.months = cleanMonths(b.months)
  if (Object.keys(patch).length > 0) {
    const keys = Object.keys(patch)
    db.prepare(`UPDATE campaigns SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`)
      .run(...keys.map((k) => patch[k]), row.id)
  }
  res.json(parse(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(row.id)))
})

router.post('/reorder', (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' })
  const upd = db.prepare('UPDATE campaigns SET sort = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))()
  res.json({ ok: true })
})

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(row.id)
  res.json({ ok: true })
})

export default router
