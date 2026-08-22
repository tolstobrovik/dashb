import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Send, Clapperboard, AlertCircle, CalendarDays, Download } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { rewardIfFinished } from '../lib/reward.js'
import { toast, loadFailed } from '../lib/toast.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { can, todayISO, dateLabel, typeInfo, isDeletedLabel } from '../lib/constants.js'
import ContentModal from '../components/ContentModal.jsx'
import ContentCalendar from '../components/ContentCalendar.jsx'
import DayAgenda from '../components/DayAgenda.jsx'
import ContentFilters, { BLANK_FILTER, matchesFilter, filterIsOn } from '../components/ContentFilters.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// How many overdue chips the strip shows before it stops being a strip.
const LATE_SHOWN = 8

// Everything that comes OUT, and everything that gets SHOT — across every
// channel at once. The channel pages answer "what is happening on Instagram
// Main"; these answer the question the week actually starts with, which is
// "what are we releasing" and "what are we filming", wherever it lives.
//
// Both are calendars. A schedule is a shape before it is a list: you plan
// around the gaps, and a gap is something you SEE — a fortnight with nothing
// in it is invisible in a list of rows and obvious in a grid. Reading is the
// smaller half anyway; the working gesture is moving a day, and on a grid that
// is one drag from where it is to where it should be.
//
// One component, two modes. They differ only in which date they read and what
// the empty state says, so keeping them apart would be two copies of the same
// page drifting away from each other.

const MODES = {
  release: {
    label: tx('Releases'), icon: Send, dateField: 'release_date', timeField: 'release_time',
    lead: tx('everything going out, every channel'),
    empty: tx('Nothing is scheduled to go out yet.'),
    file: 'releases',
    // A post is written, not filmed — but everything gets released.
    applies: () => true,
  },
  recording: {
    label: tx('Recordings'), icon: Clapperboard, dateField: 'recording_date', timeField: 'recording_time',
    lead: tx('every shoot on the books, every channel'),
    empty: tx('No shoots are booked yet.'),
    file: 'recordings',
    applies: (t) => t.type !== 'post',
  },
}

// A spreadsheet of exactly what is on screen: the same rows the filters left
// standing, over the span the calendar is parked on, late work included. The
// leading BOM is what makes Excel read a Cyrillic title as Cyrillic instead of
// mojibake, and the file name stays ASCII because Chromium silently drops a
// non-ASCII one from <a download>.
const CSV_HEAD = ['Date', 'Time', 'Title', 'Type', 'Channels', 'Stage', tx('Operator'), tx('Editor'), tx('Designer'), 'Assignees']
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
  const [newDefaults, setNewDefaults] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)

  useEffect(() => {
    Promise.all([api.get('/content'), api.cached('/statuses'), api.cached('/users')])
      .then(([ct, st, us]) => {
        setItems(ct); setStatuses(st); setTeam(us)
        cache.set(`sched:${user.id}`, {
          content: ct.map(({ photo_thumb: _t, ...rest }) => rest), statuses: st, users: us,
        })
      })
      .catch(loadFailed)
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
  const setParam = (k, v) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }

  // Come back to the page the way you left it. The address still wins: a link
  // somebody sent shows what THEY meant, not what you last looked at — so the
  // remembered channel is only consulted when the address says nothing. Which
  // month you were on is deliberately NOT remembered: a schedule opens on the
  // month you are living in, every time.
  const viewKey = `satashkent_schedview_${mode}`
  useEffect(() => {
    if (params.get('channel')) return
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(viewKey) || 'null') } catch { saved = null }
    if (saved?.channel) setParams(new URLSearchParams({ channel: String(saved.channel) }), { replace: true })
  }, [viewKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    localStorage.setItem(viewKey, JSON.stringify(channel ? { channel } : {}))
  }, [viewKey, channel])

  const today = todayISO()
  // Killed work leaves the schedule — it is not going out and not being shot.
  const alive = useMemo(
    () => items.filter((t) => M.applies(t) && !isDeletedLabel(statusesById[t.status_id]?.label)),
    [items, statusesById, M])
  const onChannel = useMemo(
    () => (channel ? alive.filter((t) => (t.channels || []).includes(channel)) : alive),
    [alive, channel])
  const shown = useMemo(
    () => (filterIsOn(filter) ? onChannel.filter((t) => matchesFilter(t, filter)) : onChannel),
    [onChannel, filter])

  const byWhen = useCallback(
    (a, b) => (a[M.dateField] + (a[M.timeField] || '')).localeCompare(b[M.dateField] + (b[M.timeField] || '')),
    [M])
  // What this page is about: work carrying a date on THIS field. A shoot with
  // no release day set is not "an unscheduled release" — it is a shoot, and it
  // belongs to the other page. Offering the two calendars each other's undated
  // work read as a backlog nobody asked for: every release-only video piled
  // into Recordings, and every shoot into Releases. The channel pages keep the
  // unscheduled tray, where it is scoped to one channel and means something.
  const dated = useMemo(() => shown.filter((t) => t[M.dateField]), [shown, M])
  // The strip shows the nearest handful. It used to show every overdue piece
  // the board had ever accumulated — fifty chips going back a month, which is
  // not a strip, it is a backlog, and dragging them back one at a time was the
  // wrong person doing the wrong job. The rest are on their owners' My Day.
  const [allLate, setAllLate] = useState(false)
  // A shoot that has HAPPENED is not an overdue shoot. The strip used to ask
  // only whether the day had passed and the whole task was unfinished, so a
  // piece that had been filmed, cut and was sitting in review still sat in
  // Recordings' Late strip with its shoot nineteen days overdue.
  const shotAlready = useMemo(() => {
    const live = [...statuses].filter((st) => !isDeletedLabel(st.label))
      .sort((a, b) => (a.sort - b.sort) || (a.id - b.id))
    const gate = live.findIndex((st) => /editing|montaj/i.test(st.label))
    return (t) => {
      if (t.shot_at) return true
      if (gate < 0) return false
      const at = live.findIndex((st) => st.id === t.status_id)
      return at >= 0 && at >= gate
    }
  }, [statuses])
  const late = useMemo(
    () => dated.filter((t) => {
      if (t.done_at || t[M.dateField] >= today) return false
      return M.dateField === 'recording_date' ? !shotAlready(t) : true
    }).sort(byWhen),
    [dated, today, byWhen, M, shotAlready])

  const updateContent = async (item, payload) => {
    const c = await api.patch(`/content/${item.id}`, payload)
    rewardIfFinished(item, c)
    setItems((prev) => prev.map((x) => (x.id === item.id ? c : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setItems((prev) => prev.filter((x) => x.id !== item.id))
  }
  const createContent = async (payload) => {
    const c = await api.post('/content', payload)
    setItems((prev) => [c, ...prev])
    return c
  }

  // Moving one day should cost one gesture — a drag across the grid. The pill
  // jumps immediately and goes back where it was if the server refuses. A drop
  // is easy to misjudge by a column, so the confirmation carries the way back:
  // the server's own ten-second undo only photographs stage moves, and this is
  // the client putting a date it already knows straight back.
  const canMove = can(user, 'move_tasks')
  const manageContent = can(user, 'manage_content')
  const setDay = async (t, field, iso, back) => {
    const before = t[field] || null
    if ((iso || null) === before) return
    setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, [field]: iso } : x)))
    try {
      const c = await api.patch(`/content/${t.id}`, { [field]: iso })
      setItems((prev) => prev.map((x) => (x.id === t.id ? c : x)))
      const where = iso ? dateLabel(iso) : 'off the calendar'
      const undo = { label: 'Undo', onClick: () => setDay({ ...t, [field]: iso }, field, before, true) }
      // `iso` is where it is going, `before` is where it came from — and an
      // undo has to name the DESTINATION, same as any other move. Naming
      // `before` here told you it had gone back to the day it just left.
      if (back) toast(`${t.title} · back to ${iso ? dateLabel(iso) : 'no day'}`)
      else toast(iso ? `${t.title} → ${where}` : `${t.title} · taken ${where}`, 'ok', undo)
    } catch (e) {
      setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, [field]: before } : x)))
      toast(e.message, 'err')
    }
  }
  const moveDate = (t, field, iso) => setDay(t, field, iso, false)

  // What you can see is what you get. The calendar owns where it is parked, so
  // it reports its span up here; the export carries that span plus the late
  // strip, which is on screen too.
  const [span, setSpan] = useState(null)
  const onRange = useCallback((from, to) => setSpan({ from, to }), [])
  const exportRows = useMemo(() => {
    const inSpan = span
      ? dated.filter((t) => t[M.dateField] >= span.from && t[M.dateField] <= span.to)
      : dated
    const seen = new Set(inSpan.map((t) => t.id))
    return [...inSpan, ...late.filter((t) => !seen.has(t.id))].sort(byWhen)
  }, [dated, late, span, byWhen, M])

  const exportCsv = () => {
    if (exportRows.length === 0) { toast(tx('Nothing to export yet'), 'err'); return }
    saveText(`${M.file}-${today}.csv`, csvOf(exportRows.map((t) => [
      t[M.dateField], t[M.timeField] || '', t.title, typeInfo(t.type).label,
      (t.channels || []).map((c) => byKey[c]?.label || c).join(' / '),
      statusesById[t.status_id]?.label || '',
      teamById[t.operator_id]?.name || '',
      teamById[t.editor_id]?.name || '',
      teamById[t.designer_id]?.name || '',
      (t.assignee_ids || []).map((id) => teamById[id]?.name || `#${id}`).join(' / '),
    ])), 'text/csv;charset=utf-8')
    toast(`${exportRows.length} ${exportRows.length === 1 ? 'row' : 'rows'} saved as a spreadsheet`)
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const Icon = M.icon
  const channelList = Object.values(byKey)
  // A new task needs a channel to live on, and this page shows all of them at
  // once — so "+ on a day" is only offered once one channel is chosen. Guessing
  // would file somebody's shoot under the wrong account.
  const addAt = manageContent && channel
    ? (iso) => { setNewDefaults({ channels: [channel], [M.dateField]: iso }); setOpenItem('new') }
    : undefined

  return (
    <>
      <div className="section-head sch-head">
        <Icon size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{M.label}</h2>
        <span className="stat-sub" style={{ fontWeight: 500 }}>{M.lead}</span>
        <span className="spacer" />
        <select className="select cf-sel" value={channel} onChange={(e) => setParam('channel', e.target.value)}
          data-tip={tx("One channel only")}>
          <option value="">{tx("All channels")}</option>
          {channelList.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <button className="btn btn-sm sch-export" onClick={exportCsv} data-tip={tx("Download exactly what is shown")}>
          <Download size={13} /> CSV
        </button>
      </div>

      <ContentFilters
        filter={filter} onChange={setFilter}
        items={onChannel} shown={shown.length}
        statuses={statuses} teamById={teamById}
      />

      {/* Late work is the only part of a schedule that needs deciding about
          today, and a calendar parked on this month would leave it behind in
          the last one. So it rides above the grid wherever you have navigated
          to — click to open it, or put it on today in one press. */}
      {late.length > 0 && !selectedDate && (
        <div className="cal-tray sch-late">
          <span className="cal-tray-label">
            <AlertCircle size={12} /> Late<b> · {late.length}</b>
            {late.length > LATE_SHOWN && (
              <button type="button" className="qbtn" onClick={() => setAllLate((v) => !v)}>
                {allLate ? 'show fewer' : `show all ${late.length}`}
              </button>
            )}
          </span>
          <div className="cal-tray-items">
            {(allLate ? late : late.slice(0, LATE_SHOWN)).map((t) => {
              const st = statusesById[t.status_id]
              return (
                <div
                  key={t.id}
                  className="cal-tray-chip late-chip"
                  style={st ? { borderLeftColor: st.color } : undefined}
                  onClick={() => setOpenItem(t)}
                  title={`${t.title} — due ${dateLabel(t[M.dateField])}`}
                >
                  <span className="late-when">{dateLabel(t[M.dateField])}</span>
                  <span className="ev-txt">{t.title}</span>
                  {canMove && (
                    <span className="tray-quick">
                      <button type="button" className="qbtn" data-tip={tx("Move to today")}
                        onClick={(e) => { e.stopPropagation(); setDay(t, M.dateField, today, false) }}>{tx("Today")}</button>
                    </span>
                  )}
                </div>
              )
            })}
            {!allLate && late.length > LATE_SHOWN && (
              <button type="button" className="cal-tray-chip late-more" onClick={() => setAllLate(true)}>
                …and {late.length - LATE_SHOWN} more
              </button>
            )}
          </div>
          {late.length > LATE_SHOWN && (
            <div className="late-hint">
              The people carrying these are asked about them on their own My Day, and work that goes
              quiet raises its own hand — this strip is for the ones you want to move yourself.
            </div>
          )}
        </div>
      )}

      {selectedDate ? (
        <DayAgenda
          date={selectedDate}
          items={shown}
          statusesById={statusesById}
          canEdit={!!addAt}
          onOpen={setOpenItem}
          onAdd={addAt}
          onBack={() => setSelectedDate(null)}
        />
      ) : dated.length === 0 ? (
        <div className="card card-pad empty">
          <CalendarDays size={28} />
          <div>{M.empty}</div>
        </div>
      ) : (
        <ContentCalendar
          items={dated}
          mode={mode}
          canMove={canMove}
          onMoveDate={moveDate}
          onDayClick={setSelectedDate}
          onOpenItem={setOpenItem}
          onAddAt={addAt}
          onRange={onRange}
          statusesById={statusesById}
        />
      )}

      {openItem && (
        <ContentModal
          item={openItem === 'new' ? null : openItem}
          defaults={newDefaults || undefined}
          statuses={statuses}
          onClose={() => { setOpenItem(null); setNewDefaults(null) }}
          onCreate={createContent}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
    </>
  )
}
