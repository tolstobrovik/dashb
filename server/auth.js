import jwt from 'jsonwebtoken'
import { createHash } from 'crypto'
import { get, publicUser, resyncStorage, storageSecret } from './db.js'

// Prefer an explicit JWT_SECRET. Without one, derive a stable secret from
// whatever credential the storage uses (Postgres URL, Turso token, or the
// GitHub storage token) — it's secret, identical on every instance, and
// survives deploys, so sessions never break and there is nothing to
// configure. The dev default only applies with no credential at all.
//
// The credential comes from db.js, which resolves it ONE way: environment
// first, and never a placeholder. Working it out separately here was a real
// hole — a deployment that keeps its token in the host's environment (the
// safe place for it) leaves the unfilled default in config.js, and this file
// used to reach past the environment and hash THAT. The placeholder is
// published in the repository, so the session secret would have been public
// and anyone could have signed themselves in as anybody.
const dbSecret = storageSecret()
export const JWT_SECRET = process.env.JWT_SECRET ||
  (dbSecret ? createHash('sha256').update(`satashkent:${dbSecret}`).digest('hex') : 'satashkent-dev-secret-change-me')
// A deployment signing sessions with the built-in dev string is one nobody
// should be logging into. Say so at boot, where it can still be fixed.
if (!process.env.JWT_SECRET && !dbSecret && (process.env.VERCEL || process.env.NODE_ENV === 'production'))
  console.error('SECURITY: no storage credential and no JWT_SECRET — sessions are signed with the public dev secret. Set JWT_SECRET.')

// "Remember me" keeps the session for a week; without it the token is short
// and the client keeps it only until the browser closes.
export function signToken(user, remember = true) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: remember ? '7d' : '12h' })
}

// Express 4 doesn't catch async errors — route handlers wrap themselves in
// this so a rejected promise lands in the error middleware, not nowhere.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// ---- the ambassador gate -----------------------------------------------------
// An ambassador is a student with a login to exactly one page. Everything else
// in this dashboard — the boards, the schedule, the money, other people's
// names — is not theirs to see, and "the sidebar does not show it" is not a
// rule, it is decoration. So the refusal lives HERE, at the one place every
// authenticated request already passes through, rather than in each router
// where a new endpoint could be written tomorrow and quietly forget it.
//
// Two prefixes are open to them: the session itself, and their own page.
const AMBASSADOR_OPEN = ['/api/auth', '/api/ambassadors']
const underPrefix = (url, base) => {
  const path = String(url || '').split('?')[0]
  return path === base || path.startsWith(base + '/')
}

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
    if (req.user.role === 'ambassador'
        && !AMBASSADOR_OPEN.some((base) => underPrefix(req.originalUrl, base))) {
      return res.status(403).json({ error: 'This is not part of your page' })
    }
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' })
  }
}

// ---- how far an admin's writ runs -------------------------------------------
// An admin used to be an admin everywhere, which is the wrong shape for a team
// where one person runs YouTube and another runs the Instagram accounts:
// giving the YouTube lead the power to move a promised Instagram date was the
// only way to let them run their own channel.
//
// `admin_channels` scopes it. EMPTY means everywhere — which is what every
// admin was before this existed, so nobody's reach changed when the column
// appeared, and the person who sets these up keeps theirs by leaving it empty.
export const adminChannelsOf = (user) => (Array.isArray(user?.admin_channels) ? user.admin_channels : [])
// Runs the whole board: the person who makes accounts and sets the rules.
export const isFullAdmin = (user) => user?.role === 'admin' && adminChannelsOf(user).length === 0
// Runs THIS work: a full admin, or a channel admin on one of these channels.
// `chans` is the channel keys the thing in question lives on.
export function isAdminOn(user, chans) {
  if (user?.role !== 'admin') return false
  const mine = adminChannelsOf(user)
  if (mine.length === 0) return true
  const list = Array.isArray(chans) ? chans : [chans].filter(Boolean)
  return list.some((ch) => mine.includes(ch))
}

// The structural things — accounts, channels, the pipeline rules, hiring —
// belong to whoever runs the whole board. A CHANNEL admin runs the content on
// their channels; they do not reshape the organisation around it.
export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  if (!isFullAdmin(req.user))
    return res.status(403).json({ error: 'This is for an admin of the whole board — you run particular channels' })
  next()
}

// A member may only touch data for channels they belong to. A full admin sees
// everything; a channel admin sees their channels, whether or not anybody
// remembered to also list those channels as their departments.
export function canAccessDept(user, dept) {
  if (isFullAdmin(user)) return true
  return (user.departments || []).includes(dept) || adminChannelsOf(user).includes(dept)
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
