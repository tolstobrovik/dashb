import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { get, run, publicUser, resyncStorage } from '../db.js'
import { signToken, authRequired, wrap } from '../auth.js'

const router = Router()

// The one the app creates itself on an empty database, and documents.
const PUBLISHED_PASSWORDS = ['admin123']

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
  // Passwords that are printed in this repository. The dashboard sits on a
  // public URL and the source is readable, so signing in with one of these is
  // the shortest way in for anybody who finds it. Nobody is locked out over
  // it — they are told, every page, until they pick their own.
  const published = PUBLISHED_PASSWORDS.includes(pw) || PUBLISHED_PASSWORDS.includes(pw.trim())
  if (published !== !!row.weak_password) {
    await run('UPDATE users SET weak_password = ? WHERE id = ?', published ? 1 : 0, row.id)
    row.weak_password = published ? 1 : 0
  }
  const user = publicUser(row)
  res.json({ token: signToken(user, req.body?.remember !== false), user })
}))

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user })
})

export default router
