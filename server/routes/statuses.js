import { Router } from 'express'
import { all, get, run, batch, STAGE_ACTORS, defaultMayLeave, getStageRules } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

const router = Router()
router.use(authRequired)

router.get('/', wrap(async (req, res) => {
  res.json(await all('SELECT * FROM statuses ORDER BY sort, id'))
}))

// ---- stage rules: who may move a task OUT of each stage ----
// GET answers the EFFECTIVE matrix (admin overrides merged over the role
// defaults) so the client never re-implements the defaults; POST stores the
// full matrix the admin saved.
router.get('/rules', wrap(async (req, res) => {
  const statuses = await all('SELECT id, label FROM statuses ORDER BY sort, id')
  const stored = await getStageRules()
  const out = {}
  for (const actor of STAGE_ACTORS) {
    out[actor] = {}
    for (const s of statuses) {
      const v = stored?.[actor]?.[String(s.id)]
      out[actor][s.id] = v === undefined ? defaultMayLeave(actor, s.label) : !!v
    }
  }
  res.json(out)
}))

router.post('/rules', adminOnly, wrap(async (req, res) => {
  const body = req.body || {}
  const statuses = await all('SELECT id FROM statuses')
  const known = new Set(statuses.map((s) => String(s.id)))
  const clean = {}
  for (const actor of STAGE_ACTORS) {
    if (body[actor] && typeof body[actor] === 'object') {
      clean[actor] = {}
      for (const [sid, v] of Object.entries(body[actor])) {
        if (known.has(String(sid))) clean[actor][String(sid)] = !!v
      }
    }
  }
  await run("INSERT INTO meta (key, value) VALUES ('stage_rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(clean))
  res.json({ ok: true })
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
