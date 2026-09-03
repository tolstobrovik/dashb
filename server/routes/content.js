import { Router } from 'express'
import { createHmac } from 'crypto'
import { all, get, run, batch, CONTENT_TYPES, resyncStorage, mayLeaveStage, getTaskFields, getCrewNeeds, publicUser, dayISO, taskChildDeletes } from '../db.js'
import { bumpProjectOfCampaign } from '../pcmodel.js'
import { resolveGates, gatesUpTo, phasesOf, holderOf, phasePassed } from '../deadlines.js'
import { readText, hasSubstance, hasLink, isSentence, clip, scriptKey, MIN_SENTENCE_WORDS } from '../text.js'
import { authRequired, canAccessDept, can, wrap, JWT_SECRET, isAdminOn, isFullAdmin } from '../auth.js'
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
// the planner/operator (their work happened) but never for the editor.

// The crew move their work with one tick — "shot" for the operator, "edited"
// or "designed" for the maker — which lands the task on the matching pipeline
// stage rather than letting them pick any stage freely.
//
// The operator's tick used to land on a stage of its own called Shot, where a
// filmed piece sat waiting for somebody to notice it and move it on. That was
// a step that existed only to be left: footage that is shot is footage the
// editor can start on, and the board now says so — the tick hands it straight
// to EDITING. Boards that still carry a Shot column (it is the admin's
// pipeline to arrange) are honoured, so nobody's stage disappears under them.
async function milestoneStatusId(kind) {
  const rows = await all('SELECT id, label, sort FROM statuses ORDER BY sort, id')
  const find = (re) => rows.find((s) => re.test(s.label))
  if (kind === 'shot') {
    return (find(/^shot$/i) || find(/^editing$|^edit$|montaj|монтаж/i) || find(/\bedit/i))?.id ?? null
  }
  // edited / designed both mean "the piece is ready"
  return (find(/^ready$/i) || find(/ready|final|approv|posted|got/i))?.id ?? null
}
// A ready-file link is a plain Google-Drive-style URL (or nothing).
const cleanLink = (v) => {
  const s = String(v ?? '').trim().slice(0, 1000)
  return s
}

// ---- the channel's shared folder -------------------------------------------
// Pasting a full Drive URL for every single cut is the same folder typed out
// forty times a week, and the one part that differs — which file — is the part
// people leave out. So a channel can carry the folder once, and a delivery
// then says only WHICH file it is: "1-3", "reel 14", "Bahrom final".
//
// The label is still required. The folder alone points at everything the
// channel has ever made, which is the same as pointing at nothing.
const FILE_LABEL_MAX = 120
const cleanFileLabel = (v) => String(v ?? '').trim().slice(0, FILE_LABEL_MAX)
// Where a delivery lands: the folder, and the file said in words. Kept as ONE
// stored string so everything that already reads these columns — the digest,
// the review row, the Files list — keeps working untouched.
export const deliveryValue = (folder, label) => (folder && label ? `${folder} · ${label}` : '')
// The folder for a task's channels, if they agree on one. A task on two
// channels with two different folders has no single answer, so it falls back
// to asking for the whole URL.
async function folderFor(chans) {
  const list = Array.isArray(chans) ? chans : []
  if (!list.length) return ''
  const rows = await all(
    `SELECT key, drive_url FROM channels WHERE key IN (${list.map(() => '?').join(',')})`, ...list)
  const set = [...new Set(rows.map((r) => (r.drive_url || '').trim()).filter(Boolean))]
  return set.length === 1 ? set[0] : ''
}

// Publishing (Ready → Published) is the SMM's call: an admin, or someone with
// the review_publish right who is actually on one of the task's channels — you
// can't publish to a channel you don't belong to.
// The channels a task lives on — rows arrive both parsed and raw depending on
// which query built them, so this asks once and both shapes answer.
const chansOf = (row) => (Array.isArray(row?.channels)
  ? row.channels
  : (() => { try { return JSON.parse(row?.channels || '[]') } catch { return [] } })())
// Does this person's admin writ cover this task?
const adminHere = (user, row) => isAdminOn(user, chansOf(row))

// ---- the admin is not made to fill in a form ------------------------------
// Every rule below this line exists to stop WORK going out half-briefed: a
// shoot with no shooter, a stage moved with nothing attached, a required field
// left empty. They are right for the people doing the work and wrong for the
// person who set them, who is usually correcting the board at speed — putting
// a name on a card somebody phoned in, fixing a date, dragging four pieces out
// of the wrong stage — and does not want to be asked for a reference photo
// each time.
//
// So the admin passes them all. Not "sees a nicer error", not "clicks through
// a warning": the requirement does not apply to them. What still applies is
// everything that is not a form to fill in — whose channel it is, whether a
// link is actually a link, whether a person exists — because those are not
// requirements, they are facts.
//
// An admin scoped to particular channels is an admin ON those channels, and
// this follows the same scope: they are unfettered where they are the admin
// and refused outright where they are not.
const unfettered = (user, chans) => isAdminOn(user, chans)

const canPublish = (user, row) => {
  if (adminHere(user, row)) return true
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
  adminHere(user, row) ||
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
  miss_blame, miss_blame_note, miss_blame_by,
  views, views_at, views_by,
  recording_date, recording_time, recording_end, edit_ready_date, design_ready_date, ready_at, ready_link,
  shot_link, design_link, post_link, reference_text, reference_links, format, rubrika, script, tz, release_date, release_time, description,
  shoot_ack, shoot_ack_at, shoot_ack_by, shoot_ack_note,
  edit_ack, edit_ack_at, edit_ack_by, edit_ack_note,
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
const QUIET_FIELDS = ['description', 'script', 'tz', 'reference_text', 'reference_links', 'photo', 'checklist']
const PLAIN_FIELDS = ['title', 'type', 'recording_date', 'recording_time', 'recording_end', 'edit_ready_date',
  'design_ready_date', 'release_date', 'release_time', 'format', 'rubrika', 'ready_link', 'shot_link', 'design_link', 'post_link',
  // A re-promised deadline is the most disputable thing on the task: it is
  // always somebody moving their own goalposts after a late handover, so it
  // goes in the log by name.
  'edit_due_revised', 'review_due_revised']

// Everything a stage move can rewrite — the snapshot restores exactly these.
const UNDO_FIELDS = ['status_id', 'done_at', 'ready_at', 'shot_at', 'edited_at',
  'edit_due_revised', 'review_due_revised', 'operator_id', 'editor_id', 'reviewer_id',
  'reviewers', 'shot_link', 'ready_link', 'post_link']
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
// ---- booked time the crew answer for -----------------------------------
// A shoot day is not a fact until the person holding the camera has said they
// can be there, and an edit deadline is not a deadline until the editor has
// said it fits. The planner books; the crew ANSWERS. Until they do the slot
// reads as waiting, and once they accept it it is theirs — the planner cannot
// quietly move an afternoon somebody has already cleared.
//
// Two bookings, one shape. `shoot` is the operator and the recording day with
// its hours; `edit` is the editor and the day the cut is due. Anything else on
// the task — the release, the design date — is a plan, not a promise made to
// a person, and nobody is asked to confirm it.
const BOOKINGS = {
  shoot: {
    holder: 'operator_id', ack: 'shoot_ack', at: 'shoot_ack_at', by: 'shoot_ack_by', note: 'shoot_ack_note',
    day: 'recording_date', from: 'recording_time', to: 'recording_end',
    what: 'the shoot', role: 'operator',
  },
  edit: {
    holder: 'editor_id', ack: 'edit_ack', at: 'edit_ack_at', by: 'edit_ack_by', note: 'edit_ack_note',
    day: 'edit_ready_date', from: null, to: null,
    what: 'the edit deadline', role: 'editor',
  },
}
// A booking exists when somebody is holding it AND there is a day. One without
// the other is half a plan and owes nobody an answer.
const bookedOn = (row, k) => !!(row[BOOKINGS[k].holder] && row[BOOKINGS[k].day])
// How the slot reads in a sentence: "3 Sep, 14:00-16:00" or just "3 Sep".
const slotWords = (row, k) => {
  const b = BOOKINGS[k]
  const day = tgDate(row[b.day])
  const from = b.from && row[b.from]
  const to = b.to && row[b.to]
  if (!from) return day
  return `${day}, ${from}${to ? `-${to}` : ''}`
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
  adminHere(user, row) ||
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
async function guardShoot(req, res, { operatorId, date, start, end, excludeId, chans }) {
  const problems = await shootProblems({ operatorId, date, start, end, excludeId })
  if (!problems) return false
  // Double-booking somebody is the channel owner's call to make, on their own
  // channels — not a power that belongs to whoever happens to be an admin.
  const mayForce = isAdminOn(req.user, chans || [])
  if (req.body?.force === true && mayForce) return false
  res.status(409).json({
    error: problems.schedule || 'That operator is already booked at this time',
    conflicts: problems.conflicts,
    schedule_issue: problems.schedule,
    can_force: mayForce,
  })
  return true
}

router.get('/', wrap(async (req, res) => {
  const { department, mine, thumbs } = req.query
  let rows = (await all(`SELECT ${listColumns(thumbs === '1')} FROM content ORDER BY pinned DESC, todo_sort, created_at DESC`)).map(parse)
  if (!isFullAdmin(req.user)) rows = rows.filter((c) => canSee(req.user, c))
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
      -- NOT EXISTS rather than NOT IN: status_id is nullable (a stage deleted
      -- out from under a task sets it null), and NOT IN against a null left
      -- side is itself null, which would quietly drop that task from the
      -- queue — the same disappearance this filter exists to prevent.
      AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.id = c.status_id AND LOWER(s.label) = 'deleted')
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
  // A channel admin sees the channels they run, and only those. Filtered
  // after the query rather than in it, because a task's channels are a JSON
  // array and every store this runs on spells that differently.
  const mine = (rows) => (isFullAdmin(req.user) ? rows : rows.filter((r) => isAdminOn(req.user, chansOf(r))))
  const rows = mine(await all(`
    SELECT r.id, r.content_id, r.target, r.note, r.created_at,
      c.title, c.channels, c.operator_id, c.editor_id, c.designer_id
    FROM revisions r JOIN content c ON c.id = r.content_id
    WHERE r.resolved_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.id = c.status_id AND LOWER(s.label) = 'deleted')
    ORDER BY r.created_at DESC`))
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

// How full each person's day already is, for the pickers. Cheap, read-only,
// and asked with the day the work would land on.
//
// ABOVE /:id on purpose: this path is one segment, so a router that reaches
// '/:id' first reads it as a task called "load" and answers Not found.
router.get('/load', wrap(async (req, res) => {
  const hat = String(req.query.hat || '')
  if (!['operator_id', 'editor_id', 'designer_id'].includes(hat)) {
    return res.status(400).json({ error: 'Ask about a shooter, an editor or a designer' })
  }
  res.json(await loadFor(hat, String(req.query.day || '').slice(0, 10)))
}))

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
  if (!isFullAdmin(req.user) && doc.uploaded_by !== req.user.id)
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
    'SELECT id, round, requested_by, requested_name, target, note, photo, voice_id, voice_secs, created_at, resolved_at FROM revisions WHERE content_id = ? ORDER BY round, id',
    row.id)
  const comments = await all(
    'SELECT id, user_id, author, text, voice_id, voice_secs, created_at FROM comments WHERE content_id = ? ORDER BY id',
    row.id)
  const activity = await all(
    'SELECT id, user_id, user_name, kind, field, old_value, new_value, created_at FROM activity WHERE content_id = ? ORDER BY id DESC LIMIT 80',
    row.id)
  // Names and sizes only — the bytes come one document at a time, on a click.
  const documents = await all(`SELECT ${DOC_COLUMNS} FROM attachments WHERE content_id = ? ORDER BY id`, row.id)
  // The three accountable phases, derived fresh — the modal shows who owes
  // what, by when, and whether the clock has already run out on them.
  const date_requests = await openRequestsFor(row.id)
  const flags = await all(
    'SELECT id, kind, reason, raised_by, raised_name, created_at, cleared_at, cleared_name FROM task_flags WHERE content_id = ? ORDER BY id DESC', row.id)
  res.json({ ...row, revisions, comments, activity, documents, date_requests, flags, phases: phasesOf(row), has_photo: row.photo ? 1 : 0 })
}))

// One delivery, however it was given. With a folder on the channel the person
// names the file and the folder is remembered for them; without one they paste
// the whole address as before. Either way the answer has to point at a FILE —
// a folder on its own points at everything the channel has ever made.
async function buildDelivery(req, row, body, fileKey, what) {
  const folder = await folderFor(chansOf(row))
  const raw = body[fileKey]
  if (raw !== undefined) {
    const label = cleanFileLabel(raw)
    if (!label) return { value: null }
    if (!folder)
      return { error: 'This channel has no shared folder yet — paste the whole link, or ask an admin to set the folder in Admin → Channels' }
    return { value: deliveryValue(folder, label) }
  }
  const link = cleanLink(body[fileKey === 'ready_file' ? 'ready_link' : fileKey === 'shot_file' ? 'shot_link' : 'design_link'])
  if (!link) return { value: null }
  if (!/^https?:\/\//i.test(link)) return { error: linkComplaint(link, what) }
  return { value: link }
}

// ---- naming somebody in the thread -----------------------------------------
// "@Dilnoza" in a comment should reach Dilnoza, whether or not she is on the
// task — naming somebody is how you pull them IN. Matched against the real
// roster rather than a username syntax, because this team writes first names
// in Cyrillic and nobody types an @handle they would have to look up.
// Longest names first, so "@Anvar Karimov" is one person and not Anvar.
export function mentionedIds(text, users) {
  const t = String(text ?? '')
  if (!t.includes('@')) return []
  const hits = []
  for (const u of [...users].sort((a, b) => (b.name || '').length - (a.name || '').length)) {
    const full = String(u.name || '').trim()
    if (!full) continue
    for (const label of [full, full.split(/\s+/)[0]]) {
      if (label.length < 2) continue
      // @ + the name, ending at a word boundary the Unicode way (\b does not
      // work on Cyrillic in every engine, so the next character is checked).
      const at = new RegExp(`@${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu')
      if (at.test(t)) { hits.push(u.id); break }
    }
  }
  return [...new Set(hits)]
}

// ---- voice notes -----------------------------------------------------------
// A Pravki that takes four minutes to type takes fifteen seconds to say, and
// half of what a reviewer means is in the tone. A clip is uploaded once and
// referred to by id: the bytes never ride along with a task, a list or a poll,
// and are fetched by the press that plays it.
const VOICE_MAX = 3 * 1024 * 1024        // ~3 minutes of opus, and a hard stop
const VOICE_SECS_MAX = 300
const VOICE_MIME = /^audio\/(webm|ogg|mp4|mpeg|wav|aac|x-m4a)(;|$)/i

async function saveVoice(req, row, body) {
  const data = String(body?.voice ?? '')
  if (!data) return { id: null, secs: 0 }
  const m = data.match(/^data:([^;,]+)[;,]/)
  if (!m || !VOICE_MIME.test(m[1])) return { error: 'That is not a voice recording' }
  // base64 is 4 chars per 3 bytes; near enough for a cap.
  const size = Math.round((data.length - data.indexOf(',') - 1) * 0.75)
  if (size > VOICE_MAX) return { error: 'That recording is too long — keep a voice note under three minutes' }
  const secs = Math.max(0, Math.min(VOICE_SECS_MAX, Math.round(Number(body?.voice_secs) || 0)))
  const info = await run(
    'INSERT INTO voice_notes (content_id, user_id, author, mime, secs, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    row.id, req.user.id, req.user.name || '', m[1], secs, size, data, new Date().toISOString())
  return { id: info.lastInsertRowid, secs }
}

// Playing one. Same reach as the task it belongs to — if you can open the
// task you can hear what was said on it.
router.get('/voice/:vid', wrap(async (req, res) => {
  const v = await get('SELECT * FROM voice_notes WHERE id = ?', req.params.vid)
  if (!v) return res.status(404).json({ error: 'Not found' })
  const row = await get('SELECT * FROM content WHERE id = ?', v.content_id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const parsed = { ...row, channels: JSON.parse(row.channels || '[]') }
  if (!canSee(req.user, parsed)) return res.status(404).json({ error: 'Not found' })
  res.json({ id: v.id, mime: v.mime, secs: v.secs, author: v.author, data: v.data })
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
  // A voice note IS the message; words beside it are optional.
  const voice = await saveVoice(req, row, req.body)
  if (voice.error) return res.status(400).json({ error: voice.error })
  if (!text && !voice.id) return res.status(400).json({ error: 'Write something first, or hold the mic and say it' })
  const now = new Date().toISOString()
  const info = await run(
    'INSERT INTO comments (content_id, user_id, author, text, voice_id, voice_secs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id, req.user.id, req.user.name || '', text, voice.id, voice.secs, now)
  let assignees = []
  try { assignees = JSON.parse(row.assignees || '[]') } catch { assignees = [] }
  const spoke = (await all('SELECT DISTINCT user_id FROM comments WHERE content_id = ?', row.id)).map((r) => r.user_id)
  // Naming somebody reaches them even when the task is none of their business
  // — which is exactly when you name somebody. "@Дилноза, можешь снять?" was
  // reaching nobody, because she was not on the task yet.
  const named = mentionedIds(text, await all("SELECT id, name FROM users WHERE role <> 'ambassador'"))
    .filter((id) => id !== req.user.id)
  const people = [...new Set([...assignees, row.assignee_id, row.operator_id, row.editor_id, row.designer_id, ...spoke, ...named]
    .filter((id) => id && id !== req.user.id))]
  if (people.length) {
    const spoken = voice.id ? `🎤 a ${voice.secs}s voice note` : ''
    const preview = text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : spoken
    const line = `${req.user.name} on «${row.title}»: ${preview}`
    const namedLine = `${req.user.name} named you on «${row.title}»: ${preview}`
    await batch(people.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, named.includes(id) ? 'mention' : 'comment', named.includes(id) ? namedLine : line, row.id, now,
    ]))
    // Telegram gets the roomier cut: who spoke, on what, the words, the link.
    await tgMirror(people, `💬 ${tgEsc(req.user.name)} wrote on <b>«${tgEsc(row.title)}»</b>\n“${tgEsc(preview)}”\nAnswer where the task lives 👇`, row.id, tgOriginFrom(req))
  }
  res.status(201).json(await get('SELECT id, user_id, author, text, voice_id, voice_secs, created_at FROM comments WHERE id = ?', info.lastInsertRowid))
}))

// Times come from <input type="time"> as HH:MM — anything else becomes null.
const cleanTime = (v) => (v && /^\d{2}:\d{2}/.test(String(v)) ? String(v).slice(0, 5) : null)

// The briefing fields the admin can demand (Admin → Pipeline → The task
// form). A required field blocks creating a task of a scoped type without
// it — and blocks clearing it later.
const FIELD_LABELS = { format: 'Format', rubrika: 'Rubrika', script: 'Script', tz: 'ТЗ', reference: 'Reference', description: 'Description' }
const cleanShort = (v) => (v ? String(v).trim().slice(0, 120) : null) || null
const cleanScript = (v) => (v ? String(v).trim().slice(0, 20000) : null) || null

// What a value IS — a link, a sentence, a placeholder — lives in one place
// now (server/text.js), because the two questions this board asks are
// genuinely different and were being answered by the same blunt check. A
// reference has to POINT somewhere; a script has to SAY something; and a URL,
// which is three "words" once you split on spaces, is not a shot list.
// Junk in an OPTIONAL field is not worth an error — but it is not worth
// storing either, because it reaches the card and reads as content. It comes
// to rest as empty, which is what it means.
const orBlank = (v) => (hasSubstance(v) ? v : null)
// A delivery box wants a link and nothing else. Somebody who typed a sentence
// into it has misread the box, and "should be a URL" does not tell them that
// — so the complaint names what they actually wrote.
const linkComplaint = (v, what) => {
  const t = readText(v)
  if (t.links.length) return `${what} is a link on its own — paste just the address, with the https:// on the front`
  if (t.words.length >= MIN_SENTENCE_WORDS) return `${what} goes in this box, not a note — this reads like a sentence. Say it in the Talk thread instead.`
  return `${what} should be a URL — paste the full https://… address`
}
// A shoot is BOOKED the moment it reaches — or is created straight into — the
// "To shoot" gate: from there it needs a shooter, all three dates and a brief
// ready for them to work from. Earlier than that (the Idea stage, the
// quick-add box) a filmed piece is still just a title, and stays cheap to
// jot down; the demand lands the moment somebody actually books the shoot.
const bookingProblem = ({ operatorId, recording, editReady, release, refReady }) => {
  if (!operatorId) return 'Pick who is filming this — a shoot nobody is holding is nobody’s job'
  const missingDate = [
    [recording, 'the shoot day'], [editReady, 'the day the cut is due'], [release, 'the release day'],
  ].find(([v]) => !v)
  if (missingDate) return `Filmed work is booked with all three dates — ${missingDate[1]} is missing`
  if (!refReady) return 'Booking the shoot needs a brief ready — paste a reference link or TZ, or attach the photo it refers to'
  return null
}
// Everything before the shooting gate is still an idea: a title and a maybe,
// which owes nobody a crew, a date or a brief. The gate itself is the admin's
// stage list, matched the way every other stage rule matches it.
const isIdea = (statusId, statuses) => {
  const { gates, ordered } = resolveGates(statuses)
  if (!gates.shoot) return false
  const at = ordered.findIndex((s) => s.id === statusId)
  return at >= 0 && at < gates.shoot.index
}
// The one stage where a filmed piece is BEING booked. A task created further
// along than this is not making a promise — it is recording work that already
// happened, and demanding a future shoot day of it would be nonsense. Nothing
// escapes that way: MOVING into or through the gate is what the wall in the
// PATCH handler watches, whichever stage the move aims at.
const isBooking = (statusId, statuses) => {
  const { gates, ordered } = resolveGates(statuses)
  if (!gates.shoot) return false
  return ordered.findIndex((s) => s.id === statusId) === gates.shoot.index
}
// Two scripts that read the same are one script wearing two titles — the
// crew ends up shooting the same thing twice. Compared loosely (case and
// whitespace folded away) so a re-typed copy still catches.
//
// The fingerprint is STORED on the row and indexed. Reading every script in
// the database to answer this — which is what it used to do — meant a board
// with a thousand tasks on it pulled megabytes of prose through on every
// single save, for a question that is one lookup.
const normScript = scriptKey
async function duplicateScript(script, excludeId) {
  const key = scriptKey(script)
  if (!key) return null
  return (await get(
    'SELECT id, title FROM content WHERE script_key = ? AND id <> ? LIMIT 1', key, excludeId ?? -1)) || null
}

// The first unmet demand among the admin's required brief fields, as the
// sentence to show. Presence, substance and (for a reference) direction are
// three different failures and get three different sentences — "required"
// alone would send somebody back to a field they had already filled in.
const requiredProblem = (rules, type, checks) => {
  for (const [k, label] of Object.entries(FIELD_LABELS)) {
    const r = rules[k]
    if (r?.state !== 'required' || !r.types.includes(type)) continue
    const c = checks[k] || {}
    if (!c.present) return `«${label}» is required for this type of task`
    // Three different failures, three different sentences: it is empty, it
    // says nothing, or it points nowhere. "Required" alone would send
    // somebody back to a field they had already filled in.
    if (c.thin) {
      const t = readText(c.raw)
      if (k === 'script' && t.kind === 'link')
        return `«${label}» needs the words, not just the link — the crew films from this`
      if (t.kind === 'fragment')
        return `«${label}» needs a real answer — “${clip(c.raw)}” is a note, not something anyone can work from`
      return `«${label}» needs a real answer — “${clip(c.raw)}” is a placeholder, not a brief`
    }
    if (c.linkless) return `«${label}» has to point somewhere — paste a link, or attach the photo or document it refers to`
  }
  return null
}

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
  const tzText = cleanScript(req.body?.tz)
  const fieldRules = await getTaskFields()
  // The admin is not made to fill in a form; see `unfettered` above.
  const free = unfettered(req.user, channels)
  // A reference can arrive as a link, a photo or an attached document; only
  // the text-only case has to prove that it points somewhere.
  const refCarried = referenceLinks.length > 0 || !!photo
  const problem = requiredProblem(fieldRules, safeType, {
    format: { present: !!format, thin: !hasSubstance(format), raw: format },
    rubrika: { present: !!rubrika, thin: !hasSubstance(rubrika), raw: rubrika },
    script: { present: !!script, thin: !isSentence(script), raw: script },
    tz: { present: !!tzText, thin: !isSentence(tzText), raw: tzText },
    description: {
      present: !!(description && String(description).trim()),
      thin: !hasSubstance(description), raw: description,
    },
    reference: {
      present: !!(reference_text || refCarried),
      thin: !refCarried && !hasSubstance(reference_text), raw: reference_text,
      linkless: !refCarried && hasSubstance(reference_text) && !hasLink(reference_text),
    },
  })
  if (problem && !free) return res.status(400).json({ error: problem })

  // The two rules that hold whether or not the admin demanded the field,
  // because they are about what the words ARE, not about whether they were
  // required: a reference that is only prose points nowhere, and a reference
  // of "." is not one. Text standing ALONE carries the rule — links, a photo
  // or an attached document already point somewhere.
  if (reference_text && !refCarried && !free) {
    if (!hasSubstance(reference_text))
      return res.status(400).json({ error: `«Reference» needs a real answer — “${clip(reference_text)}” is a placeholder, not a reference` })
    if (!hasLink(reference_text))
      return res.status(400).json({ error: '«Reference» has to point somewhere — paste a link, or attach the photo or document it refers to' })
  }
  // A script the crew already has is not a second script — it is the same
  // shoot booked twice, and both cards then wait for the same footage.
  // Duplicate carries the brief across ON PURPOSE, so it says so and passes.
  if (!req.body?.allow_duplicate_script && !free) {
    const twin = await duplicateScript(script)
    if (twin)
      return res.status(400).json({ error: `That script is already on «${twin.title}» — link to it or write what is different about this one` })
  }
  // Junk in a field nobody demanded is not worth an error, but it is not worth
  // storing either — it reaches the card and reads as content. It comes to
  // rest as empty, which is what it means.
  const briefText = {
    format: orBlank(format), rubrika: orBlank(rubrika), script: orBlank(script), tz: orBlank(tzText),
  }
  const cleanDescription = hasSubstance(description) ? description : ''

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
    if ((ids.length !== 1 || ids[0] !== req.user.id) && !isAdminOn(req.user, channels))
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
    start: recording_time, end: recording_end, chans: channels,
  })) return

  const status = status_id || (await get('SELECT id FROM statuses ORDER BY sort, id'))?.id || null

  // A shoot is BOOKED, not sketched: whoever holds the camera, the three days
  // the whole board measures, and a brief they can work from — all of it before
  // the shoot exists, because the day it was booked for passes whether or not
  // anyone turns up or knows what to film.
  //
  // But only from the "To shoot" gate onward. An IDEA is a title and a maybe;
  // demanding a crew and three dates of it killed the cheapest, most-used thing
  // on the board. So a filmed piece created straight INTO the shooting stage
  // (or past it) carries the full booking, and one parked at Idea carries
  // nothing — it is asked when somebody actually books it, in the PATCH below.
  //
  // WHICH types count as filmed is the admin's crew rule (Admin → Pipeline),
  // the same list the gap counts read. Editing and design stay advisory: they
  // are named later, often after the footage exists.
  // Nobody is handed work on a channel they do not work on, or more for one
  // day than they can take. Checked here, where somebody can still change it.
  for (const f of ['operator_id', 'editor_id', 'designer_id']) {
    if (!crew[f]) continue
    const chanProblem = await crewChannelProblem(crew[f], channels)
    if (chanProblem) return res.status(400).json({ error: chanProblem, crew_field: f })
    const capDay = { operator_id: recording_date, editor_id: edit_ready_date, designer_id: design_ready_date }[f]
    const capped = await capProblem(f, crew[f], capDay)
    if (capped) return res.status(409).json({ error: capped, crew_field: f })
  }
  // And how many ads this channel is already running that day.
  const adFull = await adCapProblem(safeType, channels, release_date)
  if (adFull) return res.status(409).json({ error: adFull, crew_field: 'release_date' })

  const isFilmed = (await getCrewNeeds()).operator.includes(safeType)
  if (isFilmed && isBooking(status, await all('SELECT id, label, sort, is_final FROM statuses'))) {
    const booking = bookingProblem({
      operatorId: crew.operator_id, recording: recording_date, editReady: edit_ready_date,
      release: release_date, refReady: refCarried || hasLink(reference_text) || isSentence(briefText.script),
    })
    if (booking && !free) return res.status(400).json({ error: booking })
  }
  const maxSort = (await get('SELECT COALESCE(MAX(todo_sort), -1) AS m FROM content')).m
  const info = await run(`
    INSERT INTO content (title, channels, type, assignee_id, assignees, created_by, status_id, campaign_id, operator_id, editor_id, designer_id, reviewer_id, reviewers,
      recording_date, recording_time, recording_end, edit_ready_date, design_ready_date, release_date, release_time, description, ready_link,
      shot_link, design_link, reference_text, reference_links, format, rubrika, script, tz, script_key, photo, photo_thumb, checklist, todo_sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    String(title).trim(), JSON.stringify(channels), safeType, assignee, JSON.stringify(assigneeList), req.user.id, status, campaignId,
    crew.operator_id, crew.editor_id, crew.designer_id, crew.reviewer_id, JSON.stringify(reviewerList),
    recording_date || null, recording_time, recording_end, edit_ready_date || null, design_ready_date || null, release_date || null, release_time,
    cleanDescription, cleanLink(req.body?.ready_link) || null,
    cleanLink(req.body?.shot_link) || null, cleanLink(req.body?.design_link) || null,
    reference_text ? String(reference_text).slice(0, 4000) : null, JSON.stringify(referenceLinks),
    briefText.format, briefText.rubrika, briefText.script, briefText.tz, scriptKey(briefText.script),
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
  res.status(201).json(await listRow(info.lastInsertRowid))
}))

// A real duplicate.
//
// This used to be done from the browser by POSTing a new task named
// "<title> (copy)" with every date left off — so the copy landed in
// Unassigned, nowhere near the board you were looking at, and all you saw was
// a toast saying it had worked. It looked like the button did nothing.
//
// A duplicate is the same task again: same brief, same crew, same dates, same
// column. Only the name changes, and only enough to tell them apart.
//
// Columns that belong to the original's own history rather than to a copy of
// it — when it was made, when it was finished, when each stage was handed
// over — start empty on the copy.
// …and so do the dates, the stage and the delivery. The button has always
// said "brief, crew and platforms kept — dates and stage cleared", and it was
// telling the truth until the copy was rebuilt from the row's own columns: a
// duplicate then arrived already booked for the shoot the original was booked
// for, already at Editing, with the original's cut hanging off it. What is
// being duplicated is the RECURRING PIECE, not the week it went out in.
const DUP_SKIP = new Set([
  'id', 'created_at', 'done_at', 'ready_at', 'shot_at', 'edited_at',
  'edit_due_revised', 'review_due_revised', 'todo_sort',
  // the week it was made in
  'recording_date', 'recording_time', 'recording_end',
  'edit_ready_date', 'design_ready_date', 'release_date', 'release_time',
  // where that week got to
  'status_id',
  // and what came out of it
  'ready_link', 'ready_file', 'shot_link', 'shot_file', 'design_link', 'design_file', 'post_link',
])

router.post('/:id/duplicate', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'No such task' })
  if (!can(req.user, 'manage_content')) {
    return res.status(403).json({ error: 'You don’t have permission to add tasks' })
  }
  const channels = JSON.parse(row.channels || '[]')
  if (!channels.every((ch) => canAccessDept(req.user, ch))) {
    return res.status(403).json({ error: 'Not your channel' })
  }

  // "Title Duplicate 1", then 2, then 3 — the next free number across every
  // copy that already exists, counted from the original's name so that
  // duplicating a duplicate does not give you "X Duplicate 1 Duplicate 1".
  const base = String(row.title).replace(/\s+Duplicate\s+\d+$/i, '').trim() || 'Task'
  const kin = await all('SELECT title FROM content WHERE title = ? OR title LIKE ?', base, `${base} Duplicate %`)
  let n = 0
  for (const k of kin) {
    const m = /\s+Duplicate\s+(\d+)$/i.exec(k.title || '')
    if (m) n = Math.max(n, Number(m[1]))
  }
  const title = `${base} Duplicate ${n + 1}`.slice(0, 300)

  // Built from the row's own columns, so a column added next year is copied
  // without anybody having to remember this place.
  const cols = Object.keys(row).filter((k) => !DUP_SKIP.has(k))
  const vals = cols.map((k) => (k === 'title' ? title : k === 'created_by' ? req.user.id : row[k]))
  const maxSort = (await get('SELECT COALESCE(MAX(todo_sort), -1) AS m FROM content')).m
  cols.push('todo_sort', 'created_at')
  vals.push(maxSort + 1, new Date().toISOString())
  // A copy starts at the beginning of the pipeline. The first stage is
  // whatever the board's first stage is called, not a hard-coded "idea".
  const first = await get('SELECT id FROM statuses ORDER BY sort, id LIMIT 1')
  if (first) { cols.push('status_id'); vals.push(first.id) }

  const info = await run(
    `INSERT INTO content (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...vals)
  await logEvent(req.user, info.lastInsertRowid, title, 'created')

  // The crew carried across are holding the copy too, so they are told the
  // same way they would be told about any other task handed to them.
  const roles = new Map()
  for (const id of JSON.parse(row.assignees || '[]')) addRole(roles, id, 'owner')
  addRole(roles, row.operator_id, 'operator')
  addRole(roles, row.editor_id, 'editor')
  addRole(roles, row.designer_id, 'designer')
  addRole(roles, row.reviewer_id, 'reviewer')
  await notifyAssigned(req, info.lastInsertRowid, title, roles, dateBit(null, null))

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
  const onChannel = adminHere(req.user, row) ||
    chansOf(row).some((ch) => (req.user.departments || []).includes(ch))
  if (!can(req.user, 'request_changes') || !onChannel)
    return res.status(403).json({ error: 'Only the channel’s reviewer can request changes' })
  const note = String(req.body?.note ?? '').trim().slice(0, 4000)
  if (!note) return res.status(400).json({ error: 'Write what needs changing' })
  // Deliberately still required in writing even when a clip is attached: a
  // voice note cannot be skimmed a week later, and the editor coming back to
  // this on Friday needs a line they can read at a glance.
  // Who fixes it: the picked stage, defaulting to whoever holds a hat.
  let target = ['operator', 'editor', 'designer'].includes(req.body?.target) ? req.body.target : null
  if (!target) target = row.editor_id ? 'editor' : row.designer_id ? 'designer' : row.operator_id ? 'operator' : 'editor'
  const round = (await get('SELECT COALESCE(MAX(round), 0) AS m FROM revisions WHERE content_id = ?', row.id)).m + 1
  // A Pravki note is usually about a frame, so it may carry the screenshot
  // that shows it — pasted straight from the clipboard, downscaled in the
  // browser exactly like the reference photo.
  const shot = typeof req.body?.photo === 'string' && req.body.photo.startsWith('data:image/') ? req.body.photo : null
  const shotThumb = shot && typeof req.body?.photo_thumb === 'string' ? req.body.photo_thumb : null
  // Said out loud is the fastest way to explain what is wrong with a cut, and
  // the tone carries half the meaning.
  const voice = await saveVoice(req, row, req.body)
  if (voice.error) return res.status(400).json({ error: voice.error })
  await run(`
    INSERT INTO revisions (content_id, round, requested_by, requested_name, target, note, photo, photo_thumb, voice_id, voice_secs, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, row.id, round, req.user.id, req.user.name || '', target, note, shot, shotThumb, voice.id, voice.secs, new Date().toISOString())
  // Send the stage back — leaving the final stage undoes done_at and its plan.
  const sid = await revisionStageId(target)
  if (sid && sid !== row.status_id) {
    await run('UPDATE content SET status_id = ?, done_at = NULL WHERE id = ?', sid, row.id)
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
  if (!hatHolder && !adminHere(req.user, row) && !(can(req.user, 'deliver_work') && canTouch(req.user, row)))
    return res.status(403).json({ error: 'This isn’t your fix to deliver' })
  const patch = {}
  const field = { operator: 'shot_link', editor: 'ready_link', designer: 'design_link' }[rev.target]
  if (req.body?.link !== undefined) {
    const link = cleanLink(req.body.link)
    if (link && !/^https?:\/\//i.test(link))
      return res.status(400).json({ error: linkComplaint(link, 'The fixed file') })
    patch[field] = link || null
  }
  // Sending it back with the SAME file is not a fix. It is the commonest way
  // a revision round evaporates: the note is read, the tick is pressed, the
  // reviewer opens the identical cut and the whole round has cost a day for
  // nothing. Whoever is delivering has to say what they are delivering.
  {
    const next = patch[field] !== undefined ? patch[field] : row[field]
    if (!next)
      return res.status(400).json({
        error: 'Attach the fixed file — a fix with nothing on it is the same piece coming back',
        needs_link: field,
      })
    if (String(next) === String(row[field] ?? ''))
      return res.status(400).json({
        error: 'That is the same file that was sent back. Upload the new one and paste its link.',
        needs_link: field,
      })
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

// ---- how much one person can be given ---------------------------------------
// A content head could hand an editor eleven cuts for a Tuesday, and nothing
// on the board said otherwise until Tuesday came and nine of them were late.
// The ceiling is a property of the PERSON — some editors take four a day and
// some take one — and it is checked when the work is handed over, which is
// the only moment anybody can still do something about it.
//
// 0 means no ceiling, which is what everyone was before this existed.
//
// The day counted is the day the work is DUE from them: an editor's cut day,
// an operator's shoot day, a designer's artwork day. Not the release, which
// is somebody else's promise.
const CAP_DATE = { editor_id: 'edit_ready_date', operator_id: 'recording_date', designer_id: 'design_ready_date' }
export async function capProblem(hatField, personId, day, excludeId) {
  if (!personId || !day) return null
  const u = await get('SELECT name, daily_cap FROM users WHERE id = ?', personId)
  const cap = u?.daily_cap || 0
  if (!cap) return null
  const dateCol = CAP_DATE[hatField]
  const dead = (await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id)
  const rows = await all(
    `SELECT id FROM content WHERE ${hatField} = ? AND ${dateCol} = ? AND done_at IS NULL
     ${dead.length ? `AND status_id NOT IN (${dead.map(() => '?').join(',')})` : ''}`,
    personId, day, ...dead)
  const already = rows.filter((r) => r.id !== excludeId).length
  if (already < cap) return null
  const what = { editor_id: 'cuts', operator_id: 'shoots', designer_id: 'pieces of artwork' }[hatField]
  return `${u.name} already has ${already} ${what} due on ${day}, which is their day's limit of ${cap}. `
    + 'Give it another day, another person, or raise their limit in Admin → People.'
}

// ---- what everybody's day already looks like --------------------------------
// The cap refuses an over-assignment at save time, which is correct and, on
// its own, rude: a content head picks a name from a list of nine, presses
// save, and is told the person's Tuesday was already full. They could not
// have known — the list was just names.
//
// So the same arithmetic is offered up front. One question, one answer for
// the whole team, so the picker can grey out a full day instead of letting
// somebody walk into it.
export async function loadFor(hatField, day) {
  const dateCol = { operator_id: 'recording_date', editor_id: 'edit_ready_date', designer_id: 'design_ready_date' }[hatField]
  if (!dateCol || !day) return {}
  const dead = (await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(String(st.label || ''))).map((st) => st.id)
  const rows = await all(
    `SELECT ${hatField} AS person FROM content
     WHERE ${hatField} IS NOT NULL AND ${dateCol} = ? AND done_at IS NULL
     ${dead.length ? `AND status_id NOT IN (${dead.map(() => '?').join(',')})` : ''}`,
    day, ...dead)
  const busy = {}
  for (const r of rows) busy[r.person] = (busy[r.person] || 0) + 1
  const out = {}
  for (const u of await all('SELECT id, daily_cap FROM users')) {
    out[u.id] = { taken: busy[u.id] || 0, cap: u.daily_cap || 0 }
  }
  return out
}

// ---- how many ads a channel runs in a day -----------------------------------
// The per-person cap answers "can this editor take another cut on Tuesday".
// This answers a different question the same day: "should this CHANNEL be
// running a fifth ad on Tuesday". Ads are bought a month at a time and burn
// their audience if they land in a heap, so the ceiling belongs to the
// channel and is checked when the release day is set, which is the only
// moment anybody can still spread them out.
export async function adCapProblem(type, chans, day, excludeId) {
  if (type !== 'target' || !day) return null
  const dead = (await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(String(st.label || ''))).map((st) => st.id)
  for (const key of (Array.isArray(chans) ? chans : [])) {
    const ch = await get('SELECT label, daily_ad_cap FROM channels WHERE key = ?', key)
    const cap = ch?.daily_ad_cap || 0
    if (!cap) continue
    const rows = await all(
      `SELECT id, channels FROM content WHERE type = 'target' AND release_date = ?
       ${dead.length ? `AND status_id NOT IN (${dead.map(() => '?').join(',')})` : ''}`,
      day, ...dead)
    const already = rows.filter((r) => {
      if (r.id === excludeId) return false
      let list = []
      try { list = JSON.parse(r.channels || '[]') } catch { list = [] }
      return list.includes(key)
    }).length
    if (already >= cap) {
      return `${ch.label} already has ${already} video ${already === 1 ? 'ad' : 'ads'} going out on ${day}, `
        + `which is its limit of ${cap} a day. Pick another day, or raise the limit in Admin → Channels.`
    }
  }
  return null
}

// The channels a crew member works on. Empty means all of them.
export async function crewChannelProblem(personId, chans) {
  if (!personId) return null
  const u = await get('SELECT name, crew_channels FROM users WHERE id = ?', personId)
  let mine = []
  try { mine = JSON.parse(u?.crew_channels || '[]') } catch { mine = [] }
  if (!mine.length) return null
  const list = Array.isArray(chans) ? chans : []
  if (list.some((ch) => mine.includes(ch))) return null
  return `${u.name} doesn’t work on this channel. Pick somebody who does, or add the channel to them in Admin → People.`
}

// ---- late work chases its own owner ----------------------------------------
// Fifty overdue pieces piled into one strip for an admin to drag back onto the
// calendar, one at a time. That is the wrong person doing the wrong job: the
// people who know why a piece slipped are the ones holding it, and every one
// of those fifty had a reason nobody ever wrote down.
//
// So late work is dealt out to whoever is carrying it. Each phase has an owner
// and a promised day (server/deadlines.js), and a day that has gone by with
// the work still in somebody's hands is theirs to answer for: give it a new
// day (which, for a promised one, means asking), say what is in the way, or
// finish it.
const LATE_PHASE = {
  shoot: { field: 'recording_date', owner: 'operator_id', what: 'the shoot', phase: 'shoot' },
  edit: { field: 'edit_ready_date', owner: 'editor_id', what: 'the cut', phase: 'edit' },
  design: { field: 'design_ready_date', owner: 'designer_id', what: 'the artwork', phase: 'design' },
  release: { field: 'release_date', owner: null, what: 'the release', phase: 'review' },
}
// "Is this phase behind us?" lives in ONE place — deadlines.js — because every
// part of the board was answering it slightly differently and finished work
// went on being called late for weeks as a result.
// Everything this person is personally late on, newest first — the list they
// are asked to deal with, not the whole board's backlog.
async function lateForUser(user) {
  const today = dayISO()
  const gates = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
  const dead = new Set((await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const rows = await all(`SELECT id, title, channels, type, status_id, assignee_id, assignees,
      operator_id, editor_id, designer_id, ready_at, shot_at, edited_at, done_at,
      recording_date, edit_ready_date, design_ready_date, release_date FROM content WHERE done_at IS NULL`)
  const out = []
  for (const row of rows) {
    if (dead.has(row.status_id)) continue
    if (!canSee(user, { ...row, channels: chansOf(row) })) continue
    for (const [phase, spec] of Object.entries(LATE_PHASE)) {
      const due = row[spec.field]
      if (!due || due >= today) continue
      // Work that has already left this phase is not late in it any more.
      if (phasePassed(row, spec.phase, gates)) continue
      // Whose is it? The hat that owns the phase, or the person the whole
      // task belongs to when the phase has no hat of its own.
      const owners = spec.owner ? [row[spec.owner]] : [row.assignee_id, ...assigneesOf(row)]
      if (!owners.filter(Boolean).includes(user.id)) continue
      const openAsk = await get(
        "SELECT id FROM date_requests WHERE content_id = ? AND field = ? AND state = 'open'", row.id, spec.field)
      // ANY hand up on the piece, not only this person's: the board raises one
      // itself when work goes silently late, and being nagged to say something
      // about a piece that already has a hand up is the nagging being wrong.
      const openFlag = await get(
        'SELECT id FROM task_flags WHERE content_id = ? AND cleared_at IS NULL', row.id)
      out.push({
        id: `${row.id}:${phase}`,
        content_id: row.id,
        title: row.title,
        type: row.type,
        channels: chansOf(row),
        phase,
        what: spec.what,
        field: spec.field,
        due,
        days_late: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000),
        // Already answered for? Then it is not still asking anything of them.
        asked: !!openAsk,
        flagged: !!openFlag,
      })
    }
  }
  return out.sort((a, b) => b.days_late - a.days_late || a.title.localeCompare(b.title))
}

// "What am I late on?" — the question the strip was answering for the wrong
// person. Cheap enough to ask on every page load.
router.get('/late/mine', wrap(async (req, res) => {
  res.json(await lateForUser(req.user))
}))

// Work that has been late for days without anybody saying anything raises its
// own hand. Silence is the failure mode this whole round is about: a piece
// three days past its day, with no new date asked for and nothing said about
// why, is invisible to everyone except the strip nobody reads.
//
// Once per piece, never again — this puts a thing on the planners' queue, and
// a queue that refills itself every night is one people stop looking at.
export const AUTO_FLAG_DAYS = 3
export async function autoFlagSilentlyLate() {
  const today = dayISO()
  const gates = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
  const dead = new Set((await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const rows = await all(`SELECT id, title, channels, status_id, assignee_id, assignees,
      operator_id, editor_id, designer_id, shot_at, edited_at, ready_at, done_at,
      recording_date, edit_ready_date, design_ready_date, release_date FROM content WHERE done_at IS NULL`)
  let raised = 0
  for (const row of rows) {
    if (dead.has(row.status_id)) continue
    for (const [phase, spec] of Object.entries(LATE_PHASE)) {
      const due = row[spec.field]
      if (!due) continue
      const daysLate = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000)
      if (daysLate < AUTO_FLAG_DAYS) continue
      if (phasePassed(row, spec.phase, gates)) continue
      // Somebody has already spoken for this piece — an ask in flight, or a
      // hand already up. Nothing to add.
      const spoken = await get(
        `SELECT 1 AS x FROM date_requests WHERE content_id = ? AND state = 'open'
         UNION SELECT 1 AS x FROM task_flags WHERE content_id = ? AND cleared_at IS NULL`, row.id, row.id)
      if (spoken) continue
      // And never twice for the same piece, however long it goes on.
      const before = await get(
        "SELECT 1 AS x FROM task_flags WHERE content_id = ? AND raised_by IS NULL", row.id)
      if (before) continue
      const owner = spec.owner ? row[spec.owner] : row.assignee_id
      const who = owner ? (await get('SELECT name FROM users WHERE id = ?', owner))?.name : null
      const now = new Date().toISOString()
      await run(
        'INSERT INTO task_flags (content_id, kind, reason, raised_by, raised_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        row.id, 'at_risk',
        `${spec.what} was due ${due} and is ${daysLate} days past it, with nothing said about why.`,
        null, 'The board', now)
      raised++
      // The person holding it hears first — this is a nudge before it is a
      // report, and they still have the ask and the hand to answer with.
      if (owner) {
        await run('INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
          owner, 'flag', `«${row.title}» — ${spec.what} is ${daysLate} days late. Give it a day, or say what is in the way.`, row.id, now)
        await tgMirror([owner], `⏳ <b>«${tgEsc(row.title)}»</b>\n${tgEsc(spec.what)} is ${daysLate} days late and nobody has said why.\nGive it a new day, or say what is in the way 👇`, row.id, null)
      }
      break   // one hand per piece, not one per phase
    }
  }
  return raised
}

// ---- raising a hand --------------------------------------------------------
// The crew could always deliver late. They had no way to say so in advance,
// so the first anyone knew was the deadline passing — and by then the only
// options are bad ones. A flag is the cheap early word, on the task, where
// the plan is made: "this will be late", or "I cannot take this at all",
// with the reason. Anybody holding a hat on the piece can raise one; the
// people who plan hear it at once.
const FLAG_WORDS = {
  at_risk: 'says this will be late',
  cant_take: 'cannot take this on',
}
router.post('/:id/flags', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const parsed = { ...row, channels: JSON.parse(row.channels || '[]') }
  if (!canSee(req.user, parsed)) return res.status(404).json({ error: 'Not found' })
  const kind = FLAG_WORDS[req.body?.kind] ? req.body.kind : 'at_risk'
  // The reason IS the flag. "It will be late" without one tells the planner
  // nothing they can act on, which is the same as not being told.
  const reason = String(req.body?.reason ?? '').trim().slice(0, 2000)
  if (!isSentence(reason))
    return res.status(400).json({ error: 'Say what is in the way — a heads-up with no reason leaves the same guessing as no heads-up' })
  // Whoever is actually carrying it, or whoever plans it.
  const onIt = [row.operator_id, row.editor_id, row.designer_id, row.assignee_id, ...assigneesOf(row)].includes(req.user.id)
  if (!onIt && !can(req.user, 'manage_content') && !can(req.user, 'move_tasks'))
    return res.status(403).json({ error: 'Only somebody on this task can raise a hand about it' })
  const already = await get('SELECT id FROM task_flags WHERE content_id = ? AND raised_by = ? AND cleared_at IS NULL', row.id, req.user.id)
  if (already) return res.status(409).json({ error: 'You already have a hand up on this — say the rest in the thread' })

  const now = new Date().toISOString()
  const info = await run(
    'INSERT INTO task_flags (content_id, kind, reason, raised_by, raised_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    row.id, kind, reason, req.user.id, req.user.name || '', now)
  // The people who can do something about it: the admins, and whoever owns
  // the task. Hearing this late is the whole problem being solved.
  const admins = (await all("SELECT id FROM users WHERE role = 'admin'")).map((u) => u.id)
  const people = [...new Set([...admins, row.assignee_id, ...assigneesOf(row)].filter((id) => id && id !== req.user.id))]
  if (people.length) {
    const line = `${req.user.name} ${FLAG_WORDS[kind]} — «${row.title}»: ${clip(reason)}`
    await batch(people.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, 'flag', line, row.id, now,
    ]))
    await tgMirror(people, `${kind === 'cant_take' ? '🙅' : '⏳'} <b>${tgEsc(req.user.name)}</b> ${tgEsc(FLAG_WORDS[kind])}\n<b>«${tgEsc(row.title)}»</b>\n“${tgEsc(clip(reason))}”\nSort it while there is still time 👇`, row.id, tgOriginFrom(req))
  }
  await run(...actRow(req.user, row.id, row.title, 'updated', 'flag', null, kind, now))
  res.status(201).json(await get('SELECT * FROM task_flags WHERE id = ?', info.lastInsertRowid))
}))

// Putting the hand down — by whoever raised it, or by whoever sorted it out.
router.post('/flags/:fid/clear', wrap(async (req, res) => {
  const f = await get('SELECT * FROM task_flags WHERE id = ?', req.params.fid)
  if (!f) return res.status(404).json({ error: 'Not found' })
  if (f.cleared_at) return res.status(409).json({ error: 'That hand is already down' })
  if (f.raised_by !== req.user.id && !adminHere(req.user, await get('SELECT channels FROM content WHERE id = ?', f.content_id)) && !can(req.user, 'manage_content'))
    return res.status(403).json({ error: 'Only whoever raised it, or somebody who can act on it, puts it down' })
  await run('UPDATE task_flags SET cleared_at = ?, cleared_by = ?, cleared_name = ? WHERE id = ?',
    new Date().toISOString(), req.user.id, req.user.name || '', f.id)
  res.json(await get('SELECT * FROM task_flags WHERE id = ?', f.id))
}))

// Every hand currently up, for the people who plan. Same shape as the
// day-move queue, and on the same Overview, because they are the same job:
// something needs deciding before a deadline decides it for you.
router.get('/flags/open', wrap(async (req, res) => {
  if (!can(req.user, 'manage_content') && !can(req.user, 'move_tasks') && req.user.role !== 'admin')
    return res.json([])
  const rows = await all(`
    SELECT f.id, f.content_id, f.kind, f.reason, f.raised_name, f.created_at, c.title, c.channels,
           c.recording_date, c.edit_ready_date, c.release_date
    FROM task_flags f JOIN content c ON c.id = f.content_id
    WHERE f.cleared_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.id = c.status_id AND LOWER(s.label) = 'deleted')
    ORDER BY f.id`)
  // A channel admin is shown the channels they run; everyone else who can see
  // this queue sees what they could already see on the board.
  res.json(req.user.role === 'admin'
    ? rows.filter((r) => isAdminOn(req.user, chansOf(r)))
    : rows.filter((r) => chansOf(r).some((ch) => (req.user.departments || []).includes(ch))))
}))

// ---- moving a promised day -------------------------------------------------
// A deadline with a date on it is a promise, and only an admin moves one.
// Everyone else ASKS — which day, to which day, and why — and the ask is the
// record. The date moves on an admin's yes and not a moment before, so the
// reason a deadline slipped is written down at the time instead of being
// remembered differently by two people a fortnight later.
const DATE_LABELS = {
  recording_date: 'the shoot day', edit_ready_date: 'the day the cut is due',
  design_ready_date: 'the day the artwork is due', release_date: 'the release day',
}
const openRequestsFor = (contentId) => all(
  `SELECT id, field, from_date, to_date, reason, state, asked_by, asked_name, created_at,
          decided_by, decided_name, decided_at, decided_note
   FROM date_requests WHERE content_id = ? ORDER BY id DESC`, contentId)

// Everything waiting on an admin's yes, in one place. Without this the whole
// asking mechanism depends on an admin happening to open the right task: the
// bell scrolls away, and a deadline nobody answered is a deadline that quietly
// stays wrong. Cheap enough to sit on the Overview and be right every time.
router.get('/date-requests/open', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.json([])
  const rows = await all(`
    SELECT d.id, d.content_id, d.field, d.from_date, d.to_date, d.reason, d.asked_name, d.created_at,
           c.title, c.channels
    FROM date_requests d JOIN content c ON c.id = d.content_id
    WHERE d.state = 'open'
      AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.id = c.status_id AND LOWER(s.label) = 'deleted')
    ORDER BY d.id`)
  // Only the channels this admin runs — a queue you cannot act on is noise.
  res.json(rows.filter((r) => isAdminOn(req.user, chansOf(r))))
}))

router.post('/:id/date-requests', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })
  if (!can(req.user, 'manage_content') && !can(req.user, 'move_tasks'))
    return res.status(403).json({ error: 'You don’t have permission to move dates' })
  const field = String(req.body?.field || '')
  if (!DATE_LABELS[field]) return res.status(400).json({ error: 'That is not a deadline' })
  if (!row[field]) return res.status(400).json({ error: 'That day is not set yet — you can simply fill it in' })
  const to = req.body?.to_date ? String(req.body.to_date).slice(0, 10) : null
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ error: 'Give the new day as a date' })
  if (String(to ?? '') === String(row[field]))
    return res.status(400).json({ error: 'That is the day it already has' })
  // The reason is the whole point of asking, so it has to BE one. A dot or an
  // "N/A" here would leave the record saying a date moved for no reason.
  const reason = String(req.body?.reason ?? '').trim().slice(0, 2000)
  if (!isSentence(reason))
    return res.status(400).json({ error: 'Say what happened — a day moves on a reason, and “—” is not one' })
  // One open ask per deadline: a second is the same conversation, not a new one.
  const already = await get(
    "SELECT id FROM date_requests WHERE content_id = ? AND field = ? AND state = 'open'", row.id, field)
  if (already) return res.status(409).json({ error: 'That day already has a request waiting on an admin' })

  const now = new Date().toISOString()
  const info = await run(`
    INSERT INTO date_requests (content_id, field, from_date, to_date, reason, state, asked_by, asked_name, created_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `, row.id, field, row[field], to, reason, req.user.id, req.user.name || '', now)

  // Every admin hears it, because any of them can answer it.
  const admins = (await all("SELECT id FROM users WHERE role = 'admin'")).map((u) => u.id)
    .filter((id) => id !== req.user.id)
  if (admins.length) {
    const line = `${req.user.name} asks to move ${DATE_LABELS[field]} on «${row.title}» — ${row[field]} → ${to || 'cleared'}`
    await batch(admins.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, 'date_request', line, row.id, now,
    ]))
    await tgMirror(admins, `📅 <b>${tgEsc(req.user.name)}</b> asks to move ${tgEsc(DATE_LABELS[field])} on <b>«${tgEsc(row.title)}»</b>\n${tgEsc(row[field])} → ${tgEsc(to || 'cleared')}\n“${tgEsc(reason.slice(0, 200))}”\nSay yes or no on the task 👇`, row.id, tgOriginFrom(req))
  }
  await run(...actRow(req.user, row.id, row.title, 'updated', 'date_request', row[field], to, now))
  res.status(201).json(await get('SELECT * FROM date_requests WHERE id = ?', info.lastInsertRowid))
}))

// The admin's answer. Yes moves the day; no leaves it exactly where it was.
// Either way the asker hears back, because an unanswered ask is worse than a
// refusal — it leaves somebody planning around a date nobody has agreed to.
router.post('/date-requests/:rid/decide', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin answers a date request' })
  const dr = await get('SELECT * FROM date_requests WHERE id = ?', req.params.rid)
  if (!dr) return res.status(404).json({ error: 'Not found' })
  if (dr.state !== 'open') return res.status(409).json({ error: 'That request has already been answered' })
  const row = await get('SELECT * FROM content WHERE id = ?', dr.content_id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  // An admin answers for the channels they run. Somebody else's channel is
  // somebody else's promise to move.
  if (!adminHere(req.user, row))
    return res.status(403).json({ error: 'That day belongs to a channel you don’t run — its own admin answers this' })
  const approve = !!req.body?.approve
  const note = String(req.body?.note ?? '').trim().slice(0, 2000)
  const now = new Date().toISOString()

  // The day may have moved under the request while it waited. Approving then
  // would apply an answer to a question nobody asked, so it is refused and the
  // asker can ask again against what the task actually says now.
  if (approve && String(row[dr.field] ?? '') !== String(dr.from_date ?? '')) {
    await run("UPDATE date_requests SET state = 'stale', decided_by = ?, decided_name = ?, decided_at = ?, decided_note = ? WHERE id = ?",
      req.user.id, req.user.name || '', now, 'the day changed while this was waiting', dr.id)
    return res.status(409).json({ error: 'That day has changed since the request was made — ask again against the day it has now' })
  }
  if (approve) {
    await run(`UPDATE content SET ${dr.field} = ? WHERE id = ?`, dr.to_date || null, row.id)
    await logPatch(req.user, row, { [dr.field]: dr.to_date || null })
  }
  await run("UPDATE date_requests SET state = ?, decided_by = ?, decided_name = ?, decided_at = ?, decided_note = ? WHERE id = ?",
    approve ? 'approved' : 'declined', req.user.id, req.user.name || '', now, note, dr.id)

  if (dr.asked_by && dr.asked_by !== req.user.id) {
    const line = approve
      ? `${req.user.name} moved ${DATE_LABELS[dr.field]} on «${row.title}» to ${dr.to_date || 'nothing'} — as you asked`
      : `${req.user.name} kept ${DATE_LABELS[dr.field]} on «${row.title}» at ${dr.from_date}${note ? ` — ${note}` : ''}`
    await run('INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      dr.asked_by, 'date_request', line, row.id, now)
    await tgMirror([dr.asked_by], `${approve ? '✅' : '🚫'} ${tgEsc(line)}`, row.id, tgOriginFrom(req))
  }
  res.json({ ok: true, request: await get('SELECT * FROM date_requests WHERE id = ?', dr.id), task: await listRow(row.id) })
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
  // The admin is not made to fill in a form; see `unfettered` above. Scoped
  // to the channels this piece is actually on, so a channel admin is free on
  // their own board and nowhere else.
  const free = unfettered(req.user, oldChannels)
  const patch = {}

  // Who holds which hat on this task — the milestone tick each may mark.
  const isOperator = row.operator_id === req.user.id
  const isEditor = row.editor_id === req.user.id
  const isDesigner = row.designer_id === req.user.id
  const canOverride = can(req.user, 'move_tasks')

  // The crew move their own work with a single tick — not a free stage picker.
  // "shot" (operator) hands it to Editing; "edited"/"designed" (editor and
  // designer) land it on Ready. Anyone with move_tasks may tick on their
  // behalf.
  if (body.milestone) {
    const m = body.milestone
    // Marking work finished is a claim, and for the two stages that produce a
    // FILE the claim is checkable: a cut exists as a link or it does not
    // exist. "Edited" with nothing attached sends the piece to review with
    // nothing to review, and the reviewer discovers that instead of the
    // editor.
    //
    // The shoot is deliberately exempt. Footage is handed over on a hard
    // drive as often as not, and refusing the tick would not create the file
    // — it would just leave the board saying the shoot has not happened.
    const NEEDS_FILE = {
      edited: { field: 'ready_link', what: 'the cut' },
      designed: { field: 'design_link', what: 'the artwork' },
    }
    // The admin ticking a milestone is catching the board up on work that
    // already happened somewhere else, and has no file to paste for it.
    const proof = free ? null : NEEDS_FILE[m]
    if (proof) {
      const fileKey = { ready_link: 'ready_file', design_link: 'design_file' }[proof.field]
      const named = body[fileKey] !== undefined ? cleanFileLabel(body[fileKey]) : ''
      const link = named || (body[proof.field] !== undefined ? cleanLink(body[proof.field]) : row[proof.field])
      const hasFile = await get('SELECT 1 AS x FROM attachments WHERE content_id = ?', row.id)
      if (!link && !hasFile)
        return res.status(400).json({
          error: `Paste ${proof.what} before marking it done — a stage that says finished with nothing attached is a stage the reviewer has to chase`,
          needs_link: proof.field,
        })
    }
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

  // ---- whose miss was it ----------------------------------------------
  // The board works this out from the work itself (see deadlines.js), and it
  // is right most of the time. Where it cannot be — a script that arrived late
  // but is sitting there now, an agreement made in a corridor — somebody with
  // the whole picture says so, and their answer wins over the derivation for
  // good. Only an admin on the channel: this is the number people are paid
  // and judged against.
  if (body.miss_blame !== undefined) {
    if (!adminHere(req.user, row))
      return res.status(403).json({ error: 'Only an admin on this channel decides whose delay it was' })
    const v = body.miss_blame === null || body.miss_blame === '' ? null : String(body.miss_blame)
    if (v !== null && v !== 'production' && v !== 'make')
      return res.status(400).json({ error: 'A delay belongs to production or to content — or to neither, which is the board working it out' })
    patch.miss_blame = v
    patch.miss_blame_by = v ? req.user.id : null
    // A verdict with no reason is the thing this replaces. Clearing it back to
    // the derived answer needs none — that is undoing, not deciding.
    if (v) {
      const note = String(body.miss_blame_note ?? '').trim().slice(0, 600)
      if (!note) return res.status(400).json({ error: 'Say why — a verdict nobody can read back is worse than the board’s guess' })
      patch.miss_blame_note = note
    } else {
      patch.miss_blame_note = null
    }
  }

  // ---- what it actually got ------------------------------------------------
  // The number is entered by hand because the board is not plugged into
  // Instagram, YouTube and Telegram — and pretending otherwise would put a
  // made-up figure next to somebody's pay. Whoever the piece is FOR may write
  // it, and so may an admin on the channel: the content maker is the one who
  // opens the app and reads the count off it.
  //
  // NULL is not zero. Clearing the box means "nobody has written it down",
  // which is what an unmeasured piece honestly is; 0 means it was measured and
  // got none. The sums and the KPI depend on being able to tell them apart.
  if (body.views !== undefined) {
    const madeIt = [row.assignee_id, ...assigneesOf(row)].filter(Boolean).includes(req.user.id)
    if (!adminHere(req.user, row) && !madeIt)
      return res.status(403).json({ error: 'Only an admin on this channel, or somebody the piece is for, records its views' })
    if (body.views === null || body.views === '') {
      patch.views = null
      patch.views_at = null
      patch.views_by = null
    } else {
      const n = Number(body.views)
      if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n)
        return res.status(400).json({ error: 'Views is a whole number of views, or empty for “nobody has counted yet”' })
      // A billion views on a school's Instagram is a typo, and a typo that
      // reaches the payroll is worse than a refusal.
      if (n > 1e10) return res.status(400).json({ error: 'That is more views than the internet has — check the number' })
      patch.views = n
      patch.views_at = new Date().toISOString()
      patch.views_by = req.user.id
    }
  }

  // Setting the stage directly still needs move_tasks — the crew no longer get
  // a free hand here; their ticks above are the sanctioned path. The one
  // exception is the reviewer publishing: review_publish alone unlocks the
  // Ready → Published move even without move_tasks.
  if (body.status_id !== undefined && body.status_id !== row.status_id) {
    // A stage that does not exist is not a stage. Taken on trust, it put the
    // task in a column no board draws — gone from the workspace without ever
    // being deleted, which is the worst way for a task to disappear. Null is
    // allowed on purpose: a task between stages is a real state.
    if (body.status_id !== null && !(await get('SELECT 1 AS x FROM statuses WHERE id = ?', body.status_id)))
      return res.status(400).json({ error: 'No such stage' })
    const intoFinal = await isFinal(body.status_id)
    if (!canOverride && !(intoFinal && canPublish(req.user, row)))
      return res.status(403).json({ error: 'You can see the stage but can’t move it — use your Shot / Edited tick, or ask an admin' })
    patch.status_id = body.status_id
  }

  // The finished-file link: the crew (or an editor of the task) drops in a
  // Google-Drive URL; admins with manage_content may set it too.
  if (body.ready_link !== undefined || body.ready_file !== undefined) {
    if (!isCrew && !can(req.user, 'manage_content'))
      return res.status(403).json({ error: 'You can’t set the ready link on this task' })
    const built = await buildDelivery(req, row, body, 'ready_file', 'The cut')
    if (built.error) return res.status(400).json({ error: built.error })
    patch.ready_link = built.value
  }

  // Per-stage delivery links: the operator drops raw footage (shot_link) and
  // the designer the artwork (design_link) — the editor's finished cut is the
  // existing ready_link ("Edit ready"), handled above. Each is owned by the
  // person who holds that hat (or manage_content) and never overwrites another.
  for (const { field, hat } of [
    { field: 'shot_link', hat: isOperator },
    { field: 'design_link', hat: isDesigner },
  ]) {
    const fileKey = field === 'shot_link' ? 'shot_file' : 'design_file'
    if (body[field] === undefined && body[fileKey] === undefined) continue
    if (!hat && !can(req.user, 'manage_content') && !can(req.user, 'deliver_work'))
      return res.status(403).json({ error: 'You can’t set that delivery link' })
    const built = await buildDelivery(req, row, body, fileKey, 'A delivery link')
    if (built.error) return res.status(400).json({ error: built.error })
    patch[field] = built.value
  }

  // Where the piece went live. Not a crew delivery — nobody holds a "posted"
  // hat — so it belongs to whoever may edit the task or publish on it, which
  // is the same set of people who can make the move it gates.
  if (body.post_link !== undefined) {
    if (!can(req.user, 'manage_content') && !can(req.user, 'review_publish'))
      return res.status(403).json({ error: 'You can’t set the published link on this task' })
    const posted = String(body.post_link ?? '').trim().slice(0, 500)
    if (posted && !hasLink(posted))
      return res.status(400).json({ error: 'That is not a link — it has to start with http:// or https://' })
    patch.post_link = posted || null
  }

  // The Reference block (style / mood / format text and example URLs) — part
  // of the brief, so editing it needs manage_content. Crew see it, never set it.
  if (body.reference_text !== undefined) {
    if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    const next = body.reference_text ? String(body.reference_text).slice(0, 4000) : null
    // The same rule the creation form applies: a task edited into a
    // placeholder is exactly as unhelpful as one created that way. Only text
    // standing ALONE has to carry a link — links, a photo or an attached
    // document already point somewhere, so text beside them is a caption.
    const links = body.reference_links !== undefined
      ? cleanLinks(body.reference_links)
      : (() => { try { return JSON.parse(row.reference_links || '[]') } catch { return [] } })()
    const carried = links.length > 0 || !!(body.photo !== undefined ? body.photo : row.photo)
    if (next && !carried && !free) {
      if (!hasSubstance(next))
        return res.status(400).json({ error: `«Reference» needs a real answer — “${clip(next)}” is a placeholder, not a reference` })
      if (!hasLink(next))
        return res.status(400).json({ error: '«Reference» has to point somewhere — paste a link, or attach the photo or document it refers to' })
    }
    patch.reference_text = next
  }
  if (body.reference_links !== undefined) {
    if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    patch.reference_links = JSON.stringify(cleanLinks(body.reference_links))
  }

  // The brief fields (format / rubrika / script) — manage_content, like the
  // Reference. Clearing one the admin made required for this type is refused.
  if (body.tz !== undefined) patch.tz = cleanScript(body.tz)
  if (['format', 'rubrika', 'script'].some((f) => body[f] !== undefined)) {
    if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    const fieldRules = await getTaskFields()
    const nextType = body.type !== undefined && CONTENT_TYPES.includes(body.type) ? body.type : row.type
    for (const f of ['format', 'rubrika', 'script']) {
      if (body[f] === undefined) continue
      const v = f === 'script' ? cleanScript(body[f]) : cleanShort(body[f])
      const r = fieldRules[f]
      const demanded = !free && r?.state === 'required' && r.types.includes(nextType)
      if (!v && row[f] && demanded)
        return res.status(400).json({ error: `«${FIELD_LABELS[f]}» is required for this type of task — it can’t be cleared` })
      // Emptying a demanded field is refused above; filling it with a dot is
      // the same act wearing a disguise, so it is refused too. Where the field
      // is NOT demanded, a placeholder simply comes to rest as empty rather
      // than reaching the card and reading as content. A demanded SCRIPT is
      // held to the higher bar the crew actually films from — one careless
      // word has letters in it and is still not a shot list.
      const answered = free || (f === 'script' && demanded ? isSentence(v) : hasSubstance(v))
      if (v && !answered) {
        if (demanded)
          return res.status(400).json({ error: `«${FIELD_LABELS[f]}» needs a real answer — “${clip(v)}” is a placeholder, not a brief` })
        patch[f] = null
        if (f === 'script') patch.script_key = null
        continue
      }
      // The same script on two cards is one shoot booked twice. A task
      // KEEPING its own script is not repeating anything, though — an
      // ordinary save sends every field back, and a twin made on purpose
      // (Duplicate) would otherwise make the original unsaveable ever after.
      if (f === 'script' && v && !free && !body.allow_duplicate_script && normScript(v) !== normScript(row.script)) {
        const twin = await duplicateScript(v, row.id)
        if (twin)
          return res.status(400).json({ error: `That script is already on «${twin.title}» — link to it or write what is different about this one` })
      }
      patch[f] = v
      if (f === 'script') patch.script_key = scriptKey(v)
    }
  }

  // Editing details needs manage_content.
  const detailFields = ['title', 'type', 'recording_time', 'recording_end', 'release_time', 'description', 'photo', 'photo_thumb']
  const wantsDetails = detailFields.some((f) => body[f] !== undefined) || body.channels !== undefined
  if (wantsDetails && !can(req.user, 'manage_content'))
    return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
  for (const f of detailFields) if (body[f] !== undefined) patch[f] = body[f]
  if (patch.type !== undefined && !CONTENT_TYPES.includes(patch.type)) patch.type = 'post'

  // The description, held to the same standard on edit as on creation: a
  // demanded one may not become a placeholder, and an optional one comes to
  // rest as empty rather than putting "." on the card.
  if (patch.description !== undefined) {
    const nType = patch.type !== undefined ? patch.type : row.type
    const dr = (await getTaskFields()).description
    const demanded = !free && dr?.state === 'required' && dr.types.includes(nType)
    const d = String(patch.description ?? '').trim()
    if (d && !hasSubstance(d) && !free) {
      if (demanded)
        return res.status(400).json({ error: `«Description» needs a real answer — “${clip(d)}” is a placeholder, not a brief` })
      patch.description = ''
    }
    if (!d && demanded && row.description)
      return res.status(400).json({ error: '«Description» is required for this type of task — it can’t be cleared' })
  }

  // A BOOKED shoot keeps its operator. Without this the demand made at the
  // shooting gate lasts exactly until somebody opens the task and clears the
  // field, or retypes a post as a video after the fact.
  //
  // Only when the edit TOUCHES the operator or the type, and only once the
  // shoot is actually booked — an idea has no crew to lose, and a guard on
  // every patch would make every pre-rule task unmovable, so dragging one to
  // another day would fail for a reason that has nothing to do with the drag.
  //
  // Two things it must not do, both found by trying to type a view count into
  // a published reel. It fired for the ADMIN, who walks through every other
  // wall on this board since round 80 — and it fired on work that is already
  // OUT, where there is no shoot left to protect and no crew left to lose.
  // The task form sends the whole form on every save, `type` included, so
  // "touches the type" meant "was saved at all": a published reel filmed on
  // somebody's phone, with no operator ever named, could not be edited again
  // by anybody, for any reason.
  if (!free && !row.done_at
      && (body.operator_id !== undefined || body.type !== undefined)
      && !isIdea(row.status_id, await all('SELECT id, label, sort, is_final FROM statuses'))) {
    const nType = patch.type !== undefined ? patch.type : row.type
    const nOperator = body.operator_id !== undefined
      ? (body.operator_id === null || body.operator_id === '' ? null : Number(body.operator_id))
      : row.operator_id
    if ((await getCrewNeeds()).operator.includes(nType) && !nOperator)
      return res.status(400).json({ error: 'Pick who is filming this — a shoot nobody is holding is nobody’s job' })
  }
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
  //
  // But a deadline that ALREADY HAS a day is a promise, and a promise the
  // person who made it can quietly move is not one. Changing a date that is
  // set is the admin's alone; filling one that is empty still belongs to
  // whoever may move tasks, so unscheduled work can still be scheduled and an
  // idea can still be given its first day. Clearing counts as changing.
  //
  // The two *_revised dates are exempt: they exist precisely to record a
  // re-promise when a handover lands late, and are already written beside the
  // original rather than over it.
  const LOCKED_DATES = ['recording_date', 'edit_ready_date', 'design_ready_date', 'release_date']
  for (const f of [...LOCKED_DATES, 'edit_due_revised', 'review_due_revised']) {
    if (body[f] !== undefined) {
      if (!can(req.user, 'manage_content') && !can(req.user, 'move_tasks'))
        return res.status(403).json({ error: 'You don’t have permission to move dates' })
      const next = body[f] || null
      if (LOCKED_DATES.includes(f) && row[f] && String(next ?? '') !== String(row[f]) && !adminHere(req.user, row))
        return res.status(403).json({
          error: `That day is already promised — ask an admin to move it, and say what happened.`,
          // What the form needs to offer the ask instead of just refusing:
          // which deadline, the day it holds, and the day that was wanted.
          ask_to_move: { field: f, from: row[f], to: next },
        })
      patch[f] = next
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

  // ---- an accepted slot is not moved behind somebody's back ----------------
  // Once the operator has said they can be there, the shoot day and its hours
  // belong to them as much as to the board: they have cleared an afternoon for
  // it. The same for an editor who has accepted a deadline. Moving it is the
  // admin's to do — and doing it puts the question back to the crew rather
  // than leaving a "confirmed" tick standing over a time nobody agreed to.
  for (const which of Object.keys(BOOKINGS)) {
    const b = BOOKINGS[which]
    const touched = [b.day, b.from, b.to, b.holder].filter(Boolean)
      .filter((f) => patch[f] !== undefined && String(patch[f] ?? '') !== String(row[f] ?? ''))
    if (!touched.length) continue
    if (row[b.ack] === 'yes' && !free) {
      const who = await get('SELECT name FROM users WHERE id = ?', row[b.holder])
      return res.status(409).json({
        error: `${who?.name || 'The ' + b.role} has already agreed to ${b.what} — ${slotWords(row, which)}. An admin can move it; they will be asked again.`,
        booking: which,
      })
    }
    // Re-booked: the answer is about the old time and does not carry over.
    if (row[b.ack]) {
      patch[b.ack] = ''
      patch[b.at] = null
      patch[b.by] = null
      patch[b.note] = null
    }
  }

  // The same two questions on an edit — whether the hat changed, or the day it
  // is due did. Moving three cuts onto one Tuesday is the same act as handing
  // somebody three cuts for Tuesday.
  {
    const nextChans = patch.channels !== undefined ? chansOf({ channels: patch.channels }) : chansOf(row)
    for (const f of ['operator_id', 'editor_id', 'designer_id']) {
      const dateCol = CAP_DATE[f]
      const hatChanged = patch[f] !== undefined && patch[f] !== row[f]
      const dayChanged = patch[dateCol] !== undefined && patch[dateCol] !== row[dateCol]
      const chansChanged = patch.channels !== undefined
      if (!hatChanged && !dayChanged && !chansChanged) continue
      const person = patch[f] !== undefined ? patch[f] : row[f]
      if (!person) continue
      if (hatChanged || chansChanged) {
        const chanProblem = await crewChannelProblem(person, nextChans)
        if (chanProblem) return res.status(400).json({ error: chanProblem, crew_field: f })
      }
      const day = patch[dateCol] !== undefined ? patch[dateCol] : row[dateCol]
      const capped = await capProblem(f, person, day, row.id)
      if (capped) return res.status(409).json({ error: capped, crew_field: f })
    }
  }

  // Moving an ad onto a day the channel has already filled is the same
  // over-booking as creating one there, and reaches this line by a different
  // door — a drag on the release calendar rather than a form.
  {
    const nextType = patch.type !== undefined ? patch.type : row.type
    const nextDay = patch.release_date !== undefined ? patch.release_date : row.release_date
    let nextChans2 = []
    try { nextChans2 = patch.channels !== undefined ? JSON.parse(patch.channels) : JSON.parse(row.channels || '[]') }
    catch { nextChans2 = [] }
    const typeChanged = patch.type !== undefined && patch.type !== row.type
    const dayChanged2 = patch.release_date !== undefined && patch.release_date !== row.release_date
    const chansChanged2 = patch.channels !== undefined && patch.channels !== row.channels
    if (typeChanged || dayChanged2 || chansChanged2) {
      const adFull = await adCapProblem(nextType, nextChans2, nextDay, row.id)
      if (adFull) return res.status(409).json({ error: adFull, crew_field: 'release_date' })
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
      if (!adminHere(req.user, row)) return res.status(403).json({ error: 'Only admins can reassign tasks' })
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
      chans: patch.channels !== undefined ? chansOf({ channels: patch.channels }) : chansOf(row),
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

  // A piece with changes still outstanding is not finished, whoever presses
  // the button. Publishing over an open Pravki is how a round gets lost: the
  // note was written, the fix was never delivered, and the piece went out
  // anyway with the reviewer assuming somebody had dealt with it.
  if ((await isFinal(nextStatus)) && !(await isFinal(row.status_id))) {
    const openFix = await get('SELECT id, note, target FROM revisions WHERE content_id = ? AND resolved_at IS NULL ORDER BY id', row.id)
    if (openFix)
      return res.status(409).json({
        error: `Changes are still outstanding — “${clip(openFix.note)}” went to the ${openFix.target} and has not come back. Close it, or drop it, before this goes out.`,
        open_revision: openFix.id,
      })
  }

  // Stage rules: the admin regulates which kind of actor moves work OUT of
  // which stage (Admin → Pipeline). Applies to moves among working stages —
  // publishing keeps its own key above, un-publishing stays as it was, and
  // admins pass everything. Rules only ever narrow the existing tickets
  // (crew milestones, a member's move_tasks); they never grant new ones.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id && !adminHere(req.user, row) &&
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
  if (patch.status_id !== undefined && patch.status_id !== row.status_id && !adminHere(req.user, row) && !body.milestone) {
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
  // never gated, and a crew member closing THEIR OWN stage is not gated either:
  // the milestone tick has already refused anyone who does not hold the hat, so
  // reaching here means the person who did the work is saying it is done, and
  // that one tap is the most-used action in the product.
  //
  // Admins ARE gated. They were exempt, and the first thing that happened live
  // was an admin walking a card through every stage with nobody named and
  // nothing attached — which is the exact hole this was built to close.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id && !body.milestone) {
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
      // ---- is anybody actually on this? ------------------------------------
      // Every gate below asks who does the NEXT step. None of them asked the
      // plainer question: whose piece is this at all. A task can cross the
      // whole board with no name on it — the shooter names an operator, the
      // edit names an editor, and the piece itself belongs to nobody, which is
      // how work arrives at Published with an empty owner column and no reason
      // anyone can reconstruct. An idea owes nobody an owner; anything past it
      // does.
      const ownedBy = (() => {
        const raw = patch.assignees !== undefined ? patch.assignees : row.assignees
        let list = []
        try { list = JSON.parse(raw || '[]') } catch { list = [] }
        const one = patch.assignee_id !== undefined ? patch.assignee_id : row.assignee_id
        return list.filter(Boolean).length > 0 || !!one
      })()
      const leavingIdea = /^idea$|^ideas$|g'oya|идея/i.test(String(resolved.ordered[at(row.status_id)]?.label || ''))
      if (!ownedBy && !leavingIdea) shortfalls.push({ gate: 'own', missing: 'assignee_id' })

      for (const gate of gatesUpTo(patch.status_id, resolved)) {
        // Only the gates this move actually CROSSES — a stage already behind
        // the card was passed under whatever rules applied at the time.
        if (at(row.status_id) >= gate.index) continue
        const need = NEEDS[gate.key]
        if (!need) continue
        if (need.owner && !val(need.owner)) shortfalls.push({ gate: gate.key, missing: need.owner })
        else if (need.link && !val(need.link) && !(await hasFile())) shortfalls.push({ gate: gate.key, missing: need.link })
      }

      // The shortfall above stays ADVISORY for everything that is written
      // rather than filmed: a text post has no cut to attach and no editor to
      // name, and refusing the move would not create either. It is shown on
      // the card by the StageGate panel (/api/warnings computes the same list)
      // and counted against the handover deadlines below.
      //
      // FILMED work is different, and this is where the two walls are. A shoot
      // is the one thing on this board that cannot be sorted out afterwards:
      // the day passes whether or not a camera, a crew and a brief turned up.
      //
      // Each wall stands at the stage it is ABOUT, and refuses a move that
      // LANDS there — booking a shoot when the card is put on the shooting
      // stage, naming an editor when it is put on the one after. A card thrown
      // further along than that is not making either promise: it is a record
      // of work that happened elsewhere — shot on a phone last week, cut on
      // somebody's laptop, dragged onto Ready to catch the board up — and
      // demanding a future shoot day of it would be asking about a day that
      // has been and gone. That is the same reason creating one there is left
      // alone, and the walls stay where a person actually stands.
      // …and the admin walks through both walls. They are the person who
      // put the walls there, and they are usually the one catching the board
      // up on work that already happened.
      // ---- the published link ----------------------------------------------
      // A WALL, and one the admin does not walk through either.
      //
      // Every other rule on this board is about a promise somebody is making,
      // and round 80 stopped asking the admin to fill those in. This one is
      // not a promise: it is the address of a thing that already exists. A
      // piece cannot reach Published without having been published, so there
      // is always a link to paste, and thirty seconds of pasting it is what
      // makes every report downstream possible — where the work went, how many
      // views it got, what a person actually made this month. A board that
      // records "published" and not "published WHERE" cannot answer any of it,
      // and the admin is usually the one doing the publishing.
      if (at(patch.status_id) >= 0 && resolved.finalId != null && patch.status_id === resolved.finalId) {
        const posted = String(val('post_link') || '').trim()
        if (!posted) {
          return res.status(400).json({
            error: 'Paste the link to the published post before moving it here',
            needs: 'post_link',
          })
        }
        if (!hasLink(posted)) {
          return res.status(400).json({ error: 'That is not a link — it has to start with http:// or https://', needs: 'post_link' })
        }
      }

      const filmedNow = !free && (await getCrewNeeds()).operator.includes(val('type') ?? row.type)
      const g = resolved.gates.shoot
      if (filmedNow && g && at(patch.status_id) === g.index) {
        let links = []
        try { links = JSON.parse(val('reference_links') || '[]') } catch { links = [] }
        const doc = await hasFile()
        const problem = bookingProblem({
          operatorId: val('operator_id'),
          recording: val('recording_date'), editReady: val('edit_ready_date'), release: val('release_date'),
          refReady: links.length > 0 || !!val('photo') || !!doc || !!val('shot_link')
            || hasLink(val('reference_text')) || isSentence(val('script')),
        })
        if (problem) return res.status(400).json({ error: problem })
      }
      // Filming done means the next pair of hands has a name. The footage
      // exists by now, so the editor is a real answer rather than a guess —
      // which is why this is asked HERE and never at creation.
      if (filmedNow && g && at(patch.status_id) === g.index + 1 && !val('editor_id'))
        return res.status(400).json({ error: 'Name who cuts this — footage with no editor waiting is footage nobody is cutting' })

      // And the third wall: a piece does not go OUT with nobody's name on it.
      // Everywhere else the ownership check advises, because a task can be
      // moved along while the owner is still being decided. Publishing is the
      // one move after which nobody decides anything: it lands in the reports,
      // in the pay run and in the statistics, and an empty owner column there
      // is a hole nobody can reconstruct a month later. The admin walks
      // through, as they do through every wall — they are usually the one
      // catching the board up on work that already happened.
      if (!free && !ownedBy && (await isFinal(patch.status_id)))
        return res.status(400).json({ error: 'Give this an owner before it goes out — a published piece with nobody’s name on it is a hole in every report' })

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

  // ---- finishing the work puts the hand down ----
  // A hand says "this will be late" or "I cannot take this on". Publishing the
  // piece answers both, and nothing was answering them: the board raised its
  // own hand on work that had gone quiet, the work then went out, and the hand
  // stayed up — a finished piece reading "The board says this will be late"
  // on its own card, and sitting in the planners' queue of problems for ever.
  //
  // Every hand, not only the board's: a person's "I cannot take this on" is
  // just as answered by the thing being done. Cleared by the board rather than
  // by whoever happened to press Publish, because it is the completion that
  // answers it, not them.
  if (!row.done_at && patch.done_at) {
    await run(
      `UPDATE task_flags SET cleared_at = ?, cleared_by = NULL, cleared_name = ?
       WHERE content_id = ? AND cleared_at IS NULL`,
      patch.done_at, 'The board — finished', row.id)
    // And the same for a day nobody ever answered about. "Can we move the
    // release to Friday?" is a question the piece going out has answered —
    // and left open it is an admin being asked for ever to decide a date on
    // work that is finished. Dropped rather than approved: nothing moves, the
    // ask keeps its reason, and the task shows why it was never decided.
    await run(
      `UPDATE date_requests SET state = 'stale', decided_by = NULL, decided_name = ?, decided_at = ?, decided_note = ?
       WHERE content_id = ? AND state = 'open'`,
      'The board — finished', patch.done_at, 'the piece went out before this was answered', row.id)
  }

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

  // ---- and the booking asks its question ----
  // A slot that is now complete and unanswered goes to whoever has to answer
  // it. Sent when the booking actually CHANGED, not on every save, or a
  // person would be asked the same question every time somebody edited the
  // title of a task they are on.
  {
    const after = { ...row, ...patch }
    for (const which of Object.keys(BOOKINGS)) {
      const b = BOOKINGS[which]
      const moved = [b.day, b.from, b.to, b.holder].filter(Boolean)
        .some((f) => patch[f] !== undefined && String(patch[f] ?? '') !== String(row[f] ?? ''))
      if (!moved || !bookedOn(after, which) || after[b.ack]) continue
      const who = after[b.holder]
      if (!who || who === req.user.id) continue
      const line = `Can you make ${b.what} on ${slotWords(after, which)}?`
      await run(
        'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
        who, 'confirm', `${line} · «${after.title}»`, row.id, new Date().toISOString())
      await tgMirror([who],
        `🗓 <b>«${tgEsc(after.title)}»</b>\n${tgEsc(line)}\nOpen the task and say yes or no 👇`,
        row.id, tgOriginFrom(req)).catch(() => {})
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
        (isAdminOn(u, chans) || (!!u.permissions.review_publish && chans.some((ch) => u.departments.includes(ch)))))
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

  res.json(await listRow(row.id))
}))

// ---- what a move is going to ask for ---------------------------------------
// The board asks this BEFORE it moves anything, so the handover window can
// open on the move itself rather than after a refusal. It answers with the
// gates the move crosses, who is eligible to take each one — the editing
// stage offers editors, not the whole company — and whether the handover is
// running late enough to need a fresh promise. The rules live here, once.
// ---- answering a booking ---------------------------------------------------
// The operator says whether they can be there; the editor says whether the
// deadline fits. Only the person actually holding it may answer — an admin
// answering on their behalf would put the board back exactly where it was,
// with a date nobody had agreed to.
//
// "No" is not a refusal to work: it is the earliest possible warning that the
// plan needs another look, and it carries a reason so the planner can re-book
// rather than guess.
router.post('/:id/confirm', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const which = String(req.body?.which || '')
  const b = BOOKINGS[which]
  if (!b) return res.status(400).json({ error: 'Answer about the shoot or the edit' })
  if (!bookedOn(row, which)) {
    return res.status(400).json({ error: `Nothing is booked yet — ${b.what} needs its ${b.role} and a day first` })
  }
  if (row[b.holder] !== req.user.id) {
    return res.status(403).json({ error: `Only the ${b.role} on this task can answer for ${b.what}` })
  }
  const ok = req.body?.ok !== false
  const note = String(req.body?.note ?? '').trim().slice(0, 400)
  if (!ok && !note) return res.status(400).json({ error: 'Say what is in the way — a no with no reason cannot be planned around' })

  const now = new Date().toISOString()
  await run(
    `UPDATE content SET ${b.ack} = ?, ${b.at} = ?, ${b.by} = ?, ${b.note} = ? WHERE id = ?`,
    ok ? 'yes' : 'no', now, req.user.id, ok ? null : note, row.id)
  await run(...actRow(req.user, row.id, row.title, 'confirmed', which, row[b.ack] || 'waiting', ok ? 'yes' : 'no', now))

  // Whoever booked it hears back. A booking answered into silence is a
  // booking the planner has to chase, which is the thing this replaces.
  const tell = [...new Set([row.created_by, ...assigneesOf(row)])].filter((id) => id && id !== req.user.id)
  if (tell.length) {
    const line = ok
      ? `${req.user.name} confirmed ${b.what} — ${slotWords(row, which)}`
      : `${req.user.name} can't make ${b.what} (${slotWords(row, which)}) — “${note}”`
    await batch(tell.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, ok ? 'confirmed' : 'declined', `${line} · «${row.title}»`, row.id, now,
    ]))
    await Promise.allSettled(tell.map((id) => tgMirror([id],
      `${ok ? '✅' : '⚠️'} <b>«${tgEsc(row.title)}»</b>\n${tgEsc(line)}`, row.id, tgOriginFrom(req))))
  }
  res.json(await listRow(row.id))
}))

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
  // The admin is not stopped at a handover gate. Answering "who is cutting
  // this and where is the footage" is the point of the gate for the crew and
  // an interruption for the person dragging four finished pieces onto Ready.
  // Empty gates means the board simply moves the card; see `unfettered`.
  if (unfettered(req.user, JSON.parse(row.channels || '[]'))) return res.json({ gates: [] })

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
  // Whose piece is this at all — asked before any gate about the NEXT step,
  // because a task can cross the whole board with every hat filled and no
  // owner, and it is the owner column the reports read.
  const owned = (() => {
    let list = []
    try { list = JSON.parse(row.assignees || '[]') } catch { list = [] }
    return list.filter(Boolean).length > 0 || !!row.assignee_id
  })()
  const fromIdea = /^idea$|^ideas$|g'oya|идея/i.test(String(resolved.ordered[at(row.status_id)]?.label || ''))
  if (!owned && !fromIdea) {
    gates.push({
      key: 'own',
      stage: resolved.ordered.find((st) => st.id === to)?.label || '',
      role: 'assignee',
      what: 'owner',
      owner_field: 'assignee_id',
      many: true,
      current: [],
      candidates: team.map((u) => ({ id: u.id, name: u.name, color: u.color, position: u.position })),
      others: [],
      link_field: null,
      link_ok: true,
      what_link: null,
      late: null,
      // Publishing is the one move this refuses outright; everywhere else it
      // is a question the mover can answer later.
      wall: !!resolved.ordered.find((st) => st.id === to)?.is_final,
    })
  }
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
// name, the deadline it made you re-promise. The undo itself is logged: taking
// a move back is a move, and the paper trail is the whole point of this.
router.post('/:id/undo', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  // canSee reads channels as a list, and this row came straight off the table.
  if (!canSee(req.user, { ...row, channels: JSON.parse(row.channels || '[]') }))
    return res.status(403).json({ error: 'Not your channel' })

  // The move being taken back may have landed on ANOTHER serverless instance
  // a second ago, and this instance's copy of the database can lag behind it.
  // Saying "nothing to undo" from a stale copy would eat the very ten seconds
  // this feature promises, so pull the freshest data once before believing it.
  let snap = await get('SELECT * FROM undo_moves WHERE content_id = ?', row.id)
  if (!snap) {
    await resyncStorage().catch(() => {})
    snap = await get('SELECT * FROM undo_moves WHERE content_id = ?', row.id)
  }
  if (!snap) return res.status(404).json({ error: 'There is nothing to undo on this task' })

  const age = (Date.now() - Date.parse(snap.created_at)) / 1000
  if (age > UNDO_SECONDS) {
    await run('DELETE FROM undo_moves WHERE content_id = ?', row.id)
    return res.status(409).json({ error: 'Too late to undo that — the move is on the record now' })
  }
  // Your own regret, or an admin's. Undoing somebody else's move would be a
  // way to move their work without it looking like a move.
  if (snap.user_id !== req.user.id && !adminHere(req.user, await get('SELECT channels FROM content WHERE id = ?', snap.content_id)))
    return res.status(403).json({ error: 'Only whoever made that move can take it back' })

  let before
  try { before = JSON.parse(snap.before) } catch { before = null }
  if (!before) return res.status(409).json({ error: 'That move can no longer be read back' })

  const keys = UNDO_FIELDS.filter((f) => f in before)
  await run(`UPDATE content SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
    ...keys.map((k) => before[k]), row.id)

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
  const allowed = adminHere(req.user, row) || (can(req.user, 'manage_content') && canTouch(req.user, row))
  if (!allowed) return res.status(403).json({ error: 'You don’t have permission to delete this' })
  await logEvent(req.user, row.id, row.title, 'deleted')
  // Everything the task was carrying goes with it. This used to take only the
  // attachments, which left the heaviest rows in the database behind for good:
  // a voice note and a Pravki screenshot are base64 blobs, and they were
  // surviving the task they belonged to with nothing left to reach them by.
  //
  // The paper trail is the deliberate exception. Activity rows write down
  // names and titles at the moment of the change precisely so the log still
  // reads like a sentence after the task is gone.
  await batch(taskChildDeletes(row.id))
  await run('DELETE FROM content WHERE id = ?', row.id)
  res.json({ ok: true })
}))

export default router
