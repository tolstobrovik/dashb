import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Check, AlertCircle, Megaphone, Hand } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { rewardIfFinished } from '../lib/reward.js'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, addDaysISO, dateLabel, deptColor, onColor, iconFor, isDeletedLabel, tashkentDay } from '../lib/constants.js'
import { loadFailed, toast } from '../lib/toast.js'
import Avatar from '../components/Avatar.jsx'
import ContentModal from '../components/ContentModal.jsx'
import { StatusBadge, PaceBar, PC, daysUntil } from '../components/ProjectBits.jsx'

// The deadlines a person can be asked to move, in the words the ask uses.
const DAY_LABEL = {
  recording_date: 'the shoot day', edit_ready_date: 'the day the cut is due',
  design_ready_date: 'the day the artwork is due', release_date: 'the release day',
}
import { tr as tx } from '../lib/i18n.jsx'

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
        {c.owner_name || <span className="pc-red">{tx("no owner")}</span>}
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

  return (
    <>
      {/* ---- campaigns first: what is live, what is next ---- */}
      {(liveCamps.length > 0 || upcomingCamps.length > 0) && (
        <div className="ov-camps">
          <div className="ov-camps-col">
            <div className="section-head" style={{ marginBottom: 8 }}>
              <Megaphone size={15} style={{ color: PC.green }} />
              <h2>{tx("Live campaigns")}</h2>
              <span className="count">· {liveCamps.length}</span>
            </div>
            {liveCamps.length === 0
              ? <div className="card card-pad" style={{ color: PC.red, fontWeight: 700 }}>{tx("Nothing live. The plan is standing still.")}</div>
              : liveCamps.map((c) => <CampRow key={c.id} c={c} navigate={navigate} byKey={byKey} colorOf={colorOf} />)}
          </div>
          <div className="ov-camps-col">
            <div className="section-head" style={{ marginBottom: 8 }}>
              <CalendarClock size={15} style={{ color: '#2a78d6' }} />
              <h2>{tx("Upcoming campaigns")}</h2>
              <span className="count">· {upcomingCamps.length}</span>
            </div>
            {upcomingCamps.length === 0
              ? <div className="card card-pad empty">{tx("Nothing scheduled next.")}</div>
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
              <button className="ov-ask-main" onClick={() => navigate(`/brief?task=${a.content_id}`)}>
                <span className="ov-ask-title">{a.title}</span>
                <span className="ov-ask-move">
                  {DAY_LABEL[a.field] || a.field}: <b>{a.from_date}</b> → <b>{a.to_date || 'cleared'}</b>
                </span>
                <span className="ov-ask-why">“{a.reason}” — {a.asked_name}</span>
              </button>
              <span className="ov-ask-do">
                <button className="btn btn-sm" disabled={busyAsk === a.id} onClick={() => answer(a, false)}>{tx("Keep")}</button>
                <button className="btn btn-sm btn-primary" disabled={busyAsk === a.id} onClick={() => answer(a, true)}>{tx("Move it")}</button>
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
            <button key={h.id} className="ov-ask" onClick={() => navigate(`/brief?task=${h.content_id}`)}>
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
                  : <span className="no-owner-badge" data-tip={tx("Nobody owns this channel — assign a head or hire one")} data-tip-left="">{tx("no owner")}</span>}
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
                <div className="ov-stages"><span className="ov-stage ov-stage-empty">{tx("no open tasks")}</span></div>
              )}

              <div className="ov-counts">
                <span><b>{open.length}</b>{' '}{tx("open")}</span>
                <span style={{ color: 'var(--good-ink, #0ca30c)' }}><Check size={12} /> {doneWeek.length}{' '}{tx('done · 7d')}</span>
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
              {open.length === 0 && meters.length === 0 && <div className="stat-sub">{tx("Nothing in flight.")}</div>}
            </button>
          )
        })}
      </div>


      {openItem && (
        <ContentModal key={openItem?.id || 'new'}
          item={openItem}
          statuses={statuses}
          onClose={(next) => setOpenItem(next?.id ? next : null)}
          onCreate={() => {}}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
    </>
  )
}
