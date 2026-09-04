import { useCallback, useRef, useState } from 'react'
import { api } from './api.js'

// One way for a page to change a piece of content.
//
// Every board page had its own copy of the same four lines: send the PATCH,
// wait, put what came back into the list. Waiting is the problem. Picking
// somebody to shoot a video is not a question the server has an opinion
// about — it will say yes — but the name did not appear until the round trip
// finished, so the board felt slow doing the thing it does most.
//
// So the change is drawn immediately and sent afterwards, and if the server
// refuses, the row goes back exactly as it was and the refusal is the thing
// on screen. That is only honest for changes whose outcome is not in doubt:
//
//   safe        a seat, a pin, a title — the server stores what it is given
//   uncertain   a stage, a tick, a date chain — gates, cascades and rules
//               can make the answer something other than what was asked
//
// Guessing an uncertain answer would show somebody the wrong thing and then
// snatch it back, which is worse than a moment's wait. Those go the old way:
// the row is marked busy, and the list is written once, from the answer.
const SAFE = new Set([
  'assignee_id', 'assignee_ids', 'operator_id', 'editor_id', 'designer_id', 'face_id',
  'reviewer_ids', 'pinned', 'title', 'description', 'format', 'rubrika', 'type',
])

// What the row will look like, if we are sure. Null means "do not guess".
function guessAt(item, payload) {
  const keys = Object.keys(payload)
  if (!keys.length || !keys.every((k) => SAFE.has(k))) return null
  const next = { ...item, ...payload }
  // assignee_ids is the multi-select and assignee_id mirrors its first name;
  // a guess that leaves the two disagreeing draws a chip and a seat that
  // contradict each other for as long as the round trip takes.
  if (payload.assignee_ids !== undefined) {
    const list = Array.isArray(payload.assignee_ids) ? payload.assignee_ids : [payload.assignee_ids]
    next.assignees = list
    next.assignee_id = list[0] ?? null
  }
  if (payload.assignee_id !== undefined) {
    next.assignees = payload.assignee_id ? [payload.assignee_id] : []
  }
  return next
}

/**
 * @param setRows   the page's list setter
 * @param belongs   optional — does this row still belong on this page? A piece
 *                  moved off the channel you are looking at leaves the list
 *                  rather than sitting there as somebody else's work.
 * @param after     optional — called with (before, saved) once the server has
 *                  answered, for the confetti and the streak.
 */
export function useTaskSync(setRows, { belongs, after } = {}) {
  const [busy, setBusy] = useState(() => new Set())
  // Kept in a ref as well: two changes to the same row in the same tick must
  // not each read a stale copy of the set and clobber the other's mark.
  const flying = useRef(new Set())
  const mark = useCallback((id, on) => {
    const next = new Set(flying.current)
    if (on) next.add(id); else next.delete(id)
    flying.current = next
    setBusy(next)
  }, [])

  const put = useCallback((row) => {
    setRows((prev) => {
      const swapped = prev.map((x) => (x.id === row.id ? row : x))
      return belongs ? swapped.filter(belongs) : swapped
    })
  }, [setRows, belongs])

  const update = useCallback(async (item, payload) => {
    const guess = guessAt(item, payload)
    if (guess) put(guess)
    mark(item.id, true)
    try {
      const saved = await api.patch(`/content/${item.id}`, payload)
      after?.(item, saved)
      put(saved)
      return saved
    } catch (err) {
      // Back exactly as it was. The caller shows the refusal — it knows
      // whether this one has a door in it (the missing published link opens
      // the sheet on that box) or is simply a no.
      if (guess) put(item)
      throw err
    } finally {
      mark(item.id, false)
    }
  }, [put, mark, after])

  return { update, busy, isBusy: useCallback((id) => busy.has(id), [busy]) }
}
