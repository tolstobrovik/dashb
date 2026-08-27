import { Router } from 'express'
import { all, get, run, dayISO } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

// Who came, and when.
//
// The rule that shapes everything here: NOBODY IS LATE BY DEFAULT. A day with
// no row says nothing at all, which is the honest reading of "nobody wrote
// anything down". It does not mean on time and it does not mean late. Only an
// admin writes rows, and the register only ever says what an admin said.
//
// Three states and no more. On time, late with the time they arrived, away.
// A fourth would need somebody to decide what it means, and this is a register
// rather than a policy.
const router = Router()
router.use(authRequired)

const STATES = ['on_time', 'late', 'away']
const now = () => new Date().toISOString()
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const cleanTime = (v) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? String(v).slice(0, 5) : null)

// A month, or any window somebody asks for. Defaults to the month containing
// today so the page opens on something rather than on nothing.
function windowOf(q) {
  const to = isDay(q?.to) ? q.to : dayISO()
  const from = isDay(q?.from) ? q.from : `${to.slice(0, 7)}-01`
  return { from, to }
}

// Everyone can read the register. It is a shared fact about the team, and a
// register only one person can see is a rumour.
router.get('/', wrap(async (req, res) => {
  const { from, to } = windowOf(req.query)
  const rows = await all(
    'SELECT * FROM attendance WHERE day >= ? AND day <= ? ORDER BY day DESC, user_id', from, to)
  // Counted here rather than in the browser, so two screens cannot disagree
  // about how many times somebody was late.
  const tally = {}
  for (const r of rows) {
    const t = (tally[r.user_id] ||= { late: 0, away: 0, on_time: 0, marked: 0 })
    t[r.status] += 1
    t.marked += 1
  }
  res.json({ from, to, rows, tally })
}))

// One person, one day. Writing 'on_time' keeps a row on purpose: "an admin
// looked and they were here" is a different fact from "nobody looked", and
// the difference is the whole point of the default.
router.put('/:userId/:day', adminOnly, wrap(async (req, res) => {
  const day = req.params.day
  if (!isDay(day)) return res.status(400).json({ error: 'A day is YYYY-MM-DD' })
  if (day > dayISO()) return res.status(400).json({ error: 'That day has not happened yet' })
  const user = await get('SELECT id FROM users WHERE id = ?', req.params.userId)
  if (!user) return res.status(404).json({ error: 'No such person' })

  const status = String(req.body?.status || '')
  // No status clears the day back to nothing said, which is how a mistake is
  // undone. There is no "unmark" verb to learn.
  if (!status) {
    await run('DELETE FROM attendance WHERE user_id = ? AND day = ?', user.id, day)
    return res.json({ cleared: true })
  }
  if (!STATES.includes(status)) return res.status(400).json({ error: 'Unknown state' })
  const arrived = status === 'late' ? cleanTime(req.body?.arrived_at) : null
  const note = String(req.body?.note || '').trim().slice(0, 300)

  const existing = await get('SELECT id FROM attendance WHERE user_id = ? AND day = ?', user.id, day)
  if (existing) {
    await run('UPDATE attendance SET status = ?, arrived_at = ?, note = ?, marked_by = ?, updated_at = ? WHERE id = ?',
      status, arrived, note, req.user.id, now(), existing.id)
  } else {
    await run(`INSERT INTO attendance (user_id, day, status, arrived_at, note, marked_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      user.id, day, status, arrived, note, req.user.id, now(), now())
  }
  res.json(await get('SELECT * FROM attendance WHERE user_id = ? AND day = ?', user.id, day))
}))

export default router
