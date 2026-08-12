import { Router } from 'express'
import { all, get, run } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

// Whiteboards — admin only (they live in the admin panel). Used for the org
// structure: each card is a role, optionally bound to a team member
// (user_id), and cards are linked into a hierarchy.
const router = Router()
router.use(authRequired, adminOnly)

const parse = (row) => {
  if (!row) return null
  let data = { nodes: [], edges: [] }
  try { data = JSON.parse(row.data || '{}') } catch { /* ignore */ }
  return {
    id: row.id,
    name: row.name,
    updated_at: row.updated_at,
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    edges: Array.isArray(data.edges) ? data.edges : [],
  }
}

// Validate and bound the payload: node ids unique strings, positions numeric,
// bound member ids numeric, edges only between existing nodes, no self-loops.
const cleanData = (v) => {
  if (!v || typeof v !== 'object') return null
  const nodes = (Array.isArray(v.nodes) ? v.nodes : []).slice(0, 300).map((n) => ({
    id: String(n.id),
    x: Math.max(0, Math.round(Number(n.x) || 0)),
    y: Math.max(0, Math.round(Number(n.y) || 0)),
    text: String(n.text || '').slice(0, 120),
    sub: String(n.sub || '').slice(0, 160),
    color: String(n.color || '#a32234').slice(0, 20),
    user_id: n.user_id == null || n.user_id === '' ? null : Number(n.user_id),
  }))
  const ids = new Set(nodes.map((n) => n.id))
  if (ids.size !== nodes.length) return null
  const edges = (Array.isArray(v.edges) ? v.edges : []).slice(0, 1000)
    .map((e) => ({ id: String(e.id), from: String(e.from), to: String(e.to) }))
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
  return JSON.stringify({ nodes, edges })
}

router.get('/', wrap(async (req, res) => {
  res.json(await all('SELECT id, name, updated_at FROM boards ORDER BY id'))
}))

router.get('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM boards WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Board not found' })
  res.json(parse(row))
}))

router.post('/', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Give the board a name' })
  const info = await run('INSERT INTO boards (name, data, created_by, updated_at) VALUES (?, ?, ?, ?)',
    name, '{"nodes":[],"edges":[]}', req.user.id, new Date().toISOString())
  res.status(201).json(parse(await get('SELECT * FROM boards WHERE id = ?', info.lastInsertRowid)))
}))

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM boards WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Board not found' })
  const b = req.body || {}
  let name = row.name
  if (b.name !== undefined) {
    name = String(b.name).trim()
    if (!name) return res.status(400).json({ error: 'Give the board a name' })
  }
  let data = row.data
  if (b.data !== undefined) {
    const cleaned = cleanData(b.data)
    if (!cleaned) return res.status(400).json({ error: 'Bad board data' })
    data = cleaned
  }
  await run('UPDATE boards SET name = ?, data = ?, updated_at = ? WHERE id = ?',
    name, data, new Date().toISOString(), row.id)
  res.json(parse(await get('SELECT * FROM boards WHERE id = ?', row.id)))
}))

router.delete('/:id', wrap(async (req, res) => {
  const row = await get('SELECT id FROM boards WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Board not found' })
  await run('DELETE FROM boards WHERE id = ?', row.id)
  res.json({ ok: true })
}))

export default router
