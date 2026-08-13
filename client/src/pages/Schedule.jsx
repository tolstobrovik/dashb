import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Send, Clapperboard, AlertCircle, CalendarDays, Video, Scissors, Palette, Download, UserRound } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { can, todayISO, dateLabel, typeInfo, statusIcon, isDeletedLabel, onColor } from '../lib/constants.js'
import ContentModal from '../components/ContentModal.jsx'
import ContentFilters, { BLANK_FILTER, matchesFilter, filterIsOn, peopleOf } from '../components/ContentFilters.jsx'

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
    moveTip: 'Move the release day',
    file: 'releases',
    // A post is written, not filmed — but everything gets released.
    applies: () => true,
  },
  recording: {
    label: 'Recordings', icon: Clapperboard, dateField: 'recording_date', timeField: 'recording_time',
    lead: 'every shoot on the books, every channel',
    empty: 'No shoots are booked.',
    moveTip: 'Move the shoot day',
    file: 'recordings',
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

// A spreadsheet of exactly what is on screen: the same rows the filters left
// standing, in the same order. The leading BOM is what makes Excel read a
// Cyrillic title as Cyrillic instead of mojibake, and the file name stays
// ASCII because Chromium silently drops a non-ASCII one from <a download>.
const CSV_HEAD = ['Date', 'Time', 'Title', 'Type', 'Channels', 'Stage', 'Operator', 'Editor', 'Designer', 'Assignees']
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csvOf = (rows) => '\uFEFF' + [CSV_HEAD, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
const saveText = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// One line of the schedule. Lives outside the page so that a poll landing
// mid-edit updates the row in place instead of tearing it down and taking an
// open date picker with it.
function Row({ t, M, today, showDate, statusesById, teamById, byKey, canMove, onOpen, onMove }) {
  const st = statusesById[t.status_id]
  const SIcon = st && statusIcon(st.label)
  const TIcon = typeInfo(t.type).icon
  const overdue = !t.done_at && t[M.dateField] < today
  return (
    <div className={'sch-row' + (t.done_at ? ' done' : '')}>
      <button className="sch-open" onClick={() => onOpen(t)}>
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
      {/* Moving a day is the one edit a schedule is actually for, and opening
          the whole task to change one date is three clicks too many. */}
      {canMove && (
        <input
          type="date" className="sch-date" value={t[M.dateField] || ''}
          data-tip={M.moveTip} aria-label={M.moveTip}
          onChange={(e) => onMove(t, e.target.value)}
        />
      )}
    </div>
  )
}

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

  // Come back to the page the way you left it. The address still wins: a link
  // somebody sent shows what THEY meant, not what you last looked at — so the
  // remembered view is only consulted when the address says nothing.
  const viewKey = `satashkent_schedview_${mode}`
  useEffect(() => {
    if (params.get('channel') || params.get('window') || params.get('group')) return
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(viewKey) || 'null') } catch { saved = null }
    if (!saved || typeof saved !== 'object') return
    const next = new URLSearchParams()
    for (const k of ['channel', 'window', 'group']) if (saved[k]) next.set(k, String(saved[k]))
    if ([...next.keys()].length) setParams(next, { replace: true })
  }, [viewKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const { late, ahead } = useMemo(() => {
    const horizon = WINDOWS.find((w) => w.key === win)?.days
    const limit = horizon == null ? null : (() => {
      const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + horizon)
      return d.toISOString().slice(0, 10)
    })()
    const byWhen = (a, b) => (a[M.dateField] + (a[M.timeField] || '')).localeCompare(b[M.dateField] + (b[M.timeField] || ''))
    return {
      late: shown.filter((t) => !t.done_at && t[M.dateField] < today).sort(byWhen),
      ahead: shown.filter((t) => t[M.dateField] >= today && (!limit || t[M.dateField] <= limit)).sort(byWhen),
    }
  }, [shown, win, today, M])

  // Two ways to read the same schedule. BY DAY answers "what is happening on
  // Thursday"; BY PERSON answers "what does Anvar owe" — and since one shoot
  // can have an operator, an editor and an owner, it shows up under each of
  // them. A person's card carries their late work too, so nobody has to read
  // two places to know what they are behind on.
  const group = params.get('group') === 'person' ? 'person' : 'day'
  // Only what differs from the plain view is worth remembering — otherwise
  // every visit would drag a tail of default parameters behind it.
  useEffect(() => {
    const view = {}
    if (channel) view.channel = channel
    if (win !== '30') view.window = win
    if (group === 'person') view.group = group
    localStorage.setItem(viewKey, JSON.stringify(view))
  }, [viewKey, channel, win, group])

  const sections = useMemo(() => {
    if (group === 'person') {
      const buckets = new Map()
      for (const t of [...late, ...ahead]) {
        const ids = peopleOf(t)
        for (const id of (ids.length ? ids : ['none'])) {
          if (!buckets.has(id)) buckets.set(id, [])
          buckets.get(id).push(t)
        }
      }
      return [...buckets.entries()]
        .map(([id, rows]) => ({
          key: `p${id}`, rows, showDate: true,
          nobody: id === 'none',
          title: id === 'none' ? 'Nobody yet' : (teamById[id]?.name || `#${id}`),
        }))
        .sort((a, b) => (a.nobody === b.nobody ? a.title.localeCompare(b.title) : (a.nobody ? 1 : -1)))
    }
    const byDay = new Map()
    for (const t of ahead) {
      if (!byDay.has(t[M.dateField])) byDay.set(t[M.dateField], [])
      byDay.get(t[M.dateField]).push(t)
    }
    return [...byDay.entries()].map(([iso, rows]) => ({
      key: iso, rows, showDate: false, today: iso === today,
      title: iso === today ? 'Today' : dateLabel(iso),
    }))
  }, [group, late, ahead, teamById, today, M])

  const updateContent = async (item, payload) => {
    const c = await api.patch(`/content/${item.id}`, payload)
    setItems((prev) => prev.map((x) => (x.id === item.id ? c : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setItems((prev) => prev.filter((x) => x.id !== item.id))
  }

  // Moving one day should cost one gesture. The row jumps immediately and
  // goes back where it was if the server refuses. A date field is easy to
  // mis-tap, so the confirmation carries the way back — the server's own
  // ten-second undo only photographs stage moves, and this is the client
  // putting a date it already knows straight back.
  const canMove = can(user, 'move_tasks')
  const setDay = async (t, iso, back) => {
    if (!iso || iso === t[M.dateField]) return
    const before = t[M.dateField]
    setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, [M.dateField]: iso } : x)))
    try {
      const c = await api.patch(`/content/${t.id}`, { [M.dateField]: iso })
      setItems((prev) => prev.map((x) => (x.id === t.id ? c : x)))
      if (back) toast(`${t.title} · back to ${dateLabel(iso)}`)
      else toast(`${t.title} → ${dateLabel(iso)}`, 'ok',
        { label: 'Undo', onClick: () => setDay({ ...t, [M.dateField]: iso }, before, true) })
    } catch (e) {
      setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, [M.dateField]: before } : x)))
      toast(e.message, 'err')
    }
  }
  const reschedule = (t, iso) => setDay(t, iso, false)

  // What you can see is what you get: the export carries the rows the filters
  // left standing, late work included, and nothing else.
  const exportCsv = () => {
    const rows = [...late, ...ahead]
    if (rows.length === 0) { toast('Nothing to export yet', 'err'); return }
    saveText(`${M.file}-${today}.csv`, csvOf(rows.map((t) => [
      t[M.dateField], t[M.timeField] || '', t.title, typeInfo(t.type).label,
      (t.channels || []).map((c) => byKey[c]?.label || c).join(' / '),
      statusesById[t.status_id]?.label || '',
      teamById[t.operator_id]?.name || '',
      teamById[t.editor_id]?.name || '',
      teamById[t.designer_id]?.name || '',
      (t.assignee_ids || []).map((id) => teamById[id]?.name || `#${id}`).join(' / '),
    ])), 'text/csv;charset=utf-8')
    toast(`${rows.length} ${rows.length === 1 ? 'row' : 'rows'} saved as a spreadsheet`)
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const Icon = M.icon
  const channelList = Object.values(byKey)
  const rowProps = { M, today, statusesById, teamById, byKey, canMove, onOpen: setOpenItem, onMove: reschedule }
  return (
    <>
      <div className="section-head sch-head">
        <Icon size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{M.label}</h2>
        <span className="stat-sub" style={{ fontWeight: 500 }}>{M.lead}</span>
        <span className="spacer" />
        <div className="pill-group sch-group">
          <button className={'pill' + (group === 'day' ? ' active' : '')} onClick={() => setParam('group', '')}
            data-tip="One card per day">
            <CalendarDays size={13} /> By day
          </button>
          <button className={'pill' + (group === 'person' ? ' active' : '')} onClick={() => setParam('group', 'person')}
            data-tip="One card per person">
            <UserRound size={13} /> By person
          </button>
        </div>
        <select className="select cf-sel" value={channel} onChange={(e) => setParam('channel', e.target.value)}
          data-tip="One channel only">
          <option value="">All channels</option>
          {channelList.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select className="select cf-sel" value={win} onChange={(e) => setParam('window', e.target.value)}
          data-tip="How far ahead to look">
          {WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
        </select>
        <button className="btn btn-sm sch-export" onClick={exportCsv} data-tip="Download exactly what is shown">
          <Download size={13} /> CSV
        </button>
      </div>

      <ContentFilters
        filter={filter} onChange={setFilter}
        items={onChannel} shown={shown.length}
        statuses={statuses} teamById={teamById}
      />

      {/* By person, the late rows already sit inside each person's card —
          repeating them up here would only be the same work twice. */}
      {group === 'day' && late.length > 0 && (
        <>
          <div className="cb-sec-head sch-late-head">
            <AlertCircle size={13} /> Late <span className="count">· {late.length}</span>
          </div>
          <div className="card card-pad sch-day">
            {late.map((t) => <Row key={t.id} t={t} showDate {...rowProps} />)}
          </div>
        </>
      )}

      {sections.length === 0 && (group === 'person' || late.length === 0) ? (
        <div className="card card-pad empty">
          <CalendarDays size={28} />
          <div>{M.empty}</div>
        </div>
      ) : sections.map((s) => (
        <div key={s.key}>
          <div className={'cb-sec-head' + (s.today ? ' sch-today' : '')
            + (group === 'person' ? ' sch-phead' : '') + (s.nobody ? ' sch-nobody' : '')}>
            {group === 'person' && <UserRound size={12} />}
            {s.title}
            <span className="count">· {s.rows.length}</span>
          </div>
          <div className="card card-pad sch-day">
            {s.rows.map((t) => <Row key={t.id} t={t} showDate={s.showDate} {...rowProps} />)}
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
