import { Router } from 'express'
import { run, getTaskFields, DEFAULT_TASK_FIELDS, TASK_FIELD_KEYS, CONTENT_TYPES, getCrewNeeds, CREW_NEED_KEYS, getPageRules, PAGE_KEYS } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

// How this board is set up, in one place: which briefing fields the task form
// asks for (Format, Rubrika, Script, ТЗ, Reference, Description) and whether
// each is off, optional or required for which content types; who a task of
// each type must carry; and which pages the team has at all. GET answers the
// EFFECTIVE config so the client never re-implements the defaults; POST stores
// what the admin set. Everybody may read it — the shell needs the page list to
// draw a sidebar — and only an admin may write.
const router = Router()
router.use(authRequired)

router.get('/', wrap(async (req, res) => {
  // The brief fields plus the crew rules ride together — one fetch tells the
  // client both what a task asks for and who it is expected to carry.
  res.json({ ...(await getTaskFields()), crew: await getCrewNeeds(), pages: await getPageRules() })
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
  // The crew rules (who a task of each type must carry): only sent keys
  // change; anything omitted keeps its current effective value.
  if (body.crew && typeof body.crew === 'object') {
    const eff = await getCrewNeeds()
    const crew = {}
    for (const k of CREW_NEED_KEYS) {
      crew[k] = Array.isArray(body.crew[k])
        ? body.crew[k].map(String).filter((t) => CONTENT_TYPES.includes(t))
        : eff[k]
    }
    await run("INSERT INTO meta (key, value) VALUES ('crew_needs', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(crew))
  }
  // Which pages the team has. Only sent keys change, so a client that knows
  // about fewer pages than the server does cannot switch off the rest.
  if (body.pages && typeof body.pages === 'object') {
    const eff = await getPageRules()
    const pages = {}
    for (const k of PAGE_KEYS) pages[k] = typeof body.pages[k] === 'boolean' ? body.pages[k] : eff[k]
    await run("INSERT INTO meta (key, value) VALUES ('page_rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(pages))
  }
  res.json({ ...(await getTaskFields()), crew: await getCrewNeeds(), pages: await getPageRules() })
}))

export default router
