import { Router } from 'express'
import { all, get, run } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

// Candidates — the people being considered for open positions. Name, how to
// reach them, what they'd be hired for, the salary they expect, portfolio,
// experience and notes, plus a simple pipeline stage. Admin-only.
const router = Router()
router.use(authRequired, adminOnly)

export const CANDIDATE_STAGES = ['new', 'interview', 'offer', 'hired', 'declined']

const FIELDS = [
  ['contacts', 300], ['position', 120], ['salary', 120],
  ['portfolio', 600], ['experience', 1000], ['notes', 2000],
]

function fieldPatch(b, patch) {
  for (const [f, max] of FIELDS) {
    if (b[f] !== undefined) patch[f] = String(b[f] ?? '').trim().slice(0, max)
  }
  if (b.stage !== undefined) {
    if (!CANDIDATE_STAGES.includes(b.stage)) return 'Unknown stage'
    patch.stage = b.stage
  }
  return null
}

router.get('/', wrap(async (req, res) => {
  res.json(await all('SELECT * FROM candidates ORDER BY created_at DESC'))
}))

router.post('/', wrap(async (req, res) => {
  const b = req.body || {}
  const name = String(b.name || '').trim().slice(0, 120)
  if (!name) return res.status(400).json({ error: 'Give the candidate a name' })
  const patch = { contacts: '', position: '', salary: '', portfolio: '', experience: '', notes: '', stage: 'new' }
  const err = fieldPatch(b, patch)
  if (err) return res.status(400).json({ error: err })
  const info = await run(`
    INSERT INTO candidates (name, contacts, position, salary, portfolio, experience, notes, stage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, name, patch.contacts, patch.position, patch.salary, patch.portfolio, patch.experience, patch.notes, patch.stage, new Date().toISOString())
  res.status(201).json(await get('SELECT * FROM candidates WHERE id = ?', info.lastInsertRowid))
}))

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM candidates WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Candidate not found' })
  const b = req.body || {}
  const patch = {}
  if (b.name !== undefined) {
    const name = String(b.name).trim().slice(0, 120)
    if (!name) return res.status(400).json({ error: 'Give the candidate a name' })
    patch.name = name
  }
  const err = fieldPatch(b, patch)
  if (err) return res.status(400).json({ error: err })
  if (Object.keys(patch).length > 0) {
    const keys = Object.keys(patch)
    await run(`UPDATE candidates SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
      ...keys.map((k) => patch[k]), row.id)
  }
  res.json(await get('SELECT * FROM candidates WHERE id = ?', row.id))
}))

router.delete('/:id', wrap(async (req, res) => {
  const row = await get('SELECT 1 AS x FROM candidates WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Candidate not found' })
  await run('DELETE FROM candidates WHERE id = ?', req.params.id)
  res.json({ ok: true })
}))

export default router
