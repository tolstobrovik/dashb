import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Lock, Plus, Pencil, Trash2, Gauge, CalendarRange, AlertCircle, Pin, PinOff, GripVertical, Minus,
  KanbanSquare, Send, Clapperboard, LineChart, Maximize2, Minimize2,
  SlidersHorizontal, Settings, Megaphone, CalendarClock, CheckCircle2, ArrowUp, ArrowDown, Rocket,
} from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { CADENCES, can, todayISO, addDaysISO, dateLabel, typeInfo, isDeletedLabel, tashkentDay } from '../lib/constants.js'
import { useFullscreen } from '../lib/useFullscreen.js'
import Meter from '../components/Meter.jsx'
import Modal from '../components/Modal.jsx'
import ContentBoard from '../components/ContentBoard.jsx'
import ContentCalendar from '../components/ContentCalendar.jsx'
import ContentFilters, { BLANK_FILTER, matchesFilter, filterIsOn } from '../components/ContentFilters.jsx'
import ContentModal from '../components/ContentModal.jsx'
import StageGate from '../components/StageGate.jsx'
import DayAgenda from '../components/DayAgenda.jsx'
import CompareCard from '../components/CompareCard.jsx'
import Avatar from '../components/Avatar.jsx'
import { CampaignRow } from '../components/ProjectBits.jsx'
import ProgramsGantt, { PLATFORMS } from '../components/ProgramsGantt.jsx'

// The Target team's lens: what platform's work to look at. Tasks and
// campaigns classify themselves by their co-channels (a task also tagged
// instagram_* counts as Instagram work); anything without a signal shows
// in every lens so nothing quietly disappears.
const lensOf = (channels = []) => ({
  ig: channels.some((c) => c.includes('instagram')),
  tg: channels.some((c) => c.includes('telegram')),
})
const inLens = (lens, channels) => {
  if (lens === 'all') return true
  const { ig, tg } = lensOf(channels)
  if (!ig && !tg) return true // unclassified — always visible
  return lens === 'instagram' ? ig : tg
}

const BLANK_METRIC = { label: '', current: 0, target: 100, unit: '', period: 'monthly', content_type: '' }
const FILL_MODES = [
  { key: '', label: 'Manually (+/−)' },
  { key: 'post', label: 'From Post tasks' },
  { key: 'reel', label: 'From Reel tasks' },
  { key: 'story', label: 'From Story tasks' },
  { key: 'video', label: 'From Video tasks' },
]

// ---- Customizable dashboard: the sections a channel page can show. ----
// Keys mirror server/routes/channels.js DASH_WIDGETS.
const DASH_WIDGETS = [
  { key: 'programs', label: 'Programs (Gantt)', hint: 'Launches on a timeline — running, halted, finished' },
  { key: 'metrics', label: 'Metrics & plans', hint: 'Headline numbers and plan meters' },
  { key: 'growth', label: 'Growth', hint: 'Then-vs-now comparison table' },
  { key: 'campaigns', label: 'Campaigns', hint: 'Campaigns running on this channel' },
  { key: 'timetable', label: 'Timetable', hint: 'The next 7 days, day by day' },
  { key: 'upcoming', label: 'Upcoming board', hint: 'Everything dated, closest first' },
  { key: 'done', label: 'Done board', hint: 'Recently completed work' },
  { key: 'content', label: 'Content workspace', hint: 'Kanban board and calendars' },
]
const DEFAULT_DASH = ['metrics', 'growth', 'content']

function parseDash(raw) {
  try {
    const l = JSON.parse(raw || 'null')
    if (Array.isArray(l)) {
      const known = l.filter((k) => DASH_WIDGETS.some((w) => w.key === k))
      if (known.length > 0) return known
    }
  } catch { /* fall through to default */ }
  return DEFAULT_DASH
}

/* ---- The optional boards (module-level so poll ticks don't remount them) ---- */

function DeptCampaigns({ camps, byKey, navigate }) {
  if (camps.length === 0) return <div className="card card-pad empty">No campaigns touch this channel yet.</div>
  return (
    <div className="pc-camp-list">
      {camps.map((c) => <CampaignRow key={c.id} c={c} byKey={byKey} onOpen={(x) => navigate(`/campaigns/${x.id}`)} />)}
    </div>
  )
}

// Seven days ahead, day by day — one table per kind of work, so a glance
// says WHAT happens that day, not just that something does.
function DeptTimetable({ content, onOpen, mode }) {
  const today = todayISO()
  const days = [...Array(7)].map((_, i) => addDaysISO(today, i))
  const Icon = mode === 'release' ? Send : Clapperboard
  return (
    <div className="card card-pad">
      {days.map((d) => {
        const items = content.filter((t) => !t.done_at && (mode === 'release' ? t.release_date === d : t.recording_date === d))
        return (
          <div key={d} className="tt-row">
            <span className={'tt-day' + (d === today ? ' today' : '')}>{d === today ? 'Today' : dateLabel(d)}</span>
            <span className="tt-items">
              {items.length === 0 ? <span className="tt-none">—</span> : items.map((t) => (
                <button key={t.id} className={`chip ct-${t.type} tt-chip`} onClick={() => onOpen(t)}
                  data-tip={mode === 'release' ? 'Release day — open the task' : `Shoot day${t.recording_time ? ` · ${t.recording_time}${t.recording_end ? `–${t.recording_end}` : ''}` : ''} — open the task`}>
                  <Icon size={10} /> {t.title}
                </button>
              ))}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Shared list look for the Upcoming / Done boards.
function DeptTaskList({ rows, empty, onOpen, done = false }) {
  const today = todayISO()
  if (rows.length === 0) return <div className="card card-pad empty">{empty}</div>
  return (
    <div className="card card-pad" style={{ paddingTop: 8, paddingBottom: 8 }}>
      {rows.map((t) => {
        const d = done ? tashkentDay(t.done_at) : (t.release_date || t.recording_date)
        const late = !done && d < today
        return (
          <button key={t.id} className="ov-row" onClick={() => onOpen(t)}>
            <span className={'ov-date' + (late ? ' late' : '')}>
              {late && <AlertCircle size={11} style={{ marginRight: 3 }} />}
              {d === today ? 'Today' : dateLabel(d)}
            </span>
            <span className={'ov-title' + (done ? ' done-txt' : '')}>{t.title}</span>
            <span className="ov-chips">
              <span className={`chip ct-${t.type}`}>{typeInfo(t.type).label}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default function Department() {
  const { key } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { byKey, channels, reload } = useChannels()
  const dept = byKey[key]
  const hasAccess = user.role === 'admin' || user.departments.includes(key)

  const editValues = can(user, 'edit_metrics')
  const manageMetrics = can(user, 'manage_metrics')
  const manageLayout = can(user, 'manage_layout')
  const manageContent = can(user, 'manage_content')
  const moveTasks = can(user, 'move_tasks')

  const [trackers, setTrackers] = useState([])
  const [history, setHistory] = useState([])
  const [content, setContent] = useState([])
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)

  const [metric, setMetric] = useState(null)
  const [err, setErr] = useState('')
  const [dragIdx, setDragIdx] = useState(null)
  // board | release | recording — the last view is remembered per browser.
  const [view, setViewState] = useState(() => localStorage.getItem('satashkent_dept_view') || 'board')
  const setView = (v) => { setViewState(v); localStorage.setItem('satashkent_dept_view', v) }
  const [selectedDate, setSelectedDate] = useState(null)
  const [openItem, setOpenItem] = useState(null) // content item or 'new'
  const [gate, setGate] = useState(null)         // a move waiting on its handover details
  const [newDefaults, setNewDefaults] = useState({})
  const [fs, setFs] = useFullscreen() // the content workspace over the whole screen
  const [fsProg, setFsProg] = useFullscreen() // the programs timeline, same treatment

  const deptReady = !!dept
  useEffect(() => {
    if (!deptReady || !hasAccess) { setLoading(false); return }
    // Instant boot: paint the last known snapshot of this channel right away
    // and let the fresh data replace it when the network answers.
    const cached = cache.get(`dept:${key}`)
    if (cached) {
      setTrackers(cached.trackers); setHistory(cached.history)
      setContent(cached.content); setStatuses(cached.statuses)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setSelectedDate(null)
    Promise.all([
      api.get(`/trackers?department=${key}`),
      api.get(`/trackers/history?department=${key}`),
      // This is the one page with a kanban board, and a board card wears its
      // thumbnail — so this is the one page that asks for them.
      api.get(`/content?department=${key}&thumbs=1`),
      api.get('/statuses'),
    ])
      .then(([tr, hist, ct, st]) => {
        setTrackers(tr); setHistory(hist); setContent(ct); setStatuses(st)
        // Thumbnails stay out of the cache to keep localStorage light.
        cache.set(`dept:${key}`, {
          trackers: tr, history: hist, statuses: st,
          content: ct.map(({ photo_thumb: _t, ...rest }) => rest),
        })
      })
      .finally(() => setLoading(false))
  }, [key, deptReady, hasAccess])

  // Live sync: tasks added by the admin or teammates appear within seconds
  // (paused while the tab is hidden or a task modal is open).
  useEffect(() => {
    if (!dept || !hasAccess) return
    const refresh = () => {
      if (document.hidden || openItem || dragIdx !== null) return
      api.poll(`/content?department=${key}&thumbs=1`).then((f) => { if (f) setContent(f) }).catch(() => {})
      api.poll(`/trackers?department=${key}`).then((f) => { if (f) setTrackers(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [key, dept, hasAccess, openItem, dragIdx])

  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  // ---- the Target platform lens (All / Instagram / Telegram) ----
  const hasLens = key === 'target'
  const [lens, setLensState] = useState('all')
  useEffect(() => { setLensState(localStorage.getItem(`satashkent_lens_${key}`) || 'all') }, [key])
  const setLens = (v) => { setLensState(v); localStorage.setItem(`satashkent_lens_${key}`, v) }
  const lensContent = useMemo(
    () => (hasLens && lens !== 'all' ? content.filter((t) => inLens(lens, t.channels)) : content),
    [content, lens, hasLens])
  // Killed pieces stay visible on the board (the Deleted column is their
  // record) but leave the timetables and upcoming lists — a dead task has no
  // shoot, release or to-do anymore. The CALENDARS keep them on purpose:
  // dimmed, struck through, status written on the pill — the month should
  // remember what was planned and killed.
  const liveContent = useMemo(
    () => lensContent.filter((t) => !isDeletedLabel(statusesById[t.status_id]?.label)),
    [lensContent, statusesById])

  // ---- the content workspace's own filters (person / type / stage) ----
  // Remembered per channel, and applied to the board, both calendars, the
  // unscheduled tray and a day's agenda at once. The dashboard's other
  // sections keep showing everything — their controls aren't on screen.
  const [filter, setFilterState] = useState(BLANK_FILTER)
  useEffect(() => {
    try { setFilterState({ ...BLANK_FILTER, ...JSON.parse(localStorage.getItem(`satashkent_cfilter_${key}`) || '{}') }) }
    catch { setFilterState(BLANK_FILTER) }
  }, [key])
  const setFilter = (f) => { setFilterState(f); localStorage.setItem(`satashkent_cfilter_${key}`, JSON.stringify(f)) }
  const filterOn = filterIsOn(filter)
  const wsContent = useMemo(
    () => (filterOn ? lensContent.filter((t) => matchesFilter(t, filter)) : lensContent),
    [lensContent, filter, filterOn])
  const wsLive = useMemo(
    () => (filterOn ? liveContent.filter((t) => matchesFilter(t, filter)) : liveContent),
    [liveContent, filter, filterOn])

  // The calendar's waiting room: open work that has no date on the current
  // calendar yet. Posts aren't filmed, so they never wait for a shoot day.
  const unscheduled = useMemo(() => wsLive.filter((t) => !t.done_at &&
    (view === 'recording' ? (t.type !== 'post' && !t.recording_date) : !t.release_date)),
  [wsLive, view])

  // Campaigns + team: chips on kanban cards, the Campaigns board, head picker.
  const [campaigns, setCampaigns] = useState([])
  const [team, setTeam] = useState([])
  useEffect(() => {
    api.get('/campaigns').then(setCampaigns).catch(() => {})
    api.get('/users').then(setTeam).catch(() => {})
  }, [])
  const campaignsById = useMemo(() => Object.fromEntries(campaigns.map((x) => [x.id, { id: x.id, name: x.name }])), [campaigns])
  const teamById = useMemo(() => Object.fromEntries(team.map((u) => [u.id, { id: u.id, name: u.name }])), [team])
  const deptCampaigns = useMemo(
    () => campaigns.filter((c) => (c.channels || []).includes(key) && c.status !== 'done'
      && (!hasLens || inLens(lens, c.channels || []))),
    [campaigns, key, hasLens, lens])
  const pinned = trackers.filter((t) => t.is_primary)
  const gridMetrics = trackers.filter((t) => !t.is_primary)

  // ---- metrics ----
  const step = async (t, delta) => {
    try {
      const u = await api.patch(`/trackers/${t.id}`, { current: Math.max(0, t.current + delta) })
      setTrackers((prev) => prev.map((x) => (x.id === t.id ? u : x)))
      api.get(`/trackers/history?department=${key}`).then(setHistory).catch(() => {})
    } catch (e) { alert(e.message) }
  }
  const setPin = async (t, on) => {
    try {
      const u = await api.patch(`/trackers/${t.id}`, { is_primary: on ? 1 : 0 })
      setTrackers((prev) => prev.map((x) => (x.id === t.id ? u : x)))
    } catch (e) { alert(e.message) }
  }
  const onDragOver = (overIdx) => {
    if (dragIdx === null || dragIdx === overIdx) return
    const grid = trackers.filter((t) => !t.is_primary)
    const [moved] = grid.splice(dragIdx, 1)
    grid.splice(overIdx, 0, moved)
    setTrackers([...trackers.filter((t) => t.is_primary), ...grid])
    setDragIdx(overIdx)
  }
  const persistOrder = async () => {
    setDragIdx(null)
    try { await api.post('/trackers/reorder', { department: key, ids: trackers.map((t) => t.id) }) } catch { /* ignore */ }
  }
  const openMetric = (t) => {
    setMetric(t
      ? { id: t.id, label: t.label, current: t.current, target: t.target, unit: t.unit, period: t.period, content_type: t.content_type || '' }
      : { ...BLANK_METRIC })
    setErr('')
  }
  const saveMetric = async () => {
    setErr('')
    try {
      if (metric.id) {
        const body = manageMetrics
          ? { label: metric.label.trim(), current: Number(metric.current), target: Number(metric.target), unit: metric.unit, period: metric.period, content_type: metric.content_type || null }
          : { current: Number(metric.current) }
        const u = await api.patch(`/trackers/${metric.id}`, body)
        setTrackers((prev) => prev.map((x) => (x.id === metric.id ? u : x)))
      } else {
        if (!metric.label.trim()) return
        const u = await api.post('/trackers', { department: key, label: metric.label.trim(), current: Number(metric.current), target: Number(metric.target), unit: metric.unit, period: metric.period, content_type: metric.content_type || null })
        setTrackers((prev) => [...prev, u])
      }
      setMetric(null)
    } catch (e) { setErr(e.message) }
  }
  const delMetric = async () => {
    try { await api.del(`/trackers/${metric.id}`); setTrackers((prev) => prev.filter((x) => x.id !== metric.id)); setMetric(null) }
    catch (e) { setErr(e.message) }
  }

  // ---- content ----
  const refreshTrackers = () => {
    api.get(`/trackers?department=${key}`).then(setTrackers).catch(() => {})
    api.get(`/trackers/history?department=${key}`).then(setHistory).catch(() => {})
  }
  const createContent = async (payload) => {
    const c = await api.post('/content', payload)
    setContent((prev) => [c, ...prev].filter((x) => x.channels.includes(key)))
    refreshTrackers() // a new task raises this channel's plan
  }
  const updateContent = async (item, payload) => {
    const c = await api.patch(`/content/${item.id}`, payload)
    setContent((prev) => prev.map((x) => (x.id === item.id ? c : x)).filter((x) => x.channels.includes(key)))
    refreshTrackers() // completing / moving a task changes the plan numbers
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
    refreshTrackers() // deleting a task lowers the plan again
  }
  // A refused move is usually not an error but a question — "who is editing
  // this?", "where is the footage?". Those open the handover dialog instead of
  // an alert; anything else is still a plain failure.
  const moveStatus = (item, statusId) =>
    updateContent(item, { status_id: statusId }).catch((e) => {
      if (e.data?.gate && e.data?.missing) setGate({ item, statusId })
      else alert(e.message)
    })
  const moveDate = (item, field, iso) => updateContent(item, { [field]: iso }).catch((e) => alert(e.message))
  // The board's foot inputs: a title lands straight in that column.
  const quickAdd = async (title, statusId) => {
    const c = await api.post('/content', { title, status_id: statusId, channels: [key] })
    setContent((prev) => [c, ...prev])
    toast('Added — synced')
  }

  // ---- customizable dashboard + channel settings ----
  const isAdmin = user.role === 'admin'
  const canCustomize = isAdmin || (manageLayout && user.departments.includes(key))
  const widgetOrder = useMemo(() => parseDash(dept?.dashboard), [dept])
  const [dash, setDash] = useState(null) // null | ordered [{key,on}] in the modal
  const [dashErr, setDashErr] = useState('')
  const openDash = () => {
    setDashErr('')
    setDash([
      ...widgetOrder.map((k) => ({ key: k, on: true })),
      ...DASH_WIDGETS.filter((w) => !widgetOrder.includes(w.key)).map((w) => ({ key: w.key, on: false })),
    ])
  }
  const moveDashRow = (i, dir) => {
    setDash((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  const saveDash = async () => {
    const keys = dash.filter((w) => w.on).map((w) => w.key)
    if (keys.length === 0) { setDashErr('Keep at least one section on the dashboard'); return }
    try {
      await api.patch(`/channels/${dept.id}/dashboard`, { dashboard: keys })
      reload()
      setDash(null)
    } catch (e) { setDashErr(e.message) }
  }

  const [chanEdit, setChanEdit] = useState(null) // null | {label, head_id}
  const [chanErr, setChanErr] = useState('')
  const saveChannel = async () => {
    if (!chanEdit.label.trim()) { setChanErr('The channel needs a name'); return }
    try {
      await api.patch(`/channels/${dept.id}`, { label: chanEdit.label.trim(), head_id: chanEdit.head_id || null })
      reload()
      setChanEdit(null)
    } catch (e) { setChanErr(e.message) }
  }
  const deleteChannel = async () => {
    if (!confirm(`Delete the channel “${dept.label}”?\n\nIts metrics and history are removed; tasks that only live here are deleted too. This cannot be undone.`)) return
    try {
      await api.del(`/channels/${dept.id}`)
      reload()
      navigate('/')
    } catch (e) { setChanErr(e.message) }
  }

  if (channels.length === 0 || loading) return <div className="app-loading"><span className="spinner" /></div>
  if (!dept) return <div className="empty">Unknown channel.</div>
  if (!hasAccess)
    return (
      <div className="card card-pad empty">
        <Lock size={30} />
        <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>You don&apos;t have access to this channel.</div>
      </div>
    )

  const VIEWS = [
    { key: 'board', label: 'Board', icon: KanbanSquare },
    { key: 'release', label: 'Releases', icon: Send },
    { key: 'recording', label: 'Recording', icon: Clapperboard },
  ]

  const dateOf = (t) => t.release_date || t.recording_date || null
  const upcomingRows = liveContent
    .filter((t) => !t.done_at && dateOf(t))
    .sort((a, b) => dateOf(a).localeCompare(dateOf(b)))
    .slice(0, 20)
  const doneRows = lensContent
    .filter((t) => t.done_at)
    .sort((a, b) => b.done_at.localeCompare(a.done_at))
    .slice(0, 20)

  // One section of the dashboard, by key — rendered in the channel's order.
  const renderWidget = (k) => {
    if (k === 'programs') return (
      <div className={'fs-wrap' + (fsProg ? ' on' : '')}>
        <div className="section-head">
          <Rocket size={17} style={{ color: 'var(--brand-500)' }} />
          <h2>Programs</h2>
          <span className="stat-sub" style={{ fontWeight: 500 }}>every launch on the timeline</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={() => setFsProg(!fsProg)}
            data-tip={fsProg ? 'Exit full screen (Esc)' : 'Full screen — the timeline fills the display'} data-tip-left="" aria-label="Full screen">
            {fsProg ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
        <ProgramsGantt channel={key} canManage={isAdmin || manageContent} isAdmin={isAdmin} lens={hasLens ? lens : 'all'} big={fsProg} />
      </div>
    )
    if (k === 'metrics') return renderMetrics()
    if (k === 'growth') return (
      <>
        <div className="section-head">
          <LineChart size={17} style={{ color: 'var(--brand-500)' }} />
          <h2>Growth</h2>
        </div>
        <CompareCard trackers={trackers} history={history} />
      </>
    )
    if (k === 'campaigns') return (
      <>
        <div className="section-head">
          <Megaphone size={17} style={{ color: 'var(--brand-500)' }} />
          <h2>Campaigns</h2>
          <span className="count">· {deptCampaigns.length}</span>
        </div>
        <DeptCampaigns camps={deptCampaigns} byKey={byKey} navigate={navigate} />
      </>
    )
    if (k === 'timetable') return (
      <>
        <div className="section-head">
          <Send size={17} style={{ color: 'var(--brand-500)' }} />
          <h2>Releasing</h2>
          <span className="stat-sub" style={{ fontWeight: 500 }}>the next 7 days</span>
        </div>
        <DeptTimetable content={liveContent} onOpen={setOpenItem} mode="release" />
        <div className="section-head" style={{ marginTop: 14 }}>
          <Clapperboard size={17} style={{ color: 'var(--brand-500)' }} />
          <h2>Shooting</h2>
          <span className="stat-sub" style={{ fontWeight: 500 }}>the next 7 days</span>
        </div>
        <DeptTimetable content={liveContent} onOpen={setOpenItem} mode="recording" />
      </>
    )
    if (k === 'upcoming') return (
      <>
        <div className="section-head">
          <CalendarRange size={17} style={{ color: 'var(--brand-500)' }} />
          <h2>Upcoming</h2>
          <span className="count">· {upcomingRows.length}</span>
        </div>
        <DeptTaskList rows={upcomingRows} empty="Nothing dated yet." onOpen={setOpenItem} />
      </>
    )
    if (k === 'done') return (
      <>
        <div className="section-head">
          <CheckCircle2 size={17} style={{ color: 'var(--good-ink, #0ca30c)' }} />
          <h2>Done</h2>
          <span className="count">· {doneRows.length}</span>
        </div>
        <DeptTaskList rows={doneRows} empty="Nothing completed yet." onOpen={setOpenItem} done />
      </>
    )
    if (k === 'content') return renderContent()
    return null
  }

  const renderMetrics = () => (
    <>
      {/* Pinned metrics — the channel's headline numbers */}
      {pinned.length > 0 && (
        <div className="pinned-grid">
          {pinned.map((t) => {
            const pct = Math.min(100, Math.round((t.current / Math.max(1, t.target)) * 100))
            return (
              <div className="card hero-metric card-pad" key={t.id}>
                <div className="hm-top">
                  <span className="hm-label"><Pin size={13} /> {t.label}</span>
                  <span className="spacer" />
                  {(editValues || manageMetrics) && (
                    <button className="icon-btn hm-unpin" data-tip={manageMetrics ? 'Edit this metric' : 'Update the value'} onClick={() => openMetric(t)} aria-label="Edit">
                      <Pencil size={15} />
                    </button>
                  )}
                  {manageLayout && (
                    <button className="icon-btn hm-unpin" data-tip="Unpin from the headline row" data-tip-left="" onClick={() => setPin(t, false)} aria-label="Unpin">
                      <PinOff size={15} />
                    </button>
                  )}
                </div>
                <div className="hm-value">
                  {t.current.toLocaleString()}
                  <span className="hm-target"> / {t.target.toLocaleString()}{t.unit ? ` ${t.unit}` : ''}</span>
                </div>
                <div className="meter-track" style={{ height: 12 }}>
                  <div className="meter-fill" style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--good)' : 'var(--brand-500)' }} />
                </div>
                <div className="hm-foot">
                  <span className={`hm-pct${pct >= 100 ? ' done' : ''}`}>{pct}% of {t.content_type ? 'plan' : 'target'}</span>
                  {t.content_type ? (
                    <span className="hm-auto" data-tip="Counts itself: creating a task raises the plan, completing one fills it">auto · from tasks</span>
                  ) : editValues && (
                    <div className="meter-adjust">
                      <button className="step-btn" onClick={() => step(t, -1)} disabled={t.current <= 0} data-tip="Decrease by 1" aria-label="Decrease"><Minus size={15} /></button>
                      <button className="step-btn" onClick={() => step(t, 1)} data-tip="Increase by 1" aria-label="Increase"><Plus size={15} /></button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {/* Right under the headline number — the way to add the next one */}
          {manageMetrics && (
            <button className="add-metric-tile" onClick={() => openMetric(null)} data-tip="Create another metric for this channel">
              <Plus size={16} /> Add another metric
            </button>
          )}
        </div>
      )}

      {/* Metrics grid */}
      <div className="section-head">
        <Gauge size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>Metrics</h2>
        <span className="icon-btn" data-tip="Plans count completed tasks · other numbers use +/−" aria-label="How metrics fill" style={{ cursor: 'help' }}><AlertCircle size={13} /></span>
        <span className="spacer" />
        {manageMetrics && <button className="btn btn-primary btn-sm" onClick={() => openMetric(null)}><Plus size={15} /> Add metric</button>}
      </div>
      {gridMetrics.length === 0 ? (
        <div className="card card-pad empty">{pinned.length > 0 ? 'All metrics are pinned above.' : 'No metrics yet.'}</div>
      ) : (
        <div className="grid grid-auto">
          {gridMetrics.map((t, i) => (
            <div
              className={`card card-pad metric-card${dragIdx === i ? ' dragging' : ''}`}
              key={t.id}
              draggable={manageLayout}
              onDragStart={() => manageLayout && setDragIdx(i)}
              onDragOver={(e) => { if (manageLayout) { e.preventDefault(); onDragOver(i) } }}
              onDragEnd={persistOrder}
            >
              {(manageLayout || manageMetrics || editValues) && (
                <div className="metric-top">
                  {manageLayout && <span className="drag-handle" data-tip="Drag to reorder"><GripVertical size={15} /></span>}
                  <span className="spacer" />
                  {manageLayout && (
                    <button className="icon-btn" data-tip="Pin as a headline metric" onClick={() => setPin(t, true)} aria-label="Pin"><Pin size={14} /></button>
                  )}
                  {(editValues || manageMetrics) && (
                    <button className="icon-btn" data-tip={manageMetrics ? 'Edit this metric' : 'Update the value'} data-tip-left="" onClick={() => openMetric(t)} aria-label="Edit"><Pencil size={14} /></button>
                  )}
                </div>
              )}
              <Meter label={t.label} current={t.current} target={t.target} unit={t.unit} period={t.period}
                auto={!!t.content_type} canEdit={editValues && !t.content_type} onStep={(d) => step(t, d)} />
            </div>
          ))}
        </div>
      )}

    </>
  )

  const renderContent = () => (
    <div className={'fs-wrap' + (fs ? ' on' : '')}>
      <div className="section-head">
        <CalendarRange size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>Content</h2>
        <span className="spacer" />
        <div className="pill-group">
          {VIEWS.map((v) => {
            const Icon = v.icon
            return (
              <button key={v.key} className={'pill' + (view === v.key && !selectedDate ? ' active' : '')}
                onClick={() => { setView(v.key); setSelectedDate(null) }}>
                <Icon size={14} /> {v.label}
              </button>
            )
          })}
        </div>
        <button className="icon-btn" onClick={() => setFs(!fs)}
          data-tip={fs ? 'Exit full screen (Esc)' : 'Full screen — board & calendars fill the display'} aria-label="Full screen">
          {fs ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        {manageContent && (
          <button className="btn btn-primary btn-sm" onClick={() => { setNewDefaults({ channels: [key] }); setOpenItem('new') }}>
            <Plus size={15} /> New task
          </button>
        )}
      </div>

      <ContentFilters
        filter={filter} onChange={setFilter}
        items={lensContent} shown={wsContent.length}
        statuses={statuses} teamById={teamById}
      />

      {selectedDate ? (
        <DayAgenda
          date={selectedDate}
          items={wsLive}
          statusesById={statusesById}
          canEdit={manageContent}
          onOpen={setOpenItem}
          onAdd={(iso) => {
            setNewDefaults({ channels: [key], [view === 'recording' ? 'recording_date' : 'release_date']: iso })
            setOpenItem('new')
          }}
          onBack={() => setSelectedDate(null)}
        />
      ) : view === 'board' ? (
        <ContentBoard items={wsContent} statuses={statuses} dept={key} canMove={moveTasks} onMove={moveStatus} onOpen={setOpenItem}
          onQuickAdd={manageContent ? quickAdd : undefined} campaignsById={campaignsById} teamById={teamById} />
      ) : (
        <ContentCalendar
          items={wsContent}
          trayItems={unscheduled}
          mode={view}
          canMove={moveTasks}
          onMoveDate={moveDate}
          onDayClick={setSelectedDate}
          statusesById={statusesById}
          onOpenItem={setOpenItem}
          onAddAt={manageContent ? (iso) => {
            setNewDefaults({ channels: [key], [view === 'recording' ? 'recording_date' : 'release_date']: iso })
            setOpenItem('new')
          } : undefined}
        />
      )}

    </div>
  )

  return (
    <>
      {/* Head of the channel + the page's own controls */}
      <div className="dept-head-row">
        {dept.head_id && dept.head_name ? (
          <>
            <Avatar name={dept.head_name} color={dept.head_color} src={dept.head_avatar} size="sm" />
            <span className="dept-head-name">{dept.head_name}</span>
            <span className="dept-head-label">Head of {dept.label}</span>
          </>
        ) : isAdmin ? (
          <button className="no-owner-badge no-owner-btn" data-tip="Nobody owns this channel — click to assign a head"
            onClick={() => { setChanErr(''); setChanEdit({ label: dept.label, head_id: dept.head_id || '' }) }}>
            no owner — assign one
          </button>
        ) : (
          <span className="no-owner-badge">no owner yet</span>
        )}
        <span className="spacer" />
        {hasLens && (
          <div className="pill-group" style={{ marginRight: 4 }}>
            <button className={'pill' + (lens === 'all' ? ' active' : '')} onClick={() => setLens('all')}
              data-tip="Everything on this channel">All</button>
            {PLATFORMS.filter((pl) => pl.key !== 'both').map((pl) => (
              <button key={pl.key} className={'pill' + (lens === pl.key ? ' active' : '')} onClick={() => setLens(pl.key)}
                data-tip={`Only ${pl.label} work — programs, tasks and campaigns`}>
                <span className="rp-dot" style={{ background: pl.color }} />{pl.label}
              </button>
            ))}
          </div>
        )}
        {canCustomize && (
          <button className="btn btn-sm" onClick={openDash} data-tip="Choose which sections this page shows, and their order">
            <SlidersHorizontal size={14} /> Customize
          </button>
        )}
        {isAdmin && (
          <button className="icon-btn" data-tip="Channel settings — rename, head, delete" data-tip-left=""
            onClick={() => { setChanErr(''); setChanEdit({ label: dept.label, head_id: dept.head_id || '' }) }} aria-label="Channel settings">
            <Settings size={16} />
          </button>
        )}
      </div>

      {/* The dashboard, exactly the sections this channel chose */}
      {widgetOrder.map((k) => <div key={k}>{renderWidget(k)}</div>)}

      {/* Customize modal — toggle sections, reorder with arrows */}
      {dash && (
        <Modal
          title="Customize this dashboard"
          onClose={() => setDash(null)}
          footer={<>
            <button className="btn" onClick={() => setDash(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveDash}>Save layout</button>
          </>}
        >
          {dashErr && <div className="form-error"><AlertCircle size={16} /> {dashErr}</div>}
          <div className="stat-sub" style={{ marginBottom: 10 }}>
            Sections show top to bottom. Changes apply to everyone who opens {dept.label}.
          </div>
          {dash.map((w, i) => {
            const def = DASH_WIDGETS.find((x) => x.key === w.key)
            return (
              <div key={w.key} className={'dash-row' + (w.on ? '' : ' off')}>
                <label className="dash-toggle">
                  <input type="checkbox" checked={w.on}
                    onChange={() => setDash((prev) => prev.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} />
                  <span>
                    <b>{def.label}</b>
                    <span className="dash-hint">{def.hint}</span>
                  </span>
                </label>
                <span className="spacer" />
                <button className="icon-btn" disabled={i === 0} onClick={() => moveDashRow(i, -1)} data-tip="Move up" aria-label="Move up"><ArrowUp size={14} /></button>
                <button className="icon-btn" disabled={i === dash.length - 1} onClick={() => moveDashRow(i, 1)} data-tip="Move down" data-tip-left="" aria-label="Move down"><ArrowDown size={14} /></button>
              </div>
            )
          })}
        </Modal>
      )}

      {/* Channel settings — rename, reassign the head, or delete the channel */}
      {chanEdit && (
        <Modal
          title="Channel settings"
          onClose={() => setChanEdit(null)}
          footer={<>
            <button className="btn btn-danger" onClick={deleteChannel}><Trash2 size={15} /> Delete channel</button>
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={() => setChanEdit(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveChannel}>Save</button>
          </>}
        >
          {chanErr && <div className="form-error"><AlertCircle size={16} /> {chanErr}</div>}
          <div className="field"><label>Name</label>
            <input className="input" autoFocus value={chanEdit.label}
              onChange={(e) => setChanEdit({ ...chanEdit, label: e.target.value })} />
          </div>
          <div className="field"><label>Head of the channel</label>
            <select className="select" value={chanEdit.head_id}
              onChange={(e) => setChanEdit({ ...chanEdit, head_id: e.target.value === '' ? '' : Number(e.target.value) })}>
              <option value="">— nobody —</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="stat-sub">Deleting removes the channel’s metrics and history; tasks that only live here are deleted. Members lose access to it.</div>
        </Modal>
      )}

      {/* Metric modal */}
      {metric && (
        <Modal
          title={metric.id ? (manageMetrics ? 'Edit metric' : 'Update value') : 'Add metric'}
          onClose={() => setMetric(null)}
          footer={<>
            {metric.id && manageMetrics && <button className="btn btn-danger" onClick={delMetric}><Trash2 size={15} /> Delete</button>}
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={() => setMetric(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveMetric}>{metric.id ? 'Save' : 'Add'}</button>
          </>}
        >
          {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
          {manageMetrics ? (
            <>
              <div className="field"><label>Name</label><input className="input" autoFocus value={metric.label} onChange={(e) => setMetric({ ...metric, label: e.target.value })} placeholder="e.g. Reels" /></div>
              <div className="field"><label>How it fills</label>
                <select className="select" value={metric.content_type} onChange={(e) => setMetric({ ...metric, content_type: e.target.value })}>
                  {FILL_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
                {metric.content_type && <span className="field-hint">New tasks raise the plan; completed tasks fill it.</span>}
              </div>
              <div className="grid grid-3" style={{ gap: 12 }}>
                <div className="field"><label>Current</label>
                  <input className="input" type="number" min="0" disabled={!!metric.content_type && user.role !== 'admin'}
                    value={metric.current} onChange={(e) => setMetric({ ...metric, current: e.target.value })} />
                </div>
                <div className="field"><label>{metric.content_type ? 'Plan' : 'Target'}</label><input className="input" type="number" min="1" value={metric.target} onChange={(e) => setMetric({ ...metric, target: e.target.value })} /></div>
                <div className="field"><label>Unit</label><input className="input" value={metric.unit} onChange={(e) => setMetric({ ...metric, unit: e.target.value })} placeholder="reels" /></div>
              </div>
              <div className="field"><label>Period</label>
                <select className="select" value={metric.period} onChange={(e) => setMetric({ ...metric, period: e.target.value })}>
                  {CADENCES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
            </>
          ) : (
            <div className="field"><label>{metric.label} — current value</label><input className="input" type="number" min="0" autoFocus value={metric.current} onChange={(e) => setMetric({ ...metric, current: e.target.value })} /></div>
          )}
        </Modal>
      )}

      {/* Content modal */}
      {openItem && (
        <ContentModal
          item={openItem === 'new' ? null : openItem}
          statuses={statuses}
          defaults={newDefaults}
          onClose={() => setOpenItem(null)}
          onCreate={createContent}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}

      {/* The handover gate: the move the server would not take on trust. */}
      {gate && (
        <StageGate
          item={gate.item}
          statusId={gate.statusId}
          statusLabel={statusesById[gate.statusId]?.label || ''}
          team={team}
          onCancel={() => setGate(null)}
          onDone={(saved) => {
            setGate(null)
            setContent((prev) => prev.map((x) => (x.id === saved.id ? saved : x)).filter((x) => x.channels.includes(key)))
            refreshTrackers()
            toast('Moved — the handover is on the record')
          }}
        />
      )}
    </>
  )
}
