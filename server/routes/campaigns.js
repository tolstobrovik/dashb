import { Router } from 'express'
import { all, get, run } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'
import {
  dayNow, cleanChecklist, campaignView, missingFields, cleanPhoto,
  bumpProject, usersMap, projectsMap,
} from '../pcmodel.js'

// Campaigns — time-boxed pushes. One project, one owner, one target.
// Everyone signed in can read; admins create and delete; the admin or the
// campaign's owner edits. The form is the gate: a campaign only reaches
// Live fully specified.
const router = Router()
router.use(authRequired)

const canWrite = (user, row) => user.role === 'admin' || (row.owner_id && row.owner_id === user.id)

const cleanChannels = async (v) => {
  const arr = [...new Set((Array.isArray(v) ? v : []).map(String))]
  if (arr.length === 0) return '[]'
  const existing = new Set((await all(
    `SELECT key FROM channels WHERE key IN (${arr.map(() => '?').join(',')})`, ...arr)).map((r) => r.key))
  return JSON.stringify(arr.filter((ch) => existing.has(ch)))
}
const cleanDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null)

async function applyFields(b, row = {}) {
  const next = { ...row }
  if (b.name !== undefined) next.name = String(b.name).trim().slice(0, 200)
  if (b.project_id !== undefined) next.project_id = b.project_id == null || b.project_id === '' ? null : Number(b.project_id)
  if (b.owner_id !== undefined) next.owner_id = b.owner_id == null || b.owner_id === '' ? null : Number(b.owner_id)
  if (b.start_date !== undefined) next.start_date = cleanDate(b.start_date)
  if (b.end_date !== undefined) next.end_date = cleanDate(b.end_date)
  if (b.channels !== undefined) next.channels = await cleanChannels(b.channels)
  if (b.metric !== undefined) next.metric = String(b.metric)
  if (b.target !== undefined) next.target = Number(b.target) || 0
  if (b.actual !== undefined) next.actual = Number(b.actual) || 0 // the weekly human number
  if (b.budget !== undefined) next.budget = b.budget == null || b.budget === '' ? null : Number(b.budget)
  if (b.goal !== undefined) next.goal = String(b.goal).slice(0, 300)
  if (b.description !== undefined) next.description = String(b.description).slice(0, 2000)
  if (b.photo !== undefined) next.photo = cleanPhoto(b.photo)
  if (b.photo_thumb !== undefined) next.photo_thumb = cleanPhoto(b.photo_thumb)
  if (b.checklist !== undefined) next.checklist = cleanChecklist(b.checklist)
  return next
}

async function validateRefs(next, res) {
  if (Object.prototype.hasOwnProperty.call(next, 'photo') && next.photo === undefined) {
    res.status(400).json({ error: 'The photo must be an image under ~700 KB' }); return false
  }
  if (Object.prototype.hasOwnProperty.call(next, 'photo_thumb') && next.photo_thumb === undefined) {
    res.status(400).json({ error: 'Bad thumbnail' }); return false
  }
  if (next.project_id && !(await get('SELECT 1 AS x FROM projects WHERE id = ?', next.project_id))) {
    res.status(400).json({ error: 'Project not found' }); return false
  }
  if (next.owner_id && !(await get('SELECT 1 AS x FROM users WHERE id = ?', next.owner_id))) {
    res.status(400).json({ error: 'Owner not found — refresh the page and pick again' }); return false
  }
  if (next.start_date && next.end_date && next.end_date < next.start_date) {
    res.status(400).json({ error: 'The end date is before the start date' }); return false
  }
  return true
}

const full = async (id, today) =>
  campaignView(await get('SELECT * FROM campaigns WHERE id = ?', id), today, await usersMap(), await projectsMap())

router.get('/', wrap(async (req, res) => {
  const today = dayNow()
  const users = await usersMap()
  const projects = await projectsMap()
  let rows = (await all('SELECT * FROM campaigns ORDER BY start_date IS NULL, start_date, id'))
    .map((c) => campaignView(c, today, users, projects))
  if (req.query.project) rows = rows.filter((c) => c.project_id === Number(req.query.project))
  res.json(rows)
}))

router.get('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM campaigns WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Campaign not found' })
  const today = dayNow()
  const users = await usersMap()
  const c = campaignView(row, today, users, await projectsMap())
  const notes = (await all("SELECT * FROM notes WHERE kind = 'campaign' AND ref_id = ? ORDER BY created_at DESC, id DESC", row.id))
    .map((n) => ({ ...n, author_name: users[n.author_id]?.name || null }))
  res.json({ ...c, photo: row.photo || null, notes })
}))

// Two save buttons, one gate: stage 'idea' accepts an incomplete form;
// stage 'accepted' (the Create button) refuses until all eight required
// fields are filled and answers with what is missing.
router.post('/', adminOnly, wrap(async (req, res) => {
  const b = req.body || {}
  const next = await applyFields(b, { channels: '[]', checklist: '[]', target: 0, actual: 0 })
  if (!next.name) return res.status(400).json({ error: 'Give the campaign a name' })
  if (!(await validateRefs(next, res))) return
  const wantsCreate = b.stage === 'accepted'
  const missing = missingFields(next)
  if (wantsCreate && missing.length > 0)
    return res.status(400).json({ error: `Not ready to create — missing: ${missing.join(', ')}`, missing })
  const info = await run(`
    INSERT INTO campaigns (name, project_id, owner_id, start_date, end_date, channels, metric, target, actual, budget, goal, description, photo, photo_thumb, checklist, stage, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `,
    next.name, next.project_id ?? null, next.owner_id ?? null, next.start_date ?? null, next.end_date ?? null,
    next.channels, next.metric || '', next.target || 0, next.actual || 0, next.budget ?? null,
    next.goal || '', next.description || '', next.photo ?? null, next.photo_thumb ?? null,
    next.checklist || '[]', wantsCreate ? 'accepted' : 'idea',
  )
  if (next.project_id) await bumpProject(next.project_id)
  res.status(201).json(await full(info.lastInsertRowid, dayNow()))
}))

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM campaigns WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Campaign not found' })
  if (!canWrite(req.user, row)) return res.status(403).json({ error: 'Only the admin or the campaign owner can edit this' })
  const b = req.body || {}
  const next = await applyFields(b, row)
  if (b.name !== undefined && !next.name) return res.status(400).json({ error: 'Give the campaign a name' })
  if (!(await validateRefs(next, res))) return

  // Stage transitions: accepting runs the gate; closing is the manual Done;
  // demoting to idea is allowed. 'blocked' is never typed — it derives.
  if (b.stage !== undefined) {
    if (!['idea', 'accepted', 'closed'].includes(b.stage))
      return res.status(400).json({ error: 'Blocked is not set by hand — it comes from overdue checklist items' })
    if (b.stage === 'accepted') {
      const missing = missingFields(next)
      if (missing.length > 0)
        return res.status(400).json({ error: `Not ready — missing: ${missing.join(', ')}`, missing })
    }
    next.stage = b.stage
  }

  const keys = ['name', 'project_id', 'owner_id', 'start_date', 'end_date', 'channels', 'metric', 'target', 'actual', 'budget', 'goal', 'description', 'photo', 'photo_thumb', 'checklist', 'stage']
    .filter((k) => next[k] !== row[k])
  if (keys.length > 0) {
    await run(`UPDATE campaigns SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
      ...keys.map((k) => next[k] ?? null), row.id)
    await bumpProject(next.project_id ?? row.project_id)
  }
  res.json(await full(row.id, dayNow()))
}))

router.post('/:id/notes', wrap(async (req, res) => {
  const row = await get('SELECT id, project_id FROM campaigns WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Campaign not found' })
  const text = String(req.body?.text || '').trim().slice(0, 2000)
  if (!text) return res.status(400).json({ error: 'Write the note first' })
  const info = await run('INSERT INTO notes (kind, ref_id, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
    'campaign', row.id, req.user.id, text, new Date().toISOString())
  if (row.project_id) await bumpProject(row.project_id)
  const n = await get('SELECT * FROM notes WHERE id = ?', info.lastInsertRowid)
  res.status(201).json({ ...n, author_name: req.user.name })
}))

// A note's author (or the admin) can take it back.
router.delete('/:id/notes/:noteId', wrap(async (req, res) => {
  const n = await get("SELECT * FROM notes WHERE id = ? AND kind = 'campaign' AND ref_id = ?", req.params.noteId, req.params.id)
  if (!n) return res.status(404).json({ error: 'Note not found' })
  if (req.user.role !== 'admin' && n.author_id !== req.user.id)
    return res.status(403).json({ error: 'Only the author or an admin can delete a note' })
  await run('DELETE FROM notes WHERE id = ?', n.id)
  res.json({ ok: true })
}))

router.delete('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT id, project_id FROM campaigns WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Campaign not found' })
  await run('UPDATE content SET campaign_id = NULL WHERE campaign_id = ?', row.id)
  await run("DELETE FROM notes WHERE kind = 'campaign' AND ref_id = ?", row.id)
  await run('DELETE FROM campaigns WHERE id = ?', row.id)
  if (row.project_id) await bumpProject(row.project_id)
  res.json({ ok: true })
}))

export default router
