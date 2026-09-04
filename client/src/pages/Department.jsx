import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Lock, Plus, Pencil, Trash2, Gauge, CalendarRange, AlertCircle, Pin, PinOff, GripVertical, Minus,
  KanbanSquare, Send, Clapperboard, LineChart, Maximize2, Minimize2,
  SlidersHorizontal, Settings, Megaphone, CalendarClock, CheckCircle2, ArrowUp, ArrowDown, Rocket,
  PenLine, Check, CopyPlus, UserRound, UsersRound,
} from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { toast, loadFailed } from '../lib/toast.js'
import { markDone, askForTheLink } from '../lib/finish.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { CADENCES, can, todayISO, addDaysISO, dateLabel, typeInfo, isDeletedLabel, tashkentDay } from '../lib/constants.js'
import { useFullscreen } from '../lib/useFullscreen.js'
import Modal from '../components/Modal.jsx'
import Fold from '../components/Fold.jsx'
import ContentBoard from '../components/ContentBoard.jsx'
import ContentCalendar from '../components/ContentCalendar.jsx'
import ContentFilters, { BLANK_FILTER, matchesFilter, filterIsOn } from '../components/ContentFilters.jsx'
import ContentModal from '../components/ContentModal.jsx'
import StageGate from '../components/StageGate.jsx'
import DayAgenda from '../components/DayAgenda.jsx'
import Avatar from '../components/Avatar.jsx'
import { useContextMenu } from '../components/ContextMenu.jsx'
import { CampaignRow } from '../components/ProjectBits.jsx'
import ProgramsGantt, { PLATFORMS } from '../components/ProgramsGantt.jsx'
import { rewardIfFinished } from '../lib/reward.js'
import { useTaskSync } from '../lib/useTaskSync.js'
import { getPicks, byPicks, bumpPick } from '../lib/picks.js'
import { tr as tx } from '../lib/i18n.jsx'

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
  { key: 'campaigns', label: 'Campaigns', hint: 'Campaigns running on this channel' },
  { key: 'timetable', label: tx('Timetable'), hint: 'The next 7 days, day by day' },
  { key: 'upcoming', label: 'Upcoming board', hint: 'Everything dated, closest first' },
  { key: 'done', label: 'Done board', hint: 'Recently completed work' },
  { key: 'content', label: 'Content workspace', hint: 'Kanban board and calendars' },
]
const DEFAULT_DASH = ['content']

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
  if (camps.length === 0) return <div className="card card-pad empty">{tx("No campaigns touch this channel yet.")}</div>
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

  const manageLayout = can(user, 'manage_layout')
  const manageContent = can(user, 'manage_content')
  const moveTasks = can(user, 'move_tasks')

  const [content, setContent] = useState([])
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)

  const [err, setErr] = useState('')
  const [dragIdx, setDragIdx] = useState(null)
  // board | release | recording — the last view is remembered per browser.
  // The board is the working view; the calendar is the planning one, and the
  // month is what the rest of the product now opens on. A choice is remembered.
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
      setContent(cached.content); setStatuses(cached.statuses)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setSelectedDate(null)
    Promise.all([
      // This is the one page with a kanban board, and a board card wears its
      // thumbnail — so this is the one page that asks for them.
      api.get(`/content?department=${key}&thumbs=1`),
      api.get('/statuses'),
    ])
      .then(([ct, st]) => {
        setContent(ct); setStatuses(st)
        // Thumbnails stay out of the cache to keep localStorage light.
        cache.set(`dept:${key}`, {
          statuses: st,
          content: ct.map(({ photo_thumb: _t, ...rest }) => rest),
        })
      })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [key, deptReady, hasAccess])

  // Live sync: tasks added by the admin or teammates appear within seconds
  // (paused while the tab is hidden or a task modal is open).
  useEffect(() => {
    if (!dept || !hasAccess) return
    const refresh = () => {
      if (document.hidden || openItem || dragIdx !== null) return
      api.poll(`/content?department=${key}&thumbs=1`).then((f) => { if (f) setContent(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [key, dept, hasAccess, openItem, dragIdx])

  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])

  // Which column is MINE. Crew hats are declared on the person; review is a
  // permission, because signing work off is an SMM's job rather than a craft.
  // Admins hold every hat, so tinting all six would tint nothing — they get
  // none. Matched on the stage's own label, the way the stage rules are.
  const myStages = useMemo(() => {
    if (user.role === 'admin') return []
    const hats = user.crew_roles || []
    const want = []
    if (hats.includes('operator')) want.push(/to\s*shoot|shooting|s[yj]omka/i, /^shot$/i)
    if (hats.includes('editor')) want.push(/editing|montaj/i)
    if (hats.includes('designer')) want.push(/editing|montaj/i)
    if (user.permissions?.review_publish) want.push(/^ready$|review|tayyor/i)
    if (!want.length) return []
    return statuses.filter((s) => want.some((re) => re.test(String(s.label || '')))).map((s) => s.id)
  }, [statuses, user])
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
  // ---- content ----
  const createContent = async (payload) => {
    const c = await api.post('/content', payload)
    setContent((prev) => [c, ...prev].filter((x) => x.channels.includes(key)))
  }
  // Picking somebody to shoot a video is not a question the server has an
  // opinion about, so the name appears at once and the request follows. A
  // stage or a tick can be refused — those still wait for the answer. See
  // lib/useTaskSync.js for where that line is drawn.
  const { update: updateContent, isBusy } = useTaskSync(setContent, {
    belongs: (x) => x.channels.includes(key),
    after: rewardIfFinished,
  })
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
  }
  // Right-click a card: the four things people did to a row on the To-Do page
  // before it was removed, on the board that replaced it. Everything here is
  // already permission-checked by the server; the menu only offers what this
  // account can actually do so nothing on it answers 403.
  // The five people this account hands work to most often, learned from what
  // they actually do (lib/picks.js). Five because a right-click menu is a
  // shortcut, not a directory — everybody else is one press further on, in
  // the sheet.
  const giveTo = useMemo(() => {
    const picks = getPicks()
    return [...team].sort(byPicks(picks, (a, b) => a.name.localeCompare(b.name))).slice(0, 5)
  }, [team])
  const { openMenu } = useContextMenu()
  const cardMenu = (e, item) => openMenu(e, [
    { label: tx('Open'), icon: PenLine, onClick: () => setOpenItem(item) },
    manageContent && {
      label: item.done_at ? tx('Mark as not done') : tx('Mark as done'), icon: Check,
      onClick: () => markDone(item, updateContent, setOpenItem),
    },
    manageContent && !item.done_at && {
      label: item.pinned ? tx('Unpin') : tx('Pin to the top'), icon: Pin,
      onClick: () => updateContent(item, { pinned: !item.pinned }).catch((err) => alert(err.message)),
    },
    // Handing a piece to somebody was a four-step job: open the sheet, find
    // the right view, pick a name, save. It is the single commonest thing
    // done to a card, so it is one press here — and it lands instantly,
    // because a seat is not something the server argues with.
    ...(manageContent && giveTo.length ? [{ sep: true }, ...giveTo.map((u) => ({
      label: `${tx('Give to')} ${u.name}`, icon: UserRound,
      hint: item.assignee_id === u.id ? tx('already theirs') : undefined,
      disabled: item.assignee_id === u.id,
      onClick: () => {
        bumpPick(u.id)
        updateContent(item, { assignee_ids: [u.id] })
          .then(() => toast(`${tx('Given to')} ${u.name.split(' ')[0]}`))
          .catch((err) => toast(err.message, 'err'))
      },
    })), {
      label: tx('Somebody else…'), icon: UsersRound, onClick: () => setOpenItem(item),
    }] : []),
    manageContent && {
      label: tx('Duplicate'), icon: CopyPlus,
      onClick: () => api.post(`/content/${item.id}/duplicate`)
        .then((copy) => { setContent((prev) => [copy, ...prev].filter((x) => x.channels.includes(key))); toast(tx('Duplicated')) })
        .catch((err) => alert(err.message)),
    },
    manageContent && { sep: true },
    manageContent && {
      label: tx('Delete'), icon: Trash2, danger: true,
      onClick: () => {
        if (!confirm(`${tx('Delete')} “${item.title}”?`)) return
        deleteContent(item).then(() => toast(tx('Task deleted'))).catch((err) => alert(err.message))
      },
    },
  ])

  // Taking a move back: the server keeps the previous shape of the task for
  // ten seconds and walks the plan numbers back with it, so an accidental drag
  // costs nothing. After that the move is on the record and stays there.
  const undoMove = async (id) => {
    try {
      const c = await api.post(`/content/${id}/undo`)
      setContent((prev) => prev.map((x) => (x.id === c.id ? c : x)).filter((x) => x.channels.includes(key)))
      toast(tx('Move taken back'))
    } catch (e) { toast(e.message, 'err') }
  }
  const movedToast = (saved, statusId) =>
    toast(`Moved to ${statusesById[statusId]?.label || 'the next stage'}`, 'ok',
      { label: 'Undo', onClick: () => undoMove(saved?.id ?? null) })

  // Moving work on is the moment you decide who is taking it, so the board
  // asks the server what this move hands over before it moves anything. If it
  // hands something over, the handover window opens; if it doesn't, the card
  // just moves. A refusal we failed to predict still opens the window.
  const moveStatus = async (item, statusId) => {
    try {
      const { gates } = await api.get(`/content/${item.id}/handover?to=${statusId}`)
      if (gates?.length) { setGate({ item, statusId, gates }); return }
      await updateContent(item, { status_id: statusId })
      movedToast(item, statusId)
    } catch (e) {
      if (e.data?.gate && e.data?.missing) setGate({ item, statusId })
      else askForTheLink(e, item, setOpenItem)
    }
  }
  // The task modal changes stages too — its chips at the top of the panel —
  // and that route used to hand work on without ever asking who was taking it.
  // A question the board asks and the panel does not is not a question anyone
  // has to answer. Anything that carries a stage change now goes past the same
  // handover window; everything else saves straight through.
  const updateFromModal = async (item, payload) => {
    const next = payload.status_id
    if (!item || next === undefined || next === item.status_id) return updateContent(item, payload)
    const { status_id, ...rest } = payload
    if (Object.keys(rest).length) await updateContent(item, rest)   // the edits land either way
    const fresh = { ...item, ...rest }
    try {
      const { gates } = await api.get(`/content/${item.id}/handover?to=${next}`)
      if (gates?.length) { setGate({ item: fresh, statusId: next, gates }); return }
    } catch { /* fall through and just move it */ }
    await updateContent(fresh, { status_id: next })
    movedToast(fresh, next)
  }

  const moveDate = (item, field, iso) => updateContent(item, { [field]: iso }).catch((e) => alert(e.message))
  // The board's foot inputs: a title lands straight in that column.
  const quickAdd = async (title, statusId) => {
    const c = await api.post('/content', { title, status_id: statusId, channels: [key] })
    setContent((prev) => [c, ...prev])
    toast(tx('Added — synced'))
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
  if (!dept) return <div className="empty">{tx("Unknown channel.")}</div>
  if (!hasAccess)
    return (
      <div className="card card-pad empty">
        <Lock size={30} />
        <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{tx("You don't have access to this channel.")}</div>
      </div>
    )

  const VIEWS = [
    { key: 'board', label: tx('Board'), icon: KanbanSquare },
    { key: 'release', label: tx('Releases'), icon: Send },
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
          <h2>{tx("Programs")}</h2>
          <span className="stat-sub" style={{ fontWeight: 500 }}>{tx("every launch on the timeline")}</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={() => setFsProg(!fsProg)}
            data-tip={fsProg ? 'Exit full screen (Esc)' : 'Full screen — the timeline fills the display'} data-tip-left="" aria-label={tx("Full screen")}>
            {fsProg ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
        <ProgramsGantt channel={key} canManage={isAdmin || manageContent} isAdmin={isAdmin} lens={hasLens ? lens : 'all'} big={fsProg} />
      </div>
    )
    // Which of these matter depends on who is looking, so each one folds and
    // remembers. The channel's LAYOUT is the admin's call for everybody; the
    // fold is this account's call for itself.
    if (k === 'campaigns') return (
      <Fold id={`dept-${key}-campaigns`} title={tx("Campaigns")} count={deptCampaigns.length}
        icon={<Megaphone size={17} style={{ color: 'var(--brand-500)' }} />}>
        <DeptCampaigns camps={deptCampaigns} byKey={byKey} navigate={navigate} />
      </Fold>
    )
    if (k === 'timetable') return (
      <>
        <Fold id={`dept-${key}-releasing`} title={tx("Releasing")}
          icon={<Send size={17} style={{ color: 'var(--brand-500)' }} />}
          extra={<span className="stat-sub" style={{ fontWeight: 500 }}>{tx("the next 7 days")}</span>}>
          <DeptTimetable content={liveContent} onOpen={setOpenItem} mode="release" />
        </Fold>
        <Fold id={`dept-${key}-shooting`} title={tx("Shooting")}
          icon={<Clapperboard size={17} style={{ color: 'var(--brand-500)' }} />}
          extra={<span className="stat-sub" style={{ fontWeight: 500 }}>{tx("the next 7 days")}</span>}>
          <DeptTimetable content={liveContent} onOpen={setOpenItem} mode="recording" />
        </Fold>
      </>
    )
    if (k === 'upcoming') return (
      <Fold id={`dept-${key}-upcoming`} title={tx("Upcoming")} count={upcomingRows.length}
        icon={<CalendarRange size={17} style={{ color: 'var(--brand-500)' }} />}>
        <DeptTaskList rows={upcomingRows} empty="Nothing dated yet." onOpen={setOpenItem} />
      </Fold>
    )
    if (k === 'done') return (
      <Fold id={`dept-${key}-done`} title={tx("Done")} count={doneRows.length}
        icon={<CheckCircle2 size={17} style={{ color: 'var(--good-ink, #0ca30c)' }} />}>
        <DeptTaskList rows={doneRows} empty="Nothing completed yet." onOpen={setOpenItem} done />
      </Fold>
    )
    if (k === 'content') return renderContent()
    return null
  }

  const renderContent = () => (
    <div className={'fs-wrap' + (fs ? ' on' : '')}>
      <div className="section-head">
        <CalendarRange size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{tx("Content")}</h2>
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
          data-tip={fs ? 'Exit full screen (Esc)' : 'Full screen — board & calendars fill the display'} aria-label={tx("Full screen")}>
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
        <ContentBoard items={wsContent} statuses={statuses} dept={key} canMove={moveTasks} onMove={moveStatus} onOpen={setOpenItem} myStages={myStages}
          onMenu={cardMenu} isBusy={isBusy}
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
          <button className="no-owner-badge no-owner-btn" data-tip={tx("Nobody owns this channel — click to assign a head")}
            onClick={() => { setChanErr(''); setChanEdit({ label: dept.label, head_id: dept.head_id || '' }) }}>
            {tx('no owner — assign one')}
          </button>
        ) : (
          <span className="no-owner-badge">{tx("no owner yet")}</span>
        )}
        <span className="spacer" />
        {hasLens && (
          <div className="pill-group" style={{ marginRight: 4 }}>
            <button className={'pill' + (lens === 'all' ? ' active' : '')} onClick={() => setLens('all')}
              data-tip={tx("Everything on this channel")}>{tx("All")}</button>
            {PLATFORMS.filter((pl) => pl.key !== 'both').map((pl) => (
              <button key={pl.key} className={'pill' + (lens === pl.key ? ' active' : '')} onClick={() => setLens(pl.key)}
                data-tip={`Only ${pl.label} work — programs, tasks and campaigns`}>
                <span className="rp-dot" style={{ background: pl.color }} />{pl.label}
              </button>
            ))}
          </div>
        )}
        {canCustomize && (
          <button className="btn btn-sm" onClick={openDash} data-tip={tx("Choose which sections this page shows, and their order")}>
            <SlidersHorizontal size={14} />{' '}{tx('Customize')}
          </button>
        )}
        {isAdmin && (
          <button className="icon-btn" data-tip={tx("Channel settings — rename, head, delete")} data-tip-left=""
            onClick={() => { setChanErr(''); setChanEdit({ label: dept.label, head_id: dept.head_id || '' }) }} aria-label={tx("Channel settings")}>
            <Settings size={16} />
          </button>
        )}
      </div>

      {/* The dashboard, exactly the sections this channel chose. Each section
          is named on its wrapper so a phone can put the work first: on a desk
          the growth numbers sit beside the board, on a 390px screen they sat
          three screenfuls above it, and the board is what the channel is
          opened for. */}
      <div className="dept-widgets">
        {widgetOrder.map((k) => <div key={k} data-w={k}>{renderWidget(k)}</div>)}
      </div>

      {/* Customize modal — toggle sections, reorder with arrows */}
      {dash && (
        <Modal
          title={tx("Customize this dashboard")}
          onClose={() => setDash(null)}
          footer={<>
            <button className="btn" onClick={() => setDash(null)}>{tx("Cancel")}</button>
            <button className="btn btn-primary" onClick={saveDash}>{tx("Save layout")}</button>
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
                <button className="icon-btn" disabled={i === 0} onClick={() => moveDashRow(i, -1)} data-tip={tx("Move up")} aria-label={tx("Move up")}><ArrowUp size={14} /></button>
                <button className="icon-btn" disabled={i === dash.length - 1} onClick={() => moveDashRow(i, 1)} data-tip={tx("Move down")} data-tip-left="" aria-label={tx("Move down")}><ArrowDown size={14} /></button>
              </div>
            )
          })}
        </Modal>
      )}

      {/* Channel settings — rename, reassign the head, or delete the channel */}
      {chanEdit && (
        <Modal
          title={tx("Channel settings")}
          onClose={() => setChanEdit(null)}
          footer={<>
            <button className="btn btn-danger" onClick={deleteChannel}><Trash2 size={15} />{' '}{tx("Delete channel")}</button>
            <span className="foot-gap" />
            <button className="btn" onClick={() => setChanEdit(null)}>{tx("Cancel")}</button>
            <button className="btn btn-primary" onClick={saveChannel}>{tx("Save")}</button>
          </>}
        >
          {chanErr && <div className="form-error"><AlertCircle size={16} /> {chanErr}</div>}
          <div className="field"><label>{tx("Name")}</label>
            <input className="input" autoFocus value={chanEdit.label}
              onChange={(e) => setChanEdit({ ...chanEdit, label: e.target.value })} />
          </div>
          <div className="field"><label>{tx("Head of the channel")}</label>
            <select className="select" value={chanEdit.head_id}
              onChange={(e) => setChanEdit({ ...chanEdit, head_id: e.target.value === '' ? '' : Number(e.target.value) })}>
              <option value="">— nobody —</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="stat-sub">Deleting removes the channel’s metrics and history; tasks that only live here are deleted. Members lose access to it.</div>
        </Modal>
      )}


      {/* Content modal */}
      {openItem && (
        <ContentModal key={openItem?.id || 'new'}
          item={openItem === 'new' ? null : openItem}
          statuses={statuses}
          defaults={newDefaults}
          onClose={(next) => setOpenItem(next?.id ? next : null)}
          onCreate={createContent}
          onUpdate={updateFromModal}
          onDelete={deleteContent}
        />
      )}

      {/* The handover gate: the move the server would not take on trust. */}
      {gate && (
        <StageGate
          item={gate.item}
          statusId={gate.statusId}
          statusLabel={statusesById[gate.statusId]?.label || ''}
          initialGates={gate.gates || null}
          onCancel={() => setGate(null)}
          onDone={(saved) => {
            const to = gate.statusId
            setGate(null)
            setContent((prev) => prev.map((x) => (x.id === saved.id ? saved : x)).filter((x) => x.channels.includes(key)))
            movedToast(saved, to)
          }}
        />
      )}
    </>
  )
}
