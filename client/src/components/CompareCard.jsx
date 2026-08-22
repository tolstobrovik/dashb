import { useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Minus as Flat } from 'lucide-react'
import { todayISO, addDaysISO } from '../lib/constants.js'
import { tr as tx } from '../lib/i18n.jsx'

const PERIODS = [
  { key: 'day', label: tx('Yesterday'), days: 1 },
  { key: 'week', label: 'Last week', days: 7 },
  { key: 'month', label: tx('Last month'), days: 30 },
  { key: 'custom', label: tx('Pick a date') },
]

// Growth comparison: current value vs the snapshot closest to the chosen
// reference date, for every metric in the channel.
export default function CompareCard({ trackers, history }) {
  const [period, setPeriod] = useState('week')
  const [customDate, setCustomDate] = useState(addDaysISO(todayISO(), -30))

  const refDate = period === 'custom'
    ? customDate
    : addDaysISO(todayISO(), -(PERIODS.find((p) => p.key === period)?.days || 7))

  const rows = useMemo(() => {
    const byTracker = {}
    for (const h of history) (byTracker[h.tracker_id] = byTracker[h.tracker_id] || []).push(h)
    return trackers.map((t) => {
      const snaps = (byTracker[t.id] || []).filter((h) => h.date <= refDate)
      const then = snaps.length ? snaps[snaps.length - 1].value : null
      const delta = then === null ? null : t.current - then
      const pct = then ? Math.round((delta / then) * 1000) / 10 : null
      return { t, then, delta, pct }
    })
  }, [trackers, history, refDate])

  return (
    <div className="card card-pad">
      <div className="compare-head">
        <span className="compare-cap">{tx('Compared with')}</span>
        <div className="pill-group">
          {PERIODS.map((p) => (
            <button key={p.key} className={'pill' + (period === p.key ? ' active' : '')} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <input className="input" type="date" style={{ width: 160 }} value={customDate}
            max={todayISO()} onChange={(e) => setCustomDate(e.target.value)} />
        )}
      </div>

      <div className="table-wrap">
        <table className="tbl compare-tbl">
          <thead>
            <tr><th>{tx('Metric')}</th><th>{tx('Then')}</th><th>{tx('Now')}</th><th>{tx('Change')}</th></tr>
          </thead>
          <tbody>
            {rows.map(({ t, then, delta, pct }) => (
              <tr key={t.id}>
                <td style={{ fontWeight: 600 }}>{t.label}</td>
                <td>{then === null ? <span className="stat-sub">no data</span> : then.toLocaleString()}</td>
                <td style={{ fontWeight: 700 }}>{t.current.toLocaleString()}</td>
                <td>
                  {delta === null ? (
                    <span className="stat-sub">—</span>
                  ) : (
                    <span className={`delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}`}>
                      {delta > 0 ? <TrendingUp size={14} /> : delta < 0 ? <TrendingDown size={14} /> : <Flat size={14} />}
                      {delta > 0 ? '+' : ''}{delta.toLocaleString()}
                      {pct !== null && <span className="delta-pct">({delta > 0 ? '+' : ''}{pct}%)</span>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
