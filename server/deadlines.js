// Who is missing the deadlines — shooters, editors or review.
//
// The pipeline is read as three accountable phases, each with an owner, a
// promised date and a moment the work actually left their hands:
//
//   shoot   operator_id  recording_date       done when the card enters Editing
//   edit    editor_id    edit_ready_date      done when the card enters Ready
//   review  reviewer_id  release_date         done when the card is published
//
// Nothing here is stored. A warning is DERIVED from those timestamps every
// time it is asked for, which is what keeps it honest: when a late handover
// excuses the next person, their warning disappears by itself instead of
// waiting for a cleanup job to agree.
import { dayISO, tashkentDay } from './db.js'

export const PHASES = ['shoot', 'edit', 'review']

// What each phase reads off a task. `started` is the moment the work reached
// this owner — the shoot has none because it starts with the task itself.
const FIELDS = {
  shoot: {
    owner: 'operator_id', promised: 'recording_date', revised: null,
    started: null, delivered: 'shot_at', role: 'operator',
  },
  edit: {
    owner: 'editor_id', promised: 'edit_ready_date', revised: 'edit_due_revised',
    started: 'shot_at', delivered: 'edited_at', role: 'editor',
  },
  review: {
    // Review can be shared. `reviewers` is the list; reviewer_id mirrors the
    // first of them, and a missed review is charged to every name on it.
    owner: 'reviewer_id', owners: 'reviewers', promised: 'release_date', revised: 'review_due_revised',
    started: 'edited_at', delivered: 'done_at', role: 'reviewer',
  },
}

// The people answering for a phase. A shared phase answers as a group.
export function ownersOfPhase(task, key) {
  const f = FIELDS[key]
  if (f.owners) {
    let list = []
    try { list = JSON.parse(task[f.owners] || '[]') } catch { list = [] }
    list = list.map(Number).filter(Boolean)
    if (list.length) return [...new Set(list)]
  }
  return task[f.owner] ? [task[f.owner]] : []
}

export const PHASE_LABEL = { shoot: 'Shooting', edit: 'Editing', review: 'Review & publish' }

// ---- which stage is which gate ------------------------------------------
// Stages are the admin's data, not constants, so they are matched by label the
// way the existing stage rules already do. Each gate answers "entering THIS
// stage means the phase before it is finished and the next one is owned".
const GATE_PATTERNS = {
  shoot:  /to\s*shoot|shooting|s[yj]omka/i,
  edit:   /editing|montaj/i,
  review: /^ready$|review|tayyor/i,
}
export const isDeleted = (label) => /^deleted$/i.test(String(label || ''))

// Resolve the gate stages once per request from the live stage list. Missing
// gates simply stay null — an admin who deleted the Editing stage gets no
// editing gate rather than a crash.
export function resolveGates(statuses) {
  const ordered = [...statuses].sort((a, b) => (a.sort - b.sort) || (a.id - b.id))
  const live = ordered.filter((s) => !isDeleted(s.label))
  const gates = { shoot: null, edit: null, review: null }
  for (const key of PHASES) {
    const hit = live.find((s) => GATE_PATTERNS[key].test(String(s.label || '')))
    if (hit) gates[key] = { id: hit.id, label: hit.label, index: live.indexOf(hit) }
  }
  const final = live.find((s) => s.is_final)
  return { gates, ordered: live, finalId: final?.id ?? null }
}

// Every gate a move into `targetId` has to satisfy. Gates are cumulative on
// purpose: dragging a card straight from Idea to Ready must not be a way to
// skip naming the shooter and the editor on the way past.
export function gatesUpTo(targetId, resolved) {
  const { gates, ordered } = resolved
  const target = ordered.findIndex((s) => s.id === targetId)
  if (target < 0) return []
  return PHASES
    .map((key) => (gates[key] && gates[key].index <= target ? { key, ...gates[key] } : null))
    .filter(Boolean)
}

// Whose hands the task is in RIGHT NOW, judged by the stage it sits in: before
// the editing gate it belongs to the shooter, from there to review it belongs
// to the editor, and past that to the reviewers. Handing work over hands over
// the right to move it — the previous owner cannot drag it back out from under
// the person now holding it.
export function holderOf(task, resolved) {
  const { gates, ordered } = resolved
  const at = ordered.findIndex((s) => s.id === task.status_id)
  if (at < 0) return { phase: null, owner_ids: [] }
  const past = (g) => g && at >= g.index
  const phase = past(gates.review) ? 'review' : past(gates.edit) ? 'edit' : 'shoot'
  return { phase, owner_ids: ownersOfPhase(task, phase) }
}

// ---- has this phase been passed? -------------------------------------------
// The question that decides whether a piece is late, and the one every part of
// this board was answering slightly differently — with the result that work
// visibly finished went on being called late for weeks.
//
// A timestamp alone does not answer it. shot_at is stamped when the work is
// handed to the EDITOR, so a card sitting on Shot — filmed, nothing handed
// over yet — has none; and rows that predate the stamping have none at all,
// however long ago the shoot happened. So the STAGE answers as well: a card
// that has reached Editing has finished its shoot whatever its timestamps say.
//
// Either signal is enough. They can only disagree by one being missing.
const PHASE_DONE_AT = { shoot: 'edit', edit: 'review', design: 'review', review: null }
// The shoot is the one phase whose end is not a gate. Gates mark handovers —
// "edit" is the moment footage reaches the editor — but filming is finished
// the moment the card reaches SHOT, which can sit there for days before
// anybody hands anything over. Asking the gate instead was why a filmed piece
// went on being an overdue shoot.
const SHOT_STAGE = /^shot$|^filmed$/i
export function phasePassed(task, key, resolved) {
  const f = FIELDS[key]
  if (f && task[f.delivered]) return true
  if (!resolved) return false
  const at = resolved.ordered.findIndex((s) => s.id === task.status_id)
  if (at < 0) return false
  if (key === 'shoot') {
    const shot = resolved.ordered.findIndex((s) => SHOT_STAGE.test(String(s.label || '')))
    if (shot >= 0) return at >= shot
  }
  const gateKey = PHASE_DONE_AT[key]
  const gate = gateKey ? resolved.gates[gateKey] : null
  return !!gate && at >= gate.index
}

// ---- the state of one phase ---------------------------------------------
// ok       delivered on or before the promised day
// late     delivered after it, or still undelivered with the day gone
// excused  the work only arrived after this phase's own deadline had passed,
//          and nobody re-promised a date — the delay is upstream, not here
// waiting  the work has not reached this owner yet
// pending  in hand, still inside the promised day
// none     no date was ever promised, so there is nothing to answer for
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000)

export function phaseState(task, key, today = dayISO(), resolved = null) {
  const f = FIELDS[key]
  const promised = task[f.promised] || null
  const revised = f.revised ? task[f.revised] || null : null
  const due = revised || promised
  const started = f.started ? task[f.started] || null : null
  const deliveredIso = task[f.delivered] || null
  const delivered = deliveredIso ? tashkentDay(deliveredIso) : null

  const owner_ids = ownersOfPhase(task, key)
  const base = {
    phase: key, label: PHASE_LABEL[key], role: f.role,
    owner_id: owner_ids[0] || null,
    owner_ids,
    promised, revised, due,
    started, started_day: started ? tashkentDay(started) : null,
    delivered: deliveredIso, delivered_day: delivered,
    days_late: 0,
  }

  if (!due) return { ...base, state: 'none' }
  if (f.started && !started) return { ...base, state: delivered ? 'ok' : 'waiting' }

  let state
  if (delivered) state = delivered <= due ? 'ok' : 'late'
  // No timestamp, but the card has moved past this phase — the work happened,
  // it simply happened before anything wrote it down. Calling that late is how
  // finished pieces stayed on people's overdue lists for weeks.
  else if (phasePassed(task, key, resolved)) state = 'ok'
  else state = today > due ? 'late' : 'pending'

  // The upstream excuse: the work landed here after this phase's own date had
  // already gone, and no replacement date was agreed. Only a phase with an
  // upstream can be excused — the shoot answers for itself.
  if (state === 'late' && started && !revised && tashkentDay(started) > due)
    state = 'excused'

  const days_late = state === 'late' ? Math.max(0, dayDiff(delivered || today, due)) : 0
  return { ...base, state, days_late }
}

// All three phases of one task.
export function phasesOf(task, today = dayISO(), resolved = null) {
  return PHASES.map((k) => phaseState(task, k, today, resolved))
}

// The warnings a task produces: late phases that have somebody to answer for.
// A shared phase produces one warning per owner — a review two people agreed
// to own is late for both of them. A late phase nobody owns is still returned
// (owner_id null) so admins can see unowned slippage, but it never lands in a
// person's account.
export function warningsOf(task, today = dayISO(), resolved = null) {
  return phasesOf(task, today, resolved)
    .filter((p) => p.state === 'late')
    .flatMap((p) => {
      const owners = p.owner_ids.length ? p.owner_ids : [null]
      return owners.map((owner_id) => ({
        content_id: task.id,
        title: task.title,
        channels: task.channels,
        type: task.type,
        phase: p.phase,
        phase_label: p.label,
        role: p.role,
        owner_id,
        // Named so a shared miss reads as shared rather than personal.
        shared_with: owners.filter((id) => id && id !== owner_id),
        due: p.due,
        promised: p.promised,
        revised: p.revised,
        delivered: p.delivered,
        delivered_day: p.delivered_day,
        days_late: p.days_late,
        // An undelivered late phase is still running — it gets worse each day.
        open: !p.delivered,
      }))
    })
}
