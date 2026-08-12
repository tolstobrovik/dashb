import { Router } from 'express'
import { all, dayISO, publicUser } from '../db.js'
import { authRequired, wrap } from '../auth.js'
import { warningsOf, phasesOf, isDeleted, PHASE_LABEL } from '../deadlines.js'

// The account record: who missed which deadline, and by how long.
//
// Nothing is stored. Every answer here is recomputed from the task's own
// timestamps, which is the point — a warning cannot be edited, deleted or
// quietly settled, because there is no row to edit. It stops existing only
// when the facts it was read from change.
//
// Who sees what: you see your own; admins see everyone's.
const router = Router()
router.use(authRequired)

// Live tasks only — a killed task's slippage stops counting for everybody.
async function liveTasks() {
  const statuses = await all('SELECT id, label FROM statuses')
  const dead = new Set(statuses.filter((s) => isDeleted(s.label)).map((s) => s.id))
  const rows = await all(`SELECT id, title, channels, status_id, operator_id, editor_id, reviewer_id,
    recording_date, edit_ready_date, release_date, edit_due_revised, review_due_revised,
    shot_at, edited_at, done_at FROM content`)
  return rows.filter((r) => !dead.has(r.status_id))
}

const withChannels = (w) => {
  try { return { ...w, channels: JSON.parse(w.channels || '[]') } } catch { return { ...w, channels: [] } }
}

// GET /api/warnings/me — the warnings on my own account.
router.get('/me', wrap(async (req, res) => {
  const today = dayISO()
  const mine = (await liveTasks())
    .flatMap((t) => warningsOf(t, today))
    .filter((w) => w.owner_id === req.user.id)
    .map(withChannels)
    .sort((a, b) => (b.days_late - a.days_late) || String(a.due).localeCompare(String(b.due)))
  res.json({
    count: mine.length,
    open: mine.filter((w) => w.open).length,
    warnings: mine,
  })
}))

// GET /api/warnings — everybody's, admins only. ?user_id= narrows it.
router.get('/', wrap(async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Only an admin sees the whole team’s record' })
  const today = dayISO()
  const only = req.query.user_id ? Number(req.query.user_id) : null
  const list = (await liveTasks())
    .flatMap((t) => warningsOf(t, today))
    .filter((w) => (only ? w.owner_id === only : true))
    .map(withChannels)
    .sort((a, b) => b.days_late - a.days_late)
  res.json({ count: list.length, warnings: list })
}))

// GET /api/warnings/report — the question the board is actually asked:
// which step of the pipeline loses the time, and who inside it.
router.get('/report', wrap(async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Only an admin sees the whole team’s record' })
  const today = dayISO()
  const tasks = await liveTasks()
  const team = (await all('SELECT * FROM users')).map(publicUser)
  const nameOf = (id) => team.find((u) => u.id === id)?.name || null

  // Per phase: how many handovers were judged, how many ran late, and how many
  // were excused because the delay came from upstream.
  const byPhase = {}
  for (const key of ['shoot', 'edit', 'review'])
    byPhase[key] = { phase: key, label: PHASE_LABEL[key], judged: 0, late: 0, excused: 0, on_time: 0, days_lost: 0 }

  const byPerson = new Map()
  const bump = (id, key, field, n = 1) => {
    if (!id) return
    if (!byPerson.has(id)) byPerson.set(id, { user_id: id, name: nameOf(id), late: 0, on_time: 0, excused: 0, days_lost: 0, phases: {} })
    const p = byPerson.get(id)
    p.phases[key] = p.phases[key] || { late: 0, on_time: 0, excused: 0, days_lost: 0 }
    p[field] += n; p.phases[key][field] += n
  }

  for (const t of tasks) {
    for (const p of phasesOf(t, today)) {
      const slot = byPhase[p.phase]
      if (p.state === 'none' || p.state === 'waiting' || p.state === 'pending') continue
      slot.judged++
      if (p.state === 'late') {
        slot.late++; slot.days_lost += p.days_late
        bump(p.owner_id, p.phase, 'late'); bump(p.owner_id, p.phase, 'days_lost', p.days_late)
      } else if (p.state === 'excused') {
        slot.excused++
        bump(p.owner_id, p.phase, 'excused')
      } else {
        slot.on_time++
        bump(p.owner_id, p.phase, 'on_time')
      }
    }
  }

  const people = [...byPerson.values()].sort((a, b) => (b.late - a.late) || (b.days_lost - a.days_lost))
  res.json({
    today,
    phases: Object.values(byPhase),
    people,
    // The headline: the stage that loses the most days.
    worst: Object.values(byPhase).sort((a, b) => b.days_lost - a.days_lost)[0] || null,
  })
}))

export default router
