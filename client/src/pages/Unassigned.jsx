import { useEffect, useMemo, useState } from 'react'
import { UserX, CalendarX2, CalendarRange, Clapperboard, Scissors, Palette, User } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, addDaysISO, dateLabel, typeInfo, isDeletedLabel, isIdeaLabel } from '../lib/constants.js'
import ContentModal from '../components/ContentModal.jsx'

// The planning gaps, on one page: every live task that nobody owns yet —
// no main assignee, no operator/editor on filmed work, no designer on a
// post — or that has no dates (shoot day on filmed work, release day on
// everything). A task shows up the moment it has a hole and leaves the
// moment the hole is filled; clicking a row opens the task to fix it.
// Filters narrow the hunt: a date window, a channel, a person, and the
// gap kinds themselves — each kind-pill cycles include → exclude → off,
// and an excluded kind stops counting toward a task's gaps entirely.

// What a task is missing. WHICH hats count as missing is the admin's call
// (Admin → Pipeline → Who must be on a task, served as /fields `crew`):
// a text-only post stops shouting "needs a designer" the day the admin
// unticks it. Dates keep their own logic: filmed work wants a shoot day,
// everything wants a release day, and work already past the edit (ready_at)
// stopped needing its shoot-side people long ago. Icon-free so Overview can
// count gaps without dragging this page's chrome along.
export const gapsOf = (t, crew) => {
  const need = (hat, fallback) => (Array.isArray(crew?.[hat]) ? crew[hat] : fallback).includes(t.type)
  const filmed = t.type === 'reel' || t.type === 'video'
  const preEdit = !t.ready_at
  const people = []
  const dates = []
  if (!(t.assignees?.length ? t.assignees.length : t.assignee_id)) people.push({ key: 'owner', label: 'needs an owner' })
  if (need('operator', ['reel', 'video']) && preEdit && !t.operator_id) people.push({ key: 'operator', label: 'needs an operator' })
  if (need('editor', ['reel', 'video']) && preEdit && !t.editor_id) people.push({ key: 'editor', label: 'needs an editor' })
  if (need('designer', ['post']) && !t.designer_id) people.push({ key: 'designer', label: 'needs a designer' })
  if (filmed && preEdit && !t.recording_date) dates.push({ key: 'shoot', label: 'no shoot day' })
  if (!t.release_date) dates.push({ key: 'release', label: 'no release day' })
  return { people, dates }
}
const GAP_ICONS = { owner: User, operator: Clapperboard, editor: Scissors, designer: Palette, shoot: CalendarX2, release: CalendarX2 }
const GAP_KINDS = [
  { key: 'owner', label: 'Owner' }, { key: 'operator', label: 'Operator' },
  { key: 'editor', label: 'Editor' }, { key: 'designer', label: 'Designer' },
  { key: 'shoot', label: 'Shoot day' }, { key: 'release', label: 'Release day' },
]
// "Due soon" is the default: work whose nearest date (shoot or release)
// stands within DUE_SOON_DAYS — plus everything overdue or undated. A reel
// releasing next week stays off the page until it actually approaches;
// "Any date" is one tap away for planning ahead.
export const DUE_SOON_DAYS = 3
const RANGES = [
  { key: 'soon', label: 'Due soon' }, { key: 'today', label: 'Today' },
  { key: '7d', label: 'Next 7 days' }, { key: 'any', label: 'Any date' }, { key: 'custom', label: 'Custom…' },
]

function GapRow({ t, holes, byKey, onOpen }) {
  return (
    <button className="ov-row" onClick={() => onOpen(t)}>
      <span className={'ov-date' + (t.release_date ? '' : ' late')}>
        {t.release_date ? dateLabel(t.release_date) : 'no date'}
      </span>
      <span className="brief-main">
        <span className="ov-title">{t.title}</span>
      </span>
      <span className="ov-chips">
        {[...holes.people, ...holes.dates].map((h) => {
          const Icon = GAP_ICONS[h.key]
          return <span key={h.key} className={'chip ' + (holes.people.includes(h) ? 'chip-danger' : 'chip-muted')}><Icon size={11} /> {h.label}</span>
        })}
        <span className={`chip ct-${t.type}`}>{typeInfo(t.type).label}</span>
        {t.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
      </span>
    </button>
  )
}

export default function Unassigned() {
  const { user } = useAuth()
  const { channels, byKey } = useChannels()
  const [boot] = useState(() => cache.get(`unassigned:${user.id}`))
  const [content, setContent] = useState(boot?.content || [])
  const [users, setUsers] = useState(boot?.users || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  const [loading, setLoading] = useState(!boot)
  const [openItem, setOpenItem] = useState(null)
  const [crew, setCrew] = useState(null) // the admin's who-must-be-on-a-task rules

  // The filters. `needs` maps a gap kind to 'only' (show tasks needing it)
  // or 'not' (that kind stops counting); absent = indifferent. They REMEMBER
  // — the page reopens exactly as this account left it; Clear × wipes both.
  // v2 key on purpose: the old default ("any") auto-saved itself into every
  // account, so a plain default change would never reach anyone — the bump
  // resets the page to "Due soon" once, then remembers choices as before.
  const remembered = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(`satashkent_gaps2_${user.id}`) || '{}') || {} } catch { return {} }
  }, [user.id])
  const [range, setRange] = useState(remembered.range || 'soon')
  const [from, setFrom] = useState(remembered.from || '')
  const [to, setTo] = useState(remembered.to || '')
  const [chan, setChan] = useState(remembered.chan || 'all')
  const [person, setPerson] = useState(remembered.person || 0)
  const [needs, setNeeds] = useState(remembered.needs && typeof remembered.needs === 'object' ? remembered.needs : {})
  useEffect(() => {
    try { localStorage.setItem(`satashkent_gaps2_${user.id}`, JSON.stringify({ range, from, to, chan, person, needs })) } catch { /* ok */ }
  }, [range, from, to, chan, person, needs, user.id])

  useEffect(() => {
    Promise.all([api.get('/content'), api.cached('/users'), api.cached('/statuses')])
      .then(([ct, us, st]) => {
        setContent(ct); setUsers(us); setStatuses(st)
        cache.set(`unassigned:${user.id}`, { content: ct.map(({ photo_thumb: _t, ...r }) => r), users: us, statuses: st })
      })
      .finally(() => setLoading(false))
    // the admin's crew rules — which hats a task of each type must carry
    api.cached('/fields').then((f) => setCrew(f.crew || null)).catch(() => {})
  }, [user.id])
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || openItem) return
      api.poll('/content').then((f) => { if (f) setContent(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    return () => clearInterval(id)
  }, [openItem])

  const today = todayISO()
  const deadIds = useMemo(() => new Set(statuses.filter((s) => isDeletedLabel(s.label)).map((s) => s.id)), [statuses])
  const ideaIds = useMemo(() => new Set(statuses.filter((s) => isIdeaLabel(s.label)).map((s) => s.id)), [statuses])

  // Every live task with raw gaps — the filters carve this list, the hero
  // keeps quoting it whole so the headline never argues with reality.
  // Ideas sit out: a task only owes people and dates once it leaves the Idea stage.
  const rows = useMemo(() => content
    .filter((t) => !t.done_at && !deadIds.has(t.status_id) && !ideaIds.has(t.status_id))
    .map((t) => ({ t, gaps: gapsOf(t, crew) }))
    .filter((r) => r.gaps.people.length > 0 || r.gaps.dates.length > 0)
    .sort((a, b) => (a.t.release_date || '9999').localeCompare(b.t.release_date || '9999') || b.t.id - a.t.id),
  [content, deadIds, ideaIds, crew])

  const holdsHat = (t, id) =>
    (t.assignees?.length ? t.assignees.includes(id) : t.assignee_id === id) ||
    t.operator_id === id || t.editor_id === id || t.designer_id === id

  // One predicate, with a dimension to ignore — so each pill row can count
  // "what would I show if you picked me" honestly.
  const includes = useMemo(() => Object.keys(needs).filter((k) => needs[k] === 'only'), [needs])
  const counted = (r) => ({
    people: r.gaps.people.filter((h) => needs[h.key] !== 'not'),
    dates: r.gaps.dates.filter((h) => needs[h.key] !== 'not'),
  })
  // The date predicate, shared by the row filter and the hero. "Due soon"
  // judges by the NEAREST date the task owns — a shoot booked for tomorrow
  // makes it urgent even when the release is weeks out. Overdue and undated
  // work always shows: those ARE the emergencies.
  const inDates = (t) => {
    const d = t.release_date
    if (range === 'soon') {
      const nearest = [t.recording_date, t.release_date].filter(Boolean).sort()[0] || null
      if (nearest && nearest > addDaysISO(today, DUE_SOON_DAYS)) return false
    }
    if (range === 'today' && d !== today) return false
    if (range === '7d' && !(d && d >= today && d <= addDaysISO(today, 7))) return false
    if (range === 'custom' && !(d && (!from || d >= from) && (!to || d <= to))) return false
    return true
  }
  const matches = (r, ignore) => {
    if (ignore !== 'date' && !inDates(r.t)) return false
    if (ignore !== 'chan' && chan !== 'all' && !r.t.channels.includes(chan)) return false
    if (ignore !== 'person' && person && !holdsHat(r.t, person)) return false
    if (ignore !== 'needs') {
      const c = counted(r)
      const all = [...c.people, ...c.dates]
      if (all.length === 0) return false
      if (includes.length > 0 && !all.some((h) => includes.includes(h.key))) return false
    }
    return true
  }

  const shown = useMemo(() => rows.filter((r) => matches(r)).map((r) => ({ ...r, holes: counted(r) })),
    [rows, range, from, to, chan, person, needs]) // eslint-disable-line react-hooks/exhaustive-deps
  const unowned = shown.filter((r) => r.holes.people.length > 0)
  const undated = shown.filter((r) => r.holes.people.length === 0)

  const chanCounts = useMemo(() => {
    const m = {}
    for (const r of rows) if (matches(r, 'chan')) for (const c of r.t.channels) m[c] = (m[c] || 0) + 1
    return m
  }, [rows, range, from, to, person, needs]) // eslint-disable-line react-hooks/exhaustive-deps
  const kindCounts = useMemo(() => {
    const m = {}
    for (const r of rows) if (matches(r, 'needs')) for (const h of [...r.gaps.people, ...r.gaps.dates]) m[h.key] = (m[h.key] || 0) + 1
    return m
  }, [rows, range, from, to, chan, person]) // eslint-disable-line react-hooks/exhaustive-deps

  const cycleNeed = (k) => setNeeds((prev) => {
    const next = { ...prev }
    if (!next[k]) next[k] = 'only'
    else if (next[k] === 'only') next[k] = 'not'
    else delete next[k]
    return next
  })
  const filtered = range !== 'any' || chan !== 'all' || person !== 0 || Object.keys(needs).length > 0
  const clearFilters = () => { setRange('any'); setFrom(''); setTo(''); setChan('all'); setPerson(0); setNeeds({}) }

  const updateContent = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    setContent((prev) => prev.map((x) => (x.id === item.id ? u : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  // The hero speaks for the chosen horizon (the date pill), so the headline
  // and the list below always tell the same story; the finer filters
  // (channel, person, kind) still only carve the sections.
  const heroRows = rows.filter((r) => inDates(r.t))
  const allUnowned = heroRows.filter((r) => r.gaps.people.length > 0).length
  const total = heroRows.length
  return (
    <>
      <div className="card card-pad brief-hero">
        <div className="brief-hello"><UserX size={17} /> Unassigned</div>
        <h2 className="brief-title">
          {total === 0
            ? (rows.length > 0
              ? 'Nothing urgent — the gaps sit further out in the calendar.'
              : 'Every task has its people and its dates.')
            : [
              allUnowned > 0 && `${allUnowned} waiting for a person`,
              total - allUnowned > 0 && `${total - allUnowned} waiting for dates`,
            ].filter(Boolean).join(' · ') + '.'}
        </h2>
      </div>

      {rows.length > 0 && (
        <>
          <div className="miss-filters">
            <span className="miss-f-label"><CalendarRange size={14} /> Date</span>
            <div className="pill-group">
              {RANGES.map((r) => (
                <button key={r.key} className={'pill' + (range === r.key ? ' active' : '')} onClick={() => setRange(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
            {range === 'custom' && (
              <span className="miss-custom">
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <span className="drow-dash">–</span>
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </span>
            )}
          </div>
          {users.length > 0 && (
            <div className="miss-filters">
              <span className="miss-f-label"><User size={14} /> Person</span>
              <select className="select gap-person" value={person} data-tip="Only tasks this person is on"
                onChange={(e) => setPerson(Number(e.target.value))}>
                <option value={0}>Everyone</option>
                {[...users].sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="miss-filters">
            <span className="miss-f-label">Channel</span>
            <div className="pill-group">
              <button className={'pill' + (chan === 'all' ? ' active' : '')} onClick={() => setChan('all')}>All</button>
              {channels.map((c) => (
                <button key={c.key}
                  className={'pill' + (chan === c.key ? ' active' : '') + (chanCounts[c.key] ? '' : ' pill-zero')}
                  onClick={() => setChan(chan === c.key ? 'all' : c.key)}>
                  {c.label} <b className="pill-n">{chanCounts[c.key] || 0}</b>
                </button>
              ))}
            </div>
          </div>
          <div className="miss-filters">
            <span className="miss-f-label">Needs</span>
            <div className="pill-group">
              {GAP_KINDS.map((k) => {
                const st = needs[k.key]
                return (
                  <button key={k.key}
                    className={'pill' + (st === 'only' ? ' active' : '') + (st === 'not' ? ' pill-not' : '') + (kindCounts[k.key] ? '' : ' pill-zero')}
                    data-tip={st === 'only' ? 'Now: only these · tap to hide these' : st === 'not' ? 'Now: hidden · tap to reset' : 'Tap: only these'}
                    onClick={() => cycleNeed(k.key)}>
                    {st === 'not' ? 'no ' : ''}{k.label} <b className="pill-n">{kindCounts[k.key] || 0}</b>
                  </button>
                )
              })}
              {filtered && (
                <button className="pill pill-clear" onClick={clearFilters}>Clear ×</button>
              )}
            </div>
          </div>
        </>
      )}

      {total > 0 && shown.length === 0 && (
        <div className="card card-pad empty">
          Nothing matches these filters.{' '}
          <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={clearFilters}>Clear filters</button>
        </div>
      )}

      {unowned.length > 0 && (
        <>
          <div className="section-head">
            <UserX size={17} style={{ color: '#A32D2D' }} />
            <h2>Nobody owns these</h2>
            <span className="count">· {unowned.length}</span>
          </div>
          <div className="card card-pad brief-list">
            {unowned.map((r) => <GapRow key={r.t.id} t={r.t} holes={r.holes} byKey={byKey} onOpen={setOpenItem} />)}
          </div>
        </>
      )}

      {undated.length > 0 && (
        <>
          <div className="section-head">
            <CalendarX2 size={17} style={{ color: 'var(--brand-500)' }} />
            <h2>No dates yet</h2>
            <span className="count">· {undated.length}</span>
          </div>
          <div className="card card-pad brief-list">
            {undated.map((r) => <GapRow key={r.t.id} t={r.t} holes={r.holes} byKey={byKey} onOpen={setOpenItem} />)}
          </div>
        </>
      )}

      {openItem && (
        <ContentModal item={openItem} statuses={statuses} onClose={() => setOpenItem(null)}
          onUpdate={updateContent} onDelete={deleteContent} />
      )}
    </>
  )
}
