import { Router } from 'express'
import { db, publicUser } from '../db.js'
import { authRequired, adminOnly } from '../auth.js'

const router = Router()
router.use(authRequired, adminOnly)

// Who did what in a period: completed content per member, broken down by
// channel and by content type.
router.get('/', (req, res) => {
  const { from, to } = req.query
  let rows = db.prepare(`
    SELECT id, title, channels, type, assignee_id, done_at
    FROM content WHERE done_at IS NOT NULL
  `).all().map((r) => ({ ...r, channels: JSON.parse(r.channels || '[]') }))
  if (from) rows = rows.filter((r) => r.done_at.slice(0, 10) >= from)
  if (to) rows = rows.filter((r) => r.done_at.slice(0, 10) <= to)

  const users = db.prepare('SELECT * FROM users').all().map(publicUser)
  const byUser = {}
  for (const r of rows) {
    const uid = r.assignee_id ?? 0
    const e = (byUser[uid] = byUser[uid] || { total: 0, byChannel: {}, byType: {}, items: [] })
    e.total += 1
    for (const ch of r.channels) e.byChannel[ch] = (e.byChannel[ch] || 0) + 1
    if (r.type && r.type !== 'other') e.byType[r.type] = (e.byType[r.type] || 0) + 1
    e.items.push({ id: r.id, title: r.title, channel: r.channels[0], done_at: r.done_at })
  }
  const report = users
    .filter((u) => u.role !== 'admin' || byUser[u.id])
    .map((u) => ({
      id: u.id, name: u.name, color: u.color, role: u.role,
      total: byUser[u.id]?.total || 0,
      byChannel: byUser[u.id]?.byChannel || {},
      byType: byUser[u.id]?.byType || {},
      items: (byUser[u.id]?.items || []).sort((a, b) => b.done_at.localeCompare(a.done_at)),
    }))
    .sort((a, b) => b.total - a.total)
  res.json({ report, totalDone: rows.length })
})

export default router
