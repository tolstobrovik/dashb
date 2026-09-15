import { Router } from 'express'
import { all, get, run, dayISO } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

const router = Router()

// What the board is actually used for.
//
// Two questions an admin kept asking and had no way to answer: is this person
// on the platform at all, and which parts of it does anybody touch? A board
// that answers them badly is worse than one that does not answer them: an
// event log of who opened what at 14:32 is a surveillance record, and people
// stop being honest on a board that keeps one.
//
// So this counts DAYS, not moments. Per person per day: how many seconds the
// board was open in front of them, and how many times each named button was
// pressed. No timestamps beyond the first and last minute of the day, no
// paths, no content, nothing that reconstructs a sitting.

// A heartbeat covers a minute; anything claiming much more than that is a
// tab that was asleep, a clock that jumped, or a client being creative. The
// board is not a stopwatch that can be wound by hand.
const MAX_BEAT = 180
const MAX_TAPS = 40          // distinct actions in one beat
const MAX_N = 500            // times one action can be counted in one beat
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60)

// ---- the heartbeat ---------------------------------------------------------
// Anybody signed in may say "I am here, and I pressed these" about THEMSELVES.
// The body never names a user: the token does.
router.post('/beat', authRequired, wrap(async (req, res) => {
  const day = dayISO()
  const now = new Date().toISOString()
  const secs = Math.max(0, Math.min(MAX_BEAT, Math.round(Number(req.body?.seconds) || 0)))

  if (secs > 0) {
    const row = await get('SELECT seconds FROM usage_day WHERE user_id = ? AND day = ?', req.user.id, day)
    if (row) {
      await run('UPDATE usage_day SET seconds = seconds + ?, last_at = ? WHERE user_id = ? AND day = ?', secs, now, req.user.id, day)
    } else {
      await run('INSERT INTO usage_day (user_id, day, seconds, first_at, last_at) VALUES (?, ?, ?, ?, ?)', req.user.id, day, secs, now, now)
    }
  }

  const taps = req.body?.taps && typeof req.body.taps === 'object' ? req.body.taps : {}
  const pages = req.body?.pages && typeof req.body.pages === 'object' ? req.body.pages : {}
  for (const [kind, bag] of [['tap', taps], ['page', pages]]) {
    for (const [rawAction, rawN] of Object.entries(bag).slice(0, MAX_TAPS)) {
      const action = clean(rawAction)
      const n = Math.max(0, Math.min(MAX_N, Math.round(Number(rawN) || 0)))
      if (!action || !n) continue
      const had = await get('SELECT n FROM usage_tap WHERE user_id = ? AND day = ? AND kind = ? AND action = ?', req.user.id, day, kind, action)
      if (had) {
        await run('UPDATE usage_tap SET n = n + ? WHERE user_id = ? AND day = ? AND kind = ? AND action = ?', n, req.user.id, day, kind, action)
      } else {
        await run('INSERT INTO usage_tap (user_id, day, kind, action, n) VALUES (?, ?, ?, ?, ?)', req.user.id, day, kind, action, n)
      }
    }
  }
  res.json({ ok: true })
}))

// ---- the panel -------------------------------------------------------------
// Whoever runs the whole board, and nobody else — a channel admin runs content
// on their channels, not the people.
router.get('/', authRequired, adminOnly, wrap(async (req, res) => {
  const to = String(req.query.to || dayISO())
  const from = String(req.query.from || to)
  const people = await all('SELECT id, name, role, color, avatar FROM users ORDER BY name')
  const days = await all(
    'SELECT user_id, day, seconds, first_at, last_at FROM usage_day WHERE day >= ? AND day <= ?', from, to)
  const taps = await all(
    'SELECT user_id, kind, action, SUM(n) AS n FROM usage_tap WHERE day >= ? AND day <= ? GROUP BY user_id, kind, action', from, to)

  const byUser = new Map()
  const seat = (id) => {
    if (!byUser.has(id)) byUser.set(id, { user_id: id, seconds: 0, days: 0, last_at: null, taps: 0 })
    return byUser.get(id)
  }
  for (const d of days) {
    const s = seat(d.user_id)
    s.seconds += Number(d.seconds) || 0
    s.days += 1
    if (!s.last_at || (d.last_at && d.last_at > s.last_at)) s.last_at = d.last_at
  }
  for (const t of taps) if (t.kind === 'tap') seat(t.user_id).taps += Number(t.n) || 0

  // Somebody who has not opened it at all in the window is the interesting
  // row, so everybody is listed and the quiet ones read zero rather than
  // vanishing.
  const rows = people.map((p) => {
    const s = byUser.get(p.id) || { seconds: 0, days: 0, last_at: null, taps: 0 }
    return {
      id: p.id, name: p.name, role: p.role, color: p.color, avatar: p.avatar,
      seconds: s.seconds, days: s.days, taps: s.taps, last_at: s.last_at,
    }
  }).sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))

  const roll = (kind) => {
    const m = new Map()
    for (const t of taps) {
      if (t.kind !== kind) continue
      m.set(t.action, (m.get(t.action) || 0) + (Number(t.n) || 0))
    }
    return [...m.entries()].map(([action, n]) => ({ action, n })).sort((a, b) => b.n - a.n).slice(0, 40)
  }
  // Per person too, so "which parts does THIS person use" is one click away.
  const perPerson = {}
  for (const t of taps) {
    if (t.kind !== 'tap') continue
    ;(perPerson[t.user_id] ||= []).push({ action: t.action, n: Number(t.n) || 0 })
  }
  for (const id of Object.keys(perPerson)) perPerson[id] = perPerson[id].sort((a, b) => b.n - a.n).slice(0, 12)

  res.json({ from, to, rows, buttons: roll('tap'), pages: roll('page'), per_person: perPerson })
}))

export default router
