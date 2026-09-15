// Standalone ON PURPOSE: this module imports nothing.
//
// It is the answer to "when is this due?", which means it is read by pages, by
// cards, by counts of what is late — and it has to be checkable from plain
// Node by the suite that guards it. constants.js reaches the phrase book and
// the icon set, neither of which a date calculation needs and neither of which
// loads outside a bundler, so the calculation lives here on its own.
const tashkentFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
const tashkentToday = () => tashkentFmt.format(new Date())

// ---- what a task is waiting on next, and the day it is late against -------
//
// Every list that answers "when is this due?" used to answer it with
// `release_date || recording_date` — which is the release day for any task
// that has one, and that is wrong twice over.
//
// It shows the wrong day. A shoot booked for the 16th, on a piece going out on
// the 21st, was listed as the 21st — so the person who booked the shoot read
// their own booking back as a different date, and the day they actually have
// to turn up appeared nowhere.
//
// And it hides a missed deadline. "Late" was decided by comparing today with
// that same release day, so a shoot day that came and went was never late
// while the release was still a week out. The one deadline that cannot be
// recovered — the day passes whether or not a crew turned up — was the one
// deadline the board would not raise.
//
// So: a task is waiting on the first of its days that has not arrived yet,
// ignoring the ones already answered for (a shoot that happened, a cut that
// was handed over). When every one of them has gone by, it is waiting on the
// EARLIEST it missed, because that is the one that made it late and the one
// somebody has to explain.
export function nextDue(t, today = tashkentToday()) {
  if (!t) return null
  const days = [
    !t.shot_at && t.recording_date,
    !t.ready_at && t.edit_ready_date,
    !t.ready_at && t.design_ready_date,
    t.release_date,
  ].filter(Boolean).sort()
  // Every milestone answered for and no release day left: the task owes
  // nothing, but a row still has to say something, so fall back to the last
  // day it was working to.
  if (!days.length) return t.release_date || t.edit_ready_date || t.recording_date || null
  // A day already gone beats a day still coming. A shoot missed on Wednesday
  // and a release due next Monday is a task that is LATE, and saying "Monday"
  // about it is the board reporting the deadline nobody has broken yet while
  // staying quiet about the one that is already broken. The earliest miss is
  // the one that made it late, so that is the one shown.
  const missed = days.filter((d) => d < today)
  return missed.length ? missed[0] : days[0]
}
// Which of a task's days `nextDue` picked — so a list can say "shoot" rather
// than leaving a bare number to be guessed at.
export function dueKind(t, day = nextDue(t)) {
  if (!day || !t) return null
  if (t.recording_date === day && !t.shot_at) return 'shoot'
  if (t.edit_ready_date === day && !t.ready_at) return 'edit'
  if (t.design_ready_date === day && !t.ready_at) return 'design'
  if (t.release_date === day) return 'release'
  return null
}
