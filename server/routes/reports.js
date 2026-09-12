import { gradeCard, METRICS } from '../kpi.js'
import { Router } from 'express'
import { all, get, run, publicUser, tashkentDay, dayISO, getSkipTiers, tierFor, getMakerGrades, gradeFor } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'
import { resolveGates, phasesOf, phasePassed } from '../deadlines.js'
import { goalsOf, periodOf } from '../paygoals.js'

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
  editor:   { column: 'editor_id',   at: 'edited_at', phase: 'edit',   due: 'edit_ready_date',  label: 'Edited it' },
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
           edit_due_revised, review_due_revised, shot_at, edited_at, done_at, views, skip_rate
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


// ---- the KPI card ----------------------------------------------------------
// One person, one month, a set of ladders. What each band pays is the admin's
// and lives in the row; this file grades a month against it and never carries
// a number of its own.
const monthOf = (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : new Date().toISOString().slice(0, 7))
const cardFor = async (userId, month) =>
  (await get('SELECT * FROM kpi_cards WHERE user_id = ? AND month = ?', userId, month)) || null

// The month a card is graded against, measured off the same pay run the
// payslip uses, so the two can never disagree about how many pieces were late.
const statsFor = async (userId, month) => {
  const from = `${month}-01`
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)
  const { people } = await payRun({ from, to, only: userId })
  const me = (people || []).find((p) => p.id === Number(userId))
  return me?.stats || {}
}

router.get('/kpi/mine', wrap(async (req, res) => {
  const month = monthOf(req.query.month)
  const card = await cardFor(req.user.id, month)
  if (!card) return res.json({ month, card: null })
  res.json({ month, card: gradeCard(card, await statsFor(req.user.id, month)) })
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
  const me = runOut.people[0] || null
  if (!me) return res.json(null)
  // Whether this month has been closed and paid, or is still being worked out.
  const month = String(to || dayISO()).slice(0, 7)
  const row = await get('SELECT * FROM payouts WHERE user_id = ? AND month = ?', req.user.id, month)
  res.json({ ...me, payout: row ? publicPayout(row) : null })
}))

// ---- a person's own track record -------------------------------------------
// One number, once a month, told nobody anything about whether they were
// doing better than last time. Six months of it is a shape — and a shape is
// the thing that makes somebody want to beat it.
//
// A CLOSED month is read from what was written down when it closed; an open
// one is worked out live. Those are different kinds of fact and the answer
// says which is which, because a figure that can still move should never be
// drawn as though it were settled.
router.get('/pay/mine/history', wrap(async (req, res) => {
  res.json(await payHistory(req.user.id, Number(req.query.months) || 6))
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

// A person's own PACE: what they made, month by month, by what it was — so a
// planner can answer "what would it take to earn X" from what this person
// has actually been doing rather than from a rate card in the abstract.
// Declared before the admin gate for the same reason /work/mine is.
//
// Buckets are what the board sells: a reel (type reel), a YouTube video (type
// video on the youtube channel — YouTube is a channel here, not a type), a
// target (type target), and the rest. A piece counts in a bucket once per
// month if this person had any hat on it; alongside, how OFTEN they filmed,
// cut or ran a piece of that kind, because tier pay is per hat and a person
// who only ever cuts YouTube videos is paid the cut, not the filming.
//
// The window is the last N COMPLETE months (this month so far is reported
// separately, so a half month never drags an average down), and it starts at
// the person's first delivered piece, so a newcomer's zero months before they
// joined are not counted against them either.
// `channels` reaches this from two directions — raw off the row as a JSON
// string, and already parsed into an array by contributions() — and
// JSON.parse of an array throws, so parsing blind quietly returned no channels
// at all. That is what filed a YouTube cut as "other work" and paid it the
// flat rate: the only kind whose test needs the channel was the only kind that
// could not see one.
const chanList = (v) => (Array.isArray(v) ? v : parseList(v))
const bucketOf = (r) => (r.type === 'reel' ? 'reel'
  : r.type === 'target' ? 'target'
  : r.type === 'video' && chanList(r.channels).includes('youtube') ? 'youtube'
  : 'other')
const PACE_BUCKETS = ['reel', 'youtube', 'target', 'other']
router.get('/work/mine/pace', wrap(async (req, res) => {
  const months = Math.min(6, Math.max(1, Number(req.query.months) || 3))
  const me = req.user.id
  const statuses = await all('SELECT * FROM statuses')
  const dead = new Set(statuses.filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const rows = await all(`
    SELECT id, type, channels, status_id, assignee_id, assignees, done_at, operator_id, editor_id, skip_rate
    FROM content WHERE done_at IS NOT NULL`)
  const thisMonth = dayISO(0).slice(0, 7)
  const keys = []
  { let [y, m] = thisMonth.split('-').map(Number); for (let i = 0; i < months; i++) { m -= 1; if (m === 0) { m = 12; y -= 1 } keys.unshift(`${y}-${String(m).padStart(2, '0')}`) } }
  const blank = () => ({ pieces: 0, filmed: 0, edited: 0, made: 0 })
  const by = Object.fromEntries(PACE_BUCKETS.map((b) => [b, { months: Object.fromEntries(keys.map((k) => [k, blank()])) }]))
  const current = Object.fromEntries(PACE_BUCKETS.map((b) => [b, 0]))
  const total = blank()
  let skipSum = 0, skipN = 0, first = null
  for (const r of rows) {
    if (dead.has(r.status_id)) continue
    const filmed = r.operator_id === me, edited = r.editor_id === me
    const made = (parseList(r.assignees).length ? parseList(r.assignees) : (r.assignee_id ? [r.assignee_id] : [])).includes(me)
    if (!filmed && !edited && !made) continue
    const month = tashkentDay(r.done_at).slice(0, 7)
    if (!first || month < first) first = month
    const b = bucketOf(r)
    if (month === thisMonth) { current[b] += 1; continue }
    const slot = by[b].months[month]
    if (!slot) continue // older than the window
    slot.pieces += 1; total.pieces += 1
    if (filmed) { slot.filmed += 1; total.filmed += 1 }
    if (edited) { slot.edited += 1; total.edited += 1 }
    if (made) { slot.made += 1; total.made += 1 }
    if (r.skip_rate !== null && r.skip_rate !== undefined && Number.isFinite(Number(r.skip_rate))) { skipSum += Number(r.skip_rate); skipN += 1 }
  }
  // Average over the months since this person started, never over months
  // before they were here — and never over zero months.
  const active = keys.filter((k) => !first || k >= first)
  const div = Math.max(1, active.length)
  const shares = (t) => (t.pieces ? { film: t.filmed / t.pieces, edit: t.edited / t.pieces, made: t.made / t.pieces } : null)
  for (const b of PACE_BUCKETS) {
    const sum = Object.values(by[b].months).reduce((acc, m) => ({ pieces: acc.pieces + m.pieces, filmed: acc.filmed + m.filmed, edited: acc.edited + m.edited, made: acc.made + m.made }), blank())
    by[b].pieces = sum.pieces
    by[b].avg = Math.round((sum.pieces / div) * 10) / 10
    by[b].shares = shares(sum)
  }
  res.json({
    months: keys, since: first, active_months: active.length,
    by, current: { month: thisMonth, ...current },
    pieces: total.pieces, shares: shares(total),
    skip_avg: skipN ? Math.round(skipSum / skipN) : null, skip_counted: skipN,
  })
}))

// ---- when the team actually works ------------------------------------------
// Every number on the statistics page is a total for a month, and a total for
// a month cannot answer the question people keep asking out loud: when are we
// flat out, and when is nothing happening. Twenty pieces in a month is a
// steady four a week or it is nineteen in the last three days, and those are
// different teams with different problems — but they are the same twenty.
//
// So this returns the work as a series of DAYS: one reading per day per
// craft, counted the same way the payroll counts it, so the picture and the
// money can never disagree about what happened.
//
// A craft with nothing in the window is left out rather than drawn as a flat
// line along the floor. An empty band in a stack is a band you have to read
// the legend to dismiss.
const CRAFT = {
  operator: { key: 'filmed',    label: 'Filmed',    color: 'var(--chart-1)' },
  editor:   { key: 'edited',    label: 'Edited',    color: 'var(--chart-2)' },
  designer: { key: 'designed',  label: 'Designed',  color: 'var(--chart-3)' },
  assignee: { key: 'published', label: 'Published', color: 'var(--chart-4)' },
}
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

router.get('/activity', wrap(async (req, res) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? String(req.query.to) : dayISO()
  const span = Math.max(7, Math.min(365, Number(req.query.days) || 90))
  const start = new Date(`${to}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - (span - 1))
  const from = start.toISOString().slice(0, 10)
  const channel = req.query.channel && req.query.channel !== 'all' ? String(req.query.channel) : null

  // Every day in the window, including the empty ones. A chart drawn only
  // from the days that had work in them puts Monday next to Friday and calls
  // the gap between them a straight line.
  const days = []
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10))
  }
  const slot = Object.fromEntries(days.map((d, i) => [d, i]))

  const list = await contributions({ from, to, channel })
  const counts = {}
  const weekday = Array(7).fill(0)
  const byPerson = new Map()
  let late = 0
  for (const c of list) {
    const craft = CRAFT[c.hat]
    if (!craft) continue
    const i = slot[c.day]
    if (i === undefined) continue
    ;(counts[craft.key] ||= Array(days.length).fill(0))[i] += 1
    weekday[new Date(`${c.day}T00:00:00Z`).getUTCDay()] += 1
    byPerson.set(c.userId, (byPerson.get(c.userId) || 0) + 1)
    if (c.late) late += 1
  }

  const series = Object.values(CRAFT)
    .filter((c) => counts[c.key]?.some((n) => n > 0))
    .map((c) => ({ key: c.key, label: c.label, color: c.color, values: counts[c.key] }))

  const totals = days.map((_, i) => series.reduce((a, s) => a + s.values[i], 0))
  const done = totals.reduce((a, b) => a + b, 0)
  // The busiest day, and the longest run of days with nothing on them. Both
  // are the shape of the month rather than its size, which is the half a
  // total never says.
  let peak = null
  totals.forEach((n, i) => { if (n > 0 && (!peak || n > peak.n)) peak = { day: days[i], n } })
  // A quiet stretch only means something when there is a rhythm to break.
  // Four pieces all delivered on one day gives an eighty-nine day "quiet
  // stretch", which is arithmetically true and tells nobody anything.
  const activeDays = totals.filter((n) => n > 0).length
  let quiet = 0, run = 0
  if (activeDays >= 3) {
    for (const n of totals) { run = n === 0 ? run + 1 : 0; if (run > quiet) quiet = run }
  }

  const users = Object.fromEntries((await all('SELECT * FROM users')).map((u) => [u.id, publicUser(u)]))
  const people = [...byPerson.entries()]
    .map(([id, n]) => ({ id, name: users[id]?.name || `#${id}`, color: users[id]?.color || null, n }))
    .sort((a, b) => b.n - a.n)

  res.json({
    from, to, days, series, totals,
    done, late,
    active_days: activeDays,
    // Below one a day the figure rounds to nought and reads as "nothing
    // happened", so the rate is reported in the unit it is actually legible
    // in. The client is told which unit rather than guessing from the size.
    rate: done === 0 ? null
      : done / days.length >= 1
        ? { n: Math.round((done / days.length) * 10) / 10, per: 'day' }
        : done / days.length >= 1 / 7
          ? { n: Math.round((done / days.length) * 70) / 10, per: 'week' }
          : { n: Math.round((done / days.length) * 300) / 10, per: 'month' },
    peak,
    quiet_run: quiet,
    weekday: weekday.map((n, i) => ({ key: String(i), label: WEEKDAY[i], value: n })),
    people,
  })
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
  // What a piece pays depends on WHAT IT IS, not only on which hat you wore.
  // A YouTube video is a day's shoot and a week's cut; a reel is an afternoon.
  // One `per_shoot` for both was the board quietly paying the same for two
  // different jobs, so shooting and editing are priced per kind of work.
  // A kind left at 0 falls back to the flat rate above, so a board that has
  // not set them keeps working exactly as it did and can adopt them one at a
  // time. "Shot AND edited it" needs no rate of its own: the person wore both
  // hats, so they are paid for both.
  'per_shoot_reel', 'per_edit_reel',
  'per_shoot_youtube', 'per_edit_youtube',
  'per_shoot_target', 'per_edit_target',
]
const BLANK_RATES = {
  currency: 'UZS', base: 0, per_shoot: 0, per_edit: 0, per_design: 0, per_publish: 0,
  per_review: 0, quota: 0, quota_bonus: 0, ontime_bonus: 0, ontime_target: 90, late_penalty: 0,
  per_1k_views: 0, views_target: 0, views_bonus: 0,
  per_shoot_reel: 0, per_edit_reel: 0,
  per_shoot_youtube: 0, per_edit_youtube: 0,
  per_shoot_target: 0, per_edit_target: 0,
}
const HAT_RATE = {
  operator: 'per_shoot', editor: 'per_edit', designer: 'per_design',
  assignee: 'per_publish', reviewer: 'per_review',
}
// The kinds of work the board prices apart, and which rate field each one
// reads for each hat. Only shooting and editing are split: designing, signing
// off and carrying a piece do not change shape with the format.
const KINDS = ['reel', 'youtube', 'target']
const KIND_LABEL = { reel: 'reels', youtube: 'YouTube', target: 'targets', other: 'other work' }
const KIND_RATE = {
  operator: { reel: 'per_shoot_reel', youtube: 'per_shoot_youtube', target: 'per_shoot_target' },
  editor: { reel: 'per_edit_reel', youtube: 'per_edit_youtube', target: 'per_edit_target' },
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
// ---- a closed month --------------------------------------------------------
// Rows come back with the frozen figures unpacked, so a caller never has to
// know that the breakdown rides as text.
function publicPayout(row) {
  let breakdown = {}
  try { breakdown = JSON.parse(row.breakdown || '{}') } catch { breakdown = {} }
  return {
    user_id: row.user_id, month: row.month, currency: row.currency || 'UZS',
    total: Number(row.total) || 0, note: row.note || '',
    paid_at: row.paid_at || null, marked_by: row.marked_by || null,
    closed_at: row.created_at, breakdown,
  }
}

const monthStartOf = (m) => `${m}-01`
const monthEndOf = (m) => {
  const d = new Date(`${m}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}
const monthsBack = (n, from = dayISO()) => {
  const out = []
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`)
  for (let i = 0; i < n; i++) { out.unshift(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1) }
  return out
}

// The last n months for one person. One pass over the board covers all of
// them: contributions are dated, so the whole span is fetched once and each
// month takes the slice that belongs to it.
async function payHistory(userId, n = 6) {
  const months = monthsBack(Math.max(1, Math.min(24, n)))
  const spanFrom = monthStartOf(months[0])
  const today = dayISO()
  const spanTo = today
  const list = await contributions({ from: spanFrom, to: spanTo })
  const closed = await all('SELECT * FROM payouts WHERE user_id = ?', userId)
  const byMonth = new Map(closed.map((r) => [r.month, publicPayout(r)]))
  const out = []
  for (const m of months) {
    const from = monthStartOf(m)
    const to = monthEndOf(m) < today ? monthEndOf(m) : today
    const paid = byMonth.get(m) || null
    if (paid) { out.push({ month: m, total: paid.total, currency: paid.currency, settled: true, payout: paid }); continue }
    const slice = list.filter((c) => String(c.day).slice(0, 7) === m)
    const run = await payRun({ from, to, only: userId, list: slice })
    const p = run.people[0]
    // A base salary is paid "whatever the count", so the calculator happily
    // reports a full month's base for a month this person has no record of
    // working at all — including months before they joined. That figure is
    // not a lie about the rate card; it would be a lie about the month. So it
    // is marked as assumed, and drawn hollow rather than as a bar somebody
    // could read as money they were once paid.
    const delivered = p?.delivered || 0
    out.push({
      month: m, total: p ? Math.round(p.total) : 0, currency: p?.currency || 'UZS',
      settled: false, payout: null, delivered,
      assumed: delivered === 0 && !!p && p.total > 0,
      running: m === today.slice(0, 7),
    })
  }
  return { months: out, currency: out.find((m) => m.total > 0)?.currency || 'UZS' }
}

async function payRun({ from, to, only, list: given }) {
  const list = given || await contributions({ from, to })
  const { pick } = await rateCards()
  const users = (await all('SELECT * FROM users')).map(publicUser)
  const wanted = only ? users.filter((u) => u.id === Number(only)) : users

  const counted = {}
  for (const c of list) {
    const e = (counted[c.userId] = counted[c.userId] || { hats: {}, byKind: {}, late: 0, done: 0, views: 0, counted: 0, items: [], skipSum: 0, skipN: 0, seenSkip: new Set() })
    e.hats[c.hat] = (e.hats[c.hat] || 0) + 1
    // …and again split by what the piece was, which is what the per-kind
    // rates are priced against. Same classifier the pace report uses, so the
    // planner's answer and the payslip never disagree about what a reel is.
    const kind = bucketOf(c.row)
    e.byKind[c.hat] = e.byKind[c.hat] || {}
    e.byKind[c.hat][kind] = (e.byKind[c.hat][kind] || 0) + 1
    e.done += 1
    if (c.late) e.late += 1
    // Views belong to the person the piece was FOR — the content maker — and
    // are counted once even though they wear several hats on the same task.
    // A piece nobody has counted yet adds nothing rather than adding zero.
    if (c.hat === 'assignee' && Number.isFinite(Number(c.row.views)) && c.row.views !== null) {
      e.views += Number(c.row.views)
      e.counted += 1
    }
    // The skip rate is a fact about the PIECE, so it is averaged once per
    // piece however many hats this person wore on it.
    if (!e.seenSkip.has(c.row.id) && c.row.skip_rate !== null && c.row.skip_rate !== undefined && Number.isFinite(Number(c.row.skip_rate))) {
      e.seenSkip.add(c.row.id); e.skipSum += Number(c.row.skip_rate); e.skipN += 1
    }
    e.items.push({ id: c.row.id, title: c.row.title, hat: c.hat, day: c.day, late: c.late, views: c.row.views ?? null })
  }

  const people = wanted.map((u) => {
    const e = counted[u.id] || { hats: {}, byKind: {}, late: 0, done: 0, views: 0, counted: 0, items: [], skipSum: 0, skipN: 0, seenSkip: new Set() }
    const rates = pick(u.id)
    const lines = []
    let piecework = 0
    for (const [hat, field] of Object.entries(HAT_RATE)) {
      const n = e.hats[hat] || 0
      const flat = rates[field] || 0
      // Shooting and editing are priced per kind of work. Where the board has
      // set those rates the month is billed kind by kind — "3 reels filmed",
      // "1 YouTube video cut" — and where it has not, the flat rate stands and
      // the line reads exactly as it always did.
      const perKind = KIND_RATE[hat]
      const split = perKind && KINDS.some((k) => rates[perKind[k]] > 0)
      if (split) {
        for (const k of KINDS) {
          const cnt = (e.byKind[hat] || {})[k] || 0
          const rate = rates[perKind[k]] || flat
          if (!cnt || !rate) continue
          const amount = cnt * rate
          piecework += amount
          lines.push({ hat, kind: k, label: `${HATS[hat].label} · ${KIND_LABEL[k]}`, count: cnt, rate, amount })
        }
        // Work of a kind nobody priced still has to be paid for.
        const priced = KINDS.reduce((t, k) => t + ((e.byKind[hat] || {})[k] || 0), 0)
        const rest = n - priced
        if (rest > 0 && flat) {
          piecework += rest * flat
          lines.push({ hat, kind: 'other', label: `${HATS[hat].label} · ${KIND_LABEL.other}`, count: rest, rate: flat, amount: rest * flat })
        }
        continue
      }
      if (!n && !flat) continue
      const amount = n * flat
      piecework += amount
      lines.push({ hat, kind: null, label: HATS[hat].label, count: n, rate: flat, amount })
    }
    // Nothing that earned nothing is drawn: a line reading "0 edits · 0 UZS"
    // is a fact about the rate card, not about the person, and it is exactly
    // the row people scroll past to find the ones that matter.
    const earning = lines.filter((l) => l.count > 0 && l.amount > 0)
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
      // What the month MEASURED, keyed the way a KPI ladder names it. A metric
      // nobody took a reading for is null rather than 0: an average skip rate
      // over no reels is not a skip rate of nothing.
      stats: {
        delivered: e.done,
        late: e.late,
        on_time_pct: onTimePct,
        views: e.counted > 0 ? e.views : null,
        skip_rate: e.skipN > 0 ? Math.round((e.skipSum / e.skipN) * 10) / 10 : null,
      },
      lines: earning, base: rates.base || 0, piecework,
      onTimeBonus, quotaBonus, viewsBonus, bonus, penalty, total,
      // What is still winnable, and what it would take — worked out here so
      // the browser only has to draw it, and so none of it can be nudged by
      // anything a browser sends.
      ...(from && to
        ? goalsOf({ rates, delivered: e.done, late: e.late, onTime, views, from, to })
        : { period: null, goals: [] }),
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
  // Which of these have already been paid for the month the range sits in.
  // A payroll that cannot tell you what has gone out is a spreadsheet.
  const month = String(to || dayISO()).slice(0, 7)
  const closed = (await all('SELECT * FROM payouts WHERE month = ?', month)).map(publicPayout)
  const byUser = new Map(closed.map((r) => [r.user_id, r]))
  out.people = out.people.map((p) => ({ ...p, payout: byUser.get(p.id) || null }))
  res.json({
    ...out, hasDefault, month,
    settled: closed.length, settledTotal: closed.reduce((a, r) => a + r.total, 0),
    currency: out.people[0]?.currency || 'UZS',
  })
}))

router.get('/kpi/:userId', adminOnly, wrap(async (req, res) => {
  const month = monthOf(req.query.month)
  const userId = Number(req.params.userId)
  const card = await cardFor(userId, month)
  res.json({
    month,
    stats: await statsFor(userId, month),
    // The admin edits the shape, so they get it raw as well as graded.
    raw: card ? { ...card, ladders: JSON.parse(card.ladders || '[]'), readings: JSON.parse(card.readings || '{}') } : null,
    card: card ? gradeCard(card, await statsFor(userId, month)) : null,
  })
}))

router.put('/kpi/:userId/:month', adminOnly, wrap(async (req, res) => {
  const userId = Number(req.params.userId)
  const month = monthOf(req.params.month)
  if (!(await get('SELECT 1 AS x FROM users WHERE id = ?', userId))) return res.status(404).json({ error: 'No such person' })
  const b = req.body || {}
  const ladders = Array.isArray(b.ladders) ? b.ladders : []
  for (const l of ladders) {
    if (!l || !l.key) return res.status(400).json({ error: 'Every ladder needs a key' })
    if (!METRICS[l.metric] && l.metric !== 'manual') return res.status(400).json({ error: `No such metric: ${l.metric}` })
    if (!Array.isArray(l.bands) || !l.bands.length) return res.status(400).json({ error: `«${l.key}» has no bands` })
    for (const band of l.bands) {
      if (band.pays !== undefined && !Number.isFinite(Number(band.pays)))
        return res.status(400).json({ error: 'A band pays a number, or nothing' })
    }
  }
  const fixed = Number(b.fixed) || 0
  if (fixed < 0) return res.status(400).json({ error: 'Fixed pay is zero or more' })
  const now = new Date().toISOString()
  const existing = await cardFor(userId, month)
  const vals = [
    String(b.currency || existing?.currency || 'UZS').slice(0, 8),
    fixed,
    JSON.stringify(ladders),
    JSON.stringify(b.readings && typeof b.readings === 'object' ? b.readings : {}),
    String(b.note || '').slice(0, 2000),
    req.user.id, now,
  ]
  if (existing) {
    await run('UPDATE kpi_cards SET currency=?, fixed=?, ladders=?, readings=?, note=?, updated_by=?, updated_at=? WHERE id=?', ...vals, existing.id)
  } else {
    await run(`INSERT INTO kpi_cards (user_id, month, currency, fixed, ladders, readings, note, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, userId, month, ...vals.slice(0, 5), req.user.id, now, now)
  }
  const saved = await cardFor(userId, month)
  res.json({ month, card: gradeCard(saved, await statsFor(userId, month)) })
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

// ---- closing a month --------------------------------------------------------
// Admin only, and past this point in the file everything is.
//
// Recording a month as paid does two things at once, and they are worth
// naming apart. It answers "was I paid for August?" — which nothing on this
// board could answer before. And it FREEZES August: from then on the figures
// come from the row rather than from a fresh sweep of the tasks, so editing an
// old task in October no longer quietly rewrites a payslip somebody has
// already been paid against.
//
// Idempotent per person per month, so two admins pressing it at the same
// moment record one payment, not two.

const MONTH_RE = /^\d{4}-\d{2}$/

router.get('/pay/payouts', wrap(async (req, res) => {
  const month = MONTH_RE.test(String(req.query.month || '')) ? String(req.query.month) : dayISO().slice(0, 7)
  const rows = await all('SELECT * FROM payouts WHERE month = ?', month)
  res.json({ month, payouts: rows.map(publicPayout) })
}))

router.post('/pay/payouts', wrap(async (req, res) => {
  const body = req.body || {}
  const month = MONTH_RE.test(String(body.month || '')) ? String(body.month) : null
  if (!month) return res.status(400).json({ error: 'A month, as YYYY-MM' })
  const today = dayISO()
  if (month > today.slice(0, 7)) return res.status(400).json({ error: 'That month has not happened yet' })
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.paid_at || '')) ? String(body.paid_at) : today
  const note = String(body.note || '').slice(0, 400)

  const from = monthStartOf(month)
  const end = monthEndOf(month)
  const to = end < today ? end : today
  const run_ = await payRun({ from, to })
  // Only people the payroll actually pays. Somebody with no rate card and
  // nothing delivered is not a payment of zero — they are not a payment.
  let people = run_.people.filter((p) => p.source !== 'none' && (p.total !== 0 || p.delivered > 0))
  if (Array.isArray(body.user_ids) && body.user_ids.length) {
    const want = new Set(body.user_ids.map(Number))
    people = people.filter((p) => want.has(p.id))
  }
  const now = new Date().toISOString()
  const written = []
  for (const p of people) {
    // The WHOLE payslip, not the total and half the reasons for it. Freezing
    // a figure and leaving its itemisation to a live re-derivation is the
    // worst of both: a number that cannot move, broken down by numbers that
    // can, which stop adding up to it the first time anybody edits an old
    // task — the exact failure the freeze exists to prevent, reintroduced one
    // level down. The rates ride along, so a card rewritten in November
    // cannot relabel what September was paid on, and so do the pieces,
    // because "which work was I paid for" is the other half of a payslip.
    const breakdown = JSON.stringify({
      base: p.base, piecework: p.piecework, viewsPay: p.viewsPay, bonus: p.bonus,
      quotaBonus: p.quotaBonus, onTimeBonus: p.onTimeBonus, viewsBonus: p.viewsBonus,
      penalty: p.penalty, delivered: p.delivered, late: p.late, onTimePct: p.onTimePct,
      views: p.views, viewsCounted: p.viewsCounted, viewsTarget: p.viewsTarget,
      quota: p.quota, rates: p.rates, lines: p.lines, items: p.items,
    })
    const existing = await get('SELECT id FROM payouts WHERE user_id = ? AND month = ?', p.id, month)
    if (existing) {
      await run('UPDATE payouts SET currency=?, total=?, breakdown=?, note=?, paid_at=?, marked_by=?, updated_at=? WHERE id=?',
        p.currency, Math.round(p.total), breakdown, note, paidAt, req.user.id, now, existing.id)
    } else {
      await run(`INSERT INTO payouts (user_id, month, currency, total, breakdown, note, paid_at, marked_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.id, month, p.currency, Math.round(p.total), breakdown, note, paidAt, req.user.id, now, now)
    }
    written.push(p.id)
  }
  const rows = await all('SELECT * FROM payouts WHERE month = ?', month)
  res.status(201).json({ month, paid_at: paidAt, recorded: written.length, payouts: rows.map(publicPayout) })
}))

// Re-opening a month. The row goes and the calculator takes over again — the
// only honest way back, because a frozen figure that can be edited in place is
// a figure nobody can trust.
router.delete('/pay/payouts/:month/:userId', wrap(async (req, res) => {
  const month = String(req.params.month)
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'A month, as YYYY-MM' })
  if (req.params.userId === 'all') {
    await run('DELETE FROM payouts WHERE month = ?', month)
    return res.json({ ok: true, month })
  }
  await run('DELETE FROM payouts WHERE month = ? AND user_id = ?', month, Number(req.params.userId))
  res.json({ ok: true, month })
}))

export default router
