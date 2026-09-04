import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { all, get, run, batch, publicUser, crewRolesOf, getChannelKeys, PERM_KEYS } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

const router = Router()
router.use(authRequired)

// Admins see everyone; members see themselves, admins, teammates who share a
// channel, and the video crew (editors/operators work across every channel).
// Crew see the whole team — their tasks can come from anywhere.
//
// And whoever is ON a piece you can see. A member could open a task, read that
// somebody is editing it, and get a chip with an ellipsis in it: the task
// names the id, the directory would not resolve it, and the seat rendered as
// though nobody held it. That is not privacy — the piece already told you
// there is a person there — it is the board lying about its own contents. The
// only thing the old rule protected was a name you were already being shown a
// gap where.
router.get('/', wrap(async (req, res) => {
  const users = (await all('SELECT * FROM users ORDER BY role DESC, name')).map(publicUser)
  if (req.user.role === 'admin' || isCrewRole(req.user.role)) return res.json(users)
  const mine = new Set(req.user.departments)
  const seated = await seatedOnMyChannels(mine)
  res.json(users.filter((u) =>
    u.id === req.user.id || u.role === 'admin' || isCrewRole(u.role) || seated.has(u.id)
    || u.departments.some((d) => mine.has(d))))
}))

// Everybody holding a seat on a piece that runs on one of these channels.
// Seven small columns, no bodies and no blobs, and only for the members who
// are scoped at all — an admin and the crew already have the whole list.
async function seatedOnMyChannels(mine) {
  const seated = new Set()
  if (!mine.size) return seated
  const rows = await all(
    'SELECT channels, assignee_id, assignees, operator_id, editor_id, designer_id, face_id FROM content')
  for (const r of rows) {
    let chans = []
    try { chans = JSON.parse(r.channels || '[]') } catch { chans = [] }
    if (!chans.some((c) => mine.has(c))) continue
    for (const k of ['assignee_id', 'operator_id', 'editor_id', 'designer_id', 'face_id']) {
      if (r[k]) seated.add(Number(r[k]))
    }
    try { for (const id of JSON.parse(r.assignees || '[]')) if (id) seated.add(Number(id)) } catch { /* not a list */ }
  }
  return seated
}

async function cleanDepartments(list) {
  if (!Array.isArray(list)) return null
  const valid = new Set(await getChannelKeys())
  return [...new Set(list)].filter((d) => valid.has(d))
}

// admin — everything · member — their departments + granular rights ·
// crew capabilities (editor / operator / designer, multi-selectable) —
// cross-department production people: they see and move only the tasks where
// they hold a hat, no department powers at all. The legacy single-role values
// stay valid; 'crew' means a combination (spelled out in crew_roles).
// 'ambassador' is a login to the ambassador page and nothing else — see the
// gate in auth.js. Their university, contract and terms are not set here.
const ROLES = ['admin', 'member', 'editor', 'operator', 'designer', 'crew', 'ambassador']
const CREW_CAPS = ['editor', 'operator', 'designer']
const isCrewRole = (r) => r === 'editor' || r === 'operator' || r === 'designer' || r === 'crew'

// Normalize role + crew_roles into one consistent pair. Multi-select rules:
// any capability list collapses to its single value as the role, or 'crew'
// for a mix; admin/member always carry an empty capability list.
function roleFields(role, crewRoles) {
  // An ambassador holds no crew capability and never will — they are a student
  // with a login to one page, not a production hat.
  if (role === 'admin' || role === 'member' || role === 'ambassador') return { role, crew_roles: '[]' }
  // An OMITTED list falls back to what the role implies; an EXPLICITLY empty
  // one is a mistake — a crew account holds at least one capability.
  const caps = crewRoles === undefined
    ? crewRolesOf({ role, crew_roles: '[]' })
    : Array.isArray(crewRoles) ? [...new Set(crewRoles.filter((c) => CREW_CAPS.includes(c)))] : []
  if (caps.length === 0) return null
  const sorted = CREW_CAPS.filter((c) => caps.includes(c))
  return { role: sorted.length === 1 ? sorted[0] : 'crew', crew_roles: JSON.stringify(sorted) }
}

// Keep only known permission keys, as booleans.
function cleanPerms(obj) {
  const out = {}
  if (obj && typeof obj === 'object') {
    for (const k of PERM_KEYS) if (obj[k] !== undefined) out[k] = !!obj[k]
  }
  return out
}

// ---- contact & working-schedule fields (self-service + admin) ----
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
// Collect phone / position / duties / work hours from a body into a patch.
// Returns an error string, or null. `own` limits what a non-admin may set.
function scheduleFields(b, patch, { own = false } = {}) {
  if (b.phone !== undefined) patch.phone = b.phone ? String(b.phone).trim().slice(0, 40) : null
  if (!own) {
    if (b.position !== undefined) patch.position = b.position ? String(b.position).trim().slice(0, 80) : null
    if (b.duties !== undefined) patch.duties = b.duties ? String(b.duties).trim().slice(0, 600) : null
  }
  for (const f of ['work_start', 'work_end']) {
    if (b[f] !== undefined) {
      if (b[f] === null || b[f] === '') patch[f] = null
      else if (HHMM.test(String(b[f]))) patch[f] = String(b[f])
      else return 'Working hours must be HH:MM'
    }
  }
  const ws = patch.work_start, we = patch.work_end
  if (ws && we && we <= ws) return 'The working day ends before it starts'
  if (b.work_days !== undefined) {
    if (b.work_days === null) patch.work_days = null
    else if (Array.isArray(b.work_days)) {
      const days = [...new Set(b.work_days.map(Number))].filter((d) => d >= 0 && d <= 6).sort()
      patch.work_days = JSON.stringify(days)
    } else return 'work_days must be an array of weekdays (0=Sun … 6=Sat)'
  }
  return null
}

router.post('/', adminOnly, wrap(async (req, res) => {
  const { name, username, email = null, password, role = 'member', crew_roles, departments = [], permissions = {}, color = '#a32234' } = req.body || {}
  // Which channels this admin runs. Empty means the whole board, which is
  // what an admin was before this existed.
  const adminChans = role === 'admin' ? ((await cleanDepartments(req.body?.admin_channels ?? [])) || []) : []
  // How many pieces this person takes in a day (0 = no ceiling), and which
  // channels they work on (empty = all). Both belong to crew hats; an admin or
  // a member is not handed work by the hour.
  const cap = Math.max(0, Math.min(50, Math.round(Number(req.body?.daily_cap) || 0)))
  const crewChans = (await cleanDepartments(req.body?.crew_channels ?? [])) || []
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required' })
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' })
  const rf = roleFields(role, crew_roles)
  if (!rf) return res.status(400).json({ error: 'Pick at least one crew capability' })
  // Only members carry departments and granular rights.
  const depts = rf.role === 'member' ? ((await cleanDepartments(departments)) || []) : []
  const perms = rf.role === 'member' ? cleanPerms(permissions) : {}
  const extra = { phone: null, position: null, duties: null, work_start: null, work_end: null, work_days: null }
  const schedErr = scheduleFields(req.body || {}, extra)
  if (schedErr) return res.status(400).json({ error: schedErr })
  try {
    const info = await run(`
      INSERT INTO users (name, username, email, password_hash, role, crew_roles, departments, permissions, color,
        admin_channels, daily_cap, crew_channels, phone, position, duties, work_start, work_end, work_days, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      name.trim(),
      String(username).toLowerCase().trim(),
      email ? String(email).toLowerCase().trim() : null,
      bcrypt.hashSync(password, 10),
      rf.role, rf.crew_roles,
      JSON.stringify(depts),
      JSON.stringify(perms),
      color,
      JSON.stringify(adminChans), cap, JSON.stringify(crewChans),
      extra.phone, extra.position, extra.duties, extra.work_start, extra.work_end, extra.work_days,
      new Date().toISOString(),
    )
    res.status(201).json(publicUser(await get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid)))
  } catch (e) {
    if (/unique/i.test(String(e))) return res.status(409).json({ error: 'That username or email is already taken' })
    throw e
  }
}))

// ---- Self-service profile: any signed-in user edits their own account ----
// Name, accent color, avatar (small data URL), and password (with the current
// password required). Username, role, departments and rights stay admin-only.
router.patch('/me', wrap(async (req, res) => {
  const row = await get('SELECT * FROM users WHERE id = ?', req.user.id)
  if (!row) return res.status(404).json({ error: 'User not found' })
  const b = req.body || {}
  const patch = {}

  if (b.name !== undefined) {
    const name = String(b.name).trim()
    if (!name) return res.status(400).json({ error: 'Name cannot be empty' })
    patch.name = name
  }
  if (b.color !== undefined) patch.color = String(b.color)
  if (b.avatar !== undefined) {
    if (b.avatar === null || b.avatar === '') patch.avatar = null
    else {
      if (typeof b.avatar !== 'string' || !b.avatar.startsWith('data:image/'))
        return res.status(400).json({ error: 'Avatar must be an image' })
      if (b.avatar.length > 300000) return res.status(400).json({ error: 'Avatar image is too large' })
      patch.avatar = b.avatar
    }
  }
  if (b.new_password !== undefined) {
    if (!b.current_password || !bcrypt.compareSync(String(b.current_password), row.password_hash))
      return res.status(403).json({ error: 'Current password is incorrect' })
    if (String(b.new_password).length < 4) return res.status(400).json({ error: 'New password is too short (min 4 characters)' })
    patch.password_hash = bcrypt.hashSync(String(b.new_password), 10)
    patch.weak_password = 0 // they picked their own — the warning goes away
  }
  // Everyone keeps their own phone and working schedule up to date.
  const schedErr = scheduleFields(b, patch, { own: true })
  if (schedErr) return res.status(400).json({ error: schedErr })

  if (Object.keys(patch).length > 0) {
    const keys = Object.keys(patch)
    await run(`UPDATE users SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
      ...keys.map((k) => patch[k]), row.id)
  }
  res.json(publicUser(await get('SELECT * FROM users WHERE id = ?', row.id)))
}))

router.patch('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT * FROM users WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'User not found' })
  const { name, username, email, role, crew_roles, departments, permissions, color, password } = req.body || {}
  if (!ROLES.includes(role ?? row.role)) return res.status(400).json({ error: 'Unknown role' })
  // crew_roles alone may also change the role (multi-select chips).
  const rf = role !== undefined || crew_roles !== undefined
    ? roleFields(role ?? row.role, crew_roles !== undefined ? crew_roles : (isCrewRole(role ?? row.role) ? crewRolesOf(row) : undefined))
    : { role: row.role, crew_roles: row.crew_roles || '[]' }
  if (!rf) return res.status(400).json({ error: 'Pick at least one crew capability' })
  const nextRole = rf.role
  let depts = row.departments
  if (departments !== undefined) {
    const cleaned = await cleanDepartments(departments)
    if (!cleaned) return res.status(400).json({ error: 'departments must be an array' })
    depts = JSON.stringify(cleaned)
  }
  // Admins see every channel; crew roles belong to none — both carry no list.
  if (nextRole !== 'member') depts = '[]'
  // Which channels an admin runs. Empty is the whole board. Stops being a
  // question the moment somebody is not an admin any more.
  let cap = row.daily_cap || 0
  if (req.body?.daily_cap !== undefined) cap = Math.max(0, Math.min(50, Math.round(Number(req.body.daily_cap) || 0)))
  let crewChans = row.crew_channels || '[]'
  if (req.body?.crew_channels !== undefined) {
    const cleaned = await cleanDepartments(req.body.crew_channels)
    if (!cleaned) return res.status(400).json({ error: 'crew_channels must be an array' })
    crewChans = JSON.stringify(cleaned)
  }
  let adminChans = row.admin_channels || '[]'
  if (nextRole !== 'admin') adminChans = '[]'
  else if (req.body?.admin_channels !== undefined) {
    const cleaned = await cleanDepartments(req.body.admin_channels)
    if (!cleaned) return res.status(400).json({ error: 'admin_channels must be an array' })
    // Nobody may narrow their OWN writ to nothing by accident, and nobody may
    // quietly widen it either: this route already belongs to a full admin.
    if (row.id === req.user.id && cleaned.length > 0)
      return res.status(400).json({ error: 'You can’t scope yourself to particular channels — ask another full admin to do it' })
    adminChans = JSON.stringify(cleaned)
  }
  if (username !== undefined && !String(username).trim()) return res.status(400).json({ error: 'Username cannot be empty' })
  const nextUsername = username !== undefined ? String(username).toLowerCase().trim() : row.username
  const nextEmail = email !== undefined ? (email ? String(email).toLowerCase().trim() : null) : row.email
  const nextPerms = nextRole !== 'member' ? '{}'
    : permissions !== undefined ? JSON.stringify(cleanPerms(permissions)) : row.permissions
  const pwHash = password ? bcrypt.hashSync(password, 10) : row.password_hash
  // Admins also manage contact info and working schedules.
  const extra = {}
  const schedErr = scheduleFields(req.body || {}, extra)
  if (schedErr) return res.status(400).json({ error: schedErr })
  try {
    const extraSql = Object.keys(extra).map((k) => `, ${k}=?`).join('')
    await run(`UPDATE users SET name=?, username=?, email=?, role=?, crew_roles=?, color=?, departments=?, permissions=?, admin_channels=?, daily_cap=?, crew_channels=?, password_hash=?${extraSql} WHERE id=?`,
      name ?? row.name, nextUsername, nextEmail, nextRole, rf.crew_roles, color ?? row.color, depts, nextPerms, adminChans, cap, crewChans, pwHash,
      ...Object.keys(extra).map((k) => extra[k]), row.id)
  } catch (e) {
    if (/unique/i.test(String(e))) return res.status(409).json({ error: 'That username or email is already taken' })
    throw e
  }
  res.json(publicUser(await get('SELECT * FROM users WHERE id = ?', row.id)))
}))

router.delete('/:id', adminOnly, wrap(async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' })
  // Un-assign their tasks explicitly — remote databases may not enforce the
  // schema's ON DELETE SET NULL, so don't rely on it.
  await batch([
    ['UPDATE content SET assignee_id = NULL WHERE assignee_id = ?', req.params.id],
    ['UPDATE content SET created_by = NULL WHERE created_by = ?', req.params.id],
    ['UPDATE channels SET head_id = NULL WHERE head_id = ?', req.params.id],
    ['UPDATE content SET operator_id = NULL WHERE operator_id = ?', req.params.id],
    ['UPDATE content SET editor_id = NULL WHERE editor_id = ?', req.params.id],
    ['UPDATE content SET designer_id = NULL WHERE designer_id = ?', req.params.id],
    ['DELETE FROM personal_tasks WHERE user_id = ?', req.params.id],
    // Their register goes with them. The month grid draws a row per person,
    // so rows for somebody who is gone are invisible — but the month's late
    // and away counts were still adding them up, and a total that disagrees
    // with the squares under it is worse than no total. Who MARKED a day is
    // a different fact: that day still happened to somebody who is still here.
    ['DELETE FROM attendance WHERE user_id = ?', req.params.id],
    ['UPDATE attendance SET marked_by = NULL WHERE marked_by = ?', req.params.id],
    // Nobody can ever open their bell again either.
    ['DELETE FROM notifications WHERE user_id = ?', req.params.id],
    // Their own papers and their own numbers. The Docs & KPI page reads
    // person_docs with no join, so these rows do not quietly disappear when
    // the person does — they go on being listed, under a name that no longer
    // resolves, and a document blob is one of the heaviest rows here.
    ['DELETE FROM person_docs WHERE user_id = ?', req.params.id],
    ['DELETE FROM person_kpis WHERE user_id = ?', req.params.id],
    // Their place in the ambassador programme, the cards they sent and what
    // they were paid for them. The admin's queue draws a row per ambassador
    // and falls back to "Someone who left" when the account behind one is
    // gone — which is a sensible answer to a race, and a terrible one to a
    // permanent state: the queue filled up with people who are not there.
    ['DELETE FROM ambassador_cards WHERE ambassador_id IN (SELECT id FROM ambassadors WHERE user_id = ?)', req.params.id],
    ['DELETE FROM ambassador_payouts WHERE ambassador_id IN (SELECT id FROM ambassadors WHERE user_id = ?)', req.params.id],
    ['DELETE FROM ambassadors WHERE user_id = ?', req.params.id],
    // How much time they spent on the board, and what they pressed, is about
    // a person — so it leaves with the person. The Usage panel rolls its
    // totals across every row it finds, and rows belonging to nobody would go
    // on being counted under a name that no longer resolves.
    ['DELETE FROM usage_day WHERE user_id = ?', req.params.id],
    ['DELETE FROM usage_tap WHERE user_id = ?', req.params.id],
    // And the sprint board stops holding a seat for somebody who has gone.
    ['DELETE FROM sprint_task_assignees WHERE user_id = ?', req.params.id],
    ['DELETE FROM sprint_owners WHERE user_id = ?', req.params.id],
    ['DELETE FROM users WHERE id = ?', req.params.id],
  ])
  res.json({ ok: true })
}))

// ---- when is somebody actually free -----------------------------------------
// Booking a shoot used to be typing a date and a time and finding out
// afterwards — from a 409, or from the operator on the day — whether that time
// existed. The person holding the camera knows their week; the board did not,
// so the board guessed and the guess was corrected by a human every time.
//
// This turns the same three facts the account already carries (which days they
// work, from when, to when) plus the bookings they already have into the only
// question a planner actually has: SHOW ME WHEN THEY ARE FREE, for this long.
//
// It is deliberately not a new store. An availability system that has to be
// filled in separately from the working hours already on the account is two
// sources of truth for one fact, and the second one goes stale in a fortnight.
const SLOT_STEP = 30           // half-hour starts, like every calendar people know
const DEFAULT_LEN = 120
const toMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5))
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

router.get('/:id/slots', wrap(async (req, res) => {
  const who = Number(req.params.id)
  const u = await get('SELECT id, name, work_start, work_end, work_days FROM users WHERE id = ?', who)
  if (!u) return res.status(404).json({ error: 'No such person' })

  const from = isDay(req.query.from) ? req.query.from : new Date().toISOString().slice(0, 10)
  const days = Math.min(31, Math.max(1, Number(req.query.days) || 14))
  const mins = Math.min(600, Math.max(15, Number(req.query.mins) || DEFAULT_LEN))
  const excludeId = Number(req.query.exclude) || 0

  // A day with no hours set is not a day with no work — it is a day nobody
  // wrote hours for. Treated as a normal working day between sensible ends,
  // so the picker is useful before anybody has filled anything in, and the
  // answer says which it was so the UI can ask them to set theirs.
  const setHours = !!(u.work_start && u.work_end)
  const openAt = setHours ? toMin(u.work_start) : toMin('09:00')
  const shutAt = setHours ? toMin(u.work_end) : toMin('18:00')
  let workDays = null
  try { workDays = JSON.parse(u.work_days || 'null') } catch { /* unset */ }
  const setDays = Array.isArray(workDays) && workDays.length > 0

  const to = addDays(from, days - 1)
  // Everything already in their day — their shoots and their edit deadlines
  // both, because an editor with a cut due on Thursday is not free all
  // Thursday just because nobody booked an hour of it.
  const booked = await all(
    `SELECT id, title, recording_date, recording_time, recording_end
     FROM content
     WHERE operator_id = ? AND recording_date >= ? AND recording_date <= ?
       AND recording_time IS NOT NULL AND done_at IS NULL`, who, from, to)

  const out = []
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i)
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
    const working = !setDays || workDays.includes(weekday)
    const busy = booked.filter((b) => b.recording_date === day && b.id !== excludeId).map((b) => ({
      id: b.id, title: b.title, from: b.recording_time,
      to: b.recording_end || toHHMM(toMin(b.recording_time) + DEFAULT_LEN),
    })).sort((a, b) => a.from.localeCompare(b.from))

    const slots = []
    if (working) {
      for (let t = openAt; t + mins <= shutAt; t += SLOT_STEP) {
        const clash = busy.some((b) => t < toMin(b.to) && toMin(b.from) < t + mins)
        if (!clash) slots.push({ from: toHHMM(t), to: toHHMM(t + mins) })
      }
    }
    out.push({ day, weekday, working, slots, busy })
  }
  res.json({
    user: { id: u.id, name: u.name },
    hours: setHours ? { from: u.work_start, to: u.work_end } : null,
    days: setDays ? workDays : null,
    mins,
    calendar: out,
  })
}))

export default router
