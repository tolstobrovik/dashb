import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { get, publicUser, resyncStorage } from '../db.js'
import { signToken, authRequired, wrap } from '../auth.js'

const router = Router()

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' })
  const uname = String(username).toLowerCase().trim()
  let row = await get('SELECT * FROM users WHERE username = ?', uname)
  if (!row) {
    // Freshly created account may not have reached this server yet — pull once.
    await resyncStorage().catch(() => {})
    row = await get('SELECT * FROM users WHERE username = ?', uname)
  }
  // Mobile keyboards sneak a trailing space in — accept the trimmed password
  // when the exact one fails. (Passwords here never legitimately have edges.)
  const pw = String(password)
  const match = row && (bcrypt.compareSync(pw, row.password_hash) ||
    (pw !== pw.trim() && bcrypt.compareSync(pw.trim(), row.password_hash)))
  if (!match) {
    return res.status(401).json({ error: 'Incorrect username or password' })
  }
  const user = publicUser(row)
  res.json({ token: signToken(user, req.body?.remember !== false), user })
}))

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user })
})

export default router
