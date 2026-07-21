import jwt from 'jsonwebtoken'
import { createHash } from 'crypto'
import { get, publicUser, resyncStorage } from './db.js'
import { DATABASE_URL as CONFIG_DATABASE_URL, GITHUB_DATA } from './config.js'

// Prefer an explicit JWT_SECRET. Without one, derive a stable secret from
// whatever credential the storage uses (Postgres URL, Turso token, or the
// GitHub storage token) — it's secret, identical on every instance, and
// survives deploys, so sessions never break and there is nothing to
// configure. The dev default only applies with no credential at all.
const dbSecret = process.env.DATABASE_URL || process.env.POSTGRES_URL ||
  process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN ||
  CONFIG_DATABASE_URL || GITHUB_DATA?.token
export const JWT_SECRET = process.env.JWT_SECRET ||
  (dbSecret ? createHash('sha256').update(`satashkent:${dbSecret}`).digest('hex') : 'satashkent-dev-secret-change-me')

// "Remember me" keeps the session for a week; without it the token is short
// and the client keeps it only until the browser closes.
export function signToken(user, remember = true) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: remember ? '7d' : '12h' })
}

// Express 4 doesn't catch async errors — route handlers wrap themselves in
// this so a rejected promise lands in the error middleware, not nowhere.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Verify the bearer token and attach the current user to the request.
export async function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Not authenticated' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    let row = await get('SELECT * FROM users WHERE id = ?', payload.id)
    if (!row) {
      // The account may have been created seconds ago on another server —
      // pull the freshest data once before declaring the user gone.
      await resyncStorage().catch(() => {})
      row = await get('SELECT * FROM users WHERE id = ?', payload.id)
    }
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
