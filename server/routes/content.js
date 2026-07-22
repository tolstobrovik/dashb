import { Router } from 'express'
import { all, get, run, batch, bumpPlan, CONTENT_TYPES, resyncStorage } from '../db.js'
import { bumpProjectOfCampaign } from '../pcmodel.js'
import { authRequired, canAccessDept, can, wrap } from '../auth.js'

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
// and the pages poll every few seconds) — only the small thumbnail and a
// has_photo flag; the task modal fetches the original via GET /:id.
const LIST_COLUMNS = `id, title, channels, type, assignee_id, assignees, created_by, status_id, campaign_id,
  operator_id, editor_id, designer_id,
  recording_date, recording_time, recording_end, edit_ready_date, design_ready_date, ready_at, ready_link,
  shot_link, design_link, reference_text, reference_links, release_date, release_time, description,
  checklist, todo_sort, pinned, photo_thumb,
  CASE WHEN photo IS NULL THEN 0 ELSE 1 END AS has_photo, done_at, created_at`

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
  const { department, mine } = req.query
  let rows = (await all(`SELECT ${LIST_COLUMNS} FROM content ORDER BY pinned DESC, todo_sort, created_at DESC`)).map(parse)
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
  res.json(mine.map((r) => ({ ...r, channels: JSON.parse(r.channels || '[]'), reference_links: parseLinks(r.reference_links) })))
}))

// One task in full — including the original photo and its revision history.
router.get('/:id', wrap(async (req, res) => {
  const row = parse(await get('SELECT * FROM content WHERE id = ?', req.params.id))
  if (!row || !canSee(req.user, row)) return res.status(404).json({ error: 'Not found' })
  const revisions = await all(
    'SELECT id, round, requested_by, requested_name, target, note, created_at, resolved_at FROM revisions WHERE content_id = ? ORDER BY round, id',
    row.id)
  res.json({ ...row, revisions, has_photo: row.photo ? 1 : 0 })
}))

// Times come from <input type="time"> as HH:MM — anything else becomes null.
const cleanTime = (v) => (v && /^\d{2}:\d{2}/.test(String(v)) ? String(v).slice(0, 5) : null)

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
      shot_link, design_link, reference_text, reference_links, photo, photo_thumb, checklist, todo_sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    String(title).trim(), JSON.stringify(channels), safeType, assignee, JSON.stringify(assigneeList), req.user.id, status, campaignId,
    crew.operator_id, crew.editor_id, crew.designer_id,
    recording_date || null, recording_time, recording_end, edit_ready_date || null, design_ready_date || null, release_date || null, release_time,
    description, cleanLink(req.body?.ready_link) || null,
    cleanLink(req.body?.shot_link) || null, cleanLink(req.body?.design_link) || null,
    reference_text ? String(reference_text).slice(0, 4000) : null, JSON.stringify(referenceLinks),
    photo || null, photo_thumb || null, JSON.stringify(Array.isArray(checklist) ? checklist : []),
    maxSort + 1, new Date().toISOString(),
  )
  if (campaignId) await bumpProjectOfCampaign(campaignId)
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
  if (keys.length) await run(`UPDATE content SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k]), row.id)
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
  await run('DELETE FROM content WHERE id = ?', row.id)
  res.json({ ok: true })
}))

export default router
