// Grading a month against a ladder.
//
// Every KPI sheet this team runs on is the same object in a different suit: a
// METRIC, five BANDS from A+ down to D, and what each band pays. The skip rate
// on a reel, quality leads out of all leads, channel growth against plan,
// forwards on a guiding post, deadline misses, flawed days. Some of them are
// gated, which is a floor the whole bonus sits behind: under 80% of the lead
// plan the leads bonus pays nothing at all, however good the quality was.
//
// None of the numbers are in here. The bands and the amounts are the admin's,
// set per person per month, because the sheets themselves say the numbers are
// set in the last five days of every month. This file only reads them.

// Which way is good. A skip rate of 30% is better than 50%; a growth of 110%
// is better than 80%. A ladder says which of the two it is, and the bands are
// then read the same way either way round.
export const METRICS = {
  // Measured by the board itself.
  skip_rate:   { auto: true,  dir: 'low',  unit: '%',  label: 'Average skip rate' },
  late:        { auto: true,  dir: 'low',  unit: '',   label: 'Pieces delivered late' },
  delivered:   { auto: true,  dir: 'high', unit: '',   label: 'Pieces delivered' },
  on_time_pct: { auto: true,  dir: 'high', unit: '%',  label: 'Delivered on time' },
  views:       { auto: true,  dir: 'high', unit: '',   label: 'Views in the month' },
  // Typed in for the month, because nothing here can see them.
  manual:      { auto: false, dir: 'high', unit: '',   label: 'Entered by hand' },
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

// Which band a value falls in. Bands carry `from` and `to` and either may be
// left open, so "55% or more" and "0 to 1" are both sayable without a
// sentinel. The first band that contains the value wins, so an admin who
// overlaps two bands gets the one they listed first rather than an argument.
export function bandFor(bands, value) {
  if (value === null || value === undefined) return null
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  for (const b of bands || []) {
    const lo = num(b.from)
    const hi = num(b.to)
    if ((lo === null || v >= lo) && (hi === null || v <= hi)) return b
  }
  return null
}

// One ladder, against one month.
//
// `stats` is what the board measured; `readings` is what somebody typed in.
// A ladder whose metric nobody has a value for is not a zero: it is a ladder
// with no reading, and it says so rather than quietly grading somebody D for
// a number that was never taken.
export function gradeLadder(ladder, stats, readings) {
  const m = METRICS[ladder.metric] || METRICS.manual
  const value = m.auto ? (stats?.[ladder.metric] ?? null) : num(readings?.[ladder.key])
  // The gate: a floor the whole ladder sits behind. Under it, nothing is paid,
  // and the reason is carried out so the payslip can say why rather than
  // showing a zero somebody has to ask about.
  let gated = null
  if (ladder.gate && ladder.gate.metric) {
    const gm = METRICS[ladder.gate.metric] || METRICS.manual
    const gv = gm.auto ? (stats?.[ladder.gate.metric] ?? null) : num(readings?.[`${ladder.key}_gate`])
    const min = num(ladder.gate.min)
    if (min !== null && (gv === null || gv < min)) gated = { need: min, got: gv, metric: ladder.gate.metric }
  }
  const band = value === null ? null : bandFor(ladder.bands, value)
  const pays = gated || !band ? 0 : Number(band.pays) || 0
  return {
    key: ladder.key,
    label: ladder.label || m.label,
    metric: ladder.metric,
    unit: ladder.unit ?? m.unit,
    value,
    grade: band?.grade ?? null,
    band: band || null,
    gated,
    pays,
  }
}

// A whole card. Returns the fixed floor, every ladder graded, and the total.
export function gradeCard(card, stats) {
  const ladders = (() => { try { return JSON.parse(card?.ladders || '[]') } catch { return [] } })()
  const readings = (() => { try { return JSON.parse(card?.readings || '{}') } catch { return {} } })()
  const rows = ladders.map((l) => gradeLadder(l, stats, readings))
  const fixed = Number(card?.fixed) || 0
  // Every ladder on the card is drawn, including the ones paying nothing.
  //
  // The rule elsewhere on the payslip is that a line earning nothing is not
  // shown, because "0 edits · 0" is a fact about the rate card rather than
  // about the month. A LADDER is the opposite: somebody put it on this
  // person's card on purpose, so a D that pays nothing is the news, and a
  // ladder nobody has taken a reading for is a number somebody still owes.
  // Hiding either is how a missing measurement goes unnoticed until payday.
  return {
    month: card?.month || null,
    currency: card?.currency || 'UZS',
    fixed,
    ladders: rows,
    bonus: rows.reduce((t, r) => t + r.pays, 0),
    total: fixed + rows.reduce((t, r) => t + r.pays, 0),
    note: card?.note || '',
  }
}
