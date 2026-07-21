import { Router } from 'express'
import { all, get, run } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'
import {
  METRICS, dayNow, cleanChecklist, parseList, campaignView, campaignStatus, cleanPhoto,
  bumpProject, usersMap, projectsMap,
} from '../pcmodel.js'

// Projects — permanent areas of the business. Everyone signed in can read;
// admins create and delete; the admin or the project's owner edits.
const router = Router()
router.use(authRequired)

const canWrite = (user, row) => user.role === 'admin' || (row.owner_id && row.owner_id === user.id)

// Health: red if no owner OR zero live campaigns OR silent for 14+ days.
// Amber if behind target pace (created → deadline). Green otherwise.
// Returns [health, reason] so the UI can say WHY, not just flash a color.
function health(p, liveCount, today) {
  if (!p.owner_id) return ['red', 'No owner — assign one']
  if (liveCount === 0) return ['red', 'No live campaign right now']
  const lastIso = p.last_activity || p.created_at
  if (!lastIso || Date.now() - Date.parse(lastIso) > 14 * 86400000) return ['red', 'Silent for 14+ days — no activity']
  if (Number(p.target) > 0) {
    if (p.deadline && p.deadline < today && Number(p.actual) < Number(p.target)) return ['amber', 'Deadline passed with the target unmet']
    if (p.deadline && p.created_at) {
      const startMs = Date.parse(p.created_at)
      const endMs = Date.parse(`${p.deadline}T00:00:00Z`)
      if (endMs > startMs) {
        const timePct = Math.min(1, Math.max(0, (Date.now() - startMs) / (endMs - startMs)))
        if (Number(p.actual) / Number(p.target) < timePct) return ['amber', 'Progress is behind the deadline pace']
      }
    }
  }
  return ['green', 'Owner set, campaign live, on pace']
}

// Progress is earned, not typed: every checklist item and every campaign of
// the project is one step; done steps fill the bar.
function progressOf(p, camps, today) {
  const list = parseList(p.checklist)
  const done = list.filter((i) => i.done).length
  const campsDone = camps.filter((c) => campaignStatus(c, today) === 'done').length
  const total = list.length + camps.length
  return {
    pct: total > 0 ? Math.round(((done + campsDone) / total) * 100) : 0,
    steps_done: done + campsDone,
    steps_total: total,
    checklist_done: done,
    checklist_total: list.length,
    campaigns_done: campsDone,
    campaigns_total: camps.length,
  }
}

function view(p, liveCount, today, camps = []) {
  const [h, reason] = health(p, liveCount, today)
  return {
    id: p.id,
    name: p.name,
    owner_id: p.owner_id || null,
    metric: p.metric || '',
    target: Number(p.target) || 0,
    actual: Number(p.actual) || 0,
    deadline: p.deadline || null,
    status: p.status || 'active',
    description: p.description || '',
    success: p.success || '',
    budget: p.budget ?? null,
    photo_thumb: p.photo_thumb || null,
    checklist: parseList(p.checklist),
    last_activity: p.last_activity || p.created_at || null,
    live_campaigns: liveCount,
    progress: progressOf(p, camps, today),
    health: h,
    health_reason: reason,
    created_at: p.created_at,
  }
}

const HEALTH_ORDER = { red: 0, amber: 1, green: 2 }

router.get('/metrics', wrap(async (req, res) => res.json(METRICS)))

// The landing table: sorted by health, red first.
router.get('/', wrap(async (req, res) => {
  const today = dayNow()
  const projects = await all('SELECT * FROM projects ORDER BY name')
  const camps = await all('SELECT * FROM campaigns')
  const liveByProject = {}
  const campsByProject = {}
  for (const c of camps) {
    if (!c.project_id) continue
    ;(campsByProject[c.project_id] ||= []).push(c)
    if (campaignStatus(c, today) === 'live') {
      liveByProject[c.project_id] = (liveByProject[c.project_id] || 0) + 1
    }
  }
  const users = await usersMap()
  const out = projects
    .map((p) => ({ ...view(p, liveByProject[p.id] || 0, today, campsByProject[p.id] || []), owner_name: users[p.owner_id]?.name || null, owner_color: users[p.owner_id]?.color || null }))
    .sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || a.name.localeCompare(b.name))
  res.json(out)
}))

// Detail: the project, its campaigns (campaign-list rows filtered to it), notes.
router.get('/:id', wrap(async (req, res) => {
  const p = await get('SELECT * FROM projects WHERE id = ?', req.params.id)
  if (!p) return res.status(404).json({ error: 'Project not found' })
  const today = dayNow()
  const users = await usersMap()
  const projects = await projectsMap()
  const campRows = await all('SELECT * FROM campaigns WHERE project_id = ? ORDER BY start_date, id', p.id)
  const camps = campRows.map((c) => campaignView(c, today, users, projects))
  const liveCount = camps.filter((c) => c.status === 'live').length
  const notes = (await all("SELECT * FROM notes WHERE kind = 'project' AND ref_id = ? ORDER BY created_at DESC, id DESC", p.id))
    .map((n) => ({ ...n, author_name: users[n.author_id]?.name || null }))
  res.json({
    ...view(p, liveCount, today, campRows),
    owner_name: users[p.owner_id]?.name || null,
    owner_color: users[p.owner_id]?.color || null,
    photo: p.photo || null,
    campaigns: camps,
    notes,
  })
}))

router.post('/', adminOnly, wrap(async (req, res) => {
  const b = req.body || {}
  const name = String(b.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Give the project a name' })
  if (b.owner_id != null && b.owner_id !== '' && !(await get('SELECT 1 AS x FROM users WHERE id = ?', Number(b.owner_id))))
    return res.status(400).json({ error: 'Owner not found' })
  const info = await run(`
    INSERT INTO projects (name, owner_id, metric, target, actual, deadline, status, description, success, budget, checklist, photo, photo_thumb, last_activity, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)
  `,
    name,
    b.owner_id == null || b.owner_id === '' ? null : Number(b.owner_id),
    String(b.metric || ''),
    Number(b.target) || 0,
    Number(b.actual) || 0,
    /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? b.deadline : null,
    ['active', 'paused', 'closed'].includes(b.status) ? b.status : 'active',
    String(b.description || '').slice(0, 2000),
    String(b.success || '').slice(0, 1000),
    b.budget == null || b.budget === '' ? null : Number(b.budget),
    cleanPhoto(b.photo) ?? null, cleanPhoto(b.photo_thumb) ?? null,
    new Date().toISOString(), new Date().toISOString(),
  )
  const p = await get('SELECT * FROM projects WHERE id = ?', info.lastInsertRowid)
  res.status(201).json(view(p, 0, dayNow()))
}))

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM projects WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Project not found' })
  if (!canWrite(req.user, row)) return res.status(403).json({ error: 'Only the admin or the project owner can edit this' })
  const b = req.body || {}
  const patch = {}
  if (b.name !== undefined) {
    if (!String(b.name).trim()) return res.status(400).json({ error: 'Give the project a name' })
    patch.name = String(b.name).trim()
  }
  if (b.owner_id !== undefined) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the admin reassigns owners' })
    const next = b.owner_id == null || b.owner_id === '' ? null : Number(b.owner_id)
    if (next !== null && !(await get('SELECT 1 AS x FROM users WHERE id = ?', next)))
      return res.status(400).json({ error: 'Owner not found' })
    patch.owner_id = next
  }
  if (b.metric !== undefined) patch.metric = String(b.metric)
  if (b.target !== undefined) patch.target = Number(b.target) || 0
  if (b.actual !== undefined) patch.actual = Number(b.actual) || 0 // the weekly human number
  if (b.deadline !== undefined) patch.deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? b.deadline : null
  if (b.status !== undefined && ['active', 'paused', 'closed'].includes(b.status)) patch.status = b.status
  if (b.description !== undefined) patch.description = String(b.description).slice(0, 2000)
  if (b.success !== undefined) patch.success = String(b.success).slice(0, 1000)
  if (b.photo !== undefined) {
    const ph = cleanPhoto(b.photo)
    if (ph === undefined) return res.status(400).json({ error: 'The photo must be an image under ~700 KB' })
    patch.photo = ph
  }
  if (b.photo_thumb !== undefined) {
    const th = cleanPhoto(b.photo_thumb)
    if (th === undefined) return res.status(400).json({ error: 'Bad thumbnail' })
    patch.photo_thumb = th
  }
  if (b.budget !== undefined) patch.budget = b.budget == null || b.budget === '' ? null : Number(b.budget)
  if (b.checklist !== undefined) patch.checklist = cleanChecklist(b.checklist)
  if (Object.keys(patch).length > 0) {
    patch.last_activity = new Date().toISOString()
    const keys = Object.keys(patch)
    await run(`UPDATE projects SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
      ...keys.map((k) => patch[k]), row.id)
  }
  const p = await get('SELECT * FROM projects WHERE id = ?', row.id)
  const today = dayNow()
  const camps = await all('SELECT * FROM campaigns WHERE project_id = ?', p.id)
  const liveCount = camps.filter((c) => campaignStatus(c, today) === 'live').length
  res.json(view(p, liveCount, today, camps))
}))

router.post('/:id/notes', wrap(async (req, res) => {
  const row = await get('SELECT id FROM projects WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Project not found' })
  const text = String(req.body?.text || '').trim().slice(0, 2000)
  if (!text) return res.status(400).json({ error: 'Write the note first' })
  const info = await run('INSERT INTO notes (kind, ref_id, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
    'project', row.id, req.user.id, text, new Date().toISOString())
  await bumpProject(row.id)
  const n = await get('SELECT * FROM notes WHERE id = ?', info.lastInsertRowid)
  res.status(201).json({ ...n, author_name: req.user.name })
}))

// A note's author (or the admin) can take it back.
router.delete('/:id/notes/:noteId', wrap(async (req, res) => {
  const n = await get("SELECT * FROM notes WHERE id = ? AND kind = 'project' AND ref_id = ?", req.params.noteId, req.params.id)
  if (!n) return res.status(404).json({ error: 'Note not found' })
  if (req.user.role !== 'admin' && n.author_id !== req.user.id)
    return res.status(403).json({ error: 'Only the author or an admin can delete a note' })
  await run('DELETE FROM notes WHERE id = ?', n.id)
  res.json({ ok: true })
}))

router.delete('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT id FROM projects WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Project not found' })
  await run('UPDATE campaigns SET project_id = NULL WHERE project_id = ?', row.id)
  await run("DELETE FROM notes WHERE kind = 'project' AND ref_id = ?", row.id)
  await run('DELETE FROM projects WHERE id = ?', row.id)
  res.json({ ok: true })
}))

export default router
