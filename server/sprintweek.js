// The sprint week, in Tashkent.
//
// Monday 00:00 → Saturday 12:00 is the working week; the freeze lands at
// Saturday noon and the meeting at 15:00 the same day. Every one of those is
// a Tashkent wall-clock time, and every one is STORED as an ISO instant —
// which is the only way two people in two places can agree on when the
// freeze happened.
//
// Tashkent is UTC+5 and has no daylight saving, which is what makes this
// arithmetic honest rather than merely convenient: shift into Tashkent, do
// ordinary calendar work with the UTC accessors, shift back. The rest of the
// board already reasons in Tashkent days (db.js: dayISO, tashkentDay); this
// is the same clock, told in hours instead of days.

const TZ = 5 * 3600e3        // Tashkent is UTC+5, all year
const DAY = 86400e3

// A Date whose UTC fields read as Tashkent wall-clock time. Read it with
// getUTC*, never getHours — the local machine's zone must not get a vote.
const inTashkent = (ms) => new Date(ms + TZ)
const backToUTC = (shifted) => new Date(shifted.getTime() - TZ)

// The Monday 00:00 Tashkent of the week containing `ms`.
export function weekStart(ms = Date.now()) {
  const d = inTashkent(ms)
  const dow = d.getUTCDay() || 7            // Sunday is 7, not 0
  d.setUTCDate(d.getUTCDate() - (dow - 1))
  d.setUTCHours(0, 0, 0, 0)
  return backToUTC(d)
}

// The ISO-8601 week number of a Tashkent instant. The Thursday rule: the week
// belongs to whichever year holds its Thursday, which is why a sprint on the
// 31st of December can be week 1.
export function isoWeek(ms) {
  const d = inTashkent(ms)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))   // to that week's Thursday
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - yearStart) / DAY + 1) / 7)
}

// Everything about the week containing `ms`, ready to be written to a row.
export function weekOf(ms = Date.now()) {
  const start = weekStart(ms)
  const shifted = inTashkent(start.getTime())
  // Saturday is Monday + 5 days. Noon freezes it; the meeting is at three.
  const at = (days, hour) => {
    const d = new Date(shifted.getTime())
    d.setUTCDate(d.getUTCDate() + days)
    d.setUTCHours(hour, 0, 0, 0)
    return backToUTC(d).toISOString()
  }
  return {
    code: `S${isoWeek(start.getTime())}`,
    start_at: start.toISOString(),
    freeze_at: at(5, 12),
    meeting_at: at(5, 15),
  }
}

// The week after a given one — what Close Sprint opens.
export const nextWeekOf = (startIso) => weekOf(Date.parse(startIso) + 7 * DAY)

// Has the freeze passed? Asked on the server for every write, because a
// browser's clock is not evidence.
export const isFrozen = (sprint, now = Date.now()) =>
  !!sprint && (sprint.status === 'closed' || now >= Date.parse(sprint.freeze_at))

// "Mon Aug 31 to Sat Sep 5", in Tashkent, for the header.
export function weekLabel(sprint) {
  const fmt = (iso) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent', weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(iso))
  return `${fmt(sprint.start_at)} to ${fmt(sprint.freeze_at)}`
}
