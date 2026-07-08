import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db, publicUser, getChannelKeys, PERM_KEYS } from '../db.js'
import { authRequired, adminOnly } from '../auth.js'

const router = Router()
router.use(authRequired)

// Admins see everyone; members see themselves + teammates who share a channel.
router.get('/', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY role DESC, name').all().map(publicUser)
  if (req.user.role === 'admin') return res.json(users)
  const mine = new Set(req.user.departments)
  res.json(users.filter((u) => u.id === req.user.id || u.role === 'admin' || u.departments.some((d) => mine.has(d))))
})

function cleanDepartments(list) {
  if (!Array.isArray(list)) return null
  const valid = new Set(getChannelKeys())
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

router.post('/', adminOnly, (req, res) => {
  const { name, username, email = null, password, role = 'member', departments = [], permissions = {}, color = '#a32234' } = req.body || {}
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required' })
  const depts = role === 'admin' ? [] : (cleanDepartments(departments) || [])
  try {
    const info = db.prepare(`
      INSERT INTO users (name, username, email, password_hash, role, departments, permissions, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
    res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)))
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'That username or email is already taken' })
    throw e
  }
})

router.patch('/:id', adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'User not found' })
  const { name, username, email, role, departments, permissions, color, password } = req.body || {}
  const nextRole = role ?? row.role
  let depts = row.departments
  if (departments !== undefined) {
    const cleaned = cleanDepartments(departments)
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
    db.prepare('UPDATE users SET name=?, username=?, email=?, role=?, color=?, departments=?, permissions=?, password_hash=? WHERE id=?')
      .run(name ?? row.name, nextUsername, nextEmail, nextRole, color ?? row.color, depts, nextPerms, pwHash, row.id)
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'That username or email is already taken' })
    throw e
  }
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)))
})

router.delete('/:id', adminOnly, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' })
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
