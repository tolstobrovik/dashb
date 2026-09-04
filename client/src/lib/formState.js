import { useCallback, useEffect, useRef, useState } from 'react'

// Two things a long form owes the person filling it in.
//
// ---- 1. it does not lose what they typed -----------------------------------
// The task sheet is three views now, and a view you have left is still holding
// what you wrote in it. That is the point — but it means the sheet can be
// closed on top of unsaved words without the person seeing the box they were
// in. So the sheet knows whether it is dirty, and closing a dirty sheet asks
// first. Switching VIEWS never asks: the views are one form, nothing is lost
// moving between them, and a dialog every time somebody looks at the dates
// would be the friction this refactor exists to remove.
//
// Dirtiness is measured against the values the sheet OPENED with, not against
// the record — a sheet that reopens after a save must not think it is dirty
// because the server rounded a date.
export function useDirtyState(form, ready = true) {
  const clean = useRef(null)
  const [dirty, setDirty] = useState(false)

  // The baseline is taken once, when the sheet has the values it opens with.
  useEffect(() => {
    if (!ready || clean.current !== null) return
    clean.current = snapshot(form)
  }, [ready, form])

  useEffect(() => {
    if (clean.current === null) return
    setDirty(snapshot(form) !== clean.current)
  }, [form])

  // After a save, what is on screen IS what is stored.
  const settle = useCallback((next) => { clean.current = snapshot(next ?? form); setDirty(false) }, [form])

  return { dirty, settle }
}

// Photographs and file blobs are hundreds of kilobytes and never change under
// somebody's fingers; comparing them on every keystroke is the one way a
// dirty-check can itself make a form feel slow.
const HEAVY = new Set(['photo', 'photo_thumb', 'checklist'])
const snapshot = (form) => {
  try {
    return JSON.stringify(form, (k, v) => (HEAVY.has(k) ? (v ? 'set' : null) : v))
  } catch {
    return String(Date.now()) // unserialisable: treat as changed rather than as clean
  }
}

// ---- 2. it keeps the dates in an order that can happen ---------------------
// The three dates are a chain: you shoot, then you cut, then it goes out. Move
// the shoot past the cut and the cut is now due before the footage exists —
// a promise nobody can keep, made silently. So the ones downstream move with
// it, by the same number of days, and the sheet says what it did.
//
// Only ever forwards. Pulling the shoot EARLIER leaves the rest alone: an
// earlier shoot does not oblige the editor to finish sooner, and quietly
// dragging somebody's deadline towards them is the opposite of the point.
// Two chains, because two kinds of work reach the same day. A filmed piece is
// shot, then cut, then goes out. A designed one is drawn, then goes out. The
// release is the end of both, and moving anything upstream of it moves it.
export const CHAINS = [
  ['recording_date', 'edit_ready_date', 'release_date'],
  ['design_ready_date', 'release_date'],
]
export const LABELS = {
  recording_date: 'the shoot',
  edit_ready_date: 'the cut',
  design_ready_date: 'the artwork',
  release_date: 'the release',
}

export function cascadeDates(form, changedKey, nextValue) {
  const out = { ...form, [changedKey]: nextValue }
  const chain = CHAINS.find((c) => c.includes(changedKey))
  const at = chain ? chain.indexOf(changedKey) : -1
  if (at < 0 || !nextValue) return { form: out, moved: [] }

  const moved = []
  let prev = changedKey   // the link each later date keeps its distance from
  let floor = nextValue
  for (const key of chain.slice(at + 1)) {
    const held = out[key]
    if (!held) continue                    // nothing promised downstream yet
    if (held >= floor) { prev = key; floor = held; continue }  // already after: leave it
    const pushedTo = addDays(floor, gapOf(form, prev, key))
    out[key] = pushedTo
    moved.push({ key, from: held, to: pushedTo })
    prev = key
    floor = pushedTo
  }
  return { form: out, moved }
}

// Keep the shape of the plan: if the cut was two days after the shoot, it is
// still two days after the shoot. A chain squashed to zero-day gaps is a plan
// nobody agreed to either.
//
// The distance is measured from the link BEFORE it, never from whatever the
// person happened to touch. Moving the shoot four days should move the plan
// four days; measuring everything from the shoot stacks each gap on top of the
// last and throws the release a fortnight into the future.
function gapOf(before, fromKey, toKey) {
  const wasFrom = before[fromKey]
  const wasTo = before[toKey]
  if (!wasFrom || !wasTo) return 1
  const days = Math.round((Date.parse(wasTo) - Date.parse(wasFrom)) / 86400000)
  return days > 0 ? days : 1
}

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
