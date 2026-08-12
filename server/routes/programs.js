import { Router } from 'express'
import { all, get, run } from '../db.js'
import { authRequired, canAccessDept, can, wrap } from '../auth.js'
import { cleanChecklist } from '../pcmodel.js'

// Creatives — the ad variations a program runs: a name, the script, and an
// optional photo (browser-downscaled data URL). Capped so a program's row
// stays a sane size even with attachments.
function cleanCreatives(v) {
  const list = (Array.isArray(v) ? v : [])
    .map((c) => ({
      name: String(c?.name ?? '').trim().slice(0, 200),
      script: String(c?.script ?? '').slice(0, 3000),
      photo: typeof c?.photo === 'string' && c.photo.startsWith('data:image/') && c.photo.length <= 400000 ? c.photo : null,
      photo_thumb: typeof c?.photo_thumb === 'string' && c.photo_thumb.startsWith('data:image/') && c.photo_thumb.length <= 60000 ? c.photo_thumb : null,
    }))
    .filter((c) => c.name)
    .slice(0, 20)
  return JSON.stringify(list)
}

// Launch programs — the Target team's ad runs on a timeline. A program is a
// named launch with dates and a hand-set state: planned → running, halted
// when it's stopped mid-flight, finished when it wraps. Any channel can turn
// the widget on; reads follow channel access, writes need manage_content.
const router = Router()
router.use(authRequired)

export const PROGRAM_STATUSES = ['planned', 'running', 'paused', 'done']
// Where the ads run — the Target team's lens over the dashboard.
export const PROGRAM_PLATFORMS = ['instagram', 'telegram', 'both']
// Which branch (filial) the launch is aimed at — multi-select.
export const PROGRAM_BRANCHES = ['shahristan', 'chilanzar', 'drujba', 'andijan', 'bukhara']
const cleanBranches = (v) =>
  JSON.stringify([...new Set((Array.isArray(v) ? v : []).map((b) => String(b).toLowerCase()))]
    .filter((b) => PROGRAM_BRANCHES.includes(b)))

const DATE = /^\d{4}-\d{2}-\d{2}$/
const cleanDate = (v) => (v == null || v === '' ? null : DATE.test(String(v)) ? String(v) : undefined)

const canWrite = (user, channel) =>
  user.role === 'admin' || (can(user, 'manage_content') && canAccessDept(user, channel))

router.get('/', wrap(async (req, res) => {
  const { channel } = req.query
  if (!channel) return res.status(400).json({ error: 'channel is required' })
  if (!canAccessDept(req.user, channel)) return res.status(403).json({ error: 'Not your channel' })
  res.json(await all('SELECT * FROM programs WHERE channel = ? ORDER BY start_date, id', channel))
}))

router.post('/', wrap(async (req, res) => {
  const b = req.body || {}
  const channel = String(b.channel || '')
  if (!(await get('SELECT 1 AS x FROM channels WHERE key = ?', channel)))
    return res.status(400).json({ error: 'Channel not found' })
  if (!canWrite(req.user, channel)) return res.status(403).json({ error: 'You don’t have permission to add programs' })
  const name = String(b.name || '').trim().slice(0, 200)
  if (!name) return res.status(400).json({ error: 'Give the program a name' })
  const status = PROGRAM_STATUSES.includes(b.status) ? b.status : 'planned'
  const platform = PROGRAM_PLATFORMS.includes(b.platform) ? b.platform : 'both'
  const start = cleanDate(b.start_date), end = cleanDate(b.end_date)
  if (start === undefined || end === undefined) return res.status(400).json({ error: 'Bad date' })
  if (start && end && end < start) return res.status(400).json({ error: 'The end date is before the start' })
  const budget = b.budget == null || b.budget === '' ? null : Number(b.budget)
  if (budget !== null && !Number.isFinite(budget)) return res.status(400).json({ error: 'Budget must be a number' })
  // The checklist is the admin's launch plan — only they shape it.
  const checklist = req.user.role === 'admin' ? cleanChecklist(b.checklist ?? []) : '[]'
  const info = await run(`
    INSERT INTO programs (channel, name, status, platform, branches, start_date, end_date, budget, note, checklist, creatives, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, channel, name, status, platform, cleanBranches(b.branches ?? []), start, end, budget, String(b.note || '').slice(0, 500), checklist, cleanCreatives(b.creatives ?? []), new Date().toISOString())
  res.status(201).json(await get('SELECT * FROM programs WHERE id = ?', info.lastInsertRowid))
}))

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM programs WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Program not found' })
  if (!canWrite(req.user, row.channel)) return res.status(403).json({ error: 'You don’t have permission to edit programs' })
  const b = req.body || {}
  const patch = {}
  if (b.name !== undefined) {
    const name = String(b.name).trim().slice(0, 200)
    if (!name) return res.status(400).json({ error: 'Give the program a name' })
    patch.name = name
  }
  if (b.status !== undefined) {
    if (!PROGRAM_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown status' })
    patch.status = b.status
  }
  if (b.platform !== undefined) {
    if (!PROGRAM_PLATFORMS.includes(b.platform)) return res.status(400).json({ error: 'Unknown platform' })
    patch.platform = b.platform
  }
  for (const f of ['start_date', 'end_date']) {
    if (b[f] !== undefined) {
      const d = cleanDate(b[f])
      if (d === undefined) return res.status(400).json({ error: 'Bad date' })
      patch[f] = d
    }
  }
  const start = patch.start_date !== undefined ? patch.start_date : row.start_date
  const end = patch.end_date !== undefined ? patch.end_date : row.end_date
  if (start && end && end < start) return res.status(400).json({ error: 'The end date is before the start' })
  if (b.budget !== undefined) {
    const budget = b.budget == null || b.budget === '' ? null : Number(b.budget)
    if (budget !== null && !Number.isFinite(budget)) return res.status(400).json({ error: 'Budget must be a number' })
    patch.budget = budget
  }
  if (b.note !== undefined) patch.note = String(b.note).slice(0, 500)
  if (b.checklist !== undefined) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the admin edits program checklists' })
    patch.checklist = cleanChecklist(b.checklist)
  }
  if (b.creatives !== undefined) patch.creatives = cleanCreatives(b.creatives)
  if (b.branches !== undefined) patch.branches = cleanBranches(b.branches)
  if (Object.keys(patch).length > 0) {
    const keys = Object.keys(patch)
    await run(`UPDATE programs SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
      ...keys.map((k) => patch[k]), row.id)
  }
  res.json(await get('SELECT * FROM programs WHERE id = ?', row.id))
}))

router.delete('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM programs WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Program not found' })
  if (!canWrite(req.user, row.channel)) return res.status(403).json({ error: 'You don’t have permission to delete programs' })
  await run('DELETE FROM programs WHERE id = ?', row.id)
  res.json({ ok: true })
}))

export default router
