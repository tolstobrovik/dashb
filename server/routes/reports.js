import { Router } from 'express'
import { all, get, run, publicUser, tashkentDay, dayISO } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'
import { resolveGates, phasesOf, phasePassed } from '../deadlines.js'

const router = Router()

// ---- who did what ----------------------------------------------------------
// The report used to count one thing: the piece's ASSIGNEE, on the day the
// whole piece was published. That is the planner's number. It made the crew
// invisible — an editor who cut forty videos in a month appeared to have done
// nothing at all, because the assignee line had somebody else's name on it.
//
// So every hat is counted, each on the day THAT person's work actually left
// their hands, and the report is asked which hat it is looking through.
//
//   assignee   done_at    the piece went out, and it was theirs to see out
//   operator   shot_at    the footage was handed to the editor
//   editor     edited_at  the cut was handed to review
//   designer   done_at    (there is no separate designed_at — the artwork has
//                          no handover stage of its own, so it is credited
//                          when the piece goes out)
//   reviewer   done_at    they signed it off and it was published
//
// The FIELD each hat is read from, and the timestamp that dates the work.
export const HATS = {
  assignee: { column: 'assignee_id', at: 'done_at',   phase: 'review', due: 'release_date',     label: 'Ran the piece' },
  operator: { column: 'operator_id', at: 'shot_at',   phase: 'shoot',  due: 'recording_date',   label: 'Shot it' },
  editor:   { column: 'editor_id',   at: 'edited_at', phase: 'edit',   due: 'edit_ready_date',  label: 'Cut it' },
  designer: { column: 'designer_id', at: 'done_at',   phase: null,     due: 'design_ready_date', label: 'Designed it' },
  reviewer: { column: 'reviewers',   at: 'done_at',   phase: 'review', due: 'release_date',     label: 'Signed it off' },
}

const parseList = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } }

// Everyone who wore `hat` on this task. Review is shared, so it is a list.
function wearers(row, hat) {
  const f = HATS[hat]
  if (!f) return []
  if (f.column === 'reviewers') {
    const list = parseList(row.reviewers).map(Number).filter(Boolean)
    if (list.length) return [...new Set(list)]
    return row.reviewer_id ? [row.reviewer_id] : []
  }
  return row[f.column] ? [row[f.column]] : []
}

// Every task, once, with the columns any hat might need. Kept in one place so
// the report and the pay run can never disagree about what happened.
export async function contributions({ from, to, channel, type }) {
  const statuses = await all('SELECT * FROM statuses')
  const resolved = resolveGates(statuses)
  const rows = (await all(`
    SELECT id, title, channels, type, status_id, assignee_id, operator_id, editor_id, designer_id,
           reviewer_id, reviewers, recording_date, edit_ready_date, design_ready_date, release_date,
           edit_due_revised, review_due_revised, shot_at, edited_at, done_at
    FROM content
  `)).map((r) => ({ ...r, channels: parseList(r.channels) }))

  const out = []          // { hat, userId, row, day, late }
  for (const r of rows) {
    if (channel && !r.channels.includes(channel)) continue
    if (type && r.type !== type) continue
    // Was any of it late? Derived exactly as the board derives it everywhere
    // else, never stored — see server/deadlines.js.
    let phases = null
    for (const hat of Object.keys(HATS)) {
      const f = HATS[hat]
      // The handover timestamp, if there is one. shot_at is stamped when the
      // footage reaches the EDITOR — so an operator who filmed twenty pieces
      // this month that no editor has picked up yet had, by that column
      // alone, done nothing. Round 72 settled this everywhere else: a card
      // that has reached Shot HAS finished its shoot, whatever the timestamps
      // say. The report and the payroll have to agree with the rest of the
      // board, so when the stage says the phase is behind us and no timestamp
      // exists, the work is credited on the day it was due.
      const stamp = r[f.at]
      let day = stamp ? tashkentDay(stamp) : null
      if (!day && f.phase && phasePassed(r, f.phase, resolved)) day = r[f.due] || null
      if (!day) continue
      if (from && day < from) continue
      if (to && day > to) continue
      const who = wearers(r, hat)
      if (!who.length) continue
      if (phases === null) phases = phasesOf(r, undefined, resolved)
      // "Late" here means delivered after the day that was promised — which
      // is what phaseState already decides, excuses included: an editor who
      // got the footage after their own date had gone is 'excused', not late,
      // and is not docked for somebody else's slip.
      //
      // Artwork has no phase of its own (no designed_at, no handover stage),
      // so it is judged directly against the day it was due.
      let late = false
      if (f.phase) {
        const ph = phases.find((p) => p.phase === f.phase)
        late = !!ph && ph.state === 'late'
      } else if (hat === 'designer' && r.design_ready_date) {
        late = day > r.design_ready_date
      }
      for (const userId of who) out.push({ hat, userId, row: r, day, late })
    }
  }
  return out
}

router.use(authRequired)

// ---- the month, with the answer written out --------------------------------
// The statistics page showed numbers and left the reading of them to whoever
// opened it — which meant everybody read them differently, or not at all. The
// arithmetic happens here now, once, and it comes back with the CONCLUSIONS
// alongside it: which step the month was lost at, which side the delays sit
// on, which channel is carrying its plan and which is not.
//
// "Plan completion" is read off the work itself now that the typed-in plan
// numbers are gone: a piece with a release day inside the window was PLANNED
// for it, and one that went out is DELIVERED. That is a plan nobody has to
// remember to update, and it cannot disagree with the board.
function statsRange(q) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q?.to || '') ? q.to : dayISO()
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q?.from || '') ? q.from : `${to.slice(0, 7)}-01`
  return { from, to }
}
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)

router.get('/stats', wrap(async (req, res) => {
  const { from, to } = statsRange(req.query)
  const channel = req.query.channel && req.query.channel !== 'all' ? String(req.query.channel) : null
  const today = dayISO()

  const statuses = await all('SELECT * FROM statuses')
  const resolved = resolveGates(statuses)
  const dead = new Set(statuses.filter((s) => /^deleted$/i.test(s.label)).map((s) => s.id))
  const channels = await all('SELECT key, label FROM channels ORDER BY sort, id')
  const users = (await all('SELECT * FROM users')).map(publicUser)
  const nameOf = (id) => users.find((u) => u.id === id)?.name || null

  const rows = (await all(`
    SELECT id, title, channels, type, status_id, assignee_id, operator_id, editor_id, designer_id,
           reviewer_id, reviewers, recording_date, edit_ready_date, design_ready_date, release_date,
           edit_due_revised, review_due_revised, shot_at, edited_at, done_at,
           script, tz, reference_text, reference_links, miss_blame, miss_blame_note
    FROM content
  `)).map((r) => ({ ...r, channels: parseList(r.channels) }))

  const mine = rows.filter((r) => !dead.has(r.status_id)
    && (!channel || r.channels.includes(channel)))

  // ---- what was planned, and what came out --------------------------------
  // Planned: it had a release day inside the window. Delivered: it went out.
  // On time: it went out on or before the day it promised.
  const planned = mine.filter((r) => r.release_date && r.release_date >= from && r.release_date <= to)
  const deliveredIn = mine.filter((r) => r.done_at && tashkentDay(r.done_at) >= from && tashkentDay(r.done_at) <= to)
  const onTime = deliveredIn.filter((r) => !r.release_date || tashkentDay(r.done_at) <= r.release_date)
  const plannedDone = planned.filter((r) => r.done_at)
  // Still owed: promised inside the window, the day has gone, nothing out.
  const owed = planned.filter((r) => !r.done_at && r.release_date < today)

  // ---- where the month was lost -------------------------------------------
  // Every late phase on every piece in the window, with the side it belongs
  // to. A piece can lose time at more than one step and each one counts: that
  // is the difference between "eleven late pieces" and "seven late edits".
  const byPhase = { shoot: { late: 0, judged: 0 }, edit: { late: 0, judged: 0 }, review: { late: 0, judged: 0 } }
  const bySide = { production: 0, make: 0 }
  const blamed = []
  const byPerson = new Map()
  for (const r of mine) {
    const touches = (r.release_date && r.release_date >= from && r.release_date <= to)
      || (r.done_at && tashkentDay(r.done_at) >= from && tashkentDay(r.done_at) <= to)
    if (!touches) continue
    for (const ph of phasesOf(r, today, resolved)) {
      if (ph.state === 'none' || ph.state === 'waiting') continue
      byPhase[ph.phase].judged += 1
      // EXCUSED is not "on time". It means the work reached this owner after
      // their own date had already gone, so they are not charged — and if the
      // step simply disappeared here the month would show delays nobody owns
      // and a conclusion that contradicts the list underneath it. The days are
      // real, so they are counted, against PRODUCTION: somebody upstream
      // handed over late, and that is the whole of the answer.
      const excused = ph.state === 'excused'
      if (ph.state !== 'late' && !excused) continue
      byPhase[ph.phase].late += 1
      const side = excused ? 'production' : ph.side
      bySide[side] = (bySide[side] || 0) + 1
      blamed.push({
        id: r.id, title: r.title, phase: ph.phase, label: ph.label,
        side, why: excused ? 'the step before it handed over after this date had gone' : ph.blame_why,
        decided: excused ? false : ph.blame_decided,
        days_late: ph.days_late, due: ph.due,
        // Nobody is personally charged for an excused step — the delay has a
        // side, not a name.
        who: excused ? [] : ph.owner_ids.map(nameOf).filter(Boolean),
      })
      if (excused) continue
      for (const uid of ph.owner_ids) {
        const e = byPerson.get(uid) || { id: uid, name: nameOf(uid), late: 0, phases: {} }
        e.late += 1
        e.phases[ph.phase] = (e.phases[ph.phase] || 0) + 1
        byPerson.set(uid, e)
      }
    }
  }

  // ---- the same arithmetic per channel ------------------------------------
  const byChannel = channels.map((c) => {
    const set = rows.filter((r) => !dead.has(r.status_id) && r.channels.includes(c.key))
    const p = set.filter((r) => r.release_date && r.release_date >= from && r.release_date <= to)
    const d = p.filter((r) => r.done_at)
    const ot = d.filter((r) => tashkentDay(r.done_at) <= r.release_date)
    return {
      key: c.key, label: c.label,
      planned: p.length, delivered: d.length, onTime: ot.length,
      completion: pct(d.length, p.length), punctuality: pct(ot.length, d.length),
    }
  }).sort((a, b) => (b.planned - a.planned) || a.label.localeCompare(b.label))

  const rates = {
    production: pct(deliveredIn.length, planned.length || deliveredIn.length),
    completion: pct(plannedDone.length, planned.length),
    punctuality: pct(onTime.length, deliveredIn.length),
  }

  // ---- and what it all means ----------------------------------------------
  // A number nobody reads a conclusion out of is a number that changes
  // nothing. These are deliberately few, ordered by what to do about them,
  // and each one names the thing rather than describing the shape of a chart.
  const say = []
  const totalLate = byPhase.shoot.late + byPhase.edit.late + byPhase.review.late
  if (planned.length === 0 && deliveredIn.length === 0) {
    say.push({ tone: 'flat', text: 'Nothing was planned or delivered in this window — there is nothing to read yet.' })
  } else {
    if (rates.completion !== null) {
      say.push(rates.completion >= 90
        ? { tone: 'good', text: `${rates.completion}% of what was planned went out. The plan is being kept.` }
        : rates.completion >= 60
          ? { tone: 'warn', text: `${rates.completion}% of the plan went out — ${owed.length} ${owed.length === 1 ? 'piece is' : 'pieces are'} still owed past ${owed.length === 1 ? 'its' : 'their'} day.` }
          : { tone: 'bad', text: `Only ${rates.completion}% of the plan went out. This is a planning problem before it is a delivery one — the month promised more than it made.` })
    }
    if (totalLate === 0 && deliveredIn.length > 0) {
      say.push({ tone: 'good', text: 'Nothing missed a deadline at any step this window.' })
    } else if (totalLate > 0) {
      const worst = Object.entries(byPhase).sort((a, b) => b[1].late - a[1].late)[0]
      const share = pct(worst[1].late, totalLate)
      const LAB = { shoot: 'Shooting', edit: 'Editing', review: 'Review and publishing' }
      say.push({
        tone: share >= 50 ? 'bad' : 'warn',
        text: `${LAB[worst[0]]} is where the time goes — ${worst[1].late} of ${totalLate} missed steps${share !== null ? ` (${share}%)` : ''}.`,
      })
      const p = bySide.production || 0, m = bySide.make || 0
      if (p || m) {
        say.push(p === m
          ? { tone: 'warn', text: `The delays are split evenly: ${p} on production, ${m} on content.` }
          : p > m
            ? { tone: 'warn', text: `${pct(p, p + m)}% of the delay sits with production — the shoots and the cuts, not the briefs.` }
            : { tone: 'warn', text: `${pct(m, p + m)}% of the delay sits with content — briefs that were not ready, and finished work that was not posted.` })
      }
      const person = [...byPerson.values()].sort((a, b) => b.late - a.late)[0]
      if (person && person.late >= 3 && person.late >= totalLate * 0.4) {
        say.push({ tone: 'warn', text: `${person.name} is carrying ${person.late} of them — worth asking what is in the way rather than adding more.` })
      }
    }
    const weak = byChannel.filter((c) => c.planned >= 3 && c.completion !== null && c.completion < 60)
    if (weak.length) {
      say.push({ tone: 'warn', text: `${weak.map((c) => c.label).join(', ')} ${weak.length === 1 ? 'is' : 'are'} furthest behind the plan.` })
    }
    const strong = byChannel.find((c) => c.planned >= 3 && c.completion === 100 && c.punctuality === 100)
    if (strong) say.push({ tone: 'good', text: `${strong.label} delivered everything it planned, on time.` })
  }

  res.json({
    from, to, channel,
    totals: {
      planned: planned.length, delivered: deliveredIn.length, onTime: onTime.length,
      owed: owed.length, lateSteps: totalLate,
    },
    rates,
    byPhase, bySide,
    byChannel,
    byPerson: [...byPerson.values()].sort((a, b) => b.late - a.late),
    blamed: blamed.sort((a, b) => b.days_late - a.days_late).slice(0, 40),
    conclusions: say,
  })
}))


// ---- what one person earned -------------------------------------------------
// Declared BEFORE the admin gate below, deliberately: a person may see their
// own pay and nobody else's. Express runs middleware in the order it is
// declared, so this route escapes `adminOnly` and the rest do not.
router.get('/pay/mine', wrap(async (req, res) => {
  const { from, to } = req.query
  // This runs on every dashboard load, for everybody. Until somebody has set
  // rates there is nothing to work out and nothing to show, so it answers
  // without reading the board at all — the card stays hidden either way.
  const { pick } = await rateCards()
  if (pick(req.user.id).source === 'none') return res.json({ source: 'none' })
  const runOut = await payRun({ from, to, only: req.user.id })
  res.json(runOut.people[0] || null)
}))

router.use(adminOnly)

router.get('/', wrap(async (req, res) => {
  const { from, to, type } = req.query
  const hat = HATS[req.query.hat] ? req.query.hat : 'assignee'
  const list = (await contributions({ from, to, type })).filter((c) => c.hat === hat)

  const users = (await all('SELECT * FROM users')).map(publicUser)
  const byUser = {}
  const byChannel = {} // the channel-side view of the exact same contributions
  for (const c of list) {
    const r = c.row
    const e = (byUser[c.userId] = byUser[c.userId] || { total: 0, late: 0, byChannel: {}, byType: {}, items: [] })
    e.total += 1
    if (c.late) e.late += 1
    for (const ch of r.channels) {
      e.byChannel[ch] = (e.byChannel[ch] || 0) + 1
      const cc = (byChannel[ch] = byChannel[ch] || { total: 0, byType: {}, byPerson: {} })
      cc.total += 1
      if (r.type && r.type !== 'other') cc.byType[r.type] = (cc.byType[r.type] || 0) + 1
      cc.byPerson[c.userId] = (cc.byPerson[c.userId] || 0) + 1
    }
    if (r.type && r.type !== 'other') e.byType[r.type] = (e.byType[r.type] || 0) + 1
    e.items.push({ id: r.id, title: r.title, channel: r.channels[0], channels: r.channels, done_at: r.done_at, day: c.day, late: c.late })
  }
  const report = users
    .filter((u) => u.role !== 'admin' || byUser[u.id])
    .map((u) => ({
      id: u.id, name: u.name, color: u.color, avatar: u.avatar, role: u.role,
      total: byUser[u.id]?.total || 0,
      late: byUser[u.id]?.late || 0,
      byChannel: byUser[u.id]?.byChannel || {},
      byType: byUser[u.id]?.byType || {},
      items: (byUser[u.id]?.items || []).sort((a, b) => String(b.day).localeCompare(String(a.day))),
    }))
    .sort((a, b) => b.total - a.total)
  res.json({ hat, report, totalDone: list.length, byChannel })
}))

// ---- pay --------------------------------------------------------------------
// The board already knows, to the day, what every person delivered and how
// much of it landed on the day they promised. Payroll was being rebuilt from
// that by hand, in a spreadsheet, once a month.
//
// The RATES are not in this file and never will be: they change, they differ
// per person, and hard-coding somebody's wage into a git repository is how a
// pay rise becomes a deploy. They live in `pay_rules` — one default card
// everybody starts from, and a card per person that overrides it — and are
// edited in Admin → Pay. This file only does the arithmetic.
export const RATE_FIELDS = [
  'base', 'per_shoot', 'per_edit', 'per_design', 'per_publish', 'per_review',
  'quota', 'quota_bonus', 'ontime_bonus', 'ontime_target', 'late_penalty',
]
const BLANK_RATES = {
  currency: 'UZS', base: 0, per_shoot: 0, per_edit: 0, per_design: 0, per_publish: 0,
  per_review: 0, quota: 0, quota_bonus: 0, ontime_bonus: 0, ontime_target: 90, late_penalty: 0,
}
const HAT_RATE = {
  operator: 'per_shoot', editor: 'per_edit', designer: 'per_design',
  assignee: 'per_publish', reviewer: 'per_review',
}

async function rateCards() {
  const rows = await all('SELECT * FROM pay_rules')
  const fallback = rows.find((r) => !r.user_id) || null
  const mine = new Map(rows.filter((r) => r.user_id).map((r) => [r.user_id, r]))
  const pick = (userId) => {
    const row = mine.get(userId) || fallback
    if (!row) return { ...BLANK_RATES, source: 'none' }
    const card = { currency: row.currency || 'UZS', source: mine.has(userId) ? 'own' : 'default' }
    for (const f of RATE_FIELDS) card[f] = Number(row[f]) || 0
    return card
  }
  return { pick, hasDefault: !!fallback }
}

// One person's month, or everybody's. `only` restricts it to one id, which is
// how a person sees their own pay without seeing the payroll.
async function payRun({ from, to, only }) {
  const list = await contributions({ from, to })
  const { pick } = await rateCards()
  const users = (await all('SELECT * FROM users')).map(publicUser)
  const wanted = only ? users.filter((u) => u.id === Number(only)) : users

  const counted = {}
  for (const c of list) {
    const e = (counted[c.userId] = counted[c.userId] || { hats: {}, late: 0, done: 0, items: [] })
    e.hats[c.hat] = (e.hats[c.hat] || 0) + 1
    e.done += 1
    if (c.late) e.late += 1
    e.items.push({ id: c.row.id, title: c.row.title, hat: c.hat, day: c.day, late: c.late })
  }

  const people = wanted.map((u) => {
    const e = counted[u.id] || { hats: {}, late: 0, done: 0, items: [] }
    const rates = pick(u.id)
    const lines = []
    let piecework = 0
    for (const [hat, field] of Object.entries(HAT_RATE)) {
      const n = e.hats[hat] || 0
      const rate = rates[field] || 0
      if (!n && !rate) continue
      const amount = n * rate
      piecework += amount
      lines.push({ hat, label: HATS[hat].label, count: n, rate, amount })
    }
    const onTime = e.done - e.late
    // A share of nothing is not 0% — it is "nothing to judge". Somebody who
    // delivered nothing this month has not failed a punctuality target.
    const onTimePct = e.done ? Math.round((onTime / e.done) * 100) : null
    const onTimeBonus = (rates.ontime_bonus && onTimePct !== null && onTimePct >= (rates.ontime_target || 0))
      ? rates.ontime_bonus : 0
    // How much, and was it enough. The two questions are deliberately paid
    // apart: somebody can hit the quota and still be late with all of it, and
    // somebody can be perfectly punctual with three pieces when the job asks
    // for twenty. Rewarding only punctuality quietly rewards doing less.
    const quota = rates.quota || 0
    const quotaMet = quota > 0 && e.done >= quota
    const quotaBonus = quotaMet ? (rates.quota_bonus || 0) : 0
    const penalty = e.late * (rates.late_penalty || 0)
    const bonus = onTimeBonus + quotaBonus
    const total = (rates.base || 0) + piecework + bonus - penalty
    return {
      id: u.id, name: u.name, color: u.color, avatar: u.avatar, role: u.role, crew_roles: u.crew_roles,
      currency: rates.currency, source: rates.source, rates,
      delivered: e.done, late: e.late, onTime, onTimePct,
      quota, quotaMet, quotaLeft: quota > 0 ? Math.max(0, quota - e.done) : null,
      lines, base: rates.base || 0, piecework,
      onTimeBonus, quotaBonus, bonus, penalty, total,
      items: e.items.sort((a, b) => String(b.day).localeCompare(String(a.day))),
    }
  })
  return { from: from || null, to: to || null, people }
}

router.get('/pay', wrap(async (req, res) => {
  const { from, to } = req.query
  const out = await payRun({ from, to })
  const { hasDefault } = await rateCards()
  // Nobody with no card and nothing delivered clutters the payroll.
  out.people = out.people.filter((p) => p.source !== 'none' || p.delivered > 0 || p.kpis.length > 0)
  out.people.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  res.json({ ...out, hasDefault, currency: out.people[0]?.currency || 'UZS' })
}))

router.get('/pay/rules', wrap(async (_req, res) => {
  res.json(await all('SELECT * FROM pay_rules ORDER BY user_id IS NOT NULL, user_id'))
}))

// `userId` is a number, or the word "default" for the card everybody who has
// no card of their own is paid on.
router.put('/pay/rules/:userId', wrap(async (req, res) => {
  const isDefault = req.params.userId === 'default'
  const userId = isDefault ? null : Number(req.params.userId)
  if (!isDefault && (!userId || !(await get('SELECT 1 AS x FROM users WHERE id = ?', userId)))) {
    return res.status(404).json({ error: 'No such person' })
  }
  const body = req.body || {}
  const vals = {}
  for (const f of RATE_FIELDS) {
    const raw = body[f]
    const n = raw === '' || raw === null || raw === undefined ? 0 : Number(raw)
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${f} must be a number, zero or more` })
    vals[f] = n
  }
  if (vals.ontime_target > 100) return res.status(400).json({ error: 'ontime_target is a percentage — 100 at most' })
  const currency = String(body.currency || 'UZS').trim().slice(0, 8) || 'UZS'

  const now = new Date().toISOString()
  const existing = isDefault
    ? await get('SELECT id FROM pay_rules WHERE user_id IS NULL')
    : await get('SELECT id FROM pay_rules WHERE user_id = ?', userId)
  const cols = RATE_FIELDS.map((f) => `${f}=?`).join(', ')
  if (existing) {
    await run(`UPDATE pay_rules SET currency=?, ${cols}, updated_by=?, updated_at=? WHERE id=?`,
      currency, ...RATE_FIELDS.map((f) => vals[f]), req.user.id, now, existing.id)
    return res.json(await get('SELECT * FROM pay_rules WHERE id = ?', existing.id))
  }
  const info = await run(
    `INSERT INTO pay_rules (user_id, currency, ${RATE_FIELDS.join(', ')}, updated_by, created_at, updated_at)
     VALUES (?, ?, ${RATE_FIELDS.map(() => '?').join(', ')}, ?, ?, ?)`,
    userId, currency, ...RATE_FIELDS.map((f) => vals[f]), req.user.id, now, now)
  res.status(201).json(await get('SELECT * FROM pay_rules WHERE id = ?', info.lastInsertRowid))
}))

// Dropping a person's own card puts them back on the default one.
router.delete('/pay/rules/:userId', wrap(async (req, res) => {
  if (req.params.userId === 'default') return res.status(400).json({ error: 'The default card cannot be removed — set it to zero instead' })
  await run('DELETE FROM pay_rules WHERE user_id = ?', Number(req.params.userId))
  res.json({ ok: true })
}))

export default router
