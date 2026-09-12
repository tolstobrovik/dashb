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
// Time counts only while somebody is actually THERE. Three things have to be
// true at once, because each one alone is trivially wrong:
//
//   visible   a board behind a closed laptop is not somebody working
//   focused   a tab parked on a second monitor is visible all day
//   awake     a tab left open on a desk while its owner is at lunch is
//             visible and focused and is not work either
//
// "Awake" means real input in the last IDLE_AFTER: a key, a pointer that
// moved, a scroll, a tap. Not a timer, and nothing the page does to itself,
// so a page that refreshes on its own cannot keep its own clock running.
//
// And ONE TAB counts. Two windows open on the same board used to accrue two
// seconds per second, which is the easiest way there is to double a number
// without meaning to. Tabs claim the clock through localStorage and hand it on
// when they go, so the total is time a person spent, not time multiplied by
// how many windows they like having open.
//
// The clock ticks every TICK_MS and only credits that slice when all three
// hold, so the resolution of a wrong answer is five seconds rather than a
// minute. It still posts once a minute; nothing about the shape of what
// leaves this file changed.
const BEAT_MS = 60_000
const TICK_MS = 5_000
const IDLE_AFTER = 30_000     // no input for this long and the clock stops
const CLAIM_KEY = 'satashkent_usage_tab'
const CLAIM_STALE = 15_000    // a claim older than this belonged to a tab that is gone
const TAB_ID = Math.random().toString(36).slice(2)
let lastInput = 0
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
  lastInput = Date.now()

  // Whether this tab holds the clock. Only one does, and a tab that dies
  // without saying so loses it after CLAIM_STALE rather than for ever.
  const holdsClock = () => {
    try {
      const raw = localStorage.getItem(CLAIM_KEY)
      const now = Date.now()
      const cur = raw ? JSON.parse(raw) : null
      if (cur && cur.id !== TAB_ID && now - (cur.at || 0) < CLAIM_STALE) return false
      localStorage.setItem(CLAIM_KEY, JSON.stringify({ id: TAB_ID, at: now }))
      return true
    } catch {
      // No storage: count anyway. One tab counting twice is a worse answer
      // than a private window counting once.
      return true
    }
  }
  const here = () => document.visibilityState === 'visible'
    && (typeof document.hasFocus !== 'function' || document.hasFocus())
    && Date.now() - lastInput < IDLE_AFTER

  let sinceFlush = 0
  const tick = (force = false) => {
    const now = Date.now()
    const gap = (now - lastTick) / 1000
    lastTick = now
    // Never more than one slice's worth: a laptop that slept for an hour did
    // not spend an hour on the board, whatever the wall clock says.
    if (here() && holdsClock()) seconds += Math.min(gap, TICK_MS / 1000 + 2)
    sinceFlush += TICK_MS
    if (force || sinceFlush >= BEAT_MS) { sinceFlush = 0; flush() }
  }
  timer = setInterval(tick, TICK_MS)

  // What counts as somebody being there. Passive listeners so none of this
  // costs a frame on a phone.
  const awake = () => { lastInput = Date.now() }
  const INPUTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart']
  for (const e of INPUTS) window.addEventListener(e, awake, { passive: true, capture: true })

  const onClick = (e) => { awake(); bump(taps, labelOf(e.target)) }
  const onHide = () => { if (document.visibilityState === 'hidden') { tick(true); flush(true) } else awake() }
  const onLeave = () => {
    tick(true); flush(true)
    // Hand the clock on rather than making the next tab wait out the claim.
    try { const c = JSON.parse(localStorage.getItem(CLAIM_KEY) || 'null'); if (c && c.id === TAB_ID) localStorage.removeItem(CLAIM_KEY) } catch { /* fine */ }
  }
  document.addEventListener('click', onClick, true)
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('blur', () => tick())
  window.addEventListener('focus', awake)
  window.addEventListener('pagehide', onLeave)

  stop = () => {
    clearInterval(timer)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('visibilitychange', onHide)
    for (const e of INPUTS) window.removeEventListener(e, awake, { capture: true })
    window.removeEventListener('pagehide', onLeave)
    timer = null; stop = null
    tick(true)
  }
  return stop
}

// One screen opened. The shell calls this on every route change.
export function trackPage(path) {
  if (!timer) return
  bump(pages, pageKey(path))
}
