// Tiny toast bus. Pages call toast('Task added') AFTER the server confirmed
// a write (i.e. after the awaited api call resolved) — so a toast always
// means "synced", never "hopefully".
let push = null
export const registerToasts = (fn) => { push = fn }
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
export const loadFailed = (e) => {
  if (e?.status !== 401) toast('Could not refresh — this is the last data that reached you', 'err')
}
