import { Router } from 'express'
import { run, getTaskFields, DEFAULT_TASK_FIELDS, TASK_FIELD_KEYS, CONTENT_TYPES } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

// The task form, tuned by the admin: which briefing fields exist (Format,
// Rubrika, Script, Reference, Description), whether each is optional or
// required, which content types it applies to, and the option lists behind
// the Format / Rubrika dropdowns. GET answers the effective config so the
// client never re-implements the defaults; POST stores what the admin set.
const router = Router()
router.use(authRequired)

router.get('/', wrap(async (req, res) => {
  res.json(await getTaskFields())
}))

router.post('/', adminOnly, wrap(async (req, res) => {
  const body = req.body || {}
  const clean = {}
  for (const k of TASK_FIELD_KEYS) {
    if (!body[k] || typeof body[k] !== 'object') continue
    const d = DEFAULT_TASK_FIELDS[k]
    clean[k] = {
      state: ['off', 'optional', 'required'].includes(body[k].state) ? body[k].state : d.state,
      types: Array.isArray(body[k].types)
        ? body[k].types.map(String).filter((t) => CONTENT_TYPES.includes(t))
        : [...d.types],
    }
    if (d.options) {
      clean[k].options = Array.isArray(body[k].options)
        ? [...new Set(body[k].options.map((o) => String(o).trim().slice(0, 80)).filter(Boolean))].slice(0, 40)
        : [...d.options]
    }
  }
  await run("INSERT INTO meta (key, value) VALUES ('task_fields', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(clean))
  res.json(await getTaskFields())
}))

export default router
