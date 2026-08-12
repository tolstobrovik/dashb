// Shared model logic for Projects & Campaigns (July 2026 spec).
import { all, get, run } from './db.js'

export const METRICS = [
  'Followers', 'Reach', 'Views', 'Leads', 'Applications', 'Enrollments',
  'Attendees', 'Posts published', 'Engagement', 'Revenue',
]

export const dayNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())

// Checklist items: {text, owner_id, due, done, done_at} — four fields, nothing more.
export const cleanChecklist = (v) =>
  JSON.stringify((Array.isArray(v) ? v : [])
    .map((c) => ({
      text: String(c?.text ?? '').trim().slice(0, 300),
      owner_id: c?.owner_id == null || c?.owner_id === '' ? null : Number(c.owner_id),
      due: /^\d{4}-\d{2}-\d{2}$/.test(String(c?.due ?? '')) ? String(c.due) : null,
      done: !!c?.done,
      done_at: c?.done ? (c?.done_at || dayNow()) : null,
    }))
    .filter((c) => c.text)
    .slice(0, 100))

// Cover photos arrive as browser-downscaled data URLs. null clears; a bad
// value returns undefined so routes can answer 400.
export function cleanPhoto(v) {
  if (v == null || v === '') return null
  if (typeof v !== 'string' || !v.startsWith('data:image/') || v.length > 900000) return undefined
  return v
}

export const parseList = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } }

// First unticked checklist item past its due date — this is what "Blocked" means.
export const blockingItem = (checklist, today) =>
  checklist.find((c) => !c.done && c.due && c.due < today) || null

// The eight required fields of a campaign. A campaign that reaches Live was
// fully specified — the form is the gate.
export function missingFields(c) {
  const missing = []
  if (!c.name || !String(c.name).trim()) missing.push('name')
  if (!c.project_id) missing.push('project')
  if (!c.owner_id) missing.push('owner')
  if (!c.start_date) missing.push('start date')
  if (!c.end_date) missing.push('end date')
  if (parseList(c.channels).length === 0) missing.push('channels')
  if (!c.metric) missing.push('primary metric')
  if (!(Number(c.target) > 0)) missing.push('target')
  return missing
}

// Computed status: Done > Idea (incomplete or still proposed) > Blocked >
// Incoming (fully specified, starts later) > Live. Blocked is never typed —
// it derives from the checklist.
export function campaignStatus(c, today) {
  const checklist = parseList(c.checklist)
  if (c.stage === 'closed' || (c.end_date && c.end_date < today)) return 'done'
  if (missingFields(c).length > 0 || c.stage === 'idea') return 'idea'
  if (blockingItem(checklist, today)) return 'blocked'
  if (c.start_date > today) return 'incoming'
  return 'live'
}

// Public shape of a campaign row, with everything the views derive.
export function campaignView(c, today, usersById = {}, projectsById = {}) {
  const checklist = parseList(c.checklist)
  const status = campaignStatus(c, today)
  const owner = usersById[c.owner_id]
  const project = projectsById[c.project_id]
  let pace = null
  if (c.start_date && c.end_date && Number(c.target) > 0) {
    const startMs = Date.parse(`${c.start_date}T00:00:00Z`)
    const endMs = Date.parse(`${c.end_date}T00:00:00Z`)
    const nowMs = Date.parse(`${today}T00:00:00Z`)
    const timePct = endMs > startMs ? Math.min(100, Math.max(0, Math.round(((nowMs - startMs) / (endMs - startMs)) * 100))) : 100
    const fillPct = Math.min(100, Math.max(0, Math.round((Number(c.actual) / Number(c.target)) * 100)))
    pace = { time_pct: timePct, fill_pct: fillPct, behind: fillPct < timePct }
  }
  const daysLeft = c.end_date ? Math.ceil((Date.parse(`${c.end_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null
  return {
    id: c.id,
    name: c.name,
    project_id: c.project_id || null,
    project_name: project?.name || null,
    owner_id: c.owner_id || null,
    owner_name: owner?.name || null,
    owner_color: owner?.color || null,
    start_date: c.start_date || null,
    end_date: c.end_date || null,
    channels: parseList(c.channels),
    metric: c.metric || '',
    target: Number(c.target) || 0,
    actual: Number(c.actual) || 0,
    budget: c.budget ?? null,
    goal: c.goal || '',
    checklist,
    stage: c.stage || 'idea',
    description: c.description || '',
    photo_thumb: c.photo_thumb || null,
    status,
    days_left: daysLeft,
    pace,
    blocking: blockingItem(checklist, today),
    missing: missingFields(c),
    created_at: c.created_at || null,
  }
}

// A write on anything belonging to a project counts as project activity.
export async function bumpProject(projectId) {
  if (!projectId) return
  await run('UPDATE projects SET last_activity = ? WHERE id = ?', new Date().toISOString(), projectId).catch(() => {})
}

export async function bumpProjectOfCampaign(campaignId) {
  const row = await get('SELECT project_id FROM campaigns WHERE id = ?', campaignId)
  if (row?.project_id) await bumpProject(row.project_id)
}

export const usersMap = async () =>
  Object.fromEntries((await all('SELECT id, name, color FROM users')).map((u) => [u.id, u]))
export const projectsMap = async () =>
  Object.fromEntries((await all('SELECT id, name FROM projects')).map((p) => [p.id, p]))
