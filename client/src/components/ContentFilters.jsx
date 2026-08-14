import { useMemo } from 'react'
import { Filter, X, UserRound } from 'lucide-react'
import { CONTENT_TYPES } from '../lib/constants.js'
import { useAuth } from '../lib/auth.jsx'

// Narrowing the content workspace: who it belongs to, what kind of thing it
// is, which stage it sits at. One row of plain selects above the board and
// the calendars — whatever is chosen applies to ALL of them at once (board,
// both calendars, the unscheduled tray and a day's agenda), so switching
// views never quietly changes what you are looking at.

export const BLANK_FILTER = { person: '', type: '', stage: '' }

// Everyone a task can belong to — the people picked as assignees plus the
// three crew seats. Filtering by "Anvar" should find the shoots he films and
// the cuts he edits, not only the tasks he was formally handed.
export const peopleOf = (t) => {
  const ids = Array.isArray(t.assignee_ids) ? [...t.assignee_ids] : []
  if (t.assignee_id) ids.push(t.assignee_id)
  for (const f of ['operator_id', 'editor_id', 'designer_id']) if (t[f]) ids.push(t[f])
  return [...new Set(ids)]
}

export function matchesFilter(t, f) {
  if (f.type && t.type !== f.type) return false
  if (f.stage && String(t.status_id) !== String(f.stage)) return false
  if (f.person) {
    const ids = peopleOf(t)
    if (f.person === 'none') return ids.length === 0
    if (!ids.includes(Number(f.person))) return false
  }
  return true
}

export const filterIsOn = (f) => !!(f.person || f.type || f.stage)

export default function ContentFilters({ filter, onChange, items, shown, statuses, teamById }) {
  const { user } = useAuth()
  // Only offer people who actually appear on this channel's work — an empty
  // menu of forty names helps nobody.
  const people = useMemo(() => {
    const seen = new Set()
    for (const t of items) for (const id of peopleOf(t)) seen.add(id)
    if (filter.person && filter.person !== 'none') seen.add(Number(filter.person)) // keep the current choice pickable
    return [...seen]
      .map((id) => ({ id, name: teamById[id]?.name || `#${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [items, teamById, filter.person])
  // Same for types and stages: show what this channel really uses.
  const types = useMemo(() => {
    const seen = new Set(items.map((t) => t.type))
    return CONTENT_TYPES.filter((c) => seen.has(c.key) || c.key === filter.type)
  }, [items, filter.type])
  const stages = useMemo(() => {
    const seen = new Set(items.map((t) => String(t.status_id)))
    return statuses.filter((s) => seen.has(String(s.id)) || String(s.id) === String(filter.stage))
  }, [items, statuses, filter.stage])

  const on = filterIsOn(filter)
  const set = (patch) => onChange({ ...filter, ...patch })
  // "Only mine" is the choice people make most, and finding your own name in
  // a menu of forty is the slowest way to make it. One switch, and it is the
  // same person filter underneath — so it clears with everything else.
  const onlyMine = String(filter.person) === String(user.id)

  return (
    <div className={'cf-bar' + (on ? ' on' : '')}>
      <Filter size={13} className="cf-icon" />
      <button className={'cf-mine' + (onlyMine ? ' active' : '')}
        onClick={() => set({ person: onlyMine ? '' : String(user.id) })}
        data-tip={onlyMine ? 'Show everyone’s work again' : 'Only the work you are on'}>
        <UserRound size={12} /> Mine
      </button>
      <select className="select cf-sel" value={filter.person} onChange={(e) => set({ person: e.target.value })}
        data-tip="Only work this person is on — assigned, filming, editing or designing">
        <option value="">Anyone</option>
        <option value="none">Nobody yet</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select className="select cf-sel" value={filter.type} onChange={(e) => set({ type: e.target.value })}
        data-tip="Only one kind of content">
        <option value="">Any type</option>
        {types.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      <select className="select cf-sel" value={filter.stage} onChange={(e) => set({ stage: e.target.value })}
        data-tip="Only one stage of the pipeline">
        <option value="">Any stage</option>
        {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {on && (
        <>
          <span className="cf-count">showing {shown} of {items.length}</span>
          <button className="cf-clear" onClick={() => onChange({ ...BLANK_FILTER })} data-tip="Show everything again">
            <X size={12} /> Clear
          </button>
        </>
      )}
    </div>
  )
}
