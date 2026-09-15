// ---- the draft that survives the tab dying -------------------------------
// Typing into a task sheet is the one place on this board where minutes of
// somebody's work exist ONLY in the browser. A crashed tab, a phone that ran
// out of memory, a host that recycled the instance mid-sentence — all of it
// used to take the words with it, and the person had no way of knowing until
// they came back to an empty box.
//
// So the sheet keeps a copy. Every few seconds, whatever is on screen is
// written to localStorage under the task's own key; the next time that task
// opens, if the copy is newer than what the server holds, it is offered back.
//
// Deliberately NOT an auto-save to the server. A half-filled form saved on a
// timer would fire the board's own rules at a person mid-thought — a stage
// gate refusing a move they had not finished making, a deadline demanded of a
// task they were still describing — and would write partial rows other people
// can see. The draft is private, local, and only ever becomes real when the
// person presses Save.
const KEY = (uid, taskId) => `satashkent_draft_${uid || 'anon'}_${taskId ?? 'new'}`

// Photos and files are data URLs — hundreds of KB each, and localStorage is a
// handful of MB for the whole origin. The words are what cannot be recovered;
// an attachment is still on the disk it came from, so it is left out.
const HEAVY = ['photo', 'photo_thumb', 'ready_file', 'shot_file', 'design_file']

export function saveDraft(uid, taskId, form) {
  try {
    const slim = {}
    for (const [k, v] of Object.entries(form || {})) {
      if (HEAVY.includes(k)) continue
      if (typeof v === 'string' && v.startsWith('data:')) continue
      slim[k] = v
    }
    localStorage.setItem(KEY(uid, taskId), JSON.stringify({ at: Date.now(), form: slim }))
  } catch { /* a full or blocked store is not worth an error in somebody's face */ }
}

export function readDraft(uid, taskId) {
  try {
    const raw = localStorage.getItem(KEY(uid, taskId))
    if (!raw) return null
    const d = JSON.parse(raw)
    return d && d.form && typeof d.at === 'number' ? d : null
  } catch { return null }
}

export function clearDraft(uid, taskId) {
  try { localStorage.removeItem(KEY(uid, taskId)) } catch { /* ok */ }
}

// A draft is only worth offering back if it is NEWER than the row it belongs
// to. Somebody else may have saved the task since the tab died, and handing a
// stale copy back would quietly undo their work.
export function draftBeatsRow(draft, row) {
  if (!draft) return false
  const rowAt = Date.parse(row?.updated_at || row?.created_at || 0)
  return !Number.isFinite(rowAt) || draft.at > rowAt
}
