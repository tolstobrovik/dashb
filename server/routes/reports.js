import { Router } from 'express'
import { all, publicUser, tashkentDay } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

const router = Router()
router.use(authRequired, adminOnly)

// Who did what in a period: completed content per member, broken down by
// channel and by content type.
router.get('/', wrap(async (req, res) => {
  const { from, to } = req.query
  let rows = (await all(`
    SELECT id, title, channels, type, assignee_id, done_at
    FROM content WHERE done_at IS NOT NULL
  `)).map((r) => ({ ...r, channels: JSON.parse(r.channels || '[]') }))
  // Completion timestamps are UTC; the report's day boundaries are Tashkent's.
  if (from) rows = rows.filter((r) => tashkentDay(r.done_at) >= from)
  if (to) rows = rows.filter((r) => tashkentDay(r.done_at) <= to)

  const users = (await all('SELECT * FROM users')).map(publicUser)
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
}))

export default router
