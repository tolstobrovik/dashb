import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Send, Clapperboard, AlertCircle, CalendarDays, Video, Scissors, Palette } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, dateLabel, typeInfo, statusIcon, isDeletedLabel, onColor } from '../lib/constants.js'
import ContentModal from '../components/ContentModal.jsx'
import ContentFilters, { BLANK_FILTER, matchesFilter, filterIsOn } from '../components/ContentFilters.jsx'

// Everything that comes OUT, and everything that gets SHOT — across every
// channel at once. The channel pages answer "what is happening on Instagram
// Main"; these answer the question the week actually starts with, which is
// "what are we releasing" and "what are we filming", wherever it lives.
//
// One component, two modes. They differ only in which date they read and what
// the empty day says, so keeping them apart would be two copies of the same
// page drifting away from each other.

const MODES = {
  release: {
    label: 'Releases', icon: Send, dateField: 'release_date', timeField: 'release_time',
    lead: 'everything going out, every channel',
    empty: 'Nothing is scheduled to go out.',
    // A post is written, not filmed — but everything gets released.
    applies: () => true,
  },
  recording: {
    label: 'Recordings', icon: Clapperboard, dateField: 'recording_date', timeField: 'recording_time',
    lead: 'every shoot on the books, every channel',
    empty: 'No shoots are booked.',
    applies: (t) => t.type !== 'post',
  },
}

// How far ahead to look, and how far back. Far enough that a month's plan is
// one page; short enough that the page is not an archive.
const WINDOWS = [
  { key: '14', label: 'Next 2 weeks', days: 14 },
  { key: '30', label: 'Next month', days: 30 },
  { key: '90', label: 'Next 3 months', days: 90 },
  { key: 'all', label: 'Everything', days: null },
]

const CREW_HATS = [
  { field: 'operator_id', Icon: Video, tip: 'Operator — films it' },
  { field: 'editor_id', Icon: Scissors, tip: 'Editor — cuts it' },
  { field: 'designer_id', Icon: Palette, tip: 'Designer — draws it' },
]

export default function Schedule({ mode }) {
  const M = MODES[mode]
  const { user } = useAuth()
  const { byKey } = useChannels()
  const [params, setParams] = useSearchParams()

  const boot = useMemo(() => cache.get(`sched:${user.id}`), [user.id])
  const [items, setItems] = useState(() => boot?.content || [])
  const [statuses, setStatuses] = useState(() => boot?.statuses || [])
  const [team, setTeam] = useState(() => boot?.users || [])
  const [loading, setLoading] = useState(!boot)
  const [openItem, setOpenItem] = useState(null)

  useEffect(() => {
    Promise.all([api.get('/content'), api.cached('/statuses'), api.cached('/users')])
      .then(([ct, st, us]) => {
        setItems(ct); setStatuses(st); setTeam(us)
        cache.set(`sched:${user.id}`, {
          content: ct.map(({ photo_thumb: _t, ...rest }) => rest), statuses: st, users: us,
        })
      })
      .finally(() => setLoading(false))
  }, [user.id])

  useEffect(() => {
    const refresh = () => {
      if (document.hidden || openItem) return
      api.poll('/content').then((f) => { if (f) setItems(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [openItem])

  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  const teamById = useMemo(() => Object.fromEntries(team.map((u) => [u.id, { id: u.id, name: u.name }])), [team])

  // ---- what this page is looking at ----
  const [filter, setFilterState] = useState(BLANK_FILTER)
  useEffect(() => {
    try { setFilterState({ ...BLANK_FILTER, ...JSON.parse(localStorage.getItem(`satashkent_sched_${mode}`) || '{}') }) }
    catch { setFilterState(BLANK_FILTER) }
  }, [mode])
  const setFilter = (f) => { setFilterState(f); localStorage.setItem(`satashkent_sched_${mode}`, JSON.stringify(f)) }
  const channel = params.get('channel') || ''
  const win = params.get('window') || '30'
  const setParam = (k, v) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }

  const today = todayISO()
  // Killed work leaves the schedule — it is not going out and not being shot.
  const alive = useMemo(
    () => items.filter((t) => M.applies(t) && t[M.dateField] && !isDeletedLabel(statusesById[t.status_id]?.label)),
    [items, statusesById, M])
  const onChannel = useMemo(
    () => (channel ? alive.filter((t) => (t.channels || []).includes(channel)) : alive),
    [alive, channel])
  const shown = useMemo(
    () => (filterIsOn(filter) ? onChannel.filter((t) => matchesFilter(t, filter)) : onChannel),
    [onChannel, filter])

  // Late work first — it is the only part of a schedule that needs deciding
  // about today — then the days ahead, each with everything on it.
  const { late, days } = useMemo(() => {
    const horizon = WINDOWS.find((w) => w.key === win)?.days
    const limit = horizon == null ? null : (() => {
      const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + horizon)
      return d.toISOString().slice(0, 10)
    })()
    const lateRows = shown.filter((t) => !t.done_at && t[M.dateField] < today)
      .sort((a, b) => a[M.dateField].localeCompare(b[M.dateField]))
    const ahead = shown.filter((t) => t[M.dateField] >= today && (!limit || t[M.dateField] <= limit))
    const byDay = new Map()
    for (const t of ahead.sort((a, b) => (a[M.dateField] + (a[M.timeField] || '')).localeCompare(b[M.dateField] + (b[M.timeField] || '')))) {
      if (!byDay.has(t[M.dateField])) byDay.set(t[M.dateField], [])
      byDay.get(t[M.dateField]).push(t)
    }
    return { late: lateRows, days: [...byDay.entries()] }
  }, [shown, win, today, M])

  const updateContent = async (item, payload) => {
    const c = await api.patch(`/content/${item.id}`, payload)
    setItems((prev) => prev.map((x) => (x.id === item.id ? c : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setItems((prev) => prev.filter((x) => x.id !== item.id))
  }

  const Row = ({ t, showDate = false }) => {
    const st = statusesById[t.status_id]
    const SIcon = st && statusIcon(st.label)
    const TIcon = typeInfo(t.type).icon
    const overdue = !t.done_at && t[M.dateField] < today
    return (
      <button className={'sch-row' + (t.done_at ? ' done' : '')} onClick={() => setOpenItem(t)}>
        <span className={'sch-when' + (overdue ? ' late' : '')}>
          {overdue && <AlertCircle size={11} />}
          {showDate ? dateLabel(t[M.dateField]) : (t[M.timeField] || '—')}
        </span>
        <span className="sch-title">{t.title}</span>
        <span className="sch-tags">
          <span className={`chip ct-${t.type}`}><TIcon size={10} /> {typeInfo(t.type).label}</span>
          {(t.channels || []).map((c) => (
            <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>
          ))}
          {CREW_HATS.map(({ field, Icon, tip }) => t[field] && teamById[t[field]] && (
            <span key={field} className="chip chip-muted" data-tip={tip}>
              <Icon size={10} /> {teamById[t[field]].name.split(' ')[0]}
            </span>
          ))}
          {st && (
            <span className="chip" style={{ background: st.color, color: onColor(st.color) }}>
              {SIcon && <SIcon size={10} />} {st.label}
            </span>
          )}
        </span>
      </button>
    )
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const Icon = M.icon
  const channelList = Object.values(byKey)
  return (
    <>
      <div className="section-head">
        <Icon size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{M.label}</h2>
        <span className="stat-sub" style={{ fontWeight: 500 }}>{M.lead}</span>
        <span className="spacer" />
        <select className="select cf-sel" value={channel} onChange={(e) => setParam('channel', e.target.value)}
          data-tip="One channel only">
          <option value="">All channels</option>
          {channelList.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select className="select cf-sel" value={win} onChange={(e) => setParam('window', e.target.value)}
          data-tip="How far ahead to look">
          {WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
        </select>
      </div>

      <ContentFilters
        filter={filter} onChange={setFilter}
        items={onChannel} shown={shown.length}
        statuses={statuses} teamById={teamById}
      />

      {late.length > 0 && (
        <>
          <div className="cb-sec-head sch-late-head">
            <AlertCircle size={13} /> Late <span className="count">· {late.length}</span>
          </div>
          <div className="card card-pad sch-day">
            {late.map((t) => <Row key={t.id} t={t} showDate />)}
          </div>
        </>
      )}

      {days.length === 0 && late.length === 0 ? (
        <div className="card card-pad empty">
          <CalendarDays size={28} />
          <div>{M.empty}</div>
        </div>
      ) : days.map(([iso, rows]) => (
        <div key={iso}>
          <div className={'cb-sec-head' + (iso === today ? ' sch-today' : '')}>
            {iso === today ? 'Today' : dateLabel(iso)}
            <span className="count">· {rows.length}</span>
          </div>
          <div className="card card-pad sch-day">
            {rows.map((t) => <Row key={t.id} t={t} />)}
          </div>
        </div>
      ))}

      {openItem && (
        <ContentModal
          item={openItem}
          statuses={statuses}
          onClose={() => setOpenItem(null)}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
    </>
  )
}
