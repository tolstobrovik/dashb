import { Router } from 'express'
import { createHmac } from 'crypto'
import { all, get, run, batch, bumpPlan, CONTENT_TYPES, resyncStorage, mayLeaveStage, getTaskFields, publicUser, dayISO } from '../db.js'
import { bumpProjectOfCampaign } from '../pcmodel.js'
import { resolveGates, gatesUpTo, phasesOf, holderOf } from '../deadlines.js'
import { authRequired, canAccessDept, can, wrap, JWT_SECRET } from '../auth.js'
import { tgMirror, tgOriginFrom, tgEsc, tgDate } from '../telegram.js'

const router = Router()

// ---- downloading a document under its own name -----------------------------
// The browser refuses to name a saved file «ТЗ ролик.docx» when the name only
// comes from an <a download> attribute — non-ASCII is dropped and the brief
// lands as "download", with no extension for Windows to open it by. So the
// SERVER names it, in a Content-Disposition header, which means the browser
// has to reach the bytes by plain navigation — without an Authorization
// header. A ticket stands in for it: a signed, single-file, two-minute
// permission that any instance can verify without shared memory (Vercel runs
// each request wherever it likes).
const TICKET_LIFE = 120_000
// A readable Latin spelling of a Cyrillic name, for the plain `filename=`
// half of the header. Every current browser reads the UTF-8 half and saves
// «ТЗ ролик.docx» exactly; anything that can't at least gets "TZ rolik.docx"
// with its extension intact, instead of a nameless "download".
const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
}
const asciiName = (name) => {
  const out = [...String(name)].map((c) => {
    if (/[\x20-\x7e]/.test(c)) return /["\\]/.test(c) ? '' : c
    const low = c.toLowerCase()
    const t = CYR[low]
    if (t === undefined) return '_'
    return c === low ? t : t.charAt(0).toUpperCase() + t.slice(1)
  }).join('').trim()
  return (out.replace(/_+/g, '_') || 'document').slice(0, 100)
}
const sign = (id, exp) => createHmac('sha256', JWT_SECRET).update(`file:${id}:${exp}`).digest('hex').slice(0, 32)
const ticketFor = (id) => { const exp = Date.now() + TICKET_LIFE; return `/api/content/files/${id}/raw?e=${exp}&k=${sign(id, exp)}` }

// Registered BEFORE the guard below on purpose — the ticket is the credential.
router.get('/files/:fileId/raw', wrap(async (req, res) => {
  const { fileId } = req.params
  const exp = Number(req.query.e || 0)
  if (!(exp > Date.now()) || req.query.k !== sign(fileId, exp))
    return res.status(403).json({ error: 'That download link has expired — open the task again' })
  const doc = await get('SELECT * FROM attachments WHERE id = ?', fileId)
  if (!doc) return res.status(404).json({ error: 'Not found' })
  const body = Buffer.from(String(doc.data).split(',').pop(), 'base64')
  // Two spellings of the name: a readable Latin fallback, and the real one,
  // percent-encoded the way RFC 5987 asks.
  const ascii = asciiName(doc.name)
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream')
  res.setHeader('Content-Length', body.length)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`)
  res.end(body)
}))

router.use(authRequired)

const parse = (row) => row && {
  ...row,
  channels: JSON.parse(row.channels || '[]'),
  checklist: JSON.parse(row.checklist || '[]'),
  reference_links: parseLinks(row.reference_links),
  assignees: assigneesOf(row),
}

// Reference example links: a small array of plain URLs (stored as JSON text).
function parseLinks(v) {
  if (Array.isArray(v)) return v
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}
const cleanLinks = (v) => {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : []
  return [...new Set(arr.map((s) => String(s ?? '').trim()).filter(Boolean))].slice(0, 12).map((s) => s.slice(0, 500))
}

// Every assignee of a row (works on raw and parsed rows alike); the legacy
// assignee_id mirrors the first entry so old clients keep working.
function assigneesOf(row) {
  let a = row.assignees
  if (typeof a === 'string') { try { a = JSON.parse(a || '[]') } catch { a = [] } }
  if (Array.isArray(a) && a.length) return a.map(Number)
  return row.assignee_id ? [row.assignee_id] : []
}
const finalStatus = () => get('SELECT * FROM statuses WHERE is_final = 1 ORDER BY sort')

// Assignee lookup with one self-heal: the member may have been created
// seconds ago on another server instance, or this instance's copy may lag a
// few seconds — pull the freshest data once before declaring them missing.
async function userExists(id) {
  if (await get('SELECT 1 AS x FROM users WHERE id = ?', id)) return true
  await resyncStorage().catch(() => {})
  return !!(await get('SELECT 1 AS x FROM users WHERE id = ?', id))
}
const isFinal = async (statusId) => !!(await get('SELECT 1 AS x FROM statuses WHERE id = ? AND is_final = 1', statusId))
// The Deleted stage: killed content that stays on the record. It counts for
// the planner/operator (their work happened) but never for the editor, and it
// leaves the channel plan.
const isDead = async (statusId) =>
  !!(statusId && (await get("SELECT 1 AS x FROM statuses WHERE id = ? AND LOWER(label) = 'deleted'", statusId)))

// The crew move their work with one tick — "shot" for the operator, "edited"
// or "designed" for the maker — which lands the task on the matching pipeline
// stage (Shot / Ready) rather than letting them pick any stage freely.
async function milestoneStatusId(kind) {
  const rows = await all('SELECT id, label, sort FROM statuses ORDER BY sort, id')
  const find = (re) => rows.find((s) => re.test(s.label))
  if (kind === 'shot') return (find(/^shot$/i) || find(/\bshot\b/i))?.id ?? null
  // edited / designed both mean "the piece is ready"
  return (find(/^ready$/i) || find(/ready|final|approv|posted|got/i))?.id ?? null
}
// A ready-file link is a plain Google-Drive-style URL (or nothing).
const cleanLink = (v) => {
  const s = String(v ?? '').trim().slice(0, 1000)
  return s
}

// Publishing (Ready → Published) is the SMM's call: an admin, or someone with
// the review_publish right who is actually on one of the task's channels — you
// can't publish to a channel you don't belong to.
const canPublish = (user, row) => {
  if (user.role === 'admin') return true
  if (!can(user, 'review_publish')) return false
  return JSON.parse(row.channels || '[]').some((ch) => (user.departments || []).includes(ch))
}

// Where a Pravki sends the task back to: a re-shoot returns it to "To shoot",
// an editor or designer fix to "Editing" — the earlier making stage.
async function revisionStageId(target) {
  const rows = await all('SELECT id, label, sort FROM statuses ORDER BY sort, id')
  const find = (re) => rows.find((s) => re.test(s.label))
  if (target === 'operator') return (find(/^to shoot$/i) || find(/shoot/i) || find(/^shot$/i))?.id ?? null
  return (find(/^editing$/i) || find(/edit/i) || find(/^shot$/i))?.id ?? null
}

// A member touches a task when it sits on one of their channels (or is theirs).
const canTouch = (user, row) =>
  user.role === 'admin' ||
  assigneesOf(row).includes(user.id) ||
  row.operator_id === user.id ||
  row.editor_id === user.id ||
  row.designer_id === user.id ||
  JSON.parse(row.channels || '[]').some((ch) => (user.departments || []).includes(ch))

const cleanChannels = async (v) => {
  const arr = [...new Set((Array.isArray(v) ? v : []).map(String))]
  if (arr.length === 0) return []
  const existing = new Set((await all(
    `SELECT key FROM channels WHERE key IN (${arr.map(() => '?').join(',')})`, ...arr)).map((r) => r.key))
  return arr.filter((ch) => existing.has(ch))
}

// Lists never carry the full-size photo (they can be megabytes as data URLs
// and the pages poll every few seconds) — the task modal fetches the original
// via GET /:id.
// The THUMBNAIL is heavy too, and only one view draws it: the kanban board.
// A photo is already-compressed bytes, so base64 of it survives gzip intact —
// twenty photographed tasks put a third of a megabyte into every answer, on
// every page, on every poll. So the list carries a flag by default and the
// picture only where a picture is shown (?thumbs=1).
const listColumns = (withThumbs) => `id, title, channels, type, assignee_id, assignees, created_by, status_id, campaign_id,
  operator_id, editor_id, designer_id, reviewer_id, reviewers,
  shot_at, edited_at, edit_due_revised, review_due_revised,
  recording_date, recording_time, recording_end, edit_ready_date, design_ready_date, ready_at, ready_link,
  shot_link, design_link, reference_text, reference_links, format, rubrika, script, release_date, release_time, description,
  checklist, todo_sort, pinned, ${withThumbs ? 'photo_thumb,' : ''}
  CASE WHEN photo_thumb IS NULL THEN 0 ELSE 1 END AS has_thumb,
  (SELECT COUNT(*) FROM comments WHERE comments.content_id = content.id) AS comment_count,
  CASE WHEN photo IS NULL THEN 0 ELSE 1 END AS has_photo, done_at, created_at`
const LIST_COLUMNS = listColumns(true)

// ---- the paper trail --------------------------------------------------------
// One activity row per meaningful change — who, which field, from → to. People
// become names and stages become labels at write time, so the log still reads
// like a sentence after members leave, stages get renamed or the task is gone.
const actRow = (user, id, title, kind, field, oldV, newV, now) => [
  'INSERT INTO activity (content_id, content_title, user_id, user_name, kind, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  id, title, user.id, user.name || '', kind, field ?? null, oldV ?? null, newV ?? null, now,
]
const logEvent = (user, id, title, kind) =>
  run(...actRow(user, id, title, kind, null, null, null, new Date().toISOString()))

// Paragraph-sized fields land as a quiet "updated the …" — no quoting essays.
const QUIET_FIELDS = ['description', 'script', 'reference_text', 'reference_links', 'photo', 'checklist']
const PLAIN_FIELDS = ['title', 'type', 'recording_date', 'recording_time', 'recording_end', 'edit_ready_date',
  'design_ready_date', 'release_date', 'release_time', 'format', 'rubrika', 'ready_link', 'shot_link', 'design_link',
  // A re-promised deadline is the most disputable thing on the task: it is
  // always somebody moving their own goalposts after a late handover, so it
  // goes in the log by name.
  'edit_due_revised', 'review_due_revised']

// Everything a stage move can rewrite — the snapshot restores exactly these.
const UNDO_FIELDS = ['status_id', 'done_at', 'ready_at', 'shot_at', 'edited_at',
  'edit_due_revised', 'review_due_revised', 'operator_id', 'editor_id', 'reviewer_id',
  'reviewers', 'shot_link', 'ready_link']
// How long a move stays regrettable.
const UNDO_SECONDS = 10

async function logPatch(user, row, patch) {
  const rows = []
  const now = new Date().toISOString()
  const title = patch.title !== undefined ? patch.title : row.title
  const push = (field, oldV, newV) => rows.push(actRow(user, row.id, title, 'updated', field, oldV, newV, now))

  // People fields → names, resolved in one query.
  const ids = new Set()
  for (const f of ['operator_id', 'editor_id', 'designer_id', 'reviewer_id'])
    if (patch[f] !== undefined && patch[f] !== row[f]) { if (row[f]) ids.add(row[f]); if (patch[f]) ids.add(patch[f]) }
  let oldAss = null; let newAss = null
  if (patch.assignees !== undefined) {
    const o = assigneesOf(row); const n = JSON.parse(patch.assignees)
    if (JSON.stringify(o) !== JSON.stringify(n)) { oldAss = o; newAss = n; for (const id of [...o, ...n]) ids.add(id) }
  }
  const names = {}
  if (ids.size)
    for (const u of await all(`SELECT id, name FROM users WHERE id IN (${[...ids].map(() => '?').join(',')})`, ...ids))
      names[u.id] = u.name
  const nameOf = (id) => (id ? names[id] || `#${id}` : null)
  for (const f of ['operator_id', 'editor_id', 'designer_id', 'reviewer_id'])
    if (patch[f] !== undefined && patch[f] !== row[f]) push(f.replace('_id', ''), nameOf(row[f]), nameOf(patch[f]))
  if (oldAss) push('owners', oldAss.map(nameOf).join(', ') || null, newAss.map(nameOf).join(', ') || null)

  if (patch.status_id !== undefined && patch.status_id !== row.status_id) {
    const two = await all('SELECT id, label FROM statuses WHERE id IN (?, ?)', row.status_id ?? 0, patch.status_id ?? 0)
    const lab = (id) => two.find((s) => s.id === id)?.label || null
    push('stage', lab(row.status_id), lab(patch.status_id))
  } else if (patch.done_at !== undefined && !!patch.done_at !== !!row.done_at) {
    // Only when no stage move tells the story already ("→ Published" covers it).
    push('done', null, patch.done_at ? 'yes' : 'no')
  }
  if (patch.pinned !== undefined && !!patch.pinned !== !!row.pinned) push('pinned', null, patch.pinned ? 'yes' : 'no')

  if (patch.channels !== undefined) {
    const o = JSON.parse(row.channels || '[]').join(', '); const n = JSON.parse(patch.channels).join(', ')
    if (o !== n) push('platforms', o || null, n || null)
  }
  for (const f of PLAIN_FIELDS) {
    if (patch[f] === undefined) continue
    if (String(row[f] ?? '') !== String(patch[f] ?? '')) push(f, row[f] ?? null, patch[f] ?? null)
  }
  for (const f of QUIET_FIELDS) {
    if (patch[f] === undefined) continue
    if (String(patch[f] ?? '') !== String(row[f] ?? '')) push(/^reference/.test(f) ? 'reference' : f, null, null)
  }
  if (rows.length) await batch(rows)
}

// New work rings its people: one bell row + the Telegram cut per person,
// naming the hat they just got. Whoever did the assigning hears nothing.
async function notifyAssigned(req, contentId, title, roleById, extra = '') {
  const now = new Date().toISOString()
  const ids = [...roleById.keys()].filter((id) => id && id !== req.user.id)
  if (!ids.length) return
  await batch(ids.map((id) => [
    'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
    id, 'assigned', `You're on «${title}» as ${roleById.get(id)} — by ${req.user.name}`, contentId, now,
  ]))
  // Every hand-off leaves at once — nobody's message waits in line behind
  // another person's Telegram round-trip.
  await Promise.allSettled(ids.map((id) =>
    tgMirror([id], `📌 New work for you — you're the ${roleById.get(id)}\n<b>«${tgEsc(title)}»</b>${extra}\nFrom ${tgEsc(req.user.name)}. Have a look and plan it in 👇`, contentId, tgOriginFrom(req))))
}
// A person can wear two hats on one task — the message names both.
const addRole = (map, id, role) => {
  if (!id) return
  map.set(id, map.has(id) ? `${map.get(id)} & ${role}` : role)
}
// The date worth mentioning when handing someone work: the shoot if one is
// booked, otherwise the release.
const dateBit = (rec, rel) => (rec ? ` · shoot ${tgDate(rec)}` : rel ? ` · release ${tgDate(rel)}` : '')

const canSee = (user, row) =>
  user.role === 'admin' ||
  assigneesOf(row).includes(user.id) ||
  row.operator_id === user.id || // crew see their work even outside their departments
  row.editor_id === user.id ||
  row.designer_id === user.id ||
  row.channels.some((ch) => (user.departments || []).includes(ch))

// Every write answers with the same slim shape the list uses — callers swap
// the row into their lists, so the full photo must never ride along.
const listRow = async (id) => parse(await get(`SELECT ${LIST_COLUMNS} FROM content WHERE id = ?`, id))

// ---- shoot scheduling guard -------------------------------------------------
// Recordings are booked in hours (from–to). Before saving, the operator's day
// is checked: another shoot at the same time on ANY channel, or hours outside
// their working schedule, comes back as a 409 warning. Only an admin may push
// through it (force: true).
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const DEFAULT_SHOOT_MIN = 60 // a shoot with no end time blocks one hour

async function shootProblems({ operatorId, date, start, end, excludeId }) {
  if (!operatorId || !date || !start) return null
  const s = toMin(start)
  const e = end ? toMin(end) : s + DEFAULT_SHOOT_MIN
  const out = { conflicts: [], schedule: null }

  // Other shoots the same operator already has that day — across all channels.
  const rows = await all(
    'SELECT id, title, channels, recording_time, recording_end FROM content WHERE operator_id = ? AND recording_date = ? AND recording_time IS NOT NULL AND done_at IS NULL',
    operatorId, date)
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue
    const rs = toMin(r.recording_time)
    const re = r.recording_end ? toMin(r.recording_end) : rs + DEFAULT_SHOOT_MIN
    if (s < re && rs < e) {
      out.conflicts.push({
        id: r.id, title: r.title, channels: JSON.parse(r.channels || '[]'),
        from: r.recording_time, to: r.recording_end || null,
      })
    }
  }

  // Their working schedule (if one is set on the account).
  const op = await get('SELECT name, work_start, work_end, work_days FROM users WHERE id = ?', operatorId)
  if (op) {
    let days = null
    try { days = JSON.parse(op.work_days || 'null') } catch { /* unset */ }
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
    if (Array.isArray(days) && days.length > 0 && !days.includes(weekday))
      out.schedule = `${op.name} doesn’t work that day`
    else if (op.work_start && op.work_end && (s < toMin(op.work_start) || e > toMin(op.work_end)))
      out.schedule = `Outside ${op.name}’s working hours (${op.work_start}–${op.work_end})`
  }

  return out.conflicts.length || out.schedule ? out : null
}

// Answers a 409 unless the caller is an admin pushing through on purpose.
async function guardShoot(req, res, { operatorId, date, start, end, excludeId }) {
  const problems = await shootProblems({ operatorId, date, start, end, excludeId })
  if (!problems) return false
  if (req.body?.force === true && req.user.role === 'admin') return false
  res.status(409).json({
    error: problems.schedule || 'That operator is already booked at this time',
    conflicts: problems.conflicts,
    schedule_issue: problems.schedule,
    can_force: req.user.role === 'admin',
  })
  return true
}

router.get('/', wrap(async (req, res) => {
  const { department, mine, thumbs } = req.query
  let rows = (await all(`SELECT ${listColumns(thumbs === '1')} FROM content ORDER BY pinned DESC, todo_sort, created_at DESC`)).map(parse)
  if (req.user.role !== 'admin') rows = rows.filter((c) => canSee(req.user, c))
  if (department) rows = rows.filter((c) => c.channels.includes(department))
  if (mine === 'true') rows = rows.filter((c) => c.assignee_id === req.user.id)
  res.json(rows)
}))

// The Pravki (revision requests) waiting on ME — the open ones on tasks where
// I hold the stage they were sent back to. Powers the crew's "Pravki" lane.
router.get('/revisions/mine', wrap(async (req, res) => {
  // Pravki on a task that was later killed (Deleted stage) die with it — the
  // fix is nobody's job anymore.
  const rows = await all(`
    SELECT r.id, r.content_id, r.round, r.requested_by, r.requested_name, r.target, r.note, r.created_at,
      c.title, c.channels, c.type, c.reference_text, c.reference_links,
      c.shot_link, c.ready_link, c.design_link,
      c.format, c.rubrika, c.script,
      c.operator_id, c.editor_id, c.designer_id,
      c.recording_date, c.edit_ready_date, c.design_ready_date, c.release_date,
      CASE WHEN c.photo IS NULL THEN 0 ELSE 1 END AS has_photo
    FROM revisions r JOIN content c ON c.id = r.content_id
    WHERE r.resolved_at IS NULL
      AND c.status_id NOT IN (SELECT id FROM statuses WHERE LOWER(label) = 'deleted')
    ORDER BY r.created_at DESC`)
  const mine = rows.filter((r) =>
    (r.target === 'operator' && r.operator_id === req.user.id) ||
    (r.target === 'editor' && r.editor_id === req.user.id) ||
    (r.target === 'designer' && r.designer_id === req.user.id))
  // The task's earlier rounds ride along, so the fixer sees the whole
  // conversation ("round 1 asked for X, round 2 now asks for Y") in place.
  const ids = [...new Set(mine.map((r) => r.content_id))]
  const history = ids.length ? await all(`
    SELECT content_id, round, note, requested_name, target, resolved_at, created_at
    FROM revisions WHERE content_id IN (${ids.map(() => '?').join(',')}) ORDER BY round, id`, ...ids) : []
  res.json(mine.map((r) => ({
    ...r,
    channels: JSON.parse(r.channels || '[]'),
    reference_links: parseLinks(r.reference_links),
    history: history.filter((h) => h.content_id === r.content_id),
  })))
}))

// Every OPEN Pravki across the team — the admin's view of who owes changes.
// Powers the "N pravki" chips on Post Production.
router.get('/open-revisions', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const rows = await all(`
    SELECT r.id, r.content_id, r.target, r.note, r.created_at,
      c.title, c.operator_id, c.editor_id, c.designer_id
    FROM revisions r JOIN content c ON c.id = r.content_id
    WHERE r.resolved_at IS NULL
      AND c.status_id NOT IN (SELECT id FROM statuses WHERE LOWER(label) = 'deleted')
    ORDER BY r.created_at DESC`)
  res.json(rows.map((r) => ({
    id: r.id, content_id: r.content_id, target: r.target, note: r.note, created_at: r.created_at, title: r.title,
    person_id: r.target === 'operator' ? r.operator_id : r.target === 'designer' ? r.designer_id : r.editor_id,
  })))
}))

// The whole team's paper trail, newest first — the admin's History tab.
router.get('/activity/all', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  res.json(await all(
    'SELECT id, content_id, content_title, user_id, user_name, kind, field, old_value, new_value, created_at FROM activity ORDER BY id DESC LIMIT 150'))
}))

// ---- documents on a task: the ТЗ in Word, the reference deck as PDF -------
// Anyone who can SEE the task can read and add its paperwork — the crew
// included, since they are usually the ones who need the brief. Removing a
// document is for the person who put it there (or an admin).
const DOC_MAX = 4 * 1024 * 1024 // 4 MB of real file — every byte is stored, synced and paid for
const DOC_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  rtf: 'application/rtf',
  csv: 'text/csv',
}
const DOC_COLUMNS = 'id, content_id, name, mime, size, uploaded_by, uploader, created_at'
const extOf = (name) => String(name || '').split('.').pop().toLowerCase()

// The task a document hangs on, or null when the caller may not see it.
const parentOf = async (user, contentId) => {
  const row = parse(await get('SELECT * FROM content WHERE id = ?', contentId))
  return row && canSee(user, row) ? row : null
}

router.get('/:id/files', wrap(async (req, res) => {
  if (!(await parentOf(req.user, req.params.id))) return res.status(404).json({ error: 'Not found' })
  res.json(await all(`SELECT ${DOC_COLUMNS} FROM attachments WHERE content_id = ? ORDER BY id`, req.params.id))
}))

router.post('/:id/files', wrap(async (req, res) => {
  const row = await parentOf(req.user, req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const name = String(req.body?.name || '').trim().slice(0, 200)
  const data = String(req.body?.data || '')
  if (!name) return res.status(400).json({ error: 'The document needs a name' })
  const ext = extOf(name)
  if (!DOC_TYPES[ext])
    return res.status(400).json({ error: `.${ext || '?'} isn’t a document — attach a PDF, Word, Excel, PowerPoint or text file` })
  const b64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data
  if (!b64) return res.status(400).json({ error: 'That file came through empty' })
  const size = Math.floor(b64.replace(/=+$/, '').length * 3 / 4)
  if (size > DOC_MAX)
    return res.status(413).json({ error: `“${name}” is ${(size / 1048576).toFixed(1)} MB — documents are capped at 4 MB` })
  const mime = DOC_TYPES[ext]
  const now = new Date().toISOString()
  const info = await run(
    `INSERT INTO attachments (content_id, name, mime, size, data, uploaded_by, uploader, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, name, mime, size, `data:${mime};base64,${b64}`, req.user.id, req.user.name || '', now)
  await run(...actRow(req.user, row.id, row.title, 'updated', 'document', null, name, now))
  res.status(201).json(await get(`SELECT ${DOC_COLUMNS} FROM attachments WHERE id = ?`, info.lastInsertRowid))
}))

// Permission to fetch one document, for the next two minutes. This is the
// route that checks WHO is asking; /raw above only checks the ticket.
router.get('/files/:fileId', wrap(async (req, res) => {
  const doc = await get(`SELECT ${DOC_COLUMNS} FROM attachments WHERE id = ?`, req.params.fileId)
  if (!doc || !(await parentOf(req.user, doc.content_id))) return res.status(404).json({ error: 'Not found' })
  res.json({ ...doc, url: ticketFor(doc.id) })
}))

router.delete('/files/:fileId', wrap(async (req, res) => {
  const doc = await get(`SELECT ${DOC_COLUMNS} FROM attachments WHERE id = ?`, req.params.fileId)
  if (!doc) return res.status(404).json({ error: 'Not found' })
  const row = await parentOf(req.user, doc.content_id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (req.user.role !== 'admin' && doc.uploaded_by !== req.user.id)
    return res.status(403).json({ error: 'Only the person who attached this (or an admin) can remove it' })
  await run('DELETE FROM attachments WHERE id = ?', doc.id)
  await run(...actRow(req.user, row.id, row.title, 'updated', 'document', doc.name, null, new Date().toISOString()))
  res.json({ ok: true })
}))

// One task in full — including the original photo, its revision history,
// the comment thread and its paper trail.
router.get('/:id', wrap(async (req, res) => {
  const row = parse(await get('SELECT * FROM content WHERE id = ?', req.params.id))
  if (!row || !canSee(req.user, row)) return res.status(404).json({ error: 'Not found' })
  const revisions = await all(
    'SELECT id, round, requested_by, requested_name, target, note, created_at, resolved_at FROM revisions WHERE content_id = ? ORDER BY round, id',
    row.id)
  const comments = await all(
    'SELECT id, user_id, author, text, created_at FROM comments WHERE content_id = ? ORDER BY id',
    row.id)
  const activity = await all(
    'SELECT id, user_id, user_name, kind, field, old_value, new_value, created_at FROM activity WHERE content_id = ? ORDER BY id DESC LIMIT 80',
    row.id)
  // Names and sizes only — the bytes come one document at a time, on a click.
  const documents = await all(`SELECT ${DOC_COLUMNS} FROM attachments WHERE content_id = ? ORDER BY id`, row.id)
  // The three accountable phases, derived fresh — the modal shows who owes
  // what, by when, and whether the clock has already run out on them.
  res.json({ ...row, revisions, comments, activity, documents, phases: phasesOf(row), has_photo: row.photo ? 1 : 0 })
}))

// One line into the task's thread. Anyone who can SEE the task may speak —
// the crew included; that is the point. Everyone else on the task (and
// anyone who spoke before) hears it through the bell.
router.post('/:id/comments', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const parsed = { ...row, channels: JSON.parse(row.channels || '[]') }
  if (!canSee(req.user, parsed)) return res.status(404).json({ error: 'Not found' })
  const text = String(req.body?.text ?? '').trim().slice(0, 2000)
  if (!text) return res.status(400).json({ error: 'Write something first' })
  const now = new Date().toISOString()
  const info = await run('INSERT INTO comments (content_id, user_id, author, text, created_at) VALUES (?, ?, ?, ?, ?)',
    row.id, req.user.id, req.user.name || '', text, now)
  let assignees = []
  try { assignees = JSON.parse(row.assignees || '[]') } catch { assignees = [] }
  const spoke = (await all('SELECT DISTINCT user_id FROM comments WHERE content_id = ?', row.id)).map((r) => r.user_id)
  const people = [...new Set([...assignees, row.assignee_id, row.operator_id, row.editor_id, row.designer_id, ...spoke]
    .filter((id) => id && id !== req.user.id))]
  if (people.length) {
    const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text
    const line = `${req.user.name} on «${row.title}»: ${preview}`
    await batch(people.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, 'comment', line, row.id, now,
    ]))
    // Telegram gets the roomier cut: who spoke, on what, the words, the link.
    await tgMirror(people, `💬 ${tgEsc(req.user.name)} wrote on <b>«${tgEsc(row.title)}»</b>\n“${tgEsc(preview)}”\nAnswer where the task lives 👇`, row.id, tgOriginFrom(req))
  }
  res.status(201).json(await get('SELECT id, user_id, author, text, created_at FROM comments WHERE id = ?', info.lastInsertRowid))
}))

// Times come from <input type="time"> as HH:MM — anything else becomes null.
const cleanTime = (v) => (v && /^\d{2}:\d{2}/.test(String(v)) ? String(v).slice(0, 5) : null)

// The briefing fields the admin can demand (Admin → Pipeline → The task
// form). A required field blocks creating a task of a scoped type without
// it — and blocks clearing it later.
const FIELD_LABELS = { format: 'Format', rubrika: 'Rubrika', script: 'Script', reference: 'Reference', description: 'Description' }
const requiredMissing = (rules, type, values) => {
  for (const k of Object.keys(FIELD_LABELS)) {
    const r = rules[k]
    if (r?.state === 'required' && r.types.includes(type) && !values[k]) return FIELD_LABELS[k]
  }
  return null
}
const cleanShort = (v) => (v ? String(v).trim().slice(0, 120) : null) || null
const cleanScript = (v) => (v ? String(v).trim().slice(0, 20000) : null) || null

router.post('/', wrap(async (req, res) => {
  const {
    title, type = 'post', status_id = null,
    recording_date = null, edit_ready_date = null, design_ready_date = null, release_date = null,
    description = '', photo = null, photo_thumb = null, checklist = [], reference_text = null,
  } = req.body || {}
  const referenceLinks = cleanLinks(req.body?.reference_links)
  const recording_time = cleanTime(req.body?.recording_time)
  const recording_end = cleanTime(req.body?.recording_end)
  const release_time = cleanTime(req.body?.release_time)
  if (recording_time && recording_end && recording_end <= recording_time)
    return res.status(400).json({ error: 'The shoot ends before it starts' })
  const channels = await cleanChannels(req.body?.channels ?? (req.body?.channel ? [req.body.channel] : []))
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Give the task a title' })
  if (channels.length === 0) return res.status(400).json({ error: 'Pick at least one platform' })
  if (!channels.every((ch) => canAccessDept(req.user, ch))) return res.status(403).json({ error: 'Not your channel' })
  if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to add tasks' })
  const safeType = CONTENT_TYPES.includes(type) ? type : 'post'

  // The brief: format / rubrika / script, plus the required-field gate the
  // admin configured for this content type.
  const format = cleanShort(req.body?.format)
  const rubrika = cleanShort(req.body?.rubrika)
  const script = cleanScript(req.body?.script)
  const fieldRules = await getTaskFields()
  const missing = requiredMissing(fieldRules, safeType, {
    format, rubrika, script,
    reference: !!(reference_text || referenceLinks.length > 0 || photo),
    description: !!(description && String(description).trim()),
  })
  if (missing) return res.status(400).json({ error: `«${missing}» is required for this type of task` })

  // Admins may assign the task to any number of people (or leave it
  // unassigned for the whole channel); everyone else creates for themselves.
  // assignee_ids is the multi-select; a lone assignee_id still works.
  let assigneeList = [req.user.id]
  const rawIds = req.body?.assignee_ids !== undefined
    ? req.body.assignee_ids
    : req.body?.assignee_id !== undefined
      ? (req.body.assignee_id === null || req.body.assignee_id === '' ? [] : [req.body.assignee_id])
      : undefined
  if (rawIds !== undefined) {
    const ids = [...new Set((Array.isArray(rawIds) ? rawIds : [rawIds]).map(Number).filter(Boolean))]
    if ((ids.length !== 1 || ids[0] !== req.user.id) && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Only admins can assign tasks to others' })
    for (const id of ids) {
      if (!(await userExists(id)))
        return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
    }
    assigneeList = ids
  }
  const assignee = assigneeList[0] ?? null

  // Optional campaign chip: one dropdown that lets campaign progress follow
  // the kanban instead of someone typing a percentage.
  let campaignId = null
  if (req.body?.campaign_id != null && req.body.campaign_id !== '') {
    campaignId = Number(req.body.campaign_id)
    if (!(await get('SELECT 1 AS x FROM campaigns WHERE id = ?', campaignId)))
      return res.status(400).json({ error: 'Campaign not found' })
  }

  // The crew hats: who shoots it and who cuts it (videos), who designs it
  // (posts), and who signs it off — all real team members.
  const crew = { operator_id: null, editor_id: null, designer_id: null, reviewer_id: null }
  for (const f of ['operator_id', 'editor_id', 'designer_id', 'reviewer_id']) {
    if (req.body?.[f] != null && req.body[f] !== '') {
      crew[f] = Number(req.body[f])
      if (!(await userExists(crew[f])))
        return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
    }
  }

  // Review can be shared from the start; a lone reviewer_id becomes a list of
  // one, so nothing downstream has to care which way it was given.
  const reviewerList = [...new Set((Array.isArray(req.body?.reviewer_ids) ? req.body.reviewer_ids : [])
    .map(Number).filter(Boolean))]
  for (const id of reviewerList) {
    if (!(await userExists(id)))
      return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
  }
  if (reviewerList.length) crew.reviewer_id = reviewerList[0]
  else if (crew.reviewer_id) reviewerList.push(crew.reviewer_id)

  // Double-booking / working-hours guard — warns before the shoot is saved.
  if (await guardShoot(req, res, {
    operatorId: crew.operator_id, date: recording_date || null,
    start: recording_time, end: recording_end,
  })) return

  const status = status_id || (await get('SELECT id FROM statuses ORDER BY sort, id'))?.id || null
  const maxSort = (await get('SELECT COALESCE(MAX(todo_sort), -1) AS m FROM content')).m
  const info = await run(`
    INSERT INTO content (title, channels, type, assignee_id, assignees, created_by, status_id, campaign_id, operator_id, editor_id, designer_id, reviewer_id, reviewers,
      recording_date, recording_time, recording_end, edit_ready_date, design_ready_date, release_date, release_time, description, ready_link,
      shot_link, design_link, reference_text, reference_links, format, rubrika, script, photo, photo_thumb, checklist, todo_sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    String(title).trim(), JSON.stringify(channels), safeType, assignee, JSON.stringify(assigneeList), req.user.id, status, campaignId,
    crew.operator_id, crew.editor_id, crew.designer_id, crew.reviewer_id, JSON.stringify(reviewerList),
    recording_date || null, recording_time, recording_end, edit_ready_date || null, design_ready_date || null, release_date || null, release_time,
    description, cleanLink(req.body?.ready_link) || null,
    cleanLink(req.body?.shot_link) || null, cleanLink(req.body?.design_link) || null,
    reference_text ? String(reference_text).slice(0, 4000) : null, JSON.stringify(referenceLinks),
    format, rubrika, script,
    photo || null, photo_thumb || null, JSON.stringify(Array.isArray(checklist) ? checklist : []),
    maxSort + 1, new Date().toISOString(),
  )
  if (campaignId) await bumpProjectOfCampaign(campaignId)
  await logEvent(req.user, info.lastInsertRowid, String(title).trim(), 'created')
  // Everyone handed a hat on the fresh task learns about it right away.
  const roles = new Map()
  for (const id of assigneeList) addRole(roles, id, 'owner')
  addRole(roles, crew.operator_id, 'operator')
  addRole(roles, crew.editor_id, 'editor')
  addRole(roles, crew.designer_id, 'designer')
  addRole(roles, crew.reviewer_id, 'reviewer')
  await notifyAssigned(req, info.lastInsertRowid, String(title).trim(), roles, dateBit(recording_date, release_date))
  // A new task raises each channel's plan: 15/16 → 15/17.
  for (const ch of channels) await bumpPlan(ch, safeType, { target: +1 }, true)
  res.status(201).json(await listRow(info.lastInsertRowid))
}))

// Reorder the to-do list (drag): ids in display order.
router.post('/todo-reorder', wrap(async (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' })
  const rows = await all(`SELECT * FROM content WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ordered = ids.map((id) => byId.get(Number(id))).filter((r) => r && canTouch(req.user, r))
  await batch(ordered.map((r, i) => ['UPDATE content SET todo_sort = ? WHERE id = ?', i, r.id]))
  res.json({ ok: true })
}))

// Request changes (Pravki): the SMM reviews a Ready task and sends it back to
// the crew with one note. Records a revision round and returns the stage to
// the correct earlier stage (To shoot for a re-shoot, Editing for a cut/design
// fix). One block of text, submitted once.
router.post('/:id/revisions', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })
  const onChannel = req.user.role === 'admin' ||
    JSON.parse(row.channels || '[]').some((ch) => (req.user.departments || []).includes(ch))
  if (!can(req.user, 'request_changes') || !onChannel)
    return res.status(403).json({ error: 'Only the channel’s reviewer can request changes' })
  const note = String(req.body?.note ?? '').trim().slice(0, 4000)
  if (!note) return res.status(400).json({ error: 'Write what needs changing' })
  // Who fixes it: the picked stage, defaulting to whoever holds a hat.
  let target = ['operator', 'editor', 'designer'].includes(req.body?.target) ? req.body.target : null
  if (!target) target = row.editor_id ? 'editor' : row.designer_id ? 'designer' : row.operator_id ? 'operator' : 'editor'
  const round = (await get('SELECT COALESCE(MAX(round), 0) AS m FROM revisions WHERE content_id = ?', row.id)).m + 1
  await run(`
    INSERT INTO revisions (content_id, round, requested_by, requested_name, target, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, row.id, round, req.user.id, req.user.name || '', target, note, new Date().toISOString())
  // Send the stage back — leaving the final stage undoes done_at and its plan.
  const sid = await revisionStageId(target)
  if (sid && sid !== row.status_id) {
    await run('UPDATE content SET status_id = ?, done_at = NULL WHERE id = ?', sid, row.id)
    if (row.done_at) for (const ch of JSON.parse(row.channels || '[]')) await bumpPlan(ch, row.type, { current: -1 })
    await logPatch(req.user, row, { status_id: sid })
  }
  await run(...actRow(req.user, row.id, row.title, 'updated', 'pravki', null, target, new Date().toISOString()))
  // The person who owes the fix hears the actual note — in the bell and in
  // Telegram — not just a stage move.
  const fixerId = row[`${target}_id`]
  if (fixerId && fixerId !== req.user.id) {
    const preview = note.length > 120 ? `${note.slice(0, 120)}…` : note
    await run('INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      fixerId, 'pravki', `Pravki from ${req.user.name} on «${row.title}»: ${preview}`, row.id, new Date().toISOString())
    await tgMirror([fixerId], `🔧 One more pass on <b>«${tgEsc(row.title)}»</b> (round ${round})\n${tgEsc(req.user.name)} asks: “${tgEsc(preview)}”\nIt's back with you — fix it and tick “Fixed” 👇`, row.id, tgOriginFrom(req))
  }
  res.status(201).json(await listRow(row.id))
}))

// "Fixed": the crew member who owns the stage delivers the fix (optionally with
// a fresh file link), which closes the revision and returns the task to Ready
// for the SMM to review again.
router.post('/revisions/:rid/resolve', wrap(async (req, res) => {
  const rev = await get('SELECT * FROM revisions WHERE id = ?', req.params.rid)
  if (!rev) return res.status(404).json({ error: 'Not found' })
  const row = await get('SELECT * FROM content WHERE id = ?', rev.content_id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const hatHolder =
    (rev.target === 'operator' && row.operator_id === req.user.id) ||
    (rev.target === 'editor' && row.editor_id === req.user.id) ||
    (rev.target === 'designer' && row.designer_id === req.user.id)
  if (!hatHolder && req.user.role !== 'admin' && !(can(req.user, 'deliver_work') && canTouch(req.user, row)))
    return res.status(403).json({ error: 'This isn’t your fix to deliver' })
  const patch = {}
  if (req.body?.link !== undefined) {
    const link = cleanLink(req.body.link)
    if (link && !/^https?:\/\//i.test(link))
      return res.status(400).json({ error: 'The link should be a full https://… URL' })
    patch[{ operator: 'shot_link', editor: 'ready_link', designer: 'design_link' }[rev.target]] = link || null
  }
  if (!rev.resolved_at) await run('UPDATE revisions SET resolved_at = ? WHERE id = ?', new Date().toISOString(), rev.id)
  const readyId = await milestoneStatusId('ready')
  if (readyId) patch.status_id = readyId
  const keys = Object.keys(patch)
  if (keys.length) {
    await run(`UPDATE content SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k]), row.id)
    await logPatch(req.user, row, patch)
  }
  res.json({ ok: true, task: await listRow(row.id) })
}))

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })

  const body = req.body || {}
  const isAssignee = assigneesOf(row).includes(req.user.id)
  // The task's crew move it through the pipeline themselves — filming,
  // editing and designing ARE stage changes — even with no granular rights.
  const isCrew = row.operator_id === req.user.id || row.editor_id === req.user.id || row.designer_id === req.user.id
  const oldChannels = JSON.parse(row.channels || '[]')
  const patch = {}

  // Who holds which hat on this task — the milestone tick each may mark.
  const isOperator = row.operator_id === req.user.id
  const isEditor = row.editor_id === req.user.id
  const isDesigner = row.designer_id === req.user.id
  const canOverride = can(req.user, 'move_tasks')

  // The crew move their own work with a single tick — not a free stage picker.
  // "shot" (operator) lands it on Shot; "edited"/"designed" (editor/designer)
  // land it on Ready. Anyone with move_tasks may also tick on their behalf.
  if (body.milestone) {
    const m = body.milestone
    if (m === 'shot' && (isOperator || canOverride)) {
      const sid = await milestoneStatusId('shot')
      if (sid) patch.status_id = sid
    } else if ((m === 'edited' || m === 'designed') && (isEditor || isDesigner || canOverride)) {
      const sid = await milestoneStatusId('ready')
      if (sid) patch.status_id = sid
    } else {
      return res.status(403).json({ error: 'That isn’t your milestone to mark' })
    }
  }

  // Setting the stage directly still needs move_tasks — the crew no longer get
  // a free hand here; their ticks above are the sanctioned path. The one
  // exception is the reviewer publishing: review_publish alone unlocks the
  // Ready → Published move even without move_tasks.
  if (body.status_id !== undefined && body.status_id !== row.status_id) {
    const intoFinal = await isFinal(body.status_id)
    if (!canOverride && !(intoFinal && canPublish(req.user, row)))
      return res.status(403).json({ error: 'You can see the stage but can’t move it — use your Shot / Edited tick, or ask an admin' })
    patch.status_id = body.status_id
  }

  // The finished-file link: the crew (or an editor of the task) drops in a
  // Google-Drive URL; admins with manage_content may set it too.
  if (body.ready_link !== undefined) {
    if (!isCrew && !can(req.user, 'manage_content'))
      return res.status(403).json({ error: 'You can’t set the ready link on this task' })
    const link = cleanLink(body.ready_link)
    if (link && !/^https?:\/\//i.test(link))
      return res.status(400).json({ error: 'The ready link should be a URL — paste the full https://… address' })
    patch.ready_link = link || null
  }

  // Per-stage delivery links: the operator drops raw footage (shot_link) and
  // the designer the artwork (design_link) — the editor's finished cut is the
  // existing ready_link ("Edit ready"), handled above. Each is owned by the
  // person who holds that hat (or manage_content) and never overwrites another.
  for (const { field, hat } of [
    { field: 'shot_link', hat: isOperator },
    { field: 'design_link', hat: isDesigner },
  ]) {
    if (body[field] === undefined) continue
    if (!hat && !can(req.user, 'manage_content') && !can(req.user, 'deliver_work'))
      return res.status(403).json({ error: 'You can’t set that delivery link' })
    const link = cleanLink(body[field])
    if (link && !/^https?:\/\//i.test(link))
      return res.status(400).json({ error: 'A delivery link should be a URL — paste the full https://… address' })
    patch[field] = link || null
  }

  // The Reference block (style / mood / format text and example URLs) — part
  // of the brief, so editing it needs manage_content. Crew see it, never set it.
  if (body.reference_text !== undefined) {
    if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    patch.reference_text = body.reference_text ? String(body.reference_text).slice(0, 4000) : null
  }
  if (body.reference_links !== undefined) {
    if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    patch.reference_links = JSON.stringify(cleanLinks(body.reference_links))
  }

  // The brief fields (format / rubrika / script) — manage_content, like the
  // Reference. Clearing one the admin made required for this type is refused.
  if (['format', 'rubrika', 'script'].some((f) => body[f] !== undefined)) {
    if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    const fieldRules = await getTaskFields()
    const nextType = body.type !== undefined && CONTENT_TYPES.includes(body.type) ? body.type : row.type
    for (const f of ['format', 'rubrika', 'script']) {
      if (body[f] === undefined) continue
      const v = f === 'script' ? cleanScript(body[f]) : cleanShort(body[f])
      const r = fieldRules[f]
      if (!v && row[f] && r?.state === 'required' && r.types.includes(nextType))
        return res.status(400).json({ error: `«${FIELD_LABELS[f]}» is required for this type of task — it can’t be cleared` })
      patch[f] = v
    }
  }

  // Editing details needs manage_content.
  const detailFields = ['title', 'type', 'recording_time', 'recording_end', 'release_time', 'description', 'photo', 'photo_thumb']
  const wantsDetails = detailFields.some((f) => body[f] !== undefined) || body.channels !== undefined
  if (wantsDetails && !can(req.user, 'manage_content'))
    return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
  for (const f of detailFields) if (body[f] !== undefined) patch[f] = body[f]
  if (patch.type !== undefined && !CONTENT_TYPES.includes(patch.type)) patch.type = 'post'
  for (const f of ['recording_time', 'recording_end', 'release_time'])
    if (patch[f] !== undefined) patch[f] = cleanTime(patch[f])

  if (body.channels !== undefined) {
    const next = await cleanChannels(body.channels)
    if (next.length === 0) return res.status(400).json({ error: 'Pick at least one platform' })
    if (!next.every((ch) => canAccessDept(req.user, ch))) return res.status(403).json({ error: 'Not your channel' })
    patch.channels = JSON.stringify(next)
  }

  // Calendar drags send only a date → allowed with move_tasks too. The two
  // revised dates are the re-promise made when a handover lands late; they
  // ride the same right, because the person making the promise is the person
  // moving the card.
  for (const f of ['recording_date', 'edit_ready_date', 'design_ready_date', 'release_date',
    'edit_due_revised', 'review_due_revised']) {
    if (body[f] !== undefined) {
      if (!can(req.user, 'manage_content') && !can(req.user, 'move_tasks'))
        return res.status(403).json({ error: 'You don’t have permission to move dates' })
      patch[f] = body[f] || null
    }
  }

  // Assignees may always tick their own checklist.
  if (body.checklist !== undefined) {
    if (!can(req.user, 'manage_content') && !isAssignee)
      return res.status(403).json({ error: 'Only the assignee can edit this checklist' })
    patch.checklist = JSON.stringify(Array.isArray(body.checklist) ? body.checklist : [])
  }

  // Crew hats (operator / editor / designer) — an editing right, linked to
  // real members.
  for (const f of ['operator_id', 'editor_id', 'designer_id', 'reviewer_id']) {
    if (body[f] !== undefined) {
      if (!can(req.user, 'manage_content'))
        return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
      const next = body[f] == null || body[f] === '' ? null : Number(body[f])
      if (next !== null && !(await userExists(next)))
        return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
      patch[f] = next
      // Setting the single reviewer replaces the whole list — the two must
      // never disagree about who is on the hook.
      if (f === 'reviewer_id') patch.reviewers = JSON.stringify(next ? [next] : [])
    }
  }

  // Review can be shared: the list is the truth, reviewer_id mirrors its head
  // so everything that reads one name keeps working.
  if (body.reviewer_ids !== undefined) {
    if (!can(req.user, 'manage_content'))
      return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    const list = [...new Set((Array.isArray(body.reviewer_ids) ? body.reviewer_ids : [])
      .map(Number).filter(Boolean))]
    for (const id of list) {
      if (!(await userExists(id)))
        return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
    }
    patch.reviewers = JSON.stringify(list)
    patch.reviewer_id = list[0] ?? null
  }

  // Retag to another campaign (or none) — an editing right.
  if (body.campaign_id !== undefined) {
    if (!can(req.user, 'manage_content'))
      return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    const nextCamp = body.campaign_id == null || body.campaign_id === '' ? null : Number(body.campaign_id)
    if (nextCamp !== null && !(await get('SELECT 1 AS x FROM campaigns WHERE id = ?', nextCamp)))
      return res.status(400).json({ error: 'Campaign not found' })
    patch.campaign_id = nextCamp
  }

  // Pinning to the top of the to-do lists — same right as completing.
  if (body.pinned !== undefined) {
    if (!isAssignee && !can(req.user, 'move_tasks'))
      return res.status(403).json({ error: 'You don’t have permission to pin this' })
    patch.pinned = body.pinned ? 1 : 0
  }

  // Reassigning — admins only. assignee_ids is the multi-select; a lone
  // assignee_id still works for older clients.
  const reassign = body.assignee_ids !== undefined
    ? (Array.isArray(body.assignee_ids) ? body.assignee_ids : [body.assignee_ids])
    : body.assignee_id !== undefined && Number(body.assignee_id) !== row.assignee_id
      ? (body.assignee_id === null || body.assignee_id === '' ? [] : [body.assignee_id])
      : undefined
  if (reassign !== undefined) {
    const ids = [...new Set(reassign.map(Number).filter(Boolean))]
    const same = JSON.stringify(ids) === JSON.stringify(assigneesOf(row))
    if (!same) {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can reassign tasks' })
      for (const id of ids) {
        if (!(await userExists(id)))
          return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
      }
      patch.assignee_id = ids[0] ?? null
      patch.assignees = JSON.stringify(ids)
    }
  }

  // done: true/false — the to-do checkbox / final stage. The crew do NOT
  // publish; their reach ends at their Shot / Edited tick, so completing is
  // left to the assignee or someone with move_tasks.
  if (body.done !== undefined) {
    if (!isAssignee && !can(req.user, 'move_tasks'))
      return res.status(403).json({ error: 'You don’t have permission to complete this' })
    const fin = await finalStatus()
    if (body.done) {
      if (fin) patch.status_id = fin.id
      patch.done_at = row.done_at || new Date().toISOString()
    } else {
      patch.done_at = null
      if (fin && (patch.status_id ?? row.status_id) === fin.id) {
        // Un-completing steps back to the last working stage — never to the
        // Deleted graveyard, even though it sorts after Published.
        const nonFinal = await all('SELECT id, label FROM statuses WHERE is_final = 0 ORDER BY sort, id')
        const lastNonFinal = nonFinal.filter((s) => !/^deleted$/i.test(s.label)).at(-1)
        if (lastNonFinal) patch.status_id = lastNonFinal.id
      }
    }
  }

  if (Object.keys(patch).length === 0) return res.json(await listRow(row.id))

  // Rescheduling the shoot (who, when, from, to) re-checks the operator's day.
  if (['operator_id', 'recording_date', 'recording_time', 'recording_end'].some((f) => patch[f] !== undefined)) {
    const nx = (f) => (patch[f] !== undefined ? patch[f] : row[f])
    if (nx('recording_time') && nx('recording_end') && nx('recording_end') <= nx('recording_time'))
      return res.status(400).json({ error: 'The shoot ends before it starts' })
    if (await guardShoot(req, res, {
      operatorId: nx('operator_id'), date: nx('recording_date'),
      start: nx('recording_time'), end: nx('recording_end'), excludeId: row.id,
    })) return
  }

  // Derive done_at from status moves into/out of the final stage.
  const nextStatus = patch.status_id ?? row.status_id
  if (patch.done_at === undefined) {
    if ((await isFinal(nextStatus)) && !row.done_at) patch.done_at = new Date().toISOString()
    if (!(await isFinal(nextStatus)) && row.done_at) patch.done_at = null
  }

  // Publishing is the reviewer's call: moving a task into the final Published
  // stage — whether by the stage picker or the done tick — needs review_publish
  // and being on the channel. The crew's milestone lands on Ready, never final,
  // so they never trip this.
  if ((await isFinal(nextStatus)) && !(await isFinal(row.status_id)) && !canPublish(req.user, row))
    return res.status(403).json({ error: 'Only the channel’s reviewer can publish — ask your SMM or an admin' })

  // Stage rules: the admin regulates which kind of actor moves work OUT of
  // which stage (Admin → Pipeline). Applies to moves among working stages —
  // publishing keeps its own key above, un-publishing stays as it was, and
  // admins pass everything. Rules only ever narrow the existing tickets
  // (crew milestones, a member's move_tasks); they never grant new ones.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id && req.user.role !== 'admin' &&
      !(await isFinal(row.status_id)) && !(await isFinal(nextStatus))) {
    const kinds = [
      row.operator_id === req.user.id && 'operator',
      row.editor_id === req.user.id && 'editor',
      row.designer_id === req.user.id && 'designer',
      req.user.role === 'member' && 'member',
    ].filter(Boolean)
    let allowed = false
    for (const k of kinds) {
      if (await mayLeaveStage(k, row.status_id)) { allowed = true; break }
    }
    if (!allowed) return res.status(403).json({ error: 'Moving work out of this stage isn’t your step — see the stage rules in Admin' })
  }

  // ---- the task belongs to whoever is holding it --------------------------
  // Once work has been handed on, it is out of the previous owner's hands: the
  // person the stage belongs to moves it, and nobody else but an admin. A
  // stage with no owner yet is nobody's property — the gates below will insist
  // on one before it goes any further.
  // A milestone tick is exempt for the same reason as the gates below: the
  // tick already proved the person holds the hat they are closing. Without
  // this an editor could not mark a cut finished while the card still sat in
  // the shooter's phase — which is exactly when they finish it.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id && req.user.role !== 'admin' && !body.milestone) {
    const held = holderOf(row, resolveGates(await all('SELECT id, label, sort, is_final FROM statuses')))
    // Whoever the task itself was handed to holds it as well. A stage owner is
    // the crew hat working it right now; an ASSIGNEE is the person the whole
    // task belongs to, and has been able to move their own work since long
    // before stages had owners. Counting only the hats locked the task's own
    // people out of it.
    const mine = held.owner_ids.includes(req.user.id) || assigneesOf(row).includes(req.user.id)
    if (held.owner_ids.length && !mine) {
      const names = await all(
        `SELECT name FROM users WHERE id IN (${held.owner_ids.map(() => '?').join(',')})`, ...held.owner_ids)
      const who = names.map((u) => u.name).join(' or ') || 'somebody else'
      return res.status(403).json({
        error: `This is with ${who} now — only they (or an admin) can move it on`,
        held_by: held.owner_ids, phase: held.phase,
      })
    }
  }

  // ---- the handover gates -------------------------------------------------
  // Moving a card forward is a claim that the stage behind it is finished, so
  // each gate makes the claim provable before the move lands: the next owner
  // is named, and the file that proves the work exists is attached. Gates are
  // cumulative — dragging a card straight from Idea to Ready does not skip the
  // shooter and the editor on the way past. Sending work BACK for fixes is
  // never gated, and admins are never blocked.
  //
  // Nor is a crew member closing THEIR OWN stage. The milestone tick above has
  // already refused anyone who does not hold the hat, so reaching here means
  // the person who did the work is saying it is done — and that one tap is the
  // most-used action in the product. Gating it would leave an editor who was
  // handed footage on a hard drive unable to ever mark the cut finished. These
  // gates are for MOVING A CARD past stages, which is where skipping happens.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id && req.user.role !== 'admin' && !body.milestone) {
    const statuses = await all('SELECT id, label, sort, is_final FROM statuses')
    const resolved = resolveGates(statuses)
    const at = (id) => resolved.ordered.findIndex((s) => s.id === id)
    const forward = at(patch.status_id) > at(row.status_id) && at(patch.status_id) >= 0

    if (forward) {
      const val = (f) => (patch[f] !== undefined ? patch[f] : row[f])
      const hasFile = async () =>
        !!(await get('SELECT 1 AS x FROM attachments WHERE content_id = ?', row.id))

      // What each gate demands: the owner it hands the work to, and the
      // delivery that proves the stage before it really happened.
      const NEEDS = {
        shoot:  { owner: 'operator_id', who: 'a shooter', link: null },
        edit:   { owner: 'editor_id', who: 'an editor', link: 'shot_link', what: 'the footage' },
        // Review already has owners, and they are not a field on the task:
        // a cut landing on Ready rings the channel's SMMs and the admins, and
        // always has. reviewer_id is an optional override — "this named person
        // answers for the review deadline" — so demanding one before the
        // EDITOR may finish would stop every crew tick until an admin filled
        // in a field that no existing task has. The proof still stands: the
        // cut itself must be attached.
        review: { owner: null, link: 'ready_link', what: 'the cut' },
      }
      // The gates ADVISE; they do not refuse. A wall here stopped ordinary
      // work: a written post has no cut to attach and no editor to name, and
      // footage handed over on a hard drive never becomes a link — yet both
      // were refused. What the stage is missing is still worked out, still
      // shown on the card by the StageGate panel (/api/warnings computes the
      // same list), and still counted against the handover deadlines below.
      // The move itself goes through.
      //
      // To make any of them a wall again, refuse here on `shortfalls`.
      const shortfalls = []
      for (const gate of gatesUpTo(patch.status_id, resolved)) {
        // Only the gates this move actually CROSSES — a stage already behind
        // the card was passed under whatever rules applied at the time.
        if (at(row.status_id) >= gate.index) continue
        const need = NEEDS[gate.key]
        if (!need) continue
        if (need.owner && !val(need.owner)) shortfalls.push({ gate: gate.key, missing: need.owner })
        else if (need.link && !val(need.link) && !(await hasFile())) shortfalls.push({ gate: gate.key, missing: need.link })
      }

      // The re-promise. When the stage being handed over finished after its
      // own deadline, the next owner cannot inherit a date that is already
      // gone: the mover has to name a new one, and both dates stay on the
      // task so the log shows what the delay cost.
      const today = dayISO()
      const LATE_HANDOVERS = [
        { gate: 'edit', ran: 'recording_date', revise: 'edit_due_revised', next: 'editing' },
        { gate: 'review', ran: 'edit_ready_date', revise: 'review_due_revised', next: 'review' },
      ]
      for (const h of LATE_HANDOVERS) {
        const g = resolved.gates[h.gate]
        if (!g || at(patch.status_id) < g.index) continue      // not crossing this gate
        if (at(row.status_id) >= g.index) continue             // already past it
        const ran = val(h.ran)
        if (!ran || today <= ran) continue                     // the handover is on time
        // Late, and nobody named a new date. Rather than stand in the way,
        // the re-promise writes itself: the work reached the next person
        // TODAY, so today is the honest start of their clock. The original
        // deadline is untouched beside it, and the change goes into the paper
        // trail like any other — so the pair still shows what the delay cost,
        // which was the whole point. Naming a date by hand still wins.
        if (!val(h.revise)) patch[h.revise] = today
      }
    }
  }

  // The handover clocks. Crossing a gate stops the previous stage's clock for
  // good — stamped once, never rewritten, so a card dragged back and forth
  // keeps the moment the work actually arrived.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id) {
    const statuses = await all('SELECT id, label, sort, is_final FROM statuses')
    const resolved = resolveGates(statuses)
    const at = (id) => resolved.ordered.findIndex((s) => s.id === id)
    const target = at(patch.status_id)
    for (const [gateKey, stamp] of [['edit', 'shot_at'], ['review', 'edited_at']]) {
      const g = resolved.gates[gateKey]
      if (g && target >= g.index && !row[stamp]) patch[stamp] = new Date().toISOString()
    }
  }

  // The videographer's clock: the first time the cut reaches a ready-or-later
  // stage (or the task completes), stamp ready_at — the proof the edit was
  // (or wasn't) ready by its edit_ready_date deadline.
  if (!row.ready_at && (patch.status_id !== undefined || patch.done_at)) {
    const st = await get('SELECT label, is_final FROM statuses WHERE id = ?', nextStatus)
    if (patch.done_at || (st && (st.is_final || /ready|approv|posted|got/i.test(st.label))))
      patch.ready_at = new Date().toISOString()
  }

  // The ten-second regret. Before a stage move lands, photograph what the task
  // was: everything the move is about to rewrite, plus the channels and type
  // the plan counters were keyed on. One row per task — a second move makes
  // the first unundoable, which is the honest behaviour.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id) {
    const before = {}
    for (const f of UNDO_FIELDS) before[f] = row[f] ?? null
    before.channels = row.channels
    before.type = row.type
    await run(
      `INSERT INTO undo_moves (content_id, user_id, before, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(content_id) DO UPDATE SET user_id = excluded.user_id, before = excluded.before, created_at = excluded.created_at`,
      row.id, req.user.id, JSON.stringify(before), new Date().toISOString())
  }

  const keys = Object.keys(patch)
  await run(`UPDATE content SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`, ...keys.map((k) => patch[k]), row.id)
  await logPatch(req.user, row, patch)

  // People just handed a hat hear about it — only the NEW names, never the
  // ones already on the task, never the assigner.
  {
    const roles = new Map()
    for (const { f, role } of [
      { f: 'operator_id', role: 'operator' }, { f: 'editor_id', role: 'editor' }, { f: 'designer_id', role: 'designer' },
    ]) if (patch[f] !== undefined && patch[f] && patch[f] !== row[f]) addRole(roles, patch[f], role)
    if (patch.assignees !== undefined) {
      const before = new Set(assigneesOf(row))
      for (const id of JSON.parse(patch.assignees)) if (!before.has(id)) addRole(roles, id, 'owner')
    }
    if (roles.size) {
      const rec = patch.recording_date !== undefined ? patch.recording_date : row.recording_date
      const rel = patch.release_date !== undefined ? patch.release_date : row.release_date
      await notifyAssigned(req, row.id, row.title, roles, dateBit(rec, rel))
    }
  }

  // The bell rings for everyone on the task except whoever moved it: a
  // status change is news to the rest of the crew, not to its author. A move
  // onto Ready is ALSO the reviewers' cue — the admins and the channel's
  // SMMs hear it too, cut link in hand, so "the edit is done" never has to
  // be discovered by accident.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id) {
    const newSt = await get('SELECT label, is_final FROM statuses WHERE id = ?', patch.status_id)
    let assignees = []
    try { assignees = JSON.parse(row.assignees || '[]') } catch { assignees = [] }
    const people = [...new Set([...assignees, row.assignee_id, row.operator_id, row.editor_id, row.designer_id]
      .filter((id) => id && id !== req.user.id))]
    const isReady = !!newSt && /^ready$/i.test(newSt.label)
    let recipients = people
    if (isReady) {
      const chans = JSON.parse(row.channels || '[]')
      const reviewers = (await all('SELECT * FROM users')).map(publicUser).filter((u) =>
        u.id !== req.user.id &&
        (u.role === 'admin' || (!!u.permissions.review_publish && chans.some((ch) => u.departments.includes(ch)))))
      recipients = [...new Set([...people, ...reviewers.map((u) => u.id)])]
    }
    if (recipients.length && newSt) {
      const now = new Date().toISOString()
      const line = `«${row.title}» → ${newSt.label} — by ${req.user.name}`
      await batch(recipients.map((id) => [
        'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
        id, 'status', line, row.id, now,
      ]))
      // The Telegram cut reads like a person wrote it: what happened, who did
      // it, the date that matters — and for a review, the file itself.
      const relDate = patch.release_date !== undefined ? patch.release_date : row.release_date
      const rel = relDate ? ` · release ${tgDate(relDate)}` : ''
      const title = `<b>«${tgEsc(row.title)}»</b>`
      const who = tgEsc(req.user.name)
      let tgLine
      if (isReady) {
        const cut = (patch.ready_link !== undefined ? patch.ready_link : row.ready_link) ||
          (patch.design_link !== undefined ? patch.design_link : row.design_link)
        const watch = cut && /^https?:\/\//i.test(cut) ? `\n▶️ <a href="${tgEsc(cut)}">Watch it</a>` : ''
        tgLine = `✅ Ready for your review\n${title} — finished by ${who}${rel}${watch}\nWatch it and publish, or send notes back 👇`
      } else if (newSt.is_final) {
        tgLine = `🚀 It's out!\n${title} — published by ${who}. Nice work, team 👏`
      } else if (/^deleted$/i.test(newSt.label)) {
        tgLine = `🗑 Taken off the plan\n${title} — by ${who}. Nothing more is owed on it.`
      } else {
        tgLine = `🔔 ${title} moved to <b>${tgEsc(newSt.label)}</b>\nby ${who}${rel}\nYour turn if it's your stage 👇`
      }
      await tgMirror(recipients, tgLine, row.id, tgOriginFrom(req))
    }
  }

  // A card moving on the kanban counts as activity for its campaign's project.
  const activityCampaign = patch.campaign_id !== undefined ? patch.campaign_id : row.campaign_id
  if (activityCampaign && (patch.status_id !== undefined || patch.done_at !== undefined || patch.campaign_id !== undefined))
    await bumpProjectOfCampaign(activityCampaign)

  // ---- keep the channel plans in sync ----
  const wasDone = !!row.done_at
  const nowDone = patch.done_at !== undefined ? !!patch.done_at : wasDone
  const newChannels = patch.channels !== undefined ? JSON.parse(patch.channels) : oldChannels
  const newType = patch.type !== undefined ? patch.type : row.type

  // Killing a piece (→ Deleted) takes it out of the channel plan — the slot
  // will never be filled; restoring it re-enters the plan. Skipped when the
  // platforms/type changed in the same save (the rebuild below handles those).
  if (patch.channels === undefined && patch.type === undefined && patch.status_id !== undefined) {
    const wasDead = await isDead(row.status_id)
    const nowDead = await isDead(nextStatus)
    if (wasDead !== nowDead) {
      for (const ch of newChannels) await bumpPlan(ch, newType, { target: nowDead ? -1 : +1 }, !nowDead)
    }
  }

  if (patch.channels !== undefined || patch.type !== undefined) {
    // Moved to other platforms / another type: walk the old plans back, then
    // count toward the new ones (carrying the completion along if done).
    for (const ch of oldChannels) await bumpPlan(ch, row.type, { target: -1, current: wasDone ? -1 : 0 })
    for (const ch of newChannels) await bumpPlan(ch, newType, { target: +1, current: nowDone ? +1 : 0 }, true)
  } else if (!wasDone && nowDone) {
    for (const ch of newChannels) await bumpPlan(ch, newType, { current: +1 }, true) // 15/16 → 16/16
  } else if (wasDone && !nowDone) {
    for (const ch of newChannels) await bumpPlan(ch, newType, { current: -1 })
  }

  res.json(await listRow(row.id))
}))

// ---- what a move is going to ask for ---------------------------------------
// The board asks this BEFORE it moves anything, so the handover window can
// open on the move itself rather than after a refusal. It answers with the
// gates the move crosses, who is eligible to take each one — the editing
// stage offers editors, not the whole company — and whether the handover is
// running late enough to need a fresh promise. The rules live here, once.
router.get('/:id/handover', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canSee(req.user, { ...row, channels: JSON.parse(row.channels || '[]') }))
    return res.status(403).json({ error: 'Not your channel' })

  const to = Number(req.query.to)
  const statuses = await all('SELECT id, label, sort, is_final FROM statuses')
  const resolved = resolveGates(statuses)
  const at = (id) => resolved.ordered.findIndex((s) => s.id === id)
  const forward = at(to) > at(row.status_id) && at(to) >= 0
  if (!forward) return res.json({ gates: [] })

  const team = (await all('SELECT * FROM users')).map(publicUser)
  // Who may wear each hat. The crew hats are declared on the person; review is
  // a permission, because signing work off is an SMM's job, not a craft.
  const eligible = (role) => (role === 'reviewer'
    ? team.filter((u) => u.role === 'admin' || !!u.permissions?.review_publish)
    : team.filter((u) => (u.crew_roles || []).includes(role)))

  const NEEDS = {
    shoot: { owner: 'operator_id', role: 'operator', label: 'shooter', link: null },
    edit: { owner: 'editor_id', role: 'editor', label: 'editor', link: 'shot_link', what: 'the footage' },
    review: { owner: 'reviewer_id', role: 'reviewer', label: 'reviewer', link: 'ready_link', what: 'the cut', many: true },
  }
  const hasFile = !!(await get('SELECT 1 AS x FROM attachments WHERE content_id = ?', row.id))
  const today = dayISO()
  const LATE = {
    edit: { ran: 'recording_date', revise: 'edit_due_revised' },
    review: { ran: 'edit_ready_date', revise: 'review_due_revised' },
  }

  const gates = []
  for (const g of gatesUpTo(to, resolved)) {
    if (at(row.status_id) >= g.index) continue     // already behind us
    const need = NEEDS[g.key]
    if (!need) continue
    const short = eligible(need.role)
    const late = LATE[g.key]
    const ran = late ? row[late.ran] : null
    gates.push({
      key: g.key,
      stage: g.label,
      role: need.role,
      what: need.label,
      owner_field: need.owner,
      many: !!need.many,
      current: need.many
        ? (() => { try { return JSON.parse(row.reviewers || '[]') } catch { return [] } })()
        : (row[need.owner] ? [row[need.owner]] : []),
      // Strictly the people who hold the hat, and everyone else as a fallback
      // so an empty roster never becomes a dead end.
      candidates: short.map((u) => ({ id: u.id, name: u.name, color: u.color, position: u.position })),
      others: team.filter((u) => !short.some((s) => s.id === u.id))
        .map((u) => ({ id: u.id, name: u.name, color: u.color, position: u.position })),
      link_field: need.link,
      link_ok: need.link ? (!!row[need.link] || hasFile) : true,
      what_link: need.what || null,
      late: late && ran && today > ran ? { was_due: ran, revise_field: late.revise, already: row[late.revise] || null } : null,
    })
  }
  res.json({ gates, to, stage: resolved.ordered.find((s) => s.id === to)?.label || '' })
}))

// ---- undoing the last move -------------------------------------------------
// Ten seconds to take a move back. It restores the stage AND everything the
// move stamped on the way — the handover clocks, the hats it forced you to
// name, the deadline it made you re-promise — and walks the channel plan back
// so the numbers say what they said before. The undo itself is logged: taking
// a move back is a move, and the paper trail is the whole point of this.
router.post('/:id/undo', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  // canSee reads channels as a list, and this row came straight off the table.
  if (!canSee(req.user, { ...row, channels: JSON.parse(row.channels || '[]') }))
    return res.status(403).json({ error: 'Not your channel' })

  const snap = await get('SELECT * FROM undo_moves WHERE content_id = ?', row.id)
  if (!snap) return res.status(404).json({ error: 'There is nothing to undo on this task' })

  const age = (Date.now() - Date.parse(snap.created_at)) / 1000
  if (age > UNDO_SECONDS) {
    await run('DELETE FROM undo_moves WHERE content_id = ?', row.id)
    return res.status(409).json({ error: 'Too late to undo that — the move is on the record now' })
  }
  // Your own regret, or an admin's. Undoing somebody else's move would be a
  // way to move their work without it looking like a move.
  if (snap.user_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Only whoever made that move can take it back' })

  let before
  try { before = JSON.parse(snap.before) } catch { before = null }
  if (!before) return res.status(409).json({ error: 'That move can no longer be read back' })

  const keys = UNDO_FIELDS.filter((f) => f in before)
  await run(`UPDATE content SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
    ...keys.map((k) => before[k]), row.id)

  // Walk the plan back: the same two questions the move itself asked, read in
  // the other direction.
  const channels = (() => { try { return JSON.parse(before.channels || '[]') } catch { return [] } })()
  const type = before.type || row.type
  const wasDead = await isDead(row.status_id)          // where the move left it
  const backDead = await isDead(before.status_id)      // where it is going back to
  if (wasDead !== backDead) await Promise.all(channels.map((ch) => bumpPlan(ch, type, { target: backDead ? -1 : +1 }, !backDead)))
  const wasDone = !!row.done_at
  const backDone = !!before.done_at
  if (wasDone !== backDone) await Promise.all(channels.map((ch) => bumpPlan(ch, type, { current: backDone ? +1 : -1 }, backDone)))

  const two = await all('SELECT id, label FROM statuses WHERE id IN (?, ?)', row.status_id ?? 0, before.status_id ?? 0)
  const lab = (id) => two.find((s) => s.id === id)?.label || null
  await run(...actRow(req.user, row.id, row.title, 'updated', 'stage undone',
    lab(row.status_id), lab(before.status_id), new Date().toISOString()))

  await run('DELETE FROM undo_moves WHERE content_id = ?', row.id)
  if (row.campaign_id) await bumpProjectOfCampaign(row.campaign_id)
  res.json(await listRow(row.id))
}))

router.delete('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const allowed = req.user.role === 'admin' || (can(req.user, 'manage_content') && canTouch(req.user, row))
  if (!allowed) return res.status(403).json({ error: 'You don’t have permission to delete this' })
  // Removing a task lowers each channel's plan again (and its count if done).
  for (const ch of JSON.parse(row.channels || '[]'))
    await bumpPlan(ch, row.type, { target: -1, current: row.done_at ? -1 : 0 })
  await logEvent(req.user, row.id, row.title, 'deleted')
  await run('DELETE FROM attachments WHERE content_id = ?', row.id) // its paperwork goes with it
  await run('DELETE FROM content WHERE id = ?', row.id)
  res.json({ ok: true })
}))

export default router
