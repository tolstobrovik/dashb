import jwt from 'jsonwebtoken'
import { db, publicUser } from './db.js'

export const JWT_SECRET = process.env.JWT_SECRET || 'satashkent-dev-secret-change-me'

export function signToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' })
}

// Verify the bearer token and attach the current user to the request.
export function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Not authenticated' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id)
    if (!row) return res.status(401).json({ error: 'User not found' })
    req.user = publicUser(row)
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' })
  }
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  next()
}

// A member may only touch data for channels they belong to; admins see all.
export function canAccessDept(user, dept) {
  return user.role === 'admin' || (user.departments || []).includes(dept)
}

// Telegram-style granular rights: admins can do everything; members only what
// the admin has switched on for them (defaults in db.js DEFAULT_PERMS).
export function can(user, perm) {
  return user.role === 'admin' || !!(user.permissions && user.permissions[perm])
}

export function requirePerm(perm) {
  return (req, res, next) => {
    if (!can(req.user, perm)) return res.status(403).json({ error: 'You don’t have permission for this — ask an admin' })
    next()
  }
}
