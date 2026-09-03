import { Router } from 'express'
import { run, getTaskFields, DEFAULT_TASK_FIELDS, TASK_FIELD_KEYS, CONTENT_TYPES, getCrewNeeds, CREW_NEED_KEYS, getPageRules, PAGE_KEYS, getSkipTiers, getMakerGrades } from '../db.js'
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
  res.json({
    ...(await getTaskFields()),
    crew: await getCrewNeeds(),
    pages: await getPageRules(),
    // What a reel earns by how much of it was watched, and how many pieces
    // earns which grade. Everybody reads these: a person is shown their own
    // grade and what their pieces earned, so hiding the ladder from the people
    // climbing it would be the wrong way round.
    skip_tiers: await getSkipTiers(),
    maker_grades: await getMakerGrades(),
  })
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
  // The skip-rate pay tiers, as a whole list — an admin edits the ladder, not
  // one rung of it, so the list arrives complete or not at all. Sending an
  // empty array is a real choice: it means nobody is paid by tier.
  if (Array.isArray(body.skip_tiers)) {
    const tiers = body.skip_tiers
      .map((t) => ({
        name: String(t?.name ?? '').trim().slice(0, 12),
        min: Math.max(0, Math.min(100, Number(t?.min) || 0)),
        max: Math.max(0, Math.min(100, Number(t?.max) || 0)),
        per_film: Math.max(0, Number(t?.per_film) || 0),
        per_edit: Math.max(0, Number(t?.per_edit) || 0),
      }))
      .filter((t) => t.name && t.max >= t.min)
      .slice(0, 12)
    await run("INSERT INTO meta (key, value) VALUES ('skip_tiers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(tiers))
  }
  // How many pieces earns which grade, same shape and same reasoning.
  if (Array.isArray(body.maker_grades)) {
    const grades = body.maker_grades
      .map((g) => ({ name: String(g?.name ?? '').trim().slice(0, 12), pieces: Math.max(0, Math.round(Number(g?.pieces) || 0)) }))
      .filter((g) => g.name && g.pieces > 0)
      .slice(0, 12)
    await run("INSERT INTO meta (key, value) VALUES ('maker_grades', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(grades))
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
