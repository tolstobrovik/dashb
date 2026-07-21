import { useMemo } from 'react'
import { todayISO, addDaysISO, dateLabel, onColor } from '../lib/constants.js'
import { PC } from './ProjectBits.jsx'

const STATUS_FILL = { live: PC.green, incoming: '#2a78d6', blocked: PC.red, done: '#6d6a70', idea: '#b5aeb8' }
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Gantt: every dated campaign as a bar on one shared time axis — start to
// end, colored by status, progress overlaid, today marked. The one view
// where overlaps and dead weeks are visible at a glance.
export default function CampaignGantt({ camps, onOpen }) {
  const today = todayISO()

  const { dated, undated, days } = useMemo(() => {
    const dated = camps
      .filter((c) => c.start_date && c.end_date)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
    const undated = camps.filter((c) => !c.start_date || !c.end_date)
    let from = addDaysISO(today, -7)
    let to = addDaysISO(today, 45) // blank runway ahead for planning
    for (const c of dated) {
      if (c.start_date < from) from = c.start_date
      if (c.end_date > to) to = c.end_date
    }
    // Hard cap so one far-future campaign can't stretch the axis absurdly.
    if (to > addDaysISO(today, 120)) to = addDaysISO(today, 120)
    if (from < addDaysISO(today, -45)) from = addDaysISO(today, -45)
    const days = []
    for (let d = from; d <= to; d = addDaysISO(d, 1)) days.push(d)
    return { dated, undated, days }
  }, [camps, today])

  const idx = useMemo(() => Object.fromEntries(days.map((d, i) => [d, i])), [days])
  const pos = (d) => (d in idx ? idx[d] : d < days[0] ? 0 : days.length - 1)
  const pct = (i) => (i / days.length) * 100
  const todayPct = pct(pos(today) + 0.5)

  // Month labels across the axis.
  const monthSpans = useMemo(() => {
    const spans = []
    for (let i = 0; i < days.length; i++) {
      const ym = days[i].slice(0, 7)
      if (!spans.length || spans[spans.length - 1].ym !== ym) spans.push({ ym, from: i, n: 1 })
      else spans[spans.length - 1].n++
    }
    return spans
  }, [days])

  if (camps.length === 0) return <div className="card card-pad empty">No campaigns yet.</div>

  return (
    <div className="card gantt-card">
      <div className="gantt-scroll">
        <div className="gantt" style={{ minWidth: Math.max(900, days.length * 24) }}>
          {/* axis */}
          <div className="gantt-axis">
            <div className="gantt-label" />
            <div className="gantt-track">
              {monthSpans.map((m) => (
                <span key={m.ym} className="gantt-month" style={{ left: `${pct(m.from)}%`, width: `${pct(m.n) - 0.2}%` }}>
                  {MONTH_SHORT[Number(m.ym.slice(5)) - 1]} {m.ym.slice(0, 4)}
                </span>
              ))}
              {days.map((d, i) => {
                const dow = new Date(`${d}T00:00:00`).getDay()
                if (dow !== 1 && d !== today) return null // Mondays + today
                return (
                  <span key={d} className={'gantt-tick' + (d === today ? ' now' : '')} style={{ left: `${pct(i)}%` }}>
                    {d.slice(8)}
                  </span>
                )
              })}
            </div>
          </div>

          {/* rows */}
          {dated.map((c) => {
            const s = pos(c.start_date)
            const e = pos(c.end_date)
            const fill = STATUS_FILL[c.status] || '#6d6a70'
            const progress = c.pace ? Math.min(100, c.pace.fill_pct) : 0
            return (
              <div key={c.id} className="gantt-row">
                <button className="gantt-label" onClick={() => onOpen(c)} data-tip="Open the campaign">
                  <span className="gantt-name">{c.name}</span>
                  <span className="gantt-sub">{c.owner_name || <span className="pc-red">no owner</span>}{c.project_name ? ` · ${c.project_name}` : ''}</span>
                </button>
                <div className="gantt-track">
                  <div className="gantt-today" style={{ left: `${todayPct}%` }} />
                  <button
                    className="gantt-bar"
                    style={{ left: `${pct(s)}%`, width: `${Math.max(pct(e - s + 1), 1.2)}%`, background: fill, color: onColor(fill) }}
                    onClick={() => onOpen(c)}
                    data-tip={`${c.name}: ${dateLabel(c.start_date)} → ${dateLabel(c.end_date)}${c.status === 'live' ? ` · ${progress}% of target` : ''} · ${c.status}`}
                  >
                    {c.status === 'live' && <span className="gantt-progress" style={{ width: `${progress}%` }} />}
                    <span className="gantt-bar-txt">{c.name}</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {undated.length > 0 && (
        <div className="gantt-undated">
          <span className="stat-sub" style={{ fontSize: 12.5, fontWeight: 700 }}>Without dates (not on the timeline):</span>
          {undated.map((c) => (
            <button key={c.id} className="chip chip-muted" onClick={() => onOpen(c)} data-tip="Open and give it dates">{c.name}</button>
          ))}
        </div>
      )}
    </div>
  )
}
