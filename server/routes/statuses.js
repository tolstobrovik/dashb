import { Router } from 'express'
import { all, get, run, batch } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

const router = Router()
router.use(authRequired)

router.get('/', wrap(async (req, res) => {
  res.json(await all('SELECT * FROM statuses ORDER BY sort, id'))
}))

router.post('/', adminOnly, wrap(async (req, res) => {
  const { label, color = '#8b8388' } = req.body || {}
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'Name is required' })
  const maxSort = (await get('SELECT COALESCE(MAX(sort), -1) AS m FROM statuses')).m
  const info = await run('INSERT INTO statuses (label, color, sort, is_final) VALUES (?, ?, ?, 0)',
    String(label).trim(), color, maxSort + 1)
  res.status(201).json(await get('SELECT * FROM statuses WHERE id = ?', info.lastInsertRowid))
}))

router.patch('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT * FROM statuses WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Status not found' })
  const { label, color, is_final } = req.body || {}
  if (is_final) await run('UPDATE statuses SET is_final = 0') // only one final stage
  await run('UPDATE statuses SET label = ?, color = ?, is_final = ? WHERE id = ?',
    label !== undefined ? String(label).trim() : row.label,
    color ?? row.color,
    is_final !== undefined ? (is_final ? 1 : 0) : row.is_final,
    row.id,
  )
  res.json(await get('SELECT * FROM statuses WHERE id = ?', row.id))
}))

router.post('/reorder', adminOnly, wrap(async (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' })
  await batch(ids.map((id, i) => ['UPDATE statuses SET sort = ? WHERE id = ?', i, id]))
  res.json({ ok: true })
}))

router.delete('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT * FROM statuses WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Status not found' })
  const fallback = await get('SELECT id FROM statuses WHERE id != ? ORDER BY sort, id', row.id)
  if (!fallback) return res.status(400).json({ error: 'At least one stage must remain' })
  await batch([
    ['UPDATE content SET status_id = ? WHERE status_id = ?', fallback.id, row.id],
    ['DELETE FROM statuses WHERE id = ?', row.id],
  ])
  res.json({ ok: true })
}))

export default router
