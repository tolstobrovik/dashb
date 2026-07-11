import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { get, publicUser } from '../db.js'
import { signToken, authRequired, wrap } from '../auth.js'

const router = Router()

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' })
  const row = await get('SELECT * FROM users WHERE username = ?', String(username).toLowerCase().trim())
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username or password' })
  }
  const user = publicUser(row)
  res.json({ token: signToken(user), user })
}))

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user })
})

export default router
