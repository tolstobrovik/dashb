// The KPIs the team already keeps, joined to the money.
//
// The board has had a KPI section since long before it had a payroll: a row
// per person per goal — "Reels published per week", target 10, current 7 —
// with `current` typed in by hand once a month by whoever remembered. And
// then, separately, pay was worked out from the same numbers, also by hand,
// on the same day, by the same person, from a different screen.
//
// Two things close that gap, and neither invents a number:
//
//   SOURCE   a KPI can say which thing the board already counts is its
//            `current`, and then it fills itself from the delivery record —
//            the same record the report and the payroll read. Leave it empty
//            and the KPI behaves exactly as it always has.
//
//   REWARD   what hitting it is worth. The KPI section becomes the pay
//            scheme rather than a document about it.
//
// DIRECTION is the part that is easy to get wrong and expensive to get wrong.
// "At least twenty cuts" and "no more than two late" are both targets, and a
// naive `actual >= target` pays exactly the wrong people on the second one.

import { all } from './db.js'
import { contributions, HATS } from './routes/reports.js'

// What the board can count for a person over a period. Each is a plain
// reduction over the same contribution list the report and the payroll use,
// so a KPI can never disagree with the report about what somebody did.
export const SOURCES = {
  shoots: { label: 'Shoots delivered', unit: 'shoots', of: (c) => c.filter((x) => x.hat === 'operator').length },
  cuts: { label: 'Cuts delivered', unit: 'cuts', of: (c) => c.filter((x) => x.hat === 'editor').length },
  designs: { label: 'Designs delivered', unit: 'designs', of: (c) => c.filter((x) => x.hat === 'designer').length },
  published: { label: 'Pieces published', unit: 'pieces', of: (c) => c.filter((x) => x.hat === 'assignee').length },
  signoffs: { label: 'Sign-offs given', unit: 'sign-offs', of: (c) => c.filter((x) => x.hat === 'reviewer').length },
  // Ads are their own question — a channel buys a number of them a month, and
  // whoever makes them is measured on that number and not on video in general.
  ads: { label: 'Video ads delivered', unit: 'ads', of: (c) => c.filter((x) => x.row.type === 'target').length },
  delivered: { label: 'Everything delivered', unit: 'pieces', of: (c) => c.length },
  ontime_pct: {
    label: 'On time (%)', unit: '%', pct: true,
    of: (c) => (c.length ? Math.round(((c.length - c.filter((x) => x.late).length) / c.length) * 100) : null),
  },
  late_count: { label: 'Delivered late', unit: 'pieces', lower: true, of: (c) => c.filter((x) => x.late).length },
}
export const SOURCE_KEYS = Object.keys(SOURCES)

// A KPI whose target is a WORD — "good", "consistent", "fine" — is a goal
// somebody judges, not a number the board can. Stripping the non-digits out
// of "good" leaves an empty string, and Number('') is 0: read carelessly,
// such a KPI reports 0 against a target of 0, calls itself met, and pays.
// Nothing to measure has to come back as nothing to judge.
const num = (v) => {
  const digits = String(v ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')
  if (!/\d/.test(digits)) return null
  const n = Number(digits)
  return Number.isFinite(n) ? n : null
}

// Was it hit? `atmost` is not a detail: "no more than two late" is met by a
// SMALLER number, and reading every target the same way pays the person who
// missed the most.
export function meets(actual, target, direction) {
  if (actual === null || target === null) return null
  return direction === 'atmost' ? actual <= target : actual >= target
}

// One person's KPIs for a period, each with what the board actually counted.
export async function kpisFor(userId, { from, to } = {}) {
  const rows = await all('SELECT * FROM person_kpis WHERE user_id = ? ORDER BY sort, id', userId)
  if (!rows.length) return []
  // The delivery record is read once even when somebody has nine KPIs.
  const needsBoard = rows.some((r) => SOURCES[r.source])
  const mine = needsBoard
    ? (await contributions({ from, to })).filter((c) => c.userId === userId)
    : []

  return rows.map((r) => {
    const src = SOURCES[r.source]
    // A sourced KPI is counted; an unsourced one keeps whatever was typed.
    const actual = src ? src.of(mine) : num(r.current)
    const target = num(r.target)
    const direction = r.direction === 'atmost' ? 'atmost' : 'atleast'
    const met = meets(actual, target, direction)
    return {
      ...r,
      reward: Number(r.reward) || 0,
      direction,
      counted: !!src,
      source_label: src?.label || null,
      unit: r.unit || src?.unit || '',
      actual,
      // What the page shows in the Current column: the counted number when
      // there is one, otherwise the words somebody typed.
      current: src ? (actual === null ? '' : String(actual)) : r.current,
      target_num: target,
      met,
      // Only a met KPI with money on it is worth anything.
      earned: met === true ? (Number(r.reward) || 0) : 0,
    }
  })
}

// Everybody's, for the payroll. One pass over the board rather than one per
// person — a team of thirty with four KPIs each would otherwise read the
// whole delivery record a hundred and twenty times.
export async function kpiEarnings({ from, to } = {}) {
  const rows = await all('SELECT * FROM person_kpis ORDER BY user_id, sort, id')
  if (!rows.length) return new Map()
  const board = rows.some((r) => SOURCES[r.source]) ? await contributions({ from, to }) : []
  const byUser = new Map()
  for (const c of board) {
    if (!byUser.has(c.userId)) byUser.set(c.userId, [])
    byUser.get(c.userId).push(c)
  }
  const out = new Map()
  for (const r of rows) {
    const src = SOURCES[r.source]
    const mine = byUser.get(r.user_id) || []
    const actual = src ? src.of(mine) : num(r.current)
    const target = num(r.target)
    const direction = r.direction === 'atmost' ? 'atmost' : 'atleast'
    const met = meets(actual, target, direction)
    const line = {
      id: r.id, name: r.name, unit: r.unit || src?.unit || '',
      counted: !!src, source: r.source || null,
      actual, target: target, direction, met,
      reward: Number(r.reward) || 0,
      earned: met === true ? (Number(r.reward) || 0) : 0,
    }
    if (!out.has(r.user_id)) out.set(r.user_id, [])
    out.get(r.user_id).push(line)
  }
  return out
}

export { HATS }
