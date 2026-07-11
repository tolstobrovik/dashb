import { Router } from 'express'
import { all, get, run, batch } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

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

router.get('/', wrap(async (req, res) => {
  res.json((await all('SELECT * FROM campaigns ORDER BY sort, id')).map(parse))
}))

router.post('/', wrap(async (req, res) => {
  const b = req.body || {}
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Give the campaign a name' })
  const maxSort = (await get('SELECT COALESCE(MAX(sort), -1) AS m FROM campaigns')).m
  const info = await run(`
    INSERT INTO campaigns (name, timing, channel, audience, goal, notes, duration, owner, status, ongoing, months, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    String(b.name).trim(), b.timing || '', b.channel || '', b.audience || '', b.goal || '', b.notes || '',
    b.duration === 'long' ? 'long' : 'short', b.owner || '', b.status || '',
    b.ongoing ? 1 : 0, cleanMonths(b.months), maxSort + 1,
  )
  res.status(201).json(parse(await get('SELECT * FROM campaigns WHERE id = ?', info.lastInsertRowid)))
}))

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM campaigns WHERE id = ?', req.params.id)
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
    await run(`UPDATE campaigns SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
      ...keys.map((k) => patch[k]), row.id)
  }
  res.json(parse(await get('SELECT * FROM campaigns WHERE id = ?', row.id)))
}))

router.post('/reorder', wrap(async (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' })
  await batch(ids.map((id, i) => ['UPDATE campaigns SET sort = ? WHERE id = ?', i, id]))
  res.json({ ok: true })
}))

router.delete('/:id', wrap(async (req, res) => {
  const row = await get('SELECT id FROM campaigns WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  await run('DELETE FROM campaigns WHERE id = ?', row.id)
  res.json({ ok: true })
}))

export default router
