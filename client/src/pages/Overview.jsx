import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Check, AlertCircle, Megaphone, Rows3, UserX, ArrowRight, Hand } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { rewardIfFinished } from '../lib/reward.js'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, addDaysISO, dateLabel, deptColor, onColor, iconFor, typeInfo, isDeletedLabel, isIdeaLabel, tashkentDay } from '../lib/constants.js'
import { loadFailed, toast } from '../lib/toast.js'
import Avatar from '../components/Avatar.jsx'
import ContentModal from '../components/ContentModal.jsx'
import { StatusBadge, PaceBar, PC, daysUntil } from '../components/ProjectBits.jsx'

// The deadlines a person can be asked to move, in the words the ask uses.
const DAY_LABEL = {
  recording_date: 'the shoot day', edit_ready_date: 'the day the cut is due',
  design_ready_date: 'the day the artwork is due', release_date: 'the release day',
}
import { gapsOf, stageRankOf, DUE_SOON_DAYS, nearestOf } from './Unassigned.jsx'

// The admin's landing view: every department's process on one screen —
// plan meters, the pipeline as a colored strip, overdue counts — plus a
// timeline of what is coming and what got done, closest first, each
// department wearing its own color.
/* Module-level: an inline component type changes identity on every render,
   remounting each row on poll ticks. */
function CampRow({ c, navigate, byKey, colorOf }) {
  const startsIn = c.status === 'incoming' && c.start_date ? daysUntil(c.start_date) : null
  return (
    <button className="ov-camp" onClick={() => navigate(`/campaigns/${c.id}`)}>
      <span className="ov-camp-name">{c.name}</span>
      <span className="ov-camp-sub">
        {c.owner_name || <span className="pc-red">no owner</span>}
        {c.project_name ? <> · <b>{c.project_name}</b></> : <span className="pc-red"> · no project</span>}
      </span>
      <span className="ov-camp-when">
        {dateLabel(c.start_date)} → {dateLabel(c.end_date)}
        {startsIn != null && startsIn >= 0 ? (
          <span className="pc-days" style={{ marginLeft: 8 }}>starts in {startsIn}d</span>
        ) : c.days_left != null && c.status !== 'done' ? (
          <span className="pc-days" style={{ marginLeft: 8 }}>{c.days_left >= 0 ? `${c.days_left}d left` : 'ended'}</span>
        ) : null}
      </span>
      <span className="ov-camp-chips">
        {c.channels.map((k) => (
          <span key={k} className="chip" style={{ background: colorOf[k] || '#6d6a70', color: onColor(colorOf[k] || '#6d6a70') }}>{byKey[k]?.label || k}</span>
        ))}
        <StatusBadge status={c.status} />
      </span>
      {c.status === 'blocked' && c.blocking
        ? <span className="pc-strip" style={{ marginTop: 6 }}>Blocked: {c.blocking.text}</span>
        : <PaceBar pace={c.pace} height={7} />}
    </button>
  )
}

export default function Overview() {
  const { channels, byKey } = useChannels()
  const navigate = useNavigate()
  const [boot] = useState(() => cache.get('overview'))
  const [content, setContent] = useState(boot?.content || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  const [trackers, setTrackers] = useState(boot?.trackers || [])
  const [camps, setCamps] = useState(boot?.camps || [])
  const [loading, setLoading] = useState(!boot)
  const [tab, setTab] = useState('upcoming') // upcoming | done | lanes
  const [openItem, setOpenItem] = useState(null)

  useEffect(() => {
    Promise.all([api.get('/content'), api.get('/statuses'), api.get('/trackers'), api.get('/campaigns')])
      .then(([ct, st, tr, cs]) => {
        setContent(ct); setStatuses(st); setTrackers(tr); setCamps(cs)
        cache.set('overview', {
          content: ct.map(({ photo_thumb: _t, ...rest }) => rest),
          statuses: st, trackers: tr,
          camps: cs.map(({ photo_thumb: _p, ...rest }) => rest),
        })
      })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const refresh = () => {
      if (document.hidden || openItem) return
      api.poll('/content').then((f) => { if (f) setContent(f) }).catch(() => {})
      api.poll('/trackers').then((f) => { if (f) setTrackers(f) }).catch(() => {})
      api.poll('/campaigns').then((f) => { if (f) setCamps(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [openItem])

  const today = todayISO()
  const colorOf = useMemo(
    () => Object.fromEntries(channels.map((c, i) => [c.key, deptColor(i)])),
    [channels])
  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])

  // ---- per-department cards ----
  const depts = useMemo(() => {
    // Killed pieces (Deleted stage) are records, not open work — they must
    // not inflate a channel's open/overdue counts or its stage chips.
    const dead = new Set(statuses.filter((s) => isDeletedLabel(s.label)).map((s) => s.id))
    return channels.map((c, i) => {
    const tasks = content.filter((t) => t.channels.includes(c.key))
    const open = tasks.filter((t) => !t.done_at && !dead.has(t.status_id))
    const dateOf = (t) => t.release_date || t.recording_date || null
    const overdue = open.filter((t) => dateOf(t) && dateOf(t) < today)
    const weekAgo = addDaysISO(today, -7)
    const doneWeek = tasks.filter((t) => t.done_at && tashkentDay(t.done_at) >= weekAgo)
    const byStage = statuses.map((s) => ({ s, n: open.filter((t) => t.status_id === s.id).length })).filter((x) => x.n > 0)
    const plans = trackers.filter((t) => t.department === c.key && t.content_type)
    const others = trackers.filter((t) => t.department === c.key && !t.content_type)
    return { c, color: deptColor(i), open, overdue, doneWeek, byStage, meters: [...plans, ...others].slice(0, 3) }
    })
  }, [channels, content, statuses, trackers, today])

  // ---- campaigns strip: what's running, what's next ----
  const liveCamps = useMemo(() => camps.filter((c) => c.status === 'live' || c.status === 'blocked'), [camps])
  const upcomingCamps = useMemo(
    () => camps.filter((c) => c.status === 'incoming').sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [camps])

  // ---- department lanes: 14 days, one row per channel, synced with the
  // same tasks the department calendars show ----
  const laneDays = useMemo(() => [...Array(14)].map((_, i) => addDaysISO(today, i - 2)), [today])
  const lanes = useMemo(() => channels.map((c, i) => ({
    c,
    color: deptColor(i),
    byDay: Object.fromEntries(laneDays.map((d) => [d,
      content.filter((t) => !t.done_at && t.channels.includes(c.key) && (t.release_date === d || t.recording_date === d)),
    ])),
  })), [channels, content, laneDays])

  // Planning gaps — live tasks missing people or dates, counted by the same
  // admin-tuned crew rules the Unassigned page uses; the strip below the
  // campaigns points at the Unassigned page only while there's work to do.
  const [crewNeeds, setCrewNeeds] = useState(null)
  useEffect(() => {
    api.cached('/fields').then((f) => setCrewNeeds(f.crew || null)).catch(() => {})
  }, [])
  // Waiting on this admin. Non-admins get an empty list from the server, so
  // there is nothing to guard here.
  const [asks, setAsks] = useState([])
  const [busyAsk, setBusyAsk] = useState(0)
  const [hands, setHands] = useState([])
  const loadAsks = () => {
    api.pollView('/content/date-requests/open')
      .then((d) => { if (Array.isArray(d)) setAsks(d) }).catch(() => {})
    api.pollView('/content/flags/open')
      .then((d) => { if (Array.isArray(d)) setHands(d) }).catch(() => {})
  }
  useEffect(() => {
    // Polled with the rest of the page: an ask that arrives while an admin is
    // sitting on Overview should appear there, not wait for a reload. It is
    // ETag'd like everything else, so a quiet minute costs one 304.
    loadAsks()
    const id = setInterval(() => { if (!document.hidden) loadAsks() }, 10000)
    return () => clearInterval(id)
  }, [])
  const answer = async (a, approve) => {
    setBusyAsk(a.id)
    try {
      await api.post(`/content/date-requests/${a.id}/decide`, { approve })
      setAsks((prev) => prev.filter((x) => x.id !== a.id))
      toast(approve ? 'Moved — they hear it right away' : 'Kept where it was — they hear why')
    } catch (e) { toast(e.message, 'err') } finally { setBusyAsk(0) }
  }

  const gapCount = useMemo(() => {
    const skip = new Set(statuses.filter((s) => isDeletedLabel(s.label) || isIdeaLabel(s.label)).map((s) => s.id))
    const horizon = addDaysISO(todayISO(), DUE_SOON_DAYS)
    const rank = stageRankOf(statuses)
    return content.filter((t) => {
      if (t.done_at || skip.has(t.status_id)) return false
      const g = gapsOf(t, crewNeeds, rank)
      if (!(g.people.length > 0 || g.dates.length > 0)) return false
      // the strip keeps the Unassigned page's "due soon" horizon, so its
      // number and the page it opens always tell the same story
      const near = nearestOf(t)
      return !near || near.d <= horizon
    }).length
  }, [content, statuses, crewNeeds])

  // ---- timeline ----
  const dateOf = (t) => t.release_date || t.recording_date || null
  const upcoming = useMemo(() =>
    content
      .filter((t) => !t.done_at && dateOf(t))
      .sort((a, b) => dateOf(a).localeCompare(dateOf(b))), // ascending — closest (and overdue) on top
    [content])
  const done = useMemo(() =>
    content
      .filter((t) => t.done_at)
      .sort((a, b) => b.done_at.localeCompare(a.done_at)) // most recently finished on top
      .slice(0, 40),
    [content])

  const updateContent = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    rewardIfFinished(item, u)
    setContent((prev) => prev.map((x) => (x.id === item.id ? u : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const rows = tab === 'upcoming' ? upcoming : done

  return (
    <>
      {/* ---- campaigns first: what is live, what is next ---- */}
      {(liveCamps.length > 0 || upcomingCamps.length > 0) && (
        <div className="ov-camps">
          <div className="ov-camps-col">
            <div className="section-head" style={{ marginBottom: 8 }}>
              <Megaphone size={15} style={{ color: PC.green }} />
              <h2>Live campaigns</h2>
              <span className="count">· {liveCamps.length}</span>
            </div>
            {liveCamps.length === 0
              ? <div className="card card-pad" style={{ color: PC.red, fontWeight: 700 }}>Nothing live. The plan is standing still.</div>
              : liveCamps.map((c) => <CampRow key={c.id} c={c} navigate={navigate} byKey={byKey} colorOf={colorOf} />)}
          </div>
          <div className="ov-camps-col">
            <div className="section-head" style={{ marginBottom: 8 }}>
              <CalendarClock size={15} style={{ color: '#2a78d6' }} />
              <h2>Upcoming campaigns</h2>
              <span className="count">· {upcomingCamps.length}</span>
            </div>
            {upcomingCamps.length === 0
              ? <div className="card card-pad empty">Nothing scheduled next.</div>
              : upcomingCamps.map((c) => <CampRow key={c.id} c={c} navigate={navigate} byKey={byKey} colorOf={colorOf} />)}
          </div>
        </div>
      )}

      {/* Deadlines waiting on this admin's yes. The asking mechanism is only
          as good as the answering: the bell scrolls away, and a request
          nobody sees is a deadline that quietly stays wrong. Answered right
          here — the reason is the whole of what there is to read. */}
      {asks.length > 0 && (
        <div className="card card-pad ov-asks">
          <div className="ov-asks-head">
            <CalendarClock size={16} />
            <b>{asks.length} day{asks.length === 1 ? '' : 's'} waiting on you</b>
          </div>
          {asks.map((a) => (
            <div key={a.id} className="ov-ask">
              <button className="ov-ask-main" onClick={() => navigate(`/todo?task=${a.content_id}`)}>
                <span className="ov-ask-title">{a.title}</span>
                <span className="ov-ask-move">
                  {DAY_LABEL[a.field] || a.field}: <b>{a.from_date}</b> → <b>{a.to_date || 'cleared'}</b>
                </span>
                <span className="ov-ask-why">“{a.reason}” — {a.asked_name}</span>
              </button>
              <span className="ov-ask-do">
                <button className="btn btn-sm" disabled={busyAsk === a.id} onClick={() => answer(a, false)}>Keep</button>
                <button className="btn btn-sm btn-primary" disabled={busyAsk === a.id} onClick={() => answer(a, true)}>Move it</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Hands up. Somebody on a piece has said early that it is in trouble —
          which is only worth saying if the people who plan see it early. */}
      {hands.length > 0 && (
        <div className="card card-pad ov-asks ov-hands">
          <div className="ov-asks-head">
            <Hand size={16} />
            <b>{hands.length} hand{hands.length === 1 ? '' : 's'} up</b>
          </div>
          {hands.map((h) => (
            <button key={h.id} className="ov-ask" onClick={() => navigate(`/todo?task=${h.content_id}`)}>
              <span className="ov-ask-main">
                <span className="ov-ask-title">{h.title}</span>
                <span className="ov-ask-move">
                  {h.raised_name} {h.kind === 'cant_take' ? 'cannot take this on' : 'says this will be late'}
                </span>
                <span className="ov-ask-why">“{h.reason}”</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Planning gaps — one quiet strip, only while something is unowned
          or undated; it opens the Unassigned page where the fixing happens. */}
      {gapCount > 0 && (
        <button className="card ov-gaps" onClick={() => navigate('/unassigned')}>
          <UserX size={15} />
          <span><b>{gapCount}</b> task{gapCount === 1 ? '' : 's'} waiting for a person or dates</span>
          <ArrowRight size={14} className="ov-gaps-go" />
        </button>
      )}

      {/* ---- every department, one card each ---- */}
      <div className="ov-grid">
        {depts.map(({ c, color, open, overdue, doneWeek, byStage, meters }) => {
          const Icon = iconFor(c.icon)
          return (
            <button key={c.key} className="card ov-card" style={{ borderTopColor: color }} onClick={() => navigate(`/dept/${c.key}`)}>
              <div className="ov-head">
                <span className="ov-icon" style={{ background: color, color: onColor(color) }}><Icon size={15} /></span>
                <span className="ov-name">{c.label}</span>
                <span style={{ flex: 1 }} />
                {c.head_name
                  ? <Avatar name={c.head_name} color={c.head_color} src={c.head_avatar} size="sm" />
                  : <span className="no-owner-badge" data-tip="Nobody owns this channel — assign a head or hire one" data-tip-left="">no owner</span>}
              </div>

              {/* the pipeline, labeled — the stage name rides ON its color,
                  so nobody has to decode a bare strip */}
              {open.length > 0 ? (
                <div className="ov-stages">
                  {byStage.map(({ s, n }) => (
                    <span key={s.id} className="ov-stage" style={{ background: s.color, color: onColor(s.color) }}>
                      {s.label} <b>{n}</b>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="ov-stages"><span className="ov-stage ov-stage-empty">no open tasks</span></div>
              )}

              <div className="ov-counts">
                <span><b>{open.length}</b> open</span>
                <span style={{ color: 'var(--good-ink, #0ca30c)' }}><Check size={12} /> {doneWeek.length} done · 7d</span>
                {overdue.length > 0 && (
                  <span className="pc-red"><AlertCircle size={12} /> {overdue.length} overdue</span>
                )}
              </div>

              {meters.map((m) => {
                const pct = Math.min(100, Math.round((m.current / Math.max(1, m.target)) * 100))
                return (
                  <div key={m.id} className="ov-meter">
                    <span className="ov-meter-label">{m.label}</span>
                    <div className="pace-track" style={{ height: 7, flex: 1 }}>
                      <div className="pace-fill" style={{ width: `${pct}%`, background: pct >= 100 ? '#1D9E75' : color }} />
                    </div>
                    <span className="ov-meter-n">{m.current.toLocaleString()}/{m.target.toLocaleString()}</span>
                  </div>
                )
              })}
              {open.length === 0 && meters.length === 0 && <div className="stat-sub">Nothing in flight.</div>}
            </button>
          )
        })}
      </div>

      {/* ---- timeline: what's coming, what's done — closest first ---- */}
      <div className="section-head" style={{ marginTop: 20 }}>
        <CalendarClock size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>Timeline</h2>
        <span className="spacer" />
        <div className="pill-group">
          <button className={'pill' + (tab === 'upcoming' ? ' active' : '')} onClick={() => setTab('upcoming')}
            data-tip="Open tasks by date — overdue and today on top">Upcoming · {upcoming.length}</button>
          <button className={'pill' + (tab === 'done' ? ' active' : '')} onClick={() => setTab('done')}
            data-tip="Recently completed, newest first">Done · {done.length}</button>
          <button className={'pill' + (tab === 'lanes' ? ' active' : '')} onClick={() => setTab('lanes')}
            data-tip="Two weeks, one lane per department — the same tasks as the channel calendars" data-tip-left="">
            <Rows3 size={13} /> By department
          </button>
        </div>
      </div>

      {tab === 'lanes' ? (
        <div className="card lanes-card">
          <div className="lanes-scroll">
            <div className="lanes" style={{ minWidth: 720 }}>
              <div className="lane lane-head">
                <div className="lane-label" />
                {laneDays.map((d) => (
                  <div key={d} className={'lane-day-head' + (d === today ? ' now' : '')}>
                    <span>{dateLabel(d)}</span>
                  </div>
                ))}
              </div>
              {lanes.map(({ c, color, byDay }) => (
                <div key={c.key} className="lane">
                  <button className="lane-label" style={{ borderLeft: `4px solid ${color}` }} onClick={() => navigate(`/dept/${c.key}`)}
                    data-tip="Open this channel's calendar">
                    {c.label}
                  </button>
                  {laneDays.map((d) => (
                    <div key={d} className={'lane-cell' + (d === today ? ' now' : '')}>
                      {byDay[d].map((t) => (
                        <button key={t.id} className="lane-chip" style={{ background: color, color: onColor(color) }}
                          onClick={() => setOpenItem(t)} data-tip={`${t.title} · ${statusesById[t.status_id]?.label || ''}`}>
                          {t.title}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="stat-sub" style={{ padding: '8px 12px' }}>
            The same tasks as the channel calendars — edits here appear there within seconds, and the other way round.
          </div>
        </div>
      ) : (
      <div className="card" style={{ padding: '4px 14px' }}>
        {rows.map((t) => {
          const d = tab === 'done' ? tashkentDay(t.done_at) : dateOf(t)
          const late = tab === 'upcoming' && d < today
          const st = statusesById[t.status_id]
          return (
            <button key={t.id} className="ov-row" onClick={() => setOpenItem(t)}>
              <span className={'ov-date' + (late ? ' late' : '')}>{late ? `${dateLabel(d)} ⚠` : dateLabel(d)}</span>
              <span className={'ov-title' + (tab === 'done' ? ' done-txt' : '')}>{t.title}</span>
              <span className="ov-chips">
                {t.channels.map((k) => (
                  <span key={k} className="chip" style={{ background: colorOf[k] || '#6d6a70', color: onColor(colorOf[k] || '#6d6a70') }}>
                    {byKey[k]?.label || k}
                  </span>
                ))}
                <span className={`chip ct-${t.type}`}>{typeInfo(t.type).label}</span>
                {tab === 'done'
                  ? <span className="chip" style={{ background: '#1D9E75', color: '#fff' }}><Check size={10} /> Done</span>
                  : st && <span className="chip" style={{ background: st.color, color: onColor(st.color) }}>{st.label}</span>}
              </span>
            </button>
          )
        })}
        {rows.length === 0 && (
          <div className="empty">{tab === 'upcoming' ? 'Nothing scheduled — plan some tasks.' : 'Nothing completed yet.'}</div>
        )}
      </div>
      )}

      {openItem && (
        <ContentModal
          item={openItem}
          statuses={statuses}
          onClose={() => setOpenItem(null)}
          onCreate={() => {}}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
    </>
  )
}
