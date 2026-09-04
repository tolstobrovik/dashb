import { Router } from 'express'
import { all, get, run, publicUser, tashkentDay, dayISO, getSkipTiers, tierFor, getMakerGrades, gradeFor } from '../db.js'
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
           edit_due_revised, review_due_revised, shot_at, edited_at, done_at, views
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

// A person's own numbers, and where this month puts them on the ladder.
// Declared BEFORE the admin gate for the same reason `/pay/mine` is: it
// exists so somebody can read their OWN, and below the gate it answered
// "Admins only" to every one of them — silently, because the card that
// asks for it treats a failure as "nothing to show".
// One person's own month: what they made, and which rung of the ladder it puts
// them on. Separate from the pay card because the ladder is not pay — a board
// that has set no rates still has a ladder, and somebody should be able to see
// where they are on it.
router.get('/work/mine', wrap(async (req, res) => {
  const { from, to } = statsRange(req.query)
  const statuses = await all('SELECT * FROM statuses')
  const dead = new Set(statuses.filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const grades = await getMakerGrades()
  const rows = await all(`
    SELECT id, status_id, assignee_id, assignees, done_at, operator_id, editor_id, face_id
    FROM content WHERE done_at IS NOT NULL`)
  const me = req.user.id
  let filmed = 0, edited = 0, both = 0, faced = 0, forMe = 0
  for (const r of rows) {
    if (dead.has(r.status_id)) continue
    const day = tashkentDay(r.done_at)
    if (day < from || day > to) continue
    if (r.operator_id === me && r.editor_id === me) both += 1
    else {
      if (r.operator_id === me) filmed += 1
      if (r.editor_id === me) edited += 1
    }
    if (r.face_id === me) faced += 1
    let list = []
    try { list = JSON.parse(r.assignees || '[]') } catch { list = [] }
    if ((list.length ? list : (r.assignee_id ? [r.assignee_id] : [])).includes(me)) forMe += 1
  }
  res.json({ from, to, filmed, edited, both, faced, made_for: forMe, ...gradeFor(grades, forMe || (filmed + edited + both)), ladder: grades })
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

// Closing a month: everything that went out in it is marked paid, once, with
// who said so. Paying happens outside this system — this records that it was
// done, the same way the sprint board records who dropped a task rather than
// pretending the system did it.
router.post('/work/paid', adminOnly, wrap(async (req, res) => {
  const month = String(req.body?.month ?? '').trim()
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'A month is YYYY-MM' })
  const stamp = new Date().toISOString()
  const rows = await all('SELECT id, done_at, paid_month FROM content WHERE done_at IS NOT NULL')
  const due = rows.filter((r) => !r.paid_month && tashkentDay(r.done_at).slice(0, 7) === month)
  for (const r of due) {
    await run('UPDATE content SET paid_month = ?, paid_at = ?, paid_by = ? WHERE id = ?', month, stamp, req.user.id, r.id)
  }
  res.json({ month, marked: due.length })
}))

// Re-opening one, for the month somebody closed by mistake. Only what THAT
// month stamped comes back — a piece paid in an earlier month is left alone.
router.post('/work/unpaid', adminOnly, wrap(async (req, res) => {
  const month = String(req.body?.month ?? '').trim()
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'A month is YYYY-MM' })
  const rows = await all('SELECT id FROM content WHERE paid_month = ?', month)
  for (const r of rows) await run('UPDATE content SET paid_month = NULL, paid_at = NULL, paid_by = NULL WHERE id = ?', r.id)
  res.json({ month, reopened: rows.length })
}))

// ---- what each person actually made this month -----------------------------
// The delivery report says whether work was on time. It never said WHAT
// anybody made — and for an operator or an editor, that is the whole question:
// how many did I film, how many did I cut, and how many did I do both ends of.
// Both ends matters on its own: a piece somebody shot AND edited is one piece
// of work, not two half ones, and counting it in both columns and nowhere else
// hides the people carrying whole pieces alone.
//
// And under the counts, the register the numbers came from — one row per
// piece, numbered, with where it went live and whether it has been paid — so
// anybody can check the total rather than take it.
router.get('/work', wrap(async (req, res) => {
  const { from, to } = statsRange(req.query)
  const channel = req.query.channel && req.query.channel !== 'all' ? String(req.query.channel) : null

  const statuses = await all('SELECT * FROM statuses')
  const dead = new Set(statuses.filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const users = (await all('SELECT * FROM users')).map(publicUser)
  const nameOf = (id) => users.find((u) => u.id === id)?.name || null
  const tiers = await getSkipTiers()
  const grades = await getMakerGrades()

  const rows = (await all(`
    SELECT id, title, channels, type, status_id, assignee_id, assignees, done_at, release_date,
           operator_id, editor_id, designer_id, face_id, views, skip_rate, post_link, paid_month
    FROM content
  `)).map((r) => ({ ...r, channels: parseList(r.channels) }))

  // A piece counts in the window by the day it went out — the day the work
  // was finished, not the day it was planned.
  const made = rows.filter((r) => {
    if (dead.has(r.status_id)) return false
    if (channel && !r.channels.includes(channel)) return false
    if (!r.done_at) return false
    const day = tashkentDay(r.done_at)
    return day >= from && day <= to
  })

  const zero = () => ({ filmed: 0, edited: 0, both: 0, faced: 0, made_for: 0, views: 0, tier_pay: 0 })
  const people = {}
  const seat = (id) => (people[id] ||= zero())

  for (const r of made) {
    const shot = r.operator_id
    const cut = r.editor_id
    const tier = tierFor(tiers, r.skip_rate)
    // Both ends counted ONCE, as one piece carried alone — not as a film and
    // an edit that happen to share a name.
    if (shot && cut && shot === cut) seat(shot).both += 1
    else {
      if (shot) seat(shot).filmed += 1
      if (cut) seat(cut).edited += 1
    }
    if (shot && tier) seat(shot).tier_pay += tier.per_film
    if (cut && tier) seat(cut).tier_pay += tier.per_edit
    if (r.face_id) seat(r.face_id).faced += 1
    for (const id of (() => { try { const a = JSON.parse(r.assignees || '[]'); return a.length ? a : (r.assignee_id ? [r.assignee_id] : []) } catch { return r.assignee_id ? [r.assignee_id] : [] } })()) {
      const p = seat(id)
      p.made_for += 1
      if (r.views != null) p.views += Number(r.views) || 0
    }
  }

  res.json({
    from,
    to,
    tiers,
    people: Object.entries(people).map(([id, p]) => ({
      user_id: Number(id),
      name: nameOf(Number(id)) || 'Someone who left',
      ...p,
      // Which rung of the ladder their delivered count puts them on.
      ...gradeFor(grades, p.made_for || (p.filmed + p.edited + p.both)),
    })).sort((a, b) => (b.filmed + b.edited + b.both) - (a.filmed + a.edited + a.both)),
    // The register the counts came from, numbered, newest last so the numbers
    // read the way a spreadsheet reads.
    sheet: made
      .sort((a, b) => String(a.done_at).localeCompare(String(b.done_at)))
      .map((r, i) => ({
        n: i + 1,
        id: r.id,
        title: r.title,
        type: r.type,
        channels: r.channels,
        day: tashkentDay(r.done_at),
        filmed_by: nameOf(r.operator_id),
        edited_by: nameOf(r.editor_id),
        face: nameOf(r.face_id),
        post_link: r.post_link || '',
        views: r.views == null ? null : Number(r.views),
        skip_rate: r.skip_rate == null ? null : Number(r.skip_rate),
        tier: tierFor(tiers, r.skip_rate)?.name || null,
        // Paid is a fact somebody recorded, not a guess from the calendar.
        paid: !!r.paid_month,
        paid_month: r.paid_month || null,
      })),
  })
}))

// ---- what it all got watched -----------------------------------------------
// The board knew what went out and when, and nothing about whether anybody
// watched it. A month of twenty pieces and a month of three are the same month
// to a delivery report, which is a strange thing for a marketing board to
// believe.
//
// The numbers are typed in by hand on the task (nobody is plugged into
// Instagram's API here), so this only adds them up — by type, by channel, by
// the person the piece was for — and says plainly how much of the month has
// actually been counted, because a total drawn from a third of the pieces is
// a number that will be read as if it were all of them.
//
// A piece counts in the window by the day it went out, which is the day its
// views started being earned.
router.get('/views', wrap(async (req, res) => {
  const { from, to } = statsRange(req.query)
  const channel = req.query.channel && req.query.channel !== 'all' ? String(req.query.channel) : null

  const statuses = await all('SELECT * FROM statuses')
  const dead = new Set(statuses.filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const channels = await all('SELECT key, label FROM channels ORDER BY sort, id')
  const users = (await all('SELECT * FROM users')).map(publicUser)
  const nameOf = (id) => users.find((u) => u.id === id)?.name || null

  const rows = (await all(`
    SELECT id, title, channels, type, status_id, assignee_id, assignees, done_at, release_date, views, views_at
    FROM content
  `)).map((r) => ({ ...r, channels: parseList(r.channels) }))

  const out = rows.filter((r) => {
    if (dead.has(r.status_id)) return false
    if (channel && !r.channels.includes(channel)) return false
    if (!r.done_at) return false
    const day = tashkentDay(r.done_at)
    return day >= from && day <= to
  })

  const zero = () => ({ pieces: 0, counted: 0, views: 0 })
  const add = (bucket, r) => {
    bucket.pieces += 1
    if (r.views !== null && r.views !== undefined) { bucket.counted += 1; bucket.views += Number(r.views) || 0 }
  }
  const totals = zero()
  const byType = {}
  const byChannelMap = {}
  const byPersonMap = new Map()
  for (const r of out) {
    add(totals, r)
    const ty = r.type || 'other'
    add((byType[ty] = byType[ty] || zero()), r)
    for (const ch of r.channels) add((byChannelMap[ch] = byChannelMap[ch] || zero()), r)
    // The people the piece was FOR. One piece, several makers, is counted for
    // each of them — the same way the delivery report counts it.
    let made = []
    try { made = JSON.parse(r.assignees || '[]').map(Number).filter(Boolean) } catch { made = [] }
    if (!made.length && r.assignee_id) made = [r.assignee_id]
    for (const uid of made) {
      if (!byPersonMap.has(uid)) byPersonMap.set(uid, { id: uid, name: nameOf(uid), ...zero() })
      add(byPersonMap.get(uid), r)
    }
  }

  const withAvg = (b) => ({ ...b, avg: b.counted > 0 ? Math.round(b.views / b.counted) : null })
  res.json({
    from,
    to,
    channel,
    totals: withAvg(totals),
    // How much of the month is actually measured. A total nobody can weigh is
    // a number that gets read as the whole truth.
    uncounted: totals.pieces - totals.counted,
    byType: Object.entries(byType)
      .map(([key, b]) => ({ key, ...withAvg(b) }))
      .sort((a, b) => b.views - a.views || a.key.localeCompare(b.key)),
    byChannel: channels
      .map((c) => ({ key: c.key, label: c.label, ...withAvg(byChannelMap[c.key] || zero()) }))
      .filter((c) => c.pieces > 0)
      .sort((a, b) => b.views - a.views),
    byPerson: [...byPersonMap.values()].map(withAvg).sort((a, b) => b.views - a.views),
    // The pieces themselves, best first — the answer to "what actually worked".
    top: out
      .filter((r) => r.views !== null && r.views !== undefined)
      .sort((a, b) => Number(b.views) - Number(a.views))
      .slice(0, 20)
      .map((r) => ({
        id: r.id, title: r.title, type: r.type, channels: r.channels,
        views: Number(r.views) || 0, day: tashkentDay(r.done_at),
      })),
  })
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
  // What the work was WORTH, not just how much of it there was. A month of
  // twenty pieces nobody watched and a month of three that half the city saw
  // are the same month to a piece-rate card, which is why this one counts
  // views too: per thousand, and a target that pays whole when it is reached.
  'per_1k_views', 'views_target', 'views_bonus',
]
const BLANK_RATES = {
  currency: 'UZS', base: 0, per_shoot: 0, per_edit: 0, per_design: 0, per_publish: 0,
  per_review: 0, quota: 0, quota_bonus: 0, ontime_bonus: 0, ontime_target: 90, late_penalty: 0,
  per_1k_views: 0, views_target: 0, views_bonus: 0,
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
    const e = (counted[c.userId] = counted[c.userId] || { hats: {}, late: 0, done: 0, views: 0, counted: 0, items: [] })
    e.hats[c.hat] = (e.hats[c.hat] || 0) + 1
    e.done += 1
    if (c.late) e.late += 1
    // Views belong to the person the piece was FOR — the content maker — and
    // are counted once even though they wear several hats on the same task.
    // A piece nobody has counted yet adds nothing rather than adding zero.
    if (c.hat === 'assignee' && Number.isFinite(Number(c.row.views)) && c.row.views !== null) {
      e.views += Number(c.row.views)
      e.counted += 1
    }
    e.items.push({ id: c.row.id, title: c.row.title, hat: c.hat, day: c.day, late: c.late, views: c.row.views ?? null })
  }

  const people = wanted.map((u) => {
    const e = counted[u.id] || { hats: {}, late: 0, done: 0, views: 0, counted: 0, items: [] }
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
    // The views KPI: paid by the thousand, and a target that pays whole when
    // the month's views reach it. Both are 0 on a card nobody has set, so a
    // board that does not care about views never sees either.
    const views = e.views
    const viewsPay = Math.round((views / 1000) * (rates.per_1k_views || 0))
    const viewsTarget = rates.views_target || 0
    const viewsMet = viewsTarget > 0 && views >= viewsTarget
    const viewsBonus = viewsMet ? (rates.views_bonus || 0) : 0
    const bonus = onTimeBonus + quotaBonus + viewsBonus
    const total = (rates.base || 0) + piecework + viewsPay + bonus - penalty
    return {
      id: u.id, name: u.name, color: u.color, avatar: u.avatar, role: u.role, crew_roles: u.crew_roles,
      currency: rates.currency, source: rates.source, rates,
      delivered: e.done, late: e.late, onTime, onTimePct,
      quota, quotaMet, quotaLeft: quota > 0 ? Math.max(0, quota - e.done) : null,
      views, viewsCounted: e.counted, viewsPay, viewsTarget, viewsMet,
      viewsLeft: viewsTarget > 0 ? Math.max(0, viewsTarget - views) : null,
      lines, base: rates.base || 0, piecework,
      onTimeBonus, quotaBonus, viewsBonus, bonus, penalty, total,
      items: e.items.sort((a, b) => String(b.day).localeCompare(String(a.day))),
    }
  })
  return { from: from || null, to: to || null, people }
}

router.get('/pay', wrap(async (req, res) => {
  const { from, to } = req.query
  const out = await payRun({ from, to })
  const { hasDefault } = await rateCards()
  // The KPI component of pay went with the KPIs in round 82, and this line kept
  // reading p.kpis — which payRun stopped producing, so every call to the
  // payroll answered 500. Nobody with no card and nothing delivered clutters
  // the payroll; that is the whole of the rule now.
  out.people = out.people.filter((p) => p.source !== 'none' || p.delivered > 0)
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
