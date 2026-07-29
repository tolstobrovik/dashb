// Tiny toast bus. Pages call toast('Task added') AFTER the server confirmed
// a write (i.e. after the awaited api call resolved) — so a toast always
// means "synced", never "hopefully".
let push = null
export const registerToasts = (fn) => { push = fn }
// action = { label, onClick } renders a button on the toast (e.g. Undo) and
// keeps it up a little longer.
export const toast = (text, kind = 'ok', action = null) => { push?.(text, kind, action) }
