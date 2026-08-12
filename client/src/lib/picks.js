import { getCookie, setCookie } from './api.js'

// The app learns who you actually assign: every confirmed pick bumps that
// person's count in a cookie, and assign lists sort by it — your regulars
// float to the top on their own. Counts halve once they get big, so the
// ordering keeps adapting instead of fossilizing.
const KEY = 'satashkent_picks'

export function getPicks() {
  try { return JSON.parse(getCookie(KEY) || '{}') || {} } catch { return {} }
}

export function bumpPick(...ids) {
  const p = getPicks()
  let touched = false
  for (const id of ids) {
    if (id == null || id === '') continue
    p[id] = (p[id] || 0) + 1
    touched = true
    if (p[id] > 60) for (const k of Object.keys(p)) p[k] = Math.ceil(p[k] / 2)
  }
  if (touched) setCookie(KEY, JSON.stringify(p), 90)
}

// Sort helper: most-picked first, then a caller-supplied tiebreak.
export const byPicks = (picks, tiebreak = () => 0) => (a, b) =>
  (picks[b.id] || 0) - (picks[a.id] || 0) || tiebreak(a, b)
