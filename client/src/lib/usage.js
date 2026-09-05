import { getToken } from './api.js'

// Counting what the board is used for, honestly and coarsely.
//
// Two numbers an admin asked for: is this person on the platform at all, and
// which parts of it does anybody touch. Both are kept per DAY, per person —
// see server/routes/usage.js for why a moment-by-moment log is the wrong thing
// to build. This side does the same: it holds a running count in memory and
// posts a total once a minute. It never sends a time, a task, a name typed
// into a box, or anything a person wrote.
//
// Time counts only while the tab is VISIBLE. A board left open behind a closed
// laptop is not somebody working.

const BEAT_MS = 60_000
let seconds = 0
let taps = Object.create(null)
let pages = Object.create(null)
let lastTick = 0
let timer = null
let stop = null

const bump = (bag, key) => { if (key) bag[key] = (bag[key] || 0) + 1 }

// What was pressed, as the app itself names it — never as the data reads.
// A button's own text can be a person's name, a task title, a message; the
// strings the app AUTHORS are its tooltips, its aria-labels, and the short
// words on its tabs and pills. Those are what get counted; everything else is
// a press that happened without a name, and is not counted at all.
const DATA_ZONES = '.pp-pop, .qf-row, .tcard, .rq-row, .ov-row, .cm-hist, [data-notrack]'
function labelOf(el) {
  const hit = el.closest?.('button, a[href], .tab, .pill')
  if (!hit || hit.closest(DATA_ZONES)) return ''
  const authored = hit.getAttribute('aria-label') || hit.getAttribute('data-tip')
  if (authored) return authored.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!hit.matches('.tab, .pill, .btn')) return ''
  const text = (hit.textContent || '').replace(/\s+/g, ' ').trim()
  return text.length > 0 && text.length <= 28 ? text : ''
}

// A screen, not a URL: the ids in it are the data, so they are dropped.
export const pageKey = (path) => String(path || '/')
  .replace(/\/\d+(?=\/|$)/g, '/:id')
  .slice(0, 60) || '/'

async function flush(final = false) {
  const secs = Math.round(seconds)
  const t = taps
  const p = pages
  if (!secs && !Object.keys(t).length && !Object.keys(p).length) return
  seconds -= secs
  taps = Object.create(null)
  pages = Object.create(null)
  try {
    // Straight past the client's cache and write-merge machinery: a heartbeat
    // is not a record anything on screen reads back. `keepalive` lets the last
    // one leave while the tab is closing.
    await fetch('/api/usage/beat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: JSON.stringify({ seconds: secs, taps: t, pages: p }),
      keepalive: final,
    })
  } catch {
    // A missed heartbeat is a missed heartbeat. Usage numbers are not worth
    // a retry queue, and certainly not worth an error in somebody's face.
  }
}

// Start counting for this account. Returns a function that stops and posts
// what is left. Called once, from the app shell.
export function trackUsage(user) {
  if (stop) return stop
  // Ambassadors are not staff and do not appear in the admin's people list;
  // counting their minutes would be measuring a guest.
  if (!user || user.role === 'ambassador') return () => {}

  lastTick = Date.now()
  const tick = () => {
    const now = Date.now()
    const gap = (now - lastTick) / 1000
    lastTick = now
    // Only time the tab was actually in front of somebody, and never more
    // than one interval's worth — a laptop that slept for an hour did not
    // spend an hour on the board.
    if (document.visibilityState === 'visible') seconds += Math.min(gap, BEAT_MS / 1000 + 5)
    flush()
  }
  timer = setInterval(tick, BEAT_MS)

  const onClick = (e) => bump(taps, labelOf(e.target))
  const onHide = () => { if (document.visibilityState === 'hidden') { tick(); flush(true) } }
  const onLeave = () => { tick(); flush(true) }
  document.addEventListener('click', onClick, true)
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onLeave)

  stop = () => {
    clearInterval(timer)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', onLeave)
    timer = null; stop = null
    tick()
  }
  return stop
}

// One screen opened. The shell calls this on every route change.
export function trackPage(path) {
  if (!timer) return
  bump(pages, pageKey(path))
}
