import { Router } from 'express'
import { dayISO } from '../db.js'
import { authRequired, wrap } from '../auth.js'
import { contributions, HATS } from './reports.js'

// What a person has actually done, told back to them.
//
// The board knew, to the day, that somebody had delivered eleven cuts this
// month and had not missed a promise in three weeks, and it never once said
// so. Every message it sent was a deadline, a Pravki or a nag. That is a
// board people avoid opening.
//
// So the same delivery record that pays them also congratulates them. Nothing
// here is invented or awarded: a streak is days on which they really handed
// something over, a milestone is a real count, and the on-time share is the
// same number the payroll uses. Points are the one synthetic thing, and they
// are a plain weighted count of deliveries — visible arithmetic, not a
// slot machine.
//
// Everything is DERIVED. No table, no nightly job, nothing to drift out of
// step with the work, and nothing that can be farmed by clicking.

const router = Router()
router.use(authRequired)

// What each kind of delivery is worth. A shoot and a cut are a day's work; a
// sign-off is a minute of somebody's attention. The weights only decide the
// size of the number people see next to their name — they are deliberately
// small and round so the arithmetic is checkable by eye.
const POINTS = { operator: 10, editor: 10, designer: 8, assignee: 6, reviewer: 2 }

// The rungs. Passing one is worth saying out loud; the rest of the time the
// count just sits there.
const MILESTONES = [1, 5, 10, 25, 50, 100, 200, 350, 500, 750, 1000]

const backDay = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

// Consecutive days ending today (or yesterday — a streak is not broken until
// the day it is missed is over, which is how everybody who has ever kept one
// understands it).
function streakOf(days, today) {
  if (!days.size) return 0
  let cursor = days.has(today) ? today : backDay(today, 1)
  if (!days.has(cursor)) return 0
  let n = 0
  while (days.has(cursor)) { n++; cursor = backDay(cursor, 1) }
  return n
}

// Every streak this person has ever run, longest first — so "your best" is a
// real record and not just what they happen to be on now.
function bestStreakOf(days) {
  const sorted = [...days].sort()
  let best = 0, run = 0, prev = null
  for (const d of sorted) {
    run = prev && backDay(d, 1) === prev ? run + 1 : 1
    prev = d
    if (run > best) best = run
  }
  return best
}

export async function rewardsFor(userId, today = dayISO()) {
  const mine = (await contributions({})).filter((c) => c.userId === userId)
  const days = new Set(mine.map((c) => c.day))

  const monthStart = today.slice(0, 8) + '01'
  const weekStart = backDay(today, 6)
  const inMonth = mine.filter((c) => c.day >= monthStart && c.day <= today)
  const inWeek = mine.filter((c) => c.day >= weekStart && c.day <= today)

  const byHat = {}
  for (const c of mine) byHat[c.hat] = (byHat[c.hat] || 0) + 1
  const points = Object.entries(byHat).reduce((a, [hat, n]) => a + n * (POINTS[hat] || 0), 0)

  const monthLate = inMonth.filter((c) => c.late).length
  const total = mine.length
  const next = MILESTONES.find((m) => m > total) ?? null

  return {
    total,
    points,
    today: mine.filter((c) => c.day === today).length,
    week: inWeek.length,
    month: inMonth.length,
    streak: streakOf(days, today),
    bestStreak: bestStreakOf(days),
    // A share of nothing is not nought per cent — it is nothing to judge.
    onTimePct: inMonth.length ? Math.round(((inMonth.length - monthLate) / inMonth.length) * 100) : null,
    byHat: Object.fromEntries(Object.entries(byHat).map(([h, n]) => [h, { count: n, label: HATS[h]?.label || h }])),
    nextMilestone: next,
    toNextMilestone: next === null ? null : next - total,
    // Did this person just land on a rung? The client asks after a delivery
    // and shows it once; nothing is stored, so re-asking says the same thing
    // until the next delivery moves the count off the rung.
    atMilestone: MILESTONES.includes(total) ? total : null,
  }
}

router.get('/mine', wrap(async (req, res) => {
  res.json(await rewardsFor(req.user.id))
}))

export default router
