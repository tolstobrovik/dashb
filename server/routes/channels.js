import { Router } from 'express'
import { all, get, run, batch } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

const router = Router()
router.use(authRequired)

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'channel'

router.get('/', wrap(async (req, res) => {
  res.json(await all('SELECT * FROM channels ORDER BY sort, id'))
}))

router.post('/', adminOnly, wrap(async (req, res) => {
  const { label, icon = 'star' } = req.body || {}
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'Name is required' })
  let key = slugify(label)
  let n = 1
  while (await get('SELECT 1 AS x FROM channels WHERE key = ?', key)) key = `${slugify(label)}_${++n}`
  const maxSort = (await get('SELECT COALESCE(MAX(sort), -1) AS m FROM channels')).m
  const info = await run('INSERT INTO channels (key, label, icon, sort) VALUES (?, ?, ?, ?)',
    key, String(label).trim(), icon, maxSort + 1)
  res.status(201).json(await get('SELECT * FROM channels WHERE id = ?', info.lastInsertRowid))
}))

router.patch('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT * FROM channels WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Channel not found' })
  const { label, icon } = req.body || {}
  await run('UPDATE channels SET label = ?, icon = ? WHERE id = ?',
    label !== undefined ? String(label).trim() : row.label, icon ?? row.icon, row.id)
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
  ]
  for (const c of await all('SELECT id, channels FROM content')) {
    const chs = JSON.parse(c.channels || '[]')
    if (!chs.includes(row.key)) continue
    const left = chs.filter((k) => k !== row.key)
    stmts.push(left.length
      ? ['UPDATE content SET channels = ? WHERE id = ?', JSON.stringify(left), c.id]
      : ['DELETE FROM content WHERE id = ?', c.id])
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
