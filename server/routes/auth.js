import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db, publicUser } from '../db.js'
import { signToken, authRequired } from '../auth.js'

const router = Router()

router.post('/login', (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' })
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).toLowerCase().trim())
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username or password' })
  }
  const user = publicUser(row)
  res.json({ token: signToken(user), user })
})

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user })
})

export default router
