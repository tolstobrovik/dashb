import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { all, get, run, batch, publicUser, getChannelKeys, PERM_KEYS } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

const router = Router()
router.use(authRequired)

// Admins see everyone; members see themselves + teammates who share a channel.
router.get('/', wrap(async (req, res) => {
  const users = (await all('SELECT * FROM users ORDER BY role DESC, name')).map(publicUser)
  if (req.user.role === 'admin') return res.json(users)
  const mine = new Set(req.user.departments)
  res.json(users.filter((u) => u.id === req.user.id || u.role === 'admin' || u.departments.some((d) => mine.has(d))))
}))

async function cleanDepartments(list) {
  if (!Array.isArray(list)) return null
  const valid = new Set(await getChannelKeys())
  return [...new Set(list)].filter((d) => valid.has(d))
}

// Keep only known permission keys, as booleans.
function cleanPerms(obj) {
  const out = {}
  if (obj && typeof obj === 'object') {
    for (const k of PERM_KEYS) if (obj[k] !== undefined) out[k] = !!obj[k]
  }
  return out
}

router.post('/', adminOnly, wrap(async (req, res) => {
  const { name, username, email = null, password, role = 'member', departments = [], permissions = {}, color = '#a32234' } = req.body || {}
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required' })
  const depts = role === 'admin' ? [] : ((await cleanDepartments(departments)) || [])
  try {
    const info = await run(`
      INSERT INTO users (name, username, email, password_hash, role, departments, permissions, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      name.trim(),
      String(username).toLowerCase().trim(),
      email ? String(email).toLowerCase().trim() : null,
      bcrypt.hashSync(password, 10),
      role,
      JSON.stringify(depts),
      JSON.stringify(cleanPerms(permissions)),
      color,
      new Date().toISOString(),
    )
    res.status(201).json(publicUser(await get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid)))
  } catch (e) {
    if (/unique/i.test(String(e))) return res.status(409).json({ error: 'That username or email is already taken' })
    throw e
  }
}))

router.patch('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT * FROM users WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'User not found' })
  const { name, username, email, role, departments, permissions, color, password } = req.body || {}
  const nextRole = role ?? row.role
  let depts = row.departments
  if (departments !== undefined) {
    const cleaned = await cleanDepartments(departments)
    if (!cleaned) return res.status(400).json({ error: 'departments must be an array' })
    depts = JSON.stringify(cleaned)
  }
  if (nextRole === 'admin') depts = '[]' // admins always see every channel
  if (username !== undefined && !String(username).trim()) return res.status(400).json({ error: 'Username cannot be empty' })
  const nextUsername = username !== undefined ? String(username).toLowerCase().trim() : row.username
  const nextEmail = email !== undefined ? (email ? String(email).toLowerCase().trim() : null) : row.email
  const nextPerms = permissions !== undefined ? JSON.stringify(cleanPerms(permissions)) : row.permissions
  const pwHash = password ? bcrypt.hashSync(password, 10) : row.password_hash
  try {
    await run('UPDATE users SET name=?, username=?, email=?, role=?, color=?, departments=?, permissions=?, password_hash=? WHERE id=?',
      name ?? row.name, nextUsername, nextEmail, nextRole, color ?? row.color, depts, nextPerms, pwHash, row.id)
  } catch (e) {
    if (/unique/i.test(String(e))) return res.status(409).json({ error: 'That username or email is already taken' })
    throw e
  }
  res.json(publicUser(await get('SELECT * FROM users WHERE id = ?', row.id)))
}))

router.delete('/:id', adminOnly, wrap(async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' })
  // Un-assign their tasks explicitly — remote databases may not enforce the
  // schema's ON DELETE SET NULL, so don't rely on it.
  await batch([
    ['UPDATE content SET assignee_id = NULL WHERE assignee_id = ?', req.params.id],
    ['UPDATE content SET created_by = NULL WHERE created_by = ?', req.params.id],
    ['DELETE FROM users WHERE id = ?', req.params.id],
  ])
  res.json({ ok: true })
}))

export default router
