// Per-person documents: SOPs, responsibility sheets, any file the company and
// a member share.
//
// This used to carry a second half — per-person KPI targets typed in by hand.
// It is gone, and so is the table's reason to exist beyond the shelf itself.
//
// Visibility contract: the admin sees and manages everyone's; a member ALWAYS
// sees their own, and may upload to their own folder (a signed copy, say).
import { Router } from 'express'
import { all, get, run } from '../db.js'
import { authRequired, wrap } from '../auth.js'

export const DOC_KINDS = ['sop', 'responsibility', 'other']

// Files ride as data URLs like photos do elsewhere. ~6M chars ≈ 4.5 MB of
// file — plenty for an SOP, small enough for the GitHub-backed store.
const MAX_DATA_CHARS = 6_000_000
const MIME_OK = /^(application\/pdf|image\/(png|jpe?g|webp|gif)|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-(excel|powerpoint))|application\/octet-stream)$/

// Lists never carry the file bytes — the pages poll, and one PDF is megabytes.
const LIST_COLUMNS = 'id, user_id, kind, title, file_name, mime, size, uploaded_by, created_at, updated_at'

const targetUserId = (req) => {
  const asked = req.query.user_id !== undefined ? Number(req.query.user_id) : req.user.id
  return req.user.role === 'admin' ? asked : req.user.id
}

export const docsRouter = Router()
docsRouter.use(authRequired)

docsRouter.get('/', wrap(async (req, res) => {
  // The whole shelf in one place — admins only.
  if (req.query.all !== undefined) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins see every folder at once' })
    return res.json(await all(`SELECT ${LIST_COLUMNS} FROM person_docs ORDER BY created_at DESC`))
  }
  // A member asking for someone else's folder is told no, not shown their own
  // by surprise.
  if (req.user.role !== 'admin' && req.query.user_id !== undefined && Number(req.query.user_id) !== req.user.id)
    return res.status(403).json({ error: 'You can only see your own documents' })
  res.json(await all(`SELECT ${LIST_COLUMNS} FROM person_docs WHERE user_id = ? ORDER BY created_at DESC`, targetUserId(req)))
}))

docsRouter.get('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM person_docs WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Document not found' })
  if (req.user.role !== 'admin' && row.user_id !== req.user.id)
    return res.status(403).json({ error: 'Not your document' })
  res.json(row)
}))

docsRouter.post('/', wrap(async (req, res) => {
  const b = req.body || {}
  const userId = b.user_id != null ? Number(b.user_id) : req.user.id
  if (req.user.role !== 'admin' && userId !== req.user.id)
    return res.status(403).json({ error: 'You can only upload to your own documents' })
  if (!(await get('SELECT 1 AS x FROM users WHERE id = ?', userId)))
    return res.status(400).json({ error: 'That member is no longer on the team' })

  const title = String(b.title || '').trim().slice(0, 200)
  const fileName = String(b.file_name || 'document.pdf').trim().slice(0, 200)
  if (!title) return res.status(400).json({ error: 'Give the document a title' })
  const kind = DOC_KINDS.includes(b.kind) ? b.kind : 'other'

  const data = String(b.data || '')
  const m = data.match(/^data:([^;,]+)[;,]/)
  if (!m) return res.status(400).json({ error: 'Attach the file itself' })
  if (!MIME_OK.test(m[1])) return res.status(400).json({ error: 'That file type isn’t supported — PDF, Office or image files only' })
  if (data.length > MAX_DATA_CHARS) return res.status(400).json({ error: 'That file is too big — keep documents under ~4 MB' })

  const now = new Date().toISOString()
  const info = await run(`
    INSERT INTO person_docs (user_id, kind, title, file_name, mime, data, size, uploaded_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, userId, kind, title, fileName, m[1], data, Math.round(data.length * 3 / 4), req.user.id, now, now)
  res.status(201).json(await get(`SELECT ${LIST_COLUMNS} FROM person_docs WHERE id = ?`, info.lastInsertRowid))
}))

docsRouter.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM person_docs WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Document not found' })
  if (req.user.role !== 'admin' && row.uploaded_by !== req.user.id)
    return res.status(403).json({ error: 'Only the uploader or an admin can change this' })
  const b = req.body || {}
  const patch = {}
  if (b.title !== undefined) {
    const t = String(b.title).trim().slice(0, 200)
    if (!t) return res.status(400).json({ error: 'Give the document a title' })
    patch.title = t
  }
  if (b.kind !== undefined) {
    if (!DOC_KINDS.includes(b.kind)) return res.status(400).json({ error: 'Unknown document kind' })
    patch.kind = b.kind
  }
  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString()
    const keys = Object.keys(patch)
    await run(`UPDATE person_docs SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
      ...keys.map((k) => patch[k]), row.id)
  }
  res.json(await get(`SELECT ${LIST_COLUMNS} FROM person_docs WHERE id = ?`, row.id))
}))

docsRouter.delete('/:id', wrap(async (req, res) => {
  const row = await get('SELECT id, uploaded_by FROM person_docs WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Document not found' })
  if (req.user.role !== 'admin' && row.uploaded_by !== req.user.id)
    return res.status(403).json({ error: 'Only the uploader or an admin can delete this' })
  await run('DELETE FROM person_docs WHERE id = ?', row.id)
  res.json({ ok: true })
}))
