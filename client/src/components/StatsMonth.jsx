import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, TrendingUp,
  Clapperboard, Scissors, Send, Lightbulb, ChevronDown,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, dateLabel } from '../lib/constants.js'
import { loadFailed } from '../lib/toast.js'
import { tr as tx, locale } from '../lib/i18n.jsx'

// ---- the month, and what it says ----
//
// The register below this block lists every missed deadline as a row and
// leaves the reading to whoever opened it. Which means everybody reads it
// differently, or — more often — scrolls past it. Numbers nobody draws a
// conclusion from change nothing.
//
// So the arithmetic happens on the server (GET /reports/stats), once, and it
// comes back with the conclusions attached: which step the month is lost at,
// which side the delay sits on, which channel is behind. This block leads with
// those sentences and puts the numbers underneath them as evidence. The
// register keeps its own period; this one is always a month, channels across
// the top, and everything below the conclusions folds away — the answer is the
// point and the working is only there for whoever wants to check it.

const monthOf = (iso) => iso.slice(0, 7)
const shiftMonth = (ym, by) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const monthEdges = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}
const monthWords = (ym) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })

const PHASE_ICON = { shoot: Clapperboard, edit: Scissors, review: Send }
const PHASE_LABEL = { shoot: 'Shooting', edit: 'Editing', review: 'Review & publish' }
const TONE_ICON = { good: CheckCircle2, warn: AlertTriangle, bad: AlertTriangle, flat: Lightbulb }

// A pie, drawn by hand. Two slices and a hole — a chart library for this would
// weigh more than the page it sits on.
function Pie({ slices, size = 132 }) {
  const total = slices.reduce((a, s) => a + s.value, 0)
  const r = size / 2 - 10
  const c = size / 2
  if (total === 0) {
    return (
      <svg width={size} height={size} className="pie" role="img" aria-label={tx('Nothing to show')}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--hairline-strong)" strokeWidth="18" strokeDasharray="4 6" />
      </svg>
    )
  }
  let at = -Math.PI / 2
  const arcs = slices.filter((s) => s.value > 0).map((s) => {
    const frac = s.value / total
    const end = at + frac * Math.PI * 2
    const big = frac > 0.5 ? 1 : 0
    const x1 = c + r * Math.cos(at), y1 = c + r * Math.sin(at)
    const x2 = c + r * Math.cos(end), y2 = c + r * Math.sin(end)
    const d = frac >= 0.999
      ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`
      : `M ${c} ${c} L ${x1} ${y1} A ${r} ${r} 0 ${big} 1 ${x2} ${y2} Z`
    at = end
    return { d, ...s, pct: Math.round(frac * 100) }
  })
  return (
    <svg width={size} height={size} className="pie" role="img"
      aria-label={arcs.map((a) => `${tx(a.label)} ${a.pct}%`).join(', ')}>
      {arcs.map((a) => <path key={a.label} d={a.d} fill={a.color} />)}
      <circle cx={c} cy={c} r={r * 0.56} fill="var(--surface)" />
      <text x={c} y={c - 2} textAnchor="middle" className="pie-n">{total}</text>
      <text x={c} y={c + 14} textAnchor="middle" className="pie-l">{tx('steps')}</text>
    </svg>
  )
}

const Bar = ({ value, of, tone }) => (
  <span className="stat-bar"><i className={'stat-bar-fill' + (tone ? ` sb-${tone}` : '')}
    style={{ width: `${of > 0 ? Math.round((value / of) * 100) : 0}%` }} /></span>
)

export default function StatsMonth() {
  const { visible: channels } = useChannels()
  const today = todayISO()
  const [month, setMonth] = useState(() => monthOf(today))
  const [chan, setChan] = useState('all')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('satashkent_stats_open') || '["steps"]')) }
    catch { return new Set(['steps']) }
  })
  const toggle = (k) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    localStorage.setItem('satashkent_stats_open', JSON.stringify([...next]))
    return next
  })

  useEffect(() => {
    const { from, to } = monthEdges(month)
    setData(null); setErr('')
    api.get(`/reports/stats?from=${from}&to=${to}&channel=${chan}`)
      .then(setData).catch((e) => { setErr(e.message); loadFailed(e) })
  }, [month, chan])

  const pie = useMemo(() => {
    if (!data) return []
    return [
      { label: 'Shooting', value: data.byPhase.shoot.late, color: '#fab219' },
      { label: 'Editing', value: data.byPhase.edit.late, color: '#b5324a' },
      { label: 'Review & publish', value: data.byPhase.review.late, color: '#2a78d6' },
    ]
  }, [data])

  const Section = ({ k, title, count, children }) => (
    <div className="card st-sec">
      <button type="button" className="st-sec-head" onClick={() => toggle(k)} aria-expanded={open.has(k)}>
        <b>{tx(title)}</b>
        {count !== undefined && <span className="count">{count}</span>}
        <span className="spacer" />
        <ChevronDown size={16} className={'dz-caret' + (open.has(k) ? ' open' : '')} />
      </button>
      {open.has(k) && <div className="st-sec-body">{children}</div>}
    </div>
  )

  return (
    <>
      <div className="section-head" style={{ marginTop: 6 }}>
        <BarChart3 size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{tx('The month at a glance')}</h2>
        <span className="spacer" />
        <div className="at-month">
          <button className="icon-btn" onClick={() => setMonth((m) => shiftMonth(m, -1))}
            aria-label={tx('Previous month')}><ChevronLeft size={18} /></button>
          <b>{monthWords(month)}</b>
          <button className="icon-btn" disabled={month >= monthOf(today)}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            aria-label={tx('Next month')}><ChevronRight size={18} /></button>
        </div>
      </div>

      {/* the channels, across the top */}
      <div className="pill-group st-chans">
        <button className={'pill' + (chan === 'all' ? ' active' : '')} onClick={() => setChan('all')}>{tx('All channels')}</button>
        {channels.map((c) => (
          <button key={c.key} className={'pill' + (chan === c.key ? ' active' : '')}
            onClick={() => setChan(chan === c.key ? 'all' : c.key)}>{c.label}</button>
        ))}
      </div>

      {err && <div className="form-error">{err}</div>}
      {!data ? <div className="app-loading"><span className="spinner" /></div> : (
        <>
          {/* THE ANSWER. Everything under this is the working. */}
          <div className="card st-say">
            {data.conclusions.map((c, i) => {
              const Icon = TONE_ICON[c.tone] || Lightbulb
              return (
                <div key={i} className={`st-line st-${c.tone}`}>
                  <Icon size={15} /> <span>{c.text}</span>
                </div>
              )
            })}
          </div>

          {/* the four numbers the conclusions are drawn from */}
          <div className="st-tiles">
            <div className="card st-tile">
              <span className="st-k">{tx('Plan completion')}</span>
              <b className={data.rates.completion !== null && data.rates.completion < 60 ? 'pay-bad' : ''}>
                {data.rates.completion === null ? '—' : `${data.rates.completion}%`}
              </b>
              <Bar value={data.totals.planned - data.totals.owed} of={data.totals.planned} tone={data.rates.completion >= 90 ? 'good' : data.rates.completion >= 60 ? 'warn' : 'bad'} />
              <span className="stat-sub">{data.totals.planned} {tx('planned')} · {data.totals.owed} {tx('still owed')}</span>
            </div>
            <div className="card st-tile">
              <span className="st-k">{tx('Production rate')}</span>
              <b>{data.rates.production === null ? '—' : `${data.rates.production}%`}</b>
              <Bar value={data.totals.delivered} of={data.totals.planned || data.totals.delivered} tone={data.rates.production >= 90 ? 'good' : data.rates.production >= 60 ? 'warn' : 'bad'} />
              <span className="stat-sub">{data.totals.delivered} {tx('went out')}</span>
            </div>
            <div className="card st-tile">
              <span className="st-k">{tx('On time')}</span>
              <b className={data.rates.punctuality !== null && data.rates.punctuality < 70 ? 'pay-bad' : ''}>
                {data.rates.punctuality === null ? '—' : `${data.rates.punctuality}%`}
              </b>
              <Bar value={data.totals.onTime} of={data.totals.delivered} tone={data.rates.punctuality >= 80 ? 'good' : 'warn'} />
              <span className="stat-sub">{tx('of what went out')}</span>
            </div>
            <div className="card st-tile">
              <span className="st-k">{tx('Missed steps')}</span>
              <b className={data.totals.lateSteps ? 'pay-bad' : ''}>{data.totals.lateSteps}</b>
              <span className="st-sides">
                <span><i className="st-dot st-prod" /> {data.bySide.production || 0} {tx('production')}</span>
                <span><i className="st-dot st-make" /> {data.bySide.make || 0} {tx('content')}</span>
              </span>
            </div>
          </div>

          <Section k="steps" title="Where the time goes">
            <div className="st-pie-row">
              <Pie slices={pie} />
              <div className="st-legend">
                {pie.map((s) => {
                  const Icon = PHASE_ICON[Object.keys(PHASE_LABEL).find((k) => PHASE_LABEL[k] === s.label)] || Clapperboard
                  const judged = data.byPhase[Object.keys(PHASE_LABEL).find((k) => PHASE_LABEL[k] === s.label)].judged
                  return (
                    <div key={s.label} className="st-leg-row">
                      <i className="st-dot" style={{ background: s.color }} />
                      <Icon size={13} />
                      <span className="st-leg-name">{tx(s.label)}</span>
                      <b>{s.value}</b>
                      <span className="stat-sub">{tx('of')} {judged}</span>
                      <Bar value={s.value} of={judged || 1} tone={s.value ? 'bad' : 'good'} />
                    </div>
                  )
                })}
              </div>
            </div>
          </Section>

          <Section k="channels" title="By channel" count={data.byChannel.filter((c) => c.planned).length}>
            <table className="tbl st-tbl">
              <thead><tr>
                <th>{tx('Channel')}</th><th>{tx('Planned')}</th><th>{tx('Delivered')}</th>
                <th>{tx('Plan completion')}</th><th>{tx('On time')}</th>
              </tr></thead>
              <tbody>
                {data.byChannel.filter((c) => c.planned > 0).map((c) => (
                  <tr key={c.key}>
                    <td><b>{c.label}</b></td>
                    <td>{c.planned}</td>
                    <td>{c.delivered}</td>
                    <td className={c.completion !== null && c.completion < 60 ? 'pay-bad' : ''}>
                      {c.completion === null ? '—' : `${c.completion}%`}
                    </td>
                    <td>{c.punctuality === null ? '—' : `${c.punctuality}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {data.byPerson.length > 0 && (
            <Section k="people" title="Who is carrying the misses" count={data.byPerson.length}>
              <table className="tbl st-tbl">
                <thead><tr>
                  <th>{tx('Person')}</th><th>{tx('Missed steps')}</th><th>{tx('Shooting')}</th>
                  <th>{tx('Editing')}</th><th>{tx('Review & publish')}</th>
                </tr></thead>
                <tbody>
                  {data.byPerson.map((p) => (
                    <tr key={p.id}>
                      <td><b>{p.name || '—'}</b></td>
                      <td className={p.late >= 3 ? 'pay-bad' : ''}>{p.late}</td>
                      <td>{p.phases.shoot || 0}</td>
                      <td>{p.phases.edit || 0}</td>
                      <td>{p.phases.review || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {data.blamed.length > 0 && (
            <Section k="each" title="Every missed step, worst first" count={data.blamed.length}>
              <div className="st-misses">
                {data.blamed.map((m, i) => (
                  <div key={`${m.id}-${m.phase}-${i}`} className="st-miss">
                    <span className={'chip ' + (m.side === 'production' ? 'chip-prod' : 'chip-make')}>
                      {tx(m.side === 'production' ? 'production' : 'content')}
                    </span>
                    <span className="st-miss-main">
                      <b>{m.title}</b>
                      <span className="stat-sub">{tx(m.label)} · {tx('due')} {dateLabel(m.due)} · {m.why}{m.decided ? ` — ${tx('an admin decided this')}` : ''}</span>
                    </span>
                    <span className="st-miss-days">{m.days_late}{tx('d')}</span>
                    <span className="st-miss-who stat-sub">{m.who.join(', ') || tx('nobody')}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </>
  )
}
