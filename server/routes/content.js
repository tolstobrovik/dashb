import { Router } from 'express'
import { all, get, run, batch, bumpPlan, CONTENT_TYPES, resyncStorage, mayLeaveStage, getTaskFields, publicUser } from '../db.js'
import { bumpProjectOfCampaign } from '../pcmodel.js'
import { authRequired, canAccessDept, can, wrap } from '../auth.js'
import { tgMirror, tgOriginFrom, tgEsc, tgDate } from '../telegram.js'

const router = Router()
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
  operator_id, editor_id, designer_id,
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
  'design_ready_date', 'release_date', 'release_time', 'format', 'rubrika', 'ready_link', 'shot_link', 'design_link']

async function logPatch(user, row, patch) {
  const rows = []
  const now = new Date().toISOString()
  const title = patch.title !== undefined ? patch.title : row.title
  const push = (field, oldV, newV) => rows.push(actRow(user, row.id, title, 'updated', field, oldV, newV, now))

  // People fields → names, resolved in one query.
  const ids = new Set()
  for (const f of ['operator_id', 'editor_id', 'designer_id'])
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
  for (const f of ['operator_id', 'editor_id', 'designer_id'])
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
    tgMirror([id], `📌 <b>«${tgEsc(title)}»</b> — you're the ${roleById.get(id)}\nAssigned by ${tgEsc(req.user.name)}${extra}`, contentId, tgOriginFrom(req))))
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
  res.json({ ...row, revisions, comments, activity, has_photo: row.photo ? 1 : 0 })
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
    await tgMirror(people, `💬 ${tgEsc(req.user.name)} — on <b>«${tgEsc(row.title)}»</b>:\n“${tgEsc(preview)}”`, row.id, tgOriginFrom(req))
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

  // The crew hats: who shoots it and who cuts it (videos), or who designs
  // it (posts) — all real team members.
  const crew = { operator_id: null, editor_id: null, designer_id: null }
  for (const f of ['operator_id', 'editor_id', 'designer_id']) {
    if (req.body?.[f] != null && req.body[f] !== '') {
      crew[f] = Number(req.body[f])
      if (!(await userExists(crew[f])))
        return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
    }
  }

  // Double-booking / working-hours guard — warns before the shoot is saved.
  if (await guardShoot(req, res, {
    operatorId: crew.operator_id, date: recording_date || null,
    start: recording_time, end: recording_end,
  })) return

  const status = status_id || (await get('SELECT id FROM statuses ORDER BY sort, id'))?.id || null
  const maxSort = (await get('SELECT COALESCE(MAX(todo_sort), -1) AS m FROM content')).m
  const info = await run(`
    INSERT INTO content (title, channels, type, assignee_id, assignees, created_by, status_id, campaign_id, operator_id, editor_id, designer_id,
      recording_date, recording_time, recording_end, edit_ready_date, design_ready_date, release_date, release_time, description, ready_link,
      shot_link, design_link, reference_text, reference_links, format, rubrika, script, photo, photo_thumb, checklist, todo_sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    String(title).trim(), JSON.stringify(channels), safeType, assignee, JSON.stringify(assigneeList), req.user.id, status, campaignId,
    crew.operator_id, crew.editor_id, crew.designer_id,
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
    await tgMirror([fixerId], `🔧 <b>«${tgEsc(row.title)}»</b> — changes requested\n${tgEsc(req.user.name)}: “${tgEsc(preview)}”\nRound ${round} — it's back with you`, row.id, tgOriginFrom(req))
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

  // Calendar drags send only a date → allowed with move_tasks too.
  for (const f of ['recording_date', 'edit_ready_date', 'design_ready_date', 'release_date']) {
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
  for (const f of ['operator_id', 'editor_id', 'designer_id']) {
    if (body[f] !== undefined) {
      if (!can(req.user, 'manage_content'))
        return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
      const next = body[f] == null || body[f] === '' ? null : Number(body[f])
      if (next !== null && !(await userExists(next)))
        return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
      patch[f] = next
    }
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

  // The videographer's clock: the first time the cut reaches a ready-or-later
  // stage (or the task completes), stamp ready_at — the proof the edit was
  // (or wasn't) ready by its edit_ready_date deadline.
  if (!row.ready_at && (patch.status_id !== undefined || patch.done_at)) {
    const st = await get('SELECT label, is_final FROM statuses WHERE id = ?', nextStatus)
    if (patch.done_at || (st && (st.is_final || /ready|approv|posted|got/i.test(st.label))))
      patch.ready_at = new Date().toISOString()
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
        const watch = cut && /^https?:\/\//i.test(cut) ? `\n▶️ <a href="${tgEsc(cut)}">Watch the cut</a>` : ''
        tgLine = `✅ ${title} is ready for review\nFinished by ${who}${rel}${watch}`
      } else if (newSt.is_final) {
        tgLine = `🚀 ${title} is out!\nPublished by ${who}`
      } else if (/^deleted$/i.test(newSt.label)) {
        tgLine = `🗑 ${title} was taken off the plan\nby ${who}`
      } else {
        tgLine = `🔔 ${title} → <b>${tgEsc(newSt.label)}</b>\nMoved by ${who}${rel}`
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

router.delete('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const allowed = req.user.role === 'admin' || (can(req.user, 'manage_content') && canTouch(req.user, row))
  if (!allowed) return res.status(403).json({ error: 'You don’t have permission to delete this' })
  // Removing a task lowers each channel's plan again (and its count if done).
  for (const ch of JSON.parse(row.channels || '[]'))
    await bumpPlan(ch, row.type, { target: -1, current: row.done_at ? -1 : 0 })
  await logEvent(req.user, row.id, row.title, 'deleted')
  await run('DELETE FROM content WHERE id = ?', row.id)
  res.json({ ok: true })
}))

export default router
