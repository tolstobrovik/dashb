import { Router } from 'express'
import { all, get, run } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

// Hiring needs — the positions the team still has to fill. Admin-only:
// this is the manager's staffing board, not a public job list.
const router = Router()
router.use(authRequired, adminOnly)

router.get('/', wrap(async (req, res) => {
  res.json(await all("SELECT * FROM hiring ORDER BY status = 'open' DESC, priority DESC, created_at DESC"))
}))

router.post('/', wrap(async (req, res) => {
  const b = req.body || {}
  const title = String(b.title || '').trim().slice(0, 120)
  if (!title) return res.status(400).json({ error: 'Name the position' })
  const info = await run(
    'INSERT INTO hiring (title, note, priority, status, created_at) VALUES (?, ?, ?, ?, ?)',
    title, String(b.note || '').slice(0, 600), b.priority ? 1 : 0, 'open', new Date().toISOString())
  res.status(201).json(await get('SELECT * FROM hiring WHERE id = ?', info.lastInsertRowid))
}))

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM hiring WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const b = req.body || {}
  const patch = {}
  if (b.title !== undefined) {
    const title = String(b.title).trim().slice(0, 120)
    if (!title) return res.status(400).json({ error: 'Name the position' })
    patch.title = title
  }
  if (b.note !== undefined) patch.note = String(b.note).slice(0, 600)
  if (b.priority !== undefined) patch.priority = b.priority ? 1 : 0
  if (b.status !== undefined) {
    if (!['open', 'hired'].includes(b.status)) return res.status(400).json({ error: 'Unknown status' })
    patch.status = b.status
  }
  if (Object.keys(patch).length > 0) {
    const keys = Object.keys(patch)
    await run(`UPDATE hiring SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
      ...keys.map((k) => patch[k]), row.id)
  }
  res.json(await get('SELECT * FROM hiring WHERE id = ?', row.id))
}))

router.delete('/:id', wrap(async (req, res) => {
  const row = await get('SELECT 1 AS x FROM hiring WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  await run('DELETE FROM hiring WHERE id = ?', req.params.id)
  res.json({ ok: true })
}))

export default router
