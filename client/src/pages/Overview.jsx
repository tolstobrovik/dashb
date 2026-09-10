import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, ChevronDown } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, addDaysISO, deptColor, onColor, iconFor, isDeletedLabel, tashkentDay } from '../lib/constants.js'
import { loadFailed, toast } from '../lib/toast.js'
import Avatar from '../components/Avatar.jsx'
import { AreaChart, BarChart, ChartCard, RangePick, Stat } from '../components/Chart.jsx'
import { tr as tx } from '../lib/i18n.jsx'
import { CountDot } from '../components/Dot.jsx'

// The board's front page.
//
// It used to be a wall: twelve channel cards of equal weight, five of them
// saying "no open tasks", with a two-column strip of campaigns above them that
// the Projects page already draws better. Every channel shouted the same
// volume, so nothing on it was the answer to the question anybody actually
// opens a dashboard with — how are we doing, and what needs me.
//
// Now it answers in that order:
//   the four numbers      where the month stands
//   when we work          the shape of it, day by day — a total for a month
//                         cannot tell four-a-week from nineteen-in-three-days
//   who and when          the busiest weekday, and who is carrying it
//   what needs answering  days waiting on this admin's yes
//   the channels          ranked by what is wrong, with the quiet ones folded
//
// The campaigns strip is gone. It was two columns of the same rows the
// Projects page shows, and a front page that repeats another page is a front
// page with nothing of its own to say.

// The deadlines a person can be asked to move, in the words the ask uses.
const DAY_LABEL = {
  recording_date: 'the shoot day', edit_ready_date: 'the day the cut is due',
  design_ready_date: 'the day the artwork is due', release_date: 'the release day',
}

const RANGES = [
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '3 months', days: 90 },
  { key: '180', label: '6 months', days: 180 },
]
const RANGE_KEY = 'satashkent_overview_range'

export default function Overview() {
  const { channels } = useChannels()
  const navigate = useNavigate()
  const [boot] = useState(() => cache.get('overview'))
  const [content, setContent] = useState(boot?.content || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  const [loading, setLoading] = useState(!boot)
  const [showQuiet, setShowQuiet] = useState(false)

  useEffect(() => {
    Promise.all([api.get('/content'), api.get('/statuses')])
      .then(([ct, st]) => {
        setContent(ct); setStatuses(st)
        cache.set('overview', { content: ct.map(({ photo_thumb: _t, ...rest }) => rest), statuses: st })
      })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return
      api.poll('/content').then((f) => { if (f) setContent(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [])

  // ---- the shape of the work ----
  const [range, setRange] = useState(() => {
    try { return localStorage.getItem(RANGE_KEY) || '90' } catch { return '90' }
  })
  const [act, setAct] = useState(null)
  useEffect(() => {
    const days = RANGES.find((r) => r.key === range)?.days || 90
    try { localStorage.setItem(RANGE_KEY, range) } catch { /* fine */ }
    let alive = true
    api.get(`/reports/activity?days=${days}`)
      .then((d) => { if (alive) setAct(d) })
      .catch(() => { if (alive) setAct(null) })
    return () => { alive = false }
  }, [range])

  const today = todayISO()

  // ---- per-channel reading ----
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
      const byStage = statuses
        .map((s) => ({ s, n: open.filter((t) => t.status_id === s.id).length }))
        .filter((x) => x.n > 0)
      return { c, color: deptColor(i), open, overdue, doneWeek, byStage }
    })
  }, [channels, content, statuses, today])

  // What is wrong comes first, then what is busiest. A channel with nothing
  // open is not ranked at all — it is folded away below, because a card
  // reading "no open tasks" is a card asking to be skipped, and eleven of
  // them are why nobody reads the four that matter.
  const busy = useMemo(() => depts
    .filter((d) => d.open.length > 0)
    .sort((a, b) => b.overdue.length - a.overdue.length || b.open.length - a.open.length), [depts])
  const quiet = useMemo(() => depts.filter((d) => d.open.length === 0), [depts])

  // ---- the four numbers ----
  const nums = useMemo(() => {
    const dead = new Set(statuses.filter((s) => isDeletedLabel(s.label)).map((s) => s.id))
    const open = content.filter((t) => !t.done_at && !dead.has(t.status_id))
    const dateOf = (t) => t.release_date || t.recording_date || null
    const late = open.filter((t) => dateOf(t) && dateOf(t) < today)
    return { open: open.length, late: late.length }
  }, [content, statuses, today])

  // Waiting on this admin. Non-admins get an empty list from the server, so
  // there is nothing to guard here.
  const [asks, setAsks] = useState([])
  const [busyAsk, setBusyAsk] = useState(0)
  useEffect(() => {
    const loadAsks = () => api.pollView('/content/date-requests/open')
      .then((d) => { if (Array.isArray(d)) setAsks(d) }).catch(() => {})
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

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const onTime = act && act.done > 0 ? Math.round(((act.done - act.late) / act.done) * 100) : null
  const rangeWord = RANGES.find((r) => r.key === range)?.label || '3 months'

  return (
    <>
      {/* ---- where the month stands ---- */}
      <div className="stat-row">
        <Stat label="Open right now" value={nums.open}
          sub={tx('across {n} channels', { n: busy.length })} />
        <Stat label="Past its day" value={nums.late} tone={nums.late > 0 ? 'late' : undefined}
          sub={nums.late === 0 ? tx('nothing overdue') : tx('needs a new date or a push')} />
        <Stat label="Delivered" value={act?.done ?? '—'}
          sub={tx('in the last {range}', { range: tx(rangeWord).toLowerCase() })}
          trend={act?.active_days >= 4 ? act.totals : null} color="var(--chart-4)" />
        <Stat label="On time" value={onTime === null ? '—' : `${onTime}%`}
          tone={onTime !== null && onTime >= 80 ? 'good' : onTime !== null && onTime < 50 ? 'late' : undefined}
          sub={act?.late ? tx('{n} went late', { n: act.late }) : tx('of what was delivered')} />
      </div>

      {/* ---- the shape of it ---- */}
      <ChartCard
        title="When the team works"
        sub={act ? (act.rate
          ? `${tx('{n} pieces finished', { n: act.done })} · ${
              act.rate.per === 'day' ? tx('{n} a day on average', { n: act.rate.n })
              : act.rate.per === 'week' ? tx('{n} a week on average', { n: act.rate.n })
              : tx('{n} a month on average', { n: act.rate.n })}`
          : tx('Nothing finished in this window')) : 'Loading…'}
        right={<RangePick value={range} onChange={setRange} options={RANGES} />}
      >
        <AreaChart
          series={act?.series || []}
          labels={act?.days || []}
          height={230}
          valueLabel={tx('Work finished')}
          emptyText={tx('No work finished in this window')}
        />
        {act?.peak && (
          <p className="chart-note">
            {tx('Busiest day: {day} with {n}.', {
              day: new Date(`${act.peak.day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' }),
              n: act.peak.n,
            })}
            {act.quiet_run > 2 ? ' ' + tx('Longest quiet stretch: {n} days.', { n: act.quiet_run }) : ''}
          </p>
        )}
      </ChartCard>

      {/* ---- who, and which day ---- */}
      <div className="ov-two">
        <ChartCard title="Which day of the week" sub="Every piece finished in the window, by weekday">
          <BarChart
            rows={(act?.weekday || []).map((d) => ({ ...d, label: tx(d.label) }))}
            emptyText={tx('No work finished in this window')}
          />
        </ChartCard>
        <ChartCard title="Who is carrying it" sub="Pieces finished, by the person who finished them">
          <BarChart
            rows={(act?.people || []).slice(0, 8).map((p) => ({ key: p.id, label: p.name, value: p.n }))}
            emptyText={tx('No work finished in this window')}
          />
        </ChartCard>
      </div>

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

      {/* ---- the channels that have work on them ---- */}
      <div className="section-head ov-chan-head">
        <h2>{tx('Channels')}</h2>
        <span className="count">· {busy.length}</span>
      </div>
      <div className="ov-grid">
        {busy.map(({ c, color, open, overdue, doneWeek, byStage }) => {
          const Icon = iconFor(c.icon)
          return (
            <button key={c.key} className="card ov-card" onClick={() => navigate(`/dept/${c.key}`)}>
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
              <div className="ov-stages">
                {byStage.map(({ s, n }) => (
                  <span key={s.id} className="ov-stage">
                    <i className="dot" style={{ background: s.color }} /> {s.label} <b>{n}</b>
                  </span>
                ))}
              </div>

              {/* The same marks the channel register, the missed register and
                  the crew deck use, so the one number somebody scans for —
                  the red one — looks the same everywhere. */}
              <div className="ov-counts">
                <CountDot n={overdue.length} tone="late" />
                <CountDot n={open.length} tone="open" />
                <CountDot n={doneWeek.length} tone="done" tip="Finished in the last 7 days" />
              </div>
            </button>
          )
        })}
      </div>

      {/* The quiet ones, as one line. They are still reachable — a channel
          with nothing open is not a channel that has stopped existing — but
          they do not get a card each, because eleven identical cards saying
          nothing is how the four that matter got lost. */}
      {quiet.length > 0 && (
        <div className="ov-quiet">
          <button className="ov-quiet-head" onClick={() => setShowQuiet((v) => !v)} aria-expanded={showQuiet}>
            <ChevronDown size={15} className={showQuiet ? 'open' : ''} />
            {quiet.length === 1
            ? tx('1 channel with nothing open')
            : tx('{n} channels with nothing open', { n: quiet.length })}
          </button>
          {showQuiet && (
            <div className="ov-quiet-list">
              {quiet.map(({ c, color }) => {
                const Icon = iconFor(c.icon)
                return (
                  <button key={c.key} className="ov-quiet-chip" onClick={() => navigate(`/dept/${c.key}`)}>
                    <span className="ov-quiet-icon" style={{ background: color, color: onColor(color) }}><Icon size={12} /></span>
                    {c.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </>
  )
}
