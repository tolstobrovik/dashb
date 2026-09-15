import { tr as tx } from './i18n.jsx'
// Tiny toast bus. Pages call toast('Task added') AFTER the server confirmed
// a write (i.e. after the awaited api call resolved) — so a toast always
// means "synced", never "hopefully".
let push = null
let drop = null
export const registerToasts = (fn, dropFn = null) => { push = fn; drop = dropFn }
// action = { label, onClick } renders a button on the toast (e.g. Undo) and
// keeps it up a little longer.
export const toast = (text, kind = 'ok', action = null) => { push?.(text, kind, action) }

// A page's opening load failed. Every page seeds from the instant-boot cache,
// so the screen is NOT blank when this happens — it is showing the last data
// that arrived, down to the row, and looks exactly like a working board. With
// the server fully down an Overview still rendered 2542 of its 2544 characters
// and said nothing. That is the board lying about the day, which is the one
// thing it must never do, so the failure is said out loud.
//
// A 401 is not reported: the session is already over and auth.jsx drops to the
// sign-in page, where "could not refresh" would only be confusing.
//
// It is STATE, not an event, and that is the whole of why it is not an
// ordinary toast. "What you are looking at is old" stays true until it stops
// being true, and a plain toast is gone in 2.6 seconds — so the first cut of
// this moved the failure rather than fixing it: glance away for three seconds
// and the board is back to looking perfectly healthy while showing yesterday.
// This one stays up until something actually reaches the server, which is the
// honest condition for taking it down, and it is raised once however many
// pages fail at once.
const STALE = 'stale-data'
export const loadFailed = (e) => {
  // A 401 is not this. The session is over and auth.jsx drops to the sign-in
  // page, where "could not refresh" is only confusing.
  if (e?.status === 401) return
  push?.(tx('Could not refresh — this is the last data that reached you'), 'err', null, STALE)
}

// Anything at all reaching the server means the screen can be believed again.
// Called from the API client on every successful request, so nothing has to
// remember to clear it.
export const dataIsFresh = () => { drop?.(STALE) }
