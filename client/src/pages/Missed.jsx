import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CalendarRange, ChevronDown, Scissors, Send, PenLine, Trash2, Palette, BarChart3 } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, addDaysISO, dateLabel, typeInfo, tashkentDay, isDeletedLabel } from '../lib/constants.js'
import Avatar from '../components/Avatar.jsx'
import ContentModal from '../components/ContentModal.jsx'
import { useContextMenu } from '../components/ContextMenu.jsx'
import { toast } from '../lib/toast.js'

// Missed deadlines — two clocks per task, each unforgiving:
//   release    — the channel's deadline (release_date, resolved by done)
//   edit ready — the MAKER's deadline (edit_ready_date, resolved the first
//                time the piece reaches a ready/final stage): the designer
//                on a post, the editor/operator on filmed content
// Not resolved by the end of that day (Tashkent) = missed, even if it lands
// later. Everyone sees their own misses; the admin sees the whole team,
// filterable by channel and person, with day / week / custom statistics.

const whoOf = (t) => [
  ...(t.assignees?.length ? t.assignees : t.assignee_id ? [t.assignee_id] : []),
  t.operator_id, t.editor_id, t.designer_id,
].filter((id, i, a) => id && a.indexOf(id) === i)

// A task can miss several clocks — each miss is its own entry, judged by its
// own person: the release by everyone on the task, the edit deadline by the
// editor, the design deadline by the designer.
const entriesOf = (t, today) => {
  const out = []
  if (t.release_date && t.release_date < today && (!t.done_at || tashkentDay(t.done_at) > t.release_date))
    out.push({ t, kind: 'release', date: t.release_date, mark: t.done_at || null, who: whoOf(t) })
  const readyMark = t.ready_at || t.done_at || null
  if (t.edit_ready_date && t.edit_ready_date < today && (!readyMark || tashkentDay(readyMark) > t.edit_ready_date))
    out.push({ t, kind: 'edit', date: t.edit_ready_date, mark: readyMark, who: [t.editor_id || t.operator_id].filter(Boolean) })
  if (t.design_ready_date && t.design_ready_date < today && (!readyMark || tashkentDay(readyMark) > t.design_ready_date))
    out.push({ t, kind: 'design', date: t.design_ready_date, mark: readyMark, who: [t.designer_id].filter(Boolean) })
  return out
}

const daysLate = (e, today) => {
  const end = e.mark ? tashkentDay(e.mark) : today
  return Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${e.date}T00:00:00Z`)) / 864e5))
}

const RANGES = [
  { key: 'all', label: 'All time', days: null },
  { key: '1d', label: 'Last day', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: 'custom', label: 'Custom…', days: null },
]

/* Where the time goes: the whole point of the exercise, in one block.
   The three phases carry their own clocks, so a week lost between the shoot
   and the cut can finally be told apart from a week lost after it. "Excused"
   is counted separately and never against the person — it is the handover
   that arrived too late for anyone to have met the date. */
const PHASE_TIP = {
  shoot: 'From the shooting date to the moment the footage was handed to an editor',
  edit: 'From that handover to the moment the cut was handed to review',
  review: 'From that handover to publication',
}
function PipelineBlame() {
  const [rep, setRep] = useState(null)
  const [all, setAll] = useState(null)   // every warning on the team, admin-only
  const [open, setOpen] = useState(null) // which person is expanded
  useEffect(() => {
    let alive = true
    api.get('/warnings/report').then((d) => { if (alive) setRep(d) }).catch(() => {})
    api.get('/warnings').then((d) => { if (alive) setAll(d.warnings || []) }).catch(() => {})
    return () => { alive = false }
  }, [])
  if (!rep || !rep.phases?.some((p) => p.judged > 0)) return null

  const worstDays = Math.max(1, ...rep.phases.map((p) => p.days_lost))
  const guilty = rep.people.filter((p) => p.late > 0)
  const forPerson = (id) => (all || []).filter((w) => w.owner_id === id)
  return (
    <>
      <div className="section-head" style={{ marginTop: 6 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BarChart3 size={16} /> Where the time goes
        </h2>
      </div>
      <div className="card card-pad">
        <div className="blame-phases">
          {rep.phases.map((p) => (
            <div className="blame-phase" key={p.phase} data-tip={PHASE_TIP[p.phase]}>
              <div className="blame-head">
                <span className="blame-name">{p.label}</span>
                <span className="blame-days">{p.days_lost}d lost</span>
              </div>
              <div className="blame-bar">
                <span style={{ width: `${Math.round((p.days_lost / worstDays) * 100)}%` }} />
              </div>
              <div className="blame-meta">
                {p.late} late · {p.on_time} on time
                {p.excused > 0 && <> · {p.excused} excused</>}
                {p.judged > 0 && <> · {Math.round((p.on_time / p.judged) * 100)}% met</>}
              </div>
            </div>
          ))}
        </div>

        {rep.worst?.days_lost > 0 && (
          <p className="blame-verdict">
            Most time is lost in <b>{rep.worst.label}</b> — {rep.worst.days_lost} day
            {rep.worst.days_lost === 1 ? '' : 's'} across {rep.worst.late} missed deadline
            {rep.worst.late === 1 ? '' : 's'}.
          </p>
        )}

        {/* Every person's record, and — one click down — exactly which tasks
            make it up. An accusation nobody can check is not worth making. */}
        {guilty.length > 0 && (
          <div className="blame-people">
            {guilty.map((p) => {
              const mine = forPerson(p.user_id)
              const isOpen = open === p.user_id
              return (
                <div key={p.user_id}>
                  <button type="button" className="blame-person"
                    onClick={() => setOpen(isOpen ? null : p.user_id)}>
                    <span className="blame-who">{p.name || `#${p.user_id}`}</span>
                    <span className="blame-split">
                      {Object.entries(p.phases).filter(([, v]) => v.late > 0)
                        .map(([k, v]) => `${k} ×${v.late}`).join(' · ')}
                      {mine.length > 0 && <span className="blame-caret">{isOpen ? '▾' : '▸'}</span>}
                    </span>
                    <span className="blame-days">{p.days_lost}d</span>
                  </button>
                  {isOpen && (
                    <div className="blame-tasks">
                      {mine.length === 0 && <div className="muted">No open items to show.</div>}
                      {mine.map((w) => (
                        <div className="blame-task" key={`${w.content_id}-${w.phase}`}>
                          <span className="blame-task-title">{w.title}</span>
                          <span className="muted">
                            {w.phase_label} · due {w.due}
                            {w.revised && <> (re-promised from {w.promised})</>}
                            {w.delivered_day ? <> · delivered {w.delivered_day}</> : <> · not delivered</>}
                            {w.shared_with?.length > 0 && <> · shared</>}
                          </span>
                          <span className="blame-days">{w.days_late}d</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

/* Module-level row — poll ticks must not remount it. */
function MissRow({ entry, today, byKey, usersById, isAdmin, onOpen, onMenu }) {
  const { t, kind } = entry
  const late = daysLate(entry, today)
  const resolved = !!entry.mark
  const who = entry.who.map((id) => usersById[id]?.name?.split(' ')[0]).filter(Boolean)
  const verb = kind === 'edit' ? (resolved ? 'ready' : 'edit')
    : kind === 'design' ? (resolved ? 'ready' : 'design')
      : (resolved ? 'done' : '')
  return (
    <button className="ov-row" onClick={() => onOpen(t)}
      onContextMenu={onMenu ? (e) => onMenu(e, t) : undefined}>
      <span className={'ov-date' + (resolved ? '' : ' late')}>
        {dateLabel(entry.date)}
      </span>
      <span className="brief-main">
        <span className={'ov-title' + (resolved ? ' done-txt' : '')}>{t.title}</span>
        <span className="brief-note" style={{ color: resolved ? 'var(--muted)' : '#A32D2D' }}>
          {resolved ? `${verb} ${late} day${late === 1 ? '' : 's'} late` : `${verb ? verb + ' ' : ''}${late} day${late === 1 ? '' : 's'} overdue`}
        </span>
      </span>
      <span className="ov-chips">
        {kind === 'edit'
          ? <span className="chip miss-kind-edit"><Scissors size={11} /> edit deadline</span>
          : kind === 'design'
            ? <span className="chip miss-kind-edit"><Palette size={11} /> design deadline</span>
            : <span className="chip miss-kind-rel"><Send size={11} /> release</span>}
        <span className={`chip ct-${t.type}`}>{typeInfo(t.type).label}</span>
        {t.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
        {isAdmin && who.map((n) => <span key={n} className="chip chip-danger">{n}</span>)}
      </span>
    </button>
  )
}

export default function Missed() {
  const { user } = useAuth()
  const { channels, byKey } = useChannels()
  const isAdmin = user.role === 'admin'
  const [boot] = useState(() => cache.get(`missed:${user.id}`))
  const [content, setContent] = useState(boot?.content || [])
  const [users, setUsers] = useState(boot?.users || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  const [loading, setLoading] = useState(!boot)
  const [openItem, setOpenItem] = useState(null)

  // Filters: period (day / week / month / custom dates), channel, person,
  // and project — the project narrows the numbers AND the missed list.
  // They REMEMBER: the page reopens exactly as this account left it.
  const remembered = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(`satashkent_stats_${user.id}`) || '{}') || {} } catch { return {} }
  }, [user.id])
  const [range, setRange] = useState(remembered.range || 'all')
  const [from, setFrom] = useState(remembered.from || '')
  const [to, setTo] = useState(remembered.to || '')
  const [chan, setChan] = useState(remembered.chan || 'all')
  const [person, setPerson] = useState(remembered.person || 0) // 0 = everyone (admin only)
  const [openPerson, setOpenPerson] = useState(0) // report row expanded to its tasks
  const [project, setProject] = useState(remembered.project || 0) // 0 = all projects
  // The numbers dashboard has its own window: this week by default.
  const [statRange, setStatRange] = useState(remembered.statRange || 'tweek')
  const [statFrom, setStatFrom] = useState(remembered.statFrom || '')
  const [statTo, setStatTo] = useState(remembered.statTo || '')
  // Published-by-channel rides the same window as the numbers above it —
  // one selector for the whole card; only the type filter is its own.
  const [pubType, setPubType] = useState(remembered.pubType || 'all')
  useEffect(() => {
    try {
      localStorage.setItem(`satashkent_stats_${user.id}`,
        JSON.stringify({ range, from, to, chan, person, project, statRange, statFrom, statTo, pubType }))
    } catch { /* ok */ }
  }, [range, from, to, chan, person, project, statRange, statFrom, statTo, pubType, user.id])
  const [campaigns, setCampaigns] = useState([])
  const [projects, setProjects] = useState([])
  useEffect(() => {
    api.cached('/campaigns').then(setCampaigns).catch(() => {})
    api.cached('/projects').then(setProjects).catch(() => {})
  }, [])

  useEffect(() => {
    Promise.all([api.get('/content'), api.cached('/users'), api.cached('/statuses')])
      .then(([ct, us, st]) => {
        setContent(ct); setUsers(us); setStatuses(st)
        cache.set(`missed:${user.id}`, { content: ct.map(({ photo_thumb: _t, ...r }) => r), users: us, statuses: st })
      })
      .finally(() => setLoading(false))
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
  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
  // Killed content (Deleted stage) is out of every judgement here: no misses
  // haunt anyone for a piece that will never ship, and it can't be upcoming.
  const deadIds = useMemo(() => new Set(statuses.filter((s) => isDeletedLabel(s.label)).map((s) => s.id)), [statuses])
  const alive = useMemo(() => content.filter((t) => !deadIds.has(t.status_id)), [content, deadIds])
  const campById = useMemo(() => Object.fromEntries(campaigns.map((c) => [c.id, c])), [campaigns])
  const projectOf = (t) => (t.campaign_id ? campById[t.campaign_id]?.project_id ?? null : null)

  // Does this person hold any hat on the task — assignee, operator, editor
  // or designer?
  const holdsHat = (t, id) =>
    (t.assignees?.length ? t.assignees.includes(id) : t.assignee_id === id) ||
    t.operator_id === id || t.editor_id === id || t.designer_id === id

  // ---- the numbers: done, missed, upcoming, in one window ----------------
  // Scope: admins see everything (narrowable by person), everyone else only
  // the tasks where they hold a hat. The project filter narrows both.
  const scoped = useMemo(() => alive.filter((t) =>
    (isAdmin ? (!person || holdsHat(t, person)) : holdsHat(t, user.id)) &&
    (!project || projectOf(t) === project)),
  [alive, isAdmin, person, project, campById]) // eslint-disable-line react-hooks/exhaustive-deps

  // A task's next own deadline: release, un-met edit/design dates, or the
  // shoot when nothing else is set.
  const nextDeadline = (t) =>
    [t.release_date, !t.ready_at ? t.edit_ready_date : null, !t.ready_at ? t.design_ready_date : null]
      .filter(Boolean).sort()[0] || t.recording_date

  // Calendar-honest windows: weeks start Monday, months and the year run
  // their real span. Done and missed look at the past side of the window,
  // upcoming at the future side — so "this week" shows both at once.
  const STAT_RANGES = [
    { key: 'today', label: 'Today' },
    { key: 'tweek', label: 'This week' },
    { key: 'lweek', label: 'Last week' },
    { key: 'tmonth', label: 'This month' },
    { key: 'lmonth', label: 'Last month' },
    { key: '6mo', label: '6 months' },
    { key: 'tyear', label: 'This year' },
    { key: 'custom', label: 'Custom…' },
  ]
  const stats = useMemo(() => {
    const mondayOf = (iso) => addDaysISO(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7))
    const monthEndOf = (iso) => {
      const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`)
      d.setUTCMonth(d.getUTCMonth() + 1)
      d.setUTCDate(0)
      return d.toISOString().slice(0, 10)
    }
    const monday = mondayOf(today)
    const prevMonth = (() => {
      const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`)
      d.setUTCDate(0)
      return d.toISOString().slice(0, 10)
    })()
    const WINDOWS = {
      today: [today, today],
      tweek: [monday, addDaysISO(monday, 6)],
      lweek: [addDaysISO(monday, -7), addDaysISO(monday, -1)],
      tmonth: [`${today.slice(0, 8)}01`, monthEndOf(today)],
      lmonth: [`${prevMonth.slice(0, 8)}01`, prevMonth],
      '6mo': [addDaysISO(today, -180), today],
      tyear: [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`],
      custom: [statFrom || null, statTo || null],
    }
    const [lo, hi] = WINDOWS[statRange] || WINDOWS.tweek
    const pastHi = hi && hi > today ? today : hi
    const futLo = lo && lo < today ? today : lo
    const inWin = (d, a, b) => d && (!a || d >= a) && (!b || d <= b)
    const done = scoped.filter((t) => t.done_at && inWin(tashkentDay(t.done_at), lo, pastHi)).length
    const missedN = scoped.flatMap((t) => entriesOf(t, today))
      .filter((e) => (isAdmin ? (!person || e.who.includes(person)) : e.who.includes(user.id)))
      .filter((e) => inWin(e.date, lo, pastHi)).length
    const upcoming = hi && hi < today ? 0
      : scoped.filter((t) => !t.done_at && inWin(nextDeadline(t), futLo, hi)).length
    const openNow = scoped.filter((t) => !t.done_at).length
    return { done, missedN, upcoming, openNow }
  }, [scoped, statRange, statFrom, statTo, today, isAdmin, person, user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- published, by channel: how many items went out in a window --------
  // "Published" = reached the final stage (done_at stamped). Counted on the
  // team's Tashkent clock, grouped per channel, filterable by type.
  const PUB_TYPES = [
    { key: 'all', label: 'All' }, { key: 'post', label: 'Post' }, { key: 'reel', label: 'Reel' },
    { key: 'story', label: 'Story' }, { key: 'video', label: 'Video' },
  ]
  const published = useMemo(() => {
    const finalId = (statuses.find((s) => s.is_final) || {}).id ?? null
    const mondayOf = (iso) => addDaysISO(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7))
    const monthEndOf = (iso) => {
      const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`)
      d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0)
      return d.toISOString().slice(0, 10)
    }
    const monday = mondayOf(today)
    const prevMonth = (() => {
      const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`)
      d.setUTCDate(0)
      return d.toISOString().slice(0, 10)
    })()
    const WINDOWS = {
      today: [today, today],
      tweek: [monday, addDaysISO(monday, 6)],
      lweek: [addDaysISO(monday, -7), addDaysISO(monday, -1)],
      tmonth: [`${today.slice(0, 8)}01`, monthEndOf(today)],
      lmonth: [`${prevMonth.slice(0, 8)}01`, prevMonth],
      '6mo': [addDaysISO(today, -180), today],
      tyear: [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`],
      custom: [statFrom || null, statTo || null],
    }
    const [lo, hi] = WINDOWS[statRange] || WINDOWS.tweek
    const inWin = (d) => d && (!lo || d >= lo) && (!hi || d <= hi)
    const rows = {}
    let total = 0
    for (const t of content) {
      if (!t.done_at) continue
      if (finalId != null && t.status_id !== finalId) continue
      if (pubType !== 'all' && t.type !== pubType) continue
      if (!inWin(tashkentDay(t.done_at))) continue
      total++
      for (const c of t.channels) rows[c] = (rows[c] || 0) + 1
    }
    const list = Object.entries(rows).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n)
    return { list, total, max: list[0]?.n || 1, lo, hi }
  }, [content, statuses, statRange, statFrom, statTo, pubType, today])

  // Projects offered in the filter: all of them for admins, only the ones
  // holding your visible tasks for everyone else.
  const projectChoices = useMemo(() => {
    if (isAdmin) return projects
    const minePr = new Set(content.filter((t) => holdsHat(t, user.id)).map(projectOf).filter(Boolean))
    return projects.filter((pr) => minePr.has(pr.id))
  }, [projects, content, isAdmin, user.id, campById]) // eslint-disable-line react-hooks/exhaustive-deps

  // Every miss I answer for — as head, operator or editor of the entry.
  const missedAll = useMemo(
    () => alive.flatMap((t) => entriesOf(t, today)).filter((e) => isAdmin || e.who.includes(user.id)),
    [alive, today, isAdmin, user.id])

  // Period first (it scopes everything, counts included) …
  const inRange = useMemo(() => {
    let lo = null, hi = null
    const r = RANGES.find((x) => x.key === range)
    if (r?.days) lo = addDaysISO(today, -r.days)
    if (range === 'custom') { lo = from || null; hi = to || null }
    return missedAll.filter((e) => (!lo || e.date >= lo) && (!hi || e.date <= hi))
  }, [missedAll, range, from, to, today])

  // … then who and where, with live counts on every pill.
  const chanCounts = useMemo(() => {
    const m = {}
    for (const e of inRange) {
      if (person && !e.who.includes(person)) continue
      for (const c of e.t.channels) m[c] = (m[c] || 0) + 1
    }
    return m
  }, [inRange, person])
  // Per person, in the current period + channel: total, still open, done late.
  const personStats = useMemo(() => {
    const m = {}
    for (const e of inRange) {
      if (chan !== 'all' && !e.t.channels.includes(chan)) continue
      for (const id of e.who) {
        const s = (m[id] ||= { n: 0, open: 0, late: 0 })
        s.n++
        if (e.mark) s.late++
        else s.open++
      }
    }
    return m
  }, [inRange, chan])
  const personCounts = useMemo(
    () => Object.fromEntries(Object.entries(personStats).map(([id, s]) => [id, s.n])),
    [personStats])

  const missed = useMemo(
    () => inRange.filter((e) =>
      (chan === 'all' || e.t.channels.includes(chan)) &&
      (!person || e.who.includes(person)) &&
      (!project || projectOf(e.t) === project)),
    [inRange, chan, person, project, campById]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = useMemo(
    () => missed.filter((e) => !e.mark).sort((a, b) => a.date.localeCompare(b.date)),
    [missed])
  const late = useMemo(
    () => missed.filter((e) => e.mark).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50),
    [missed])

  // The person with the most misses in the current scope.
  const worst = useMemo(() => {
    if (!isAdmin) return null
    let best = null
    for (const [id, n] of Object.entries(personCounts))
      if (!best || n > best.n) best = { id: Number(id), n }
    return best && usersById[best.id] ? { ...best, name: usersById[best.id].name.split(' ')[0] } : null
  }, [personCounts, usersById, isAdmin])

  // Every channel is offered, not only the guilty ones.
  const allChans = useMemo(() => {
    const keys = channels.map((c) => c.key)
    for (const k of Object.keys(chanCounts)) if (!keys.includes(k)) keys.push(k)
    return keys.sort((a, b) => (chanCounts[b] || 0) - (chanCounts[a] || 0))
  }, [channels, chanCounts])

  const updateContent = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    setContent((prev) => prev.map((x) => (x.id === item.id ? u : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
  }

  // Right-click: resolve or clear a miss without opening it.
  const { openMenu } = useContextMenu()
  const rowMenu = (e, item) => openMenu(e, [
    { label: 'Open', icon: PenLine, onClick: () => setOpenItem(item) },
    { label: item.done_at ? 'Mark as not done' : 'Mark as done', icon: CheckCircle2, onClick: () => updateContent(item, { done: !item.done_at }).then(() => toast('Saved — synced')).catch((err) => alert(err.message)) },
    { sep: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => { if (confirm(`Delete “${item.title}”?`)) deleteContent(item).catch((err) => alert(err.message)) } },
  ])

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const activePeople = Object.keys(personCounts).map(Number)
    .sort((a, b) => (personCounts[b] || 0) - (personCounts[a] || 0))

  return (
    <>
      <div className="card card-pad brief-hero">
        <div className="brief-hello"><BarChart3 size={17} /> Statistics</div>
        <h2 className="brief-title">
          {isAdmin ? 'The whole team: ' : ''}
          {missed.length === 0
            ? 'nothing missed — clean record.'
            : `${open.length} still not done · ${late.length} finished late`}
        </h2>
        <div className="stat-sub" style={{ marginTop: 4 }}>
          Done, upcoming and missed — across every task {isAdmin ? 'of the team' : 'assigned to you'},
          each judged by its own clock: release, edit-ready, design-ready.
        </div>
      </div>

      {/* ---- the numbers: one window, four honest counts ---- */}
      <div className="card card-pad stats-card">
        <div className="docs-sec-head">
          <h2><BarChart3 size={17} /> The numbers</h2>
          <div className="docs-up">
            <div className="pill-group">
              {STAT_RANGES.map((r) => (
                <button key={r.key} className={'pill' + (statRange === r.key ? ' active' : '')} onClick={() => setStatRange(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
            {statRange === 'custom' && (
              <span className="miss-custom">
                <input className="input" type="date" value={statFrom} onChange={(e) => setStatFrom(e.target.value)} />
                <span className="drow-dash">–</span>
                <input className="input" type="date" value={statTo} onChange={(e) => setStatTo(e.target.value)} />
              </span>
            )}
          </div>
        </div>
        {(isAdmin || projectChoices.length > 0) && (
          <div className="stats-filters">
            {isAdmin && (
              <select className="select" value={person} data-tip="Only this person's work"
                onChange={(e) => setPerson(Number(e.target.value))}>
                <option value={0}>Everyone</option>
                {[...users].sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            )}
            {projectChoices.length > 0 && (
              <select className="select" value={project} data-tip="Only tasks tied to this project's campaigns"
                onChange={(e) => setProject(Number(e.target.value))}>
                <option value={0}>All projects</option>
                {projectChoices.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
              </select>
            )}
          </div>
        )}
        <div className="miss-stats">
          <div className="miss-stat stat-done"><b>{stats.done}</b><span>done</span></div>
          <div className="miss-stat stat-up"><b>{stats.upcoming}</b><span>upcoming</span></div>
          <div className="miss-stat stat-missed"><b style={stats.missedN ? { color: '#A32D2D' } : undefined}>{stats.missedN}</b><span>missed</span></div>
          <div className="miss-stat"><b>{stats.openNow}</b><span>open now</span></div>
        </div>

        {/* Published, by channel — same window as the tiles above; only the
            content type is its own little filter. */}
        <div className="pub-head">
          <h3><Send size={14} /> Published by channel</h3>
          <div className="pub-types">
            {PUB_TYPES.map((t) => (
              <button key={t.key} className={'pill' + (pubType === t.key ? ' active' : '')} onClick={() => setPubType(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {published.total === 0 ? (
          <div className="tt-none" style={{ padding: '4px 0 0' }}>Nothing published in this window.</div>
        ) : (
          <div className="pub-list">
            {published.list.map((r) => (
              <div key={r.key} className="pub-row">
                <span className="pub-name">{byKey[r.key]?.label || r.key}</span>
                <span className="pub-bar"><span style={{ width: `${Math.round((r.n / published.max) * 100)}%` }} /></span>
                <b className="pub-n">{r.n}</b>
              </div>
            ))}
            <div className="stat-sub" style={{ marginTop: 8 }}>
              {published.total} item{published.total === 1 ? '' : 's'} published · counted on Asia/Tashkent time.
            </div>
          </div>
        )}
      </div>

      {isAdmin && <PipelineBlame />}

      <div className="section-head" style={{ marginTop: 6 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><AlertTriangle size={16} /> Missed deadlines</h2>
      </div>

      {/* Period: a day, a week, a month, or any dates you pick */}
      <div className="miss-filters">
        <span className="miss-f-label"><CalendarRange size={14} /> Period</span>
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

      {/* Where and who — live counts on every pill; every channel is listed */}
      {(allChans.length > 1 || chan !== 'all') && (
        <div className="miss-filters">
          <span className="miss-f-label">Channel</span>
          <div className="pill-group">
            <button className={'pill' + (chan === 'all' ? ' active' : '')} onClick={() => setChan('all')}>
              All <b className="pill-n">{inRange.filter((e) => !person || e.who.includes(person)).length}</b>
            </button>
            {allChans.map((c) => (
              <button key={c} className={'pill' + (chan === c ? ' active' : '') + (chanCounts[c] ? '' : ' pill-zero')}
                onClick={() => setChan(chan === c ? 'all' : c)}>
                {byKey[c]?.label || c} <b className="pill-n">{chanCounts[c] || 0}</b>
              </button>
            ))}
          </div>
        </div>
      )}
      {isAdmin && (activePeople.length > 0 || person !== 0) && (
        <div className="miss-filters">
          <span className="miss-f-label">Person</span>
          <div className="pill-group">
            <button className={'pill' + (person === 0 ? ' active' : '')} onClick={() => setPerson(0)}>Everyone</button>
            {activePeople.map((id) => {
              const u = usersById[id]
              if (!u) return null
              return (
                <button key={id} className={'pill pill-person' + (person === id ? ' active' : '')}
                  onClick={() => setPerson(person === id ? 0 : id)}>
                  <Avatar name={u.name} color={u.color} src={u.avatar} size="xs" />
                  {u.name.split(' ')[0]} <b className="pill-n">{personCounts[id]}</b>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* The numbers for the chosen period */}
      {/* One tile says how the period looks; the lists below carry the rest
          (their headers already count "still not done" and "finished late"). */}
      <div className="miss-stats">
        <div className="miss-stat">
          <b>{missed.length}</b>
          <span>missed in this period</span>
        </div>
        {worst && worst.n > 0 && (
          <button className="miss-stat miss-stat-btn" data-tip="See exactly which ones, below"
            onClick={() => setOpenPerson(openPerson === worst.id ? 0 : worst.id)}>
            <b>{worst.name}</b>
            <span>most misses · {worst.n}</span>
          </button>
        )}
      </div>

      {/* Who missed how many — the report for the chosen period. */}
      {isAdmin && activePeople.length > 0 && (
        <div className="card card-pad miss-report">
          <div className="pc-check-head" style={{ marginBottom: 8 }}>
            <h3>Misses by person</h3>
            <span className="stat-sub">
              {range === 'custom'
                ? `${from || 'start'} → ${to || 'today'}`
                : RANGES.find((r) => r.key === range)?.label.toLowerCase()}
              {chan !== 'all' ? ` · ${byKey[chan]?.label || chan}` : ''}
            </span>
          </div>
          {activePeople.map((id) => {
            const u = usersById[id]
            const s = personStats[id]
            if (!u || !s) return null
            const max = personCounts[activePeople[0]] || 1
            const opened = openPerson === id
            return (
              <div key={id}>
                <button className={'miss-person-row' + (opened ? ' on' : '')}
                  onClick={() => setOpenPerson(opened ? 0 : id)}>
                  <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
                  <span className="miss-person-name">{u.name}</span>
                  <span className="miss-person-bar">
                    <span style={{ width: `${Math.round((s.n / max) * 100)}%` }} />
                  </span>
                  <b className="miss-person-n">{s.n}</b>
                  <span className="miss-person-split">
                    <span className="mp-open">{s.open} open</span>
                    <span className="mp-late">{s.late} late</span>
                  </span>
                  <ChevronDown size={14} className={'miss-person-chev' + (opened ? ' open' : '')} />
                </button>
                {/* The receipts: exactly which deadlines this person missed,
                    right under their name — no scrolling off to find them. */}
                {opened && (
                  <div className="miss-person-tasks">
                    {inRange
                      .filter((e) => e.who.includes(id) &&
                        (chan === 'all' || e.t.channels.includes(chan)) &&
                        (!project || projectOf(e.t) === project))
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .slice(0, 30)
                      .map((e) => (
                        <MissRow key={`${e.t.id}-${e.kind}`} entry={e} today={today} byKey={byKey}
                          usersById={usersById} isAdmin={false} onOpen={setOpenItem} onMenu={rowMenu} />
                      ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="section-head">
        <AlertTriangle size={17} style={{ color: '#A32D2D' }} />
        <h2 style={{ color: '#A32D2D' }}>Still not done</h2>
        <span className="count">· {open.length}</span>
      </div>
      {open.length === 0 ? (
        <div className="card card-pad empty">Nothing overdue and undone. Keep it that way.</div>
      ) : (
        <div className="card card-pad brief-list">
          {open.map((e) => (
            <MissRow key={`${e.t.id}-${e.kind}`} entry={e} today={today} byKey={byKey} usersById={usersById} isAdmin={isAdmin} onOpen={setOpenItem} onMenu={rowMenu} />
          ))}
        </div>
      )}

      <div className="section-head">
        <CheckCircle2 size={17} style={{ color: 'var(--good-ink, #0ca30c)' }} />
        <h2>Finished, but late</h2>
        <span className="count">· {late.length}</span>
      </div>
      {late.length === 0 ? (
        <div className="card card-pad empty">No late finishes on record.</div>
      ) : (
        <div className="card card-pad brief-list">
          {late.map((e) => (
            <MissRow key={`${e.t.id}-${e.kind}`} entry={e} today={today} byKey={byKey} usersById={usersById} isAdmin={isAdmin} onOpen={setOpenItem} onMenu={rowMenu} />
          ))}
        </div>
      )}

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
