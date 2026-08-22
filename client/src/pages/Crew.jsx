import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Clapperboard, Scissors, AlertTriangle, Clock, Pencil, Check, LayoutGrid, CalendarDays, Rows3, Palette, CheckCircle2, RotateCcw,
} from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, addDaysISO, dateLabel, scheduleLabel, WORK_DAYS, isDeletedLabel, tashkentDay } from '../lib/constants.js'
import Avatar from '../components/Avatar.jsx'
import Modal from '../components/Modal.jsx'
import ContentModal from '../components/ContentModal.jsx'
import { useContextMenu } from '../components/ContextMenu.jsx'
import { toast, loadFailed } from '../lib/toast.js'
import { rewardIfFinished } from '../lib/reward.js'

// Post Production — the admin's view of everyone who MAKES the content, in
// two sub-pages:
//   Editors & shooters — deck / timetable / list of shoots and cuts, with a
//     person filter; load is real, not guessed — booked shoot hours against
//     each person's working schedule.
//   Designers — one card per designer: designs in work, due this week,
//     overdue against the design deadline, done in the last 30 days.
// Every task block wears its channel, so you never have to open it to know
// where it goes.

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const SHOOT_MIN = 60 // a shoot without an end time blocks one hour
const DEFAULT_DAYS = [1, 2, 3, 4, 5] // Mon–Fri when no schedule is set
const DEFAULT_HOURS = 8 * 60

const crewWord = (u) => {
  const caps = u.crew_roles || []
  if (caps.length === 0) return null
  return caps.map((c) => c[0].toUpperCase() + c.slice(1)).join(' & ')
}

// ---- per-designer workload ----
function designWorkOf(u, content, today) {
  const mine = content.filter((t) => t.designer_id === u.id)
  const open = mine.filter((t) => !t.done_at)
    .sort((a, b) => (a.design_ready_date || a.release_date || '9999').localeCompare(b.design_ready_date || b.release_date || '9999'))
  const overdue = open.filter((t) => t.design_ready_date && t.design_ready_date < today && !t.ready_at)
  const week = open.filter((t) => t.design_ready_date && t.design_ready_date >= today && t.design_ready_date < addDaysISO(today, 7))
  const done30 = mine.filter((t) => t.done_at && tashkentDay(t.done_at) >= addDaysISO(today, -30))
  return { open, overdue, week, done30 }
}

// ---- per-member workload over the next 7 days ----
function workloadOf(u, content, today) {
  const days = []
  const wdays = Array.isArray(u.work_days) && u.work_days.length ? u.work_days : DEFAULT_DAYS
  const dayCap = u.work_start && u.work_end ? toMin(u.work_end) - toMin(u.work_start) : DEFAULT_HOURS
  let booked = 0
  let capacity = 0
  let clashes = 0
  for (let i = 0; i < 7; i++) {
    const iso = addDaysISO(today, i)
    const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay()
    const working = wdays.includes(weekday)
    if (working) capacity += dayCap
    const shoots = content
      .filter((t) => t.operator_id === u.id && !t.done_at && t.recording_date === iso)
      .sort((a, b) => (a.recording_time || '99').localeCompare(b.recording_time || '99'))
    let mins = 0
    for (let s = 0; s < shoots.length; s++) {
      const a = shoots[s]
      const as = a.recording_time ? toMin(a.recording_time) : null
      const ae = a.recording_end ? toMin(a.recording_end) : as !== null ? as + SHOOT_MIN : null
      mins += as !== null ? ae - as : SHOOT_MIN
      for (let z = s + 1; z < shoots.length; z++) {
        const b = shoots[z]
        if (as === null || !b.recording_time) continue
        const bs = toMin(b.recording_time)
        const be = b.recording_end ? toMin(b.recording_end) : bs + SHOOT_MIN
        if (as < be && bs < ae) clashes++
      }
    }
    booked += mins
    days.push({ iso, working, shoots, mins })
  }
  const edits = content.filter((t) => t.editor_id === u.id && !t.done_at)
    .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'))
  const overdue = content.filter((t) =>
    !t.done_at && t.release_date && t.release_date < today &&
    (t.assignee_id === u.id || t.operator_id === u.id || t.editor_id === u.id))
  const pct = capacity > 0 ? booked / capacity : 0
  const level = pct >= 0.8 || edits.length >= 6 ? 'hot' : pct <= 0.3 && edits.length <= 2 ? 'free' : 'ok'
  return { days, booked, capacity, pct, clashes, edits, overdue, level }
}

const LEVELS = {
  hot: { label: 'Overloaded', cls: 'load-hot' },
  ok: { label: 'Balanced', cls: 'load-ok' },
  free: { label: 'Has capacity', cls: 'load-free' },
}
const hrs = (min) => (min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h${min % 60}`)

/* Admin sets a member's schedule right from the deck. */
function ScheduleModal({ member, onClose, onSaved }) {
  const [days, setDays] = useState(() => (Array.isArray(member.work_days) ? member.work_days : []))
  const [start, setStart] = useState(member.work_start || '')
  const [end, setEnd] = useState(member.work_end || '')
  const [err, setErr] = useState('')
  const toggle = (d) => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()))
  const save = async () => {
    setErr('')
    try {
      const u = await api.patch(`/users/${member.id}`, {
        work_start: start || null, work_end: end || null, work_days: days.length ? days : null,
      })
      toast('Schedule saved — synced')
      onSaved(u)
      onClose()
    } catch (e) { setErr(e.message) }
  }
  return (
    <Modal title={`${member.name} — working schedule`} onClose={onClose}
      footer={<>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Check size={15} /> Save schedule</button>
      </>}>
      {err && <div className="form-error">{err}</div>}
      <div className="stat-sub" style={{ marginBottom: 10 }}>
        Shoots for {member.name.split(' ')[0]} can only be booked inside these hours.
      </div>
      <div className="wd-row">
        {WORK_DAYS.map((d) => (
          <button key={d.n} type="button" className={'wd-chip' + (days.includes(d.n) ? ' on' : '')} onClick={() => toggle(d.n)}>
            {d.label}
          </button>
        ))}
      </div>
      <div className="sched-hours">
        <label className="sched-field">from
          <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="sched-field">to
          <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
    </Modal>
  )
}

const VIEWS = [
  { key: 'deck', label: 'Deck', icon: LayoutGrid },
  { key: 'week', label: 'Timetable', icon: CalendarDays },
  { key: 'list', label: 'List', icon: Rows3 },
]

export default function Crew() {
  const { user } = useAuth()
  const { byKey } = useChannels()
  const [boot] = useState(() => cache.get('crew'))
  const [content, setContent] = useState(boot?.content || [])
  const [users, setUsers] = useState(boot?.users || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  const [loading, setLoading] = useState(!boot)
  const [openItem, setOpenItem] = useState(null)
  const [schedFor, setSchedFor] = useState(null)
  // Killed pieces (Deleted stage) are nobody's workload — drop them before
  // any shoots/edits/design math runs.
  const live = useMemo(() => {
    const dead = new Set(statuses.filter((s) => isDeletedLabel(s.label)).map((s) => s.id))
    return content.filter((t) => !dead.has(t.status_id))
  }, [content, statuses])
  const [view, setViewState] = useState(() => localStorage.getItem('satashkent_crew_view') || 'deck')
  const setView = (v) => { setViewState(v); localStorage.setItem('satashkent_crew_view', v) }
  // The design sub-page keeps its own view choice — deck of cards or the grid.
  const [dview, setDviewState] = useState(() => localStorage.getItem('satashkent_crew_dview') || 'deck')
  const setDview = (v) => { setDviewState(v); localStorage.setItem('satashkent_crew_dview', v) }
  const [tab, setTabState] = useState(() => localStorage.getItem('satashkent_pp_tab') || 'video')
  const setTab = (t) => { setTabState(t); setWho(0); localStorage.setItem('satashkent_pp_tab', t) }
  const [who, setWho] = useState(0) // 0 = everyone
  // Every OPEN Pravki across the team — who owes changes, worn as chips.
  const [openRevs, setOpenRevs] = useState([])

  useEffect(() => {
    Promise.all([api.get('/content'), api.get('/users'), api.cached('/statuses')])
      .then(([ct, us, st]) => {
        setContent(ct); setUsers(us); setStatuses(st)
        cache.set('crew', { content: ct.map(({ photo_thumb: _t, ...r }) => r), users: us, statuses: st })
      })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    if (user.role === 'admin') api.get('/content/open-revisions').then(setOpenRevs).catch(() => {})
  }, [user.role])
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || openItem || schedFor) return
      api.poll('/content').then((f) => { if (f) setContent(f) }).catch(() => {})
      if (user.role === 'admin') api.pollView('/content/open-revisions').then((f) => { if (f) setOpenRevs(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    return () => clearInterval(id)
  }, [openItem, schedFor, user.role])

  const today = todayISO()
  // Open change-requests per person — the chip every card wears.
  const pravkiBy = useMemo(() => {
    const m = new Map()
    for (const r of openRevs) if (r.person_id) m.set(r.person_id, (m.get(r.person_id) || 0) + 1)
    return m
  }, [openRevs])

  // Only the crew proper: accounts holding the capability. Members who merely
  // hold a hat on some task still show on that task everywhere else — but
  // they are not columns on this page.
  const crewAll = useMemo(
    () => users.filter((u) => (u.crew_roles || []).some((r) => r === 'operator' || r === 'editor')),
    [users])
  const designersAll = useMemo(
    () => users.filter((u) => (u.crew_roles || []).includes('designer')),
    [users])
  const designers = who ? designersAll.filter((u) => u.id === who) : designersAll
  const crew = who ? crewAll.filter((u) => u.id === who) : crewAll

  const loads = useMemo(() => {
    const m = new Map()
    for (const u of crewAll) m.set(u.id, workloadOf(u, live, today))
    return m
  }, [crewAll, live, today])

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(today, i)), [today])

  const updateContent = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    rewardIfFinished(item, u)
    setContent((prev) => prev.map((x) => (x.id === item.id ? u : x)))
  }
  // Right-click a shoot or edit block: the quick verbs.
  const { openMenu } = useContextMenu()
  const blockMenu = (e, t) => openMenu(e, [
    { label: 'Open', icon: Pencil, onClick: () => setOpenItem(t) },
    { label: t.done_at ? 'Mark as not done' : 'Mark as done', icon: Check, onClick: () => updateContent(t, { done: !t.done_at }).catch((err) => alert(err.message)) },
  ])
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
  }

  // ---- drag a block to rebook it ----
  // A shoot dropped on another day moves the shoot; dropped on another
  // person's row it changes the operator too. An edit-due card moves the
  // edit deadline / the editor the same way. The Late tray above the grid
  // holds work whose date already slipped out of the week — drag it back in.
  const dragInfo = useRef(null) // { id, kind: 'shoot' | 'edit' }
  const [dropCell, setDropCell] = useState(null)
  const startDrag = (e, t, kind) => {
    dragInfo.current = { id: t.id, kind }
    try { e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
  }
  const endDrag = () => { dragInfo.current = null; setDropCell(null) }
  const overCell = (e, key) => {
    if (!dragInfo.current) return
    e.preventDefault()
    if (dropCell !== key) setDropCell(key)
  }
  // personId null = keep whoever holds the hat (day-only drops in the List).
  const dropTask = async (personId, iso) => {
    const drag = dragInfo.current
    endDrag()
    if (!drag) return
    const t = content.find((x) => x.id === drag.id)
    if (!t) return
    const patch = {}
    if (drag.kind === 'shoot') {
      if ((t.recording_date || null) !== iso) patch.recording_date = iso
      if (personId && t.operator_id !== personId) patch.operator_id = personId
    } else if (drag.kind === 'design') {
      if ((t.design_ready_date || null) !== iso) patch.design_ready_date = iso
      if (personId && t.designer_id !== personId) patch.designer_id = personId
    } else {
      if ((t.edit_ready_date || null) !== iso) patch.edit_ready_date = iso
      if (personId && t.editor_id !== personId) patch.editor_id = personId
    }
    if (Object.keys(patch).length === 0) return
    // Remember what the drop overwrote, so the toast can take it back.
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, t[k] ?? null]))
    try {
      await updateContent(t, patch)
      toast(drag.kind === 'shoot' ? 'Shoot rebooked — synced' : drag.kind === 'design' ? 'Design deadline moved — synced' : 'Edit deadline moved — synced', 'ok', {
        label: 'Undo',
        onClick: () => updateContent(t, before)
          .then(() => toast('Put back — synced'))
          .catch((e) => alert(e.message)),
      })
    } catch (e) { alert(e.message) }
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const totalShoots = crew.reduce((n, u) => n + loads.get(u.id).days.reduce((x, d) => x + d.shoots.length, 0), 0)
  const hot = crew.filter((u) => loads.get(u.id).level === 'hot')
  const free = crew.filter((u) => loads.get(u.id).level === 'free')

  const dTotals = designersAll.reduce((acc, u) => {
    const w = designWorkOf(u, live, today)
    acc.open += w.open.length
    acc.overdue += w.overdue.length
    return acc
  }, { open: 0, overdue: 0 })

  return (
    <>
      <div className="card card-pad brief-hero">
        <div className="brief-hello"><Clapperboard size={17} /> Post Production{tab === 'video' ? ' — video, next 7 days' : ' — design'}</div>
        <h2 className="brief-title">
          {tab === 'video' ? (
            crewAll.length === 0 ? 'No crew yet — give someone the operator or editor role.' : (
              <>
                {crew.length} {who ? 'selected' : 'on the crew'} · {totalShoots} shoot{totalShoots === 1 ? '' : 's'} booked
                {hot.length > 0 && <> · <span style={{ color: '#A32D2D' }}>{hot.map((u) => u.name.split(' ')[0]).join(', ')} overloaded</span></>}
                {free.length > 0 && <> · {free.map((u) => u.name.split(' ')[0]).join(', ')} free</>}
              </>
            )
          ) : (
            designersAll.length === 0 ? 'No designers yet — give someone the designer role.' : (
              <>
                {designersAll.length} designer{designersAll.length === 1 ? '' : 's'} · {dTotals.open} design{dTotals.open === 1 ? '' : 's'} in work
                {dTotals.overdue > 0 && <> · <span style={{ color: '#A32D2D' }}>{dTotals.overdue} overdue</span></>}
                {openRevs.filter((r) => r.target === 'designer').length > 0 && (
                  <> · <span style={{ color: '#A32D2D' }}>{openRevs.filter((r) => r.target === 'designer').length} change{openRevs.filter((r) => r.target === 'designer').length === 1 ? '' : 's'} requested</span></>
                )}
              </>
            )
          )}
        </h2>
      </div>

      {/* sub-page first, then the view + person controls */}
      <div className="miss-filters">
        <div className="pill-group pp-tabs">
          <button className={'pill' + (tab === 'video' ? ' active' : '')} onClick={() => setTab('video')}>
            <Clapperboard size={14} /> Editors & shooters
          </button>
          <button className={'pill' + (tab === 'design' ? ' active' : '')} onClick={() => setTab('design')}>
            <Palette size={14} /> Designers
          </button>
        </div>
        {tab === 'design' && (
          <div className="pill-group">
            {[{ key: 'deck', label: 'Deck', icon: LayoutGrid }, { key: 'week', label: 'Timetable', icon: CalendarDays }].map((v) => {
              const Icon = v.icon
              return (
                <button key={v.key} className={'pill' + (dview === v.key ? ' active' : '')} onClick={() => setDview(v.key)}>
                  <Icon size={14} /> {v.label}
                </button>
              )
            })}
          </div>
        )}
        {tab === 'video' && (
          <div className="pill-group">
            {VIEWS.map((v) => {
              const Icon = v.icon
              return (
                <button key={v.key} className={'pill' + (view === v.key ? ' active' : '')} onClick={() => setView(v.key)}>
                  <Icon size={14} /> {v.label}
                </button>
              )
            })}
          </div>
        )}
        {(tab === 'video' ? crewAll : designersAll).length > 0 && (
          <div className="pill-group">
            <button className={'pill' + (who === 0 ? ' active' : '')} onClick={() => setWho(0)}>Everyone</button>
            {(tab === 'video' ? crewAll : designersAll).map((u) => (
              <button key={u.id} className={'pill pill-person' + (who === u.id ? ' active' : '')}
                onClick={() => setWho(who === u.id ? 0 : u.id)}>
                <Avatar name={u.name} color={u.color} src={u.avatar} size="xs" /> {u.name.split(' ')[0]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---- Designers: one card per designer, judged by the design date ---- */}
      {tab === 'design' && dview === 'deck' && designers.map((u) => {
        const w = designWorkOf(u, live, today)
        return (
          <div key={u.id} className="card crew-card">
            <div className="crew-head">
              <Avatar name={u.name} color={u.color} src={u.avatar} />
              <div className="crew-who">
                <b>{u.name}</b>
                <span className="stat-sub">{u.position || crewWord(u) || 'Designer'}</span>
              </div>
              {w.overdue.length > 0
                ? <span className="load-badge load-hot">{w.overdue.length} overdue</span>
                : <span className="load-badge load-free">On schedule</span>}
            </div>
            <div className="crew-nums">
              <span className="crew-num"><Palette size={13} /> {w.open.length} in work</span>
              <span className="crew-num"><CalendarDays size={13} /> {w.week.length} due this week</span>
              {w.overdue.length > 0 && <span className="crew-num crew-num-bad"><AlertTriangle size={13} /> {w.overdue.length} past the design date</span>}
              {(pravkiBy.get(u.id) || 0) > 0 && <span className="crew-num crew-num-bad"><RotateCcw size={13} /> {pravkiBy.get(u.id)} pravki waiting</span>}
              <span className="crew-num"><CheckCircle2 size={13} /> {w.done30.length} done in 30 days</span>
            </div>
            {w.open.length > 0 && (
              <div className="design-queue">
                {w.open.slice(0, 8).map((t) => {
                  const late = t.design_ready_date && t.design_ready_date < today && !t.ready_at
                  return (
                    <button key={t.id} className="ov-row" onClick={() => setOpenItem(t)} onContextMenu={(e) => blockMenu(e, t)}>
                      <span className={'crew-list-time crew-list-edit' + (late ? ' late-txt' : '')}>
                        <Palette size={13} /> {t.design_ready_date ? `Due ${dateLabel(t.design_ready_date)}` : 'No design date'}
                      </span>
                      <span className="ov-title">{t.title}</span>
                      <span className="ov-chips">
                        {t.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
                        {late && <span className="chip chip-danger">late</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      {tab === 'design' && designers.length === 0 && (
        <div className="card card-pad empty">Nobody to show.</div>
      )}

      {/* ---- The design week: designers × days, every card draggable ----
          Same grammar as the editors' grid: drop on a day to rebook the
          design deadline, on another designer's row to hand the artwork
          over; slipped work waits in the Late tray; every drop can Undo. */}
      {tab === 'design' && dview === 'week' && designers.length > 0 && (() => {
        const dIds = new Set(designers.map((u) => u.id))
        const lateDesigns = live.filter((t) => !t.done_at && !t.ready_at && dIds.has(t.designer_id) &&
          t.design_ready_date && t.design_ready_date < today)
        const nameOf = (id) => users.find((x) => x.id === id)?.name?.split(' ')[0] || '?'
        const wdaysOf = (u) => (Array.isArray(u.work_days) && u.work_days.length ? u.work_days : DEFAULT_DAYS)
        return (
          <>
            {lateDesigns.length > 0 && (
              <div className="cal-tray crew-late-tray">
                <span className="cal-tray-label"><AlertTriangle size={13} /> Late — drag onto a day to rebook</span>
                <div className="cal-tray-items">
                  {lateDesigns.map((t) => (
                    <div key={`ld${t.id}`} className="cal-tray-chip" draggable
                      onDragStart={(e) => startDrag(e, t, 'design')} onDragEnd={endDrag}
                      onClick={() => setOpenItem(t)} title={t.title}>
                      <Palette size={12} />
                      <span className="ev-txt">{t.title}</span>
                      <span className="chip chip-danger">{nameOf(t.designer_id)} · {dateLabel(t.design_ready_date)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="card table-wrap tt-wrap">
              <table className="crew-tt">
                <thead>
                  <tr>
                    <th className="tt-who-col" />
                    {week.map((iso) => (
                      <th key={iso} className={iso === today ? 'tt-today' : ''}>{dateLabel(iso)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {designers.map((u) => {
                    const wdays = wdaysOf(u)
                    return (
                      <tr key={u.id}>
                        <td className="tt-who-col">
                          <span className="tt-who">
                            <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
                            <span>
                              <b>{u.name.split(' ')[0]}</b>
                              <small>{(pravkiBy.get(u.id) || 0) > 0 ? `${pravkiBy.get(u.id)} pravki waiting` : (u.position || 'Designer')}</small>
                            </span>
                          </span>
                        </td>
                        {week.map((iso) => {
                          const working = wdays.includes(new Date(`${iso}T12:00:00Z`).getUTCDay())
                          const dues = live.filter((t) => t.designer_id === u.id && !t.done_at && !t.ready_at && t.design_ready_date === iso)
                          const cellKey = `d${u.id}|${iso}`
                          return (
                            <td key={iso}
                              className={(working ? '' : 'tt-off') + (iso === today ? ' tt-today' : '') + (dropCell === cellKey ? ' tt-drop' : '')}
                              onDragOver={(e) => overCell(e, cellKey)}
                              onDragLeave={() => { if (dropCell === cellKey) setDropCell(null) }}
                              onDrop={(e) => { e.preventDefault(); dropTask(u.id, iso) }}>
                              {!working && dues.length === 0 && <span className="tt-off-txt">off</span>}
                              {dues.map((t) => (
                                <button key={`d${t.id}`} className="tt-shoot tt-design" draggable
                                  onDragStart={(e) => startDrag(e, t, 'design')} onDragEnd={endDrag}
                                  onClick={() => setOpenItem(t)} onContextMenu={(e) => blockMenu(e, t)} title={t.title}>
                                  <b><Palette size={11} /> Design due</b>
                                  <span>{t.title}</span>
                                  <i className="tt-ch">{t.channels.map((c) => byKey[c]?.label || c).join(' · ')}</i>
                                </button>
                              ))}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      })()}

      {/* ---- Deck: one calm card per person ---- */}
      {tab === 'video' && view === 'deck' && crew.map((u) => {
        const w = loads.get(u.id)
        const lv = LEVELS[w.level]
        const sched = scheduleLabel(u)
        return (
          <div key={u.id} className="card crew-card">
            <div className="crew-head">
              <Avatar name={u.name} color={u.color} src={u.avatar} />
              <div className="crew-who">
                <b>{u.name}</b>
                <span className="stat-sub">
                  {[u.position || crewWord(u) || 'Member', sched].filter(Boolean).join(' · ')}
                  {!sched && <button className="lnk" onClick={() => setSchedFor(u)}>set the schedule</button>}
                </span>
              </div>
              <span className={`load-badge ${lv.cls}`}>{lv.label}</span>
              {user.role === 'admin' && (
                <button className="icon-btn" data-tip="Working schedule" data-tip-left="" aria-label="Edit schedule"
                  onClick={() => setSchedFor(u)}><Pencil size={14} /></button>
              )}
            </div>
            <div className="crew-meter">
              <div className="crew-meter-bar">
                <span className={`crew-meter-fill ${lv.cls}`} style={{ width: `${Math.min(100, Math.round(w.pct * 100))}%` }} />
              </div>
              <span className="crew-meter-txt">
                {hrs(w.booked)} of {hrs(w.capacity)} shoot hours booked
              </span>
            </div>
            <div className="crew-nums">
              <span className="crew-num"><Clapperboard size={13} /> {w.days.reduce((n, d) => n + d.shoots.length, 0)} shoots</span>
              <span className="crew-num"><Scissors size={13} /> {w.edits.length} in the cut</span>
              {w.overdue.length > 0 && <span className="crew-num crew-num-bad"><AlertTriangle size={13} /> {w.overdue.length} overdue</span>}
              {(pravkiBy.get(u.id) || 0) > 0 && <span className="crew-num crew-num-bad"><RotateCcw size={13} /> {pravkiBy.get(u.id)} pravki waiting</span>}
              {w.clashes > 0 && <span className="crew-num crew-num-bad"><Clock size={13} /> {w.clashes} time clash{w.clashes === 1 ? '' : 'es'}</span>}
              <span className="spacer" />
              <span className="stat-sub">next shoot: {(() => {
                const d = w.days.find((x) => x.shoots.length > 0)
                return d ? `${dateLabel(d.iso)}${d.shoots[0].recording_time ? ` ${d.shoots[0].recording_time}` : ''}` : '—'
              })()}</span>
            </div>
          </div>
        )
      })}

      {/* ---- Timetable: the big week grid, people × days ---- */}
      {tab === 'video' && view === 'week' && (() => {
        // Work whose date slipped out of the week is invisible on the grid —
        // the Late tray keeps it in hand, ready to be dragged onto a day.
        const crewIds = new Set(crew.map((u) => u.id))
        const lateShoots = live.filter((t) => !t.done_at && t.recording_date && t.recording_date < today && crewIds.has(t.operator_id))
        const lateCuts = live.filter((t) => !t.done_at && !t.ready_at && crewIds.has(t.editor_id) &&
          (t.edit_ready_date || t.release_date) && (t.edit_ready_date || t.release_date) < today)
        const nameOf = (id) => users.find((x) => x.id === id)?.name?.split(' ')[0] || '?'
        return (
          <>
            {(lateShoots.length > 0 || lateCuts.length > 0) && (
              <div className="cal-tray crew-late-tray">
                <span className="cal-tray-label"><AlertTriangle size={13} /> Late — drag onto a day to rebook</span>
                <div className="cal-tray-items">
                  {lateShoots.map((t) => (
                    <div key={`ls${t.id}`} className="cal-tray-chip" draggable
                      onDragStart={(e) => startDrag(e, t, 'shoot')} onDragEnd={endDrag}
                      onClick={() => setOpenItem(t)} title={t.title}>
                      <Clapperboard size={12} />
                      <span className="ev-txt">{t.title}</span>
                      <span className="chip chip-danger">{nameOf(t.operator_id)} · {dateLabel(t.recording_date)}</span>
                    </div>
                  ))}
                  {lateCuts.map((t) => (
                    <div key={`lc${t.id}`} className="cal-tray-chip" draggable
                      onDragStart={(e) => startDrag(e, t, 'edit')} onDragEnd={endDrag}
                      onClick={() => setOpenItem(t)} title={t.title}>
                      <Scissors size={12} />
                      <span className="ev-txt">{t.title}</span>
                      <span className="chip chip-danger">{nameOf(t.editor_id)} · {dateLabel(t.edit_ready_date || t.release_date)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
        <div className="card table-wrap tt-wrap">
          <table className="crew-tt">
            <thead>
              <tr>
                <th className="tt-who-col" />
                {week.map((iso) => (
                  <th key={iso} className={iso === today ? 'tt-today' : ''}>{dateLabel(iso)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {crew.map((u) => {
                const w = loads.get(u.id)
                return (
                  <tr key={u.id}>
                    <td className="tt-who-col">
                      <span className="tt-who">
                        <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
                        <span>
                          <b>{u.name.split(' ')[0]}</b>
                          <small>{u.work_start && u.work_end
                            ? `${u.work_start}–${u.work_end}`
                            : user.role === 'admin'
                              ? <button className="lnk" onClick={() => setSchedFor(u)}>set hours</button>
                              : 'no hours set'}</small>
                        </span>
                      </span>
                    </td>
                    {w.days.map((d) => {
                      const cuts = w.edits.filter((t) => (t.edit_ready_date || t.release_date) === d.iso)
                      const cellKey = `${u.id}|${d.iso}`
                      return (
                        <td key={d.iso}
                          className={(d.working ? '' : 'tt-off') + (d.iso === today ? ' tt-today' : '') + (dropCell === cellKey ? ' tt-drop' : '')}
                          onDragOver={(e) => overCell(e, cellKey)}
                          onDragLeave={() => { if (dropCell === cellKey) setDropCell(null) }}
                          onDrop={(e) => { e.preventDefault(); dropTask(u.id, d.iso) }}>
                          {!d.working && d.shoots.length === 0 && cuts.length === 0 && <span className="tt-off-txt">off</span>}
                          {d.shoots.map((s) => (
                            <button key={`s${s.id}`} className="tt-shoot" draggable
                              onDragStart={(e) => startDrag(e, s, 'shoot')} onDragEnd={endDrag}
                              onClick={() => setOpenItem(s)} onContextMenu={(e) => blockMenu(e, s)} title={s.title}>
                              <b><Clapperboard size={11} /> Shoot{s.recording_time ? ` · ${s.recording_time}${s.recording_end ? `–${s.recording_end}` : ''}` : ''}</b>
                              <span>{s.title}</span>
                              <i className="tt-ch">{s.channels.map((c) => byKey[c]?.label || c).join(' · ')}</i>
                            </button>
                          ))}
                          {cuts.map((t) => (
                            <button key={`e${t.id}`} className="tt-shoot tt-edit" draggable
                              onDragStart={(e) => startDrag(e, t, 'edit')} onDragEnd={endDrag}
                              onClick={() => setOpenItem(t)} onContextMenu={(e) => blockMenu(e, t)} title={t.title}>
                              <b><Scissors size={11} /> Edit due</b>
                              <span>{t.title}</span>
                              <i className="tt-ch">{t.channels.map((c) => byKey[c]?.label || c).join(' · ')}</i>
                            </button>
                          ))}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {crew.length === 0 && <div className="empty">Nobody to show.</div>}
        </div>
          </>
        )
      })()}

      {/* ---- List: the week as plain rows ---- */}
      {tab === 'video' && view === 'list' && (
        <div className="card card-pad" style={{ marginTop: 2 }}>
          {week.map((iso) => {
            const shoots = crew.flatMap((u) =>
              loads.get(u.id).days.find((d) => d.iso === iso).shoots.map((s) => ({ s, u })))
              .sort((a, b) => (a.s.recording_time || '99').localeCompare(b.s.recording_time || '99'))
            const cuts = crew.flatMap((u) =>
              loads.get(u.id).edits.filter((t) => (t.edit_ready_date || t.release_date) === iso).map((t) => ({ t, u })))
            if (shoots.length === 0 && cuts.length === 0) return null
            // A day group is a drop target too: dragging a row onto another
            // day rebooks the date and keeps the person.
            return (
              <div key={iso} className={'crew-list-day' + (dropCell === `day|${iso}` ? ' tt-drop' : '')}
                onDragOver={(e) => overCell(e, `day|${iso}`)}
                onDragLeave={() => { if (dropCell === `day|${iso}`) setDropCell(null) }}
                onDrop={(e) => { e.preventDefault(); dropTask(null, iso) }}>
                <div className="brief-h-head">{dateLabel(iso)}{iso === today ? ' · today' : ''}</div>
                {shoots.map(({ s, u }) => (
                  <button key={`s${s.id}`} className="ov-row" draggable
                    onDragStart={(e) => startDrag(e, s, 'shoot')} onDragEnd={endDrag}
                    onClick={() => setOpenItem(s)} onContextMenu={(e) => blockMenu(e, s)}>
                    <span className="crew-list-time"><Clapperboard size={13} /> Shoot{s.recording_time ? ` · ${s.recording_time}${s.recording_end ? `–${s.recording_end}` : ''}` : ''}</span>
                    <span className="ov-title">{s.title}</span>
                    <span className="ov-chips">
                      <span className="chip chip-muted">{u.name.split(' ')[0]}</span>
                      {s.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
                    </span>
                  </button>
                ))}
                {cuts.map(({ t, u }) => (
                  <button key={`c${t.id}`} className="ov-row" draggable
                    onDragStart={(e) => startDrag(e, t, 'edit')} onDragEnd={endDrag}
                    onClick={() => setOpenItem(t)} onContextMenu={(e) => blockMenu(e, t)}>
                    <span className="crew-list-time crew-list-edit"><Scissors size={13} /> Edit due</span>
                    <span className="ov-title">{t.title}</span>
                    <span className="ov-chips">
                      <span className="chip chip-muted">{u.name.split(' ')[0]}</span>
                      {t.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
                    </span>
                  </button>
                ))}
              </div>
            )
          })}
          {crew.every((u) => loads.get(u.id).days.every((d) => d.shoots.length === 0)) &&
            crew.every((u) => loads.get(u.id).edits.every((t) => !week.includes(t.release_date))) && (
            <div className="empty">Nothing booked this week.</div>
          )}
        </div>
      )}

      {schedFor && (
        <ScheduleModal member={schedFor} onClose={() => setSchedFor(null)}
          onSaved={(u) => setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)))} />
      )}
      {openItem && (
        <ContentModal item={openItem} statuses={statuses} onClose={() => setOpenItem(null)}
          onUpdate={updateContent} onDelete={deleteContent} />
      )}
    </>
  )
}
