import { useEffect, useState } from 'react'
import { CheckCircle2, Crown, History } from 'lucide-react'
import { api } from '../lib/api.js'
import { useIsPhone } from '../lib/usePhone.js'
import { money } from './SalaryPlanner.jsx'
import { tr as tx, locale } from '../lib/i18n.jsx'

// ---- the months behind this one ----------------------------------------------
//
// One number, once a month, tells nobody whether they are doing better than
// they were. Six of them side by side is a shape, and a shape is the thing
// somebody wants to beat. It is also the only place on this board that can
// answer the question people actually ask out loud — "was I paid for August?"
//
// Three kinds of month are drawn differently, because they are three different
// kinds of fact and drawing them alike would be a small lie:
//
//   settled   closed and paid. Solid, with a tick and the day the money went.
//   running   this month, still moving. Striped, because it is not a result.
//   assumed   a base salary the calculator will happily report for a month
//             with no record of this person working at all — including months
//             before they joined. Hollow, and it says so.
//
// The bars are scaled against the biggest month shown, not against zero to
// infinity, so a flat run of equal months reads as flat rather than as noise.

const monthWords = (m) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale(), { month: 'short', timeZone: 'UTC' })
const dayWords = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' })

export default function PayHistory({ shown = true, months }) {
  // Six columns need about 55px each on a phone, and a month of UZS is seven
  // digits — so six months came back as "3 140 0…" over a bar too narrow to
  // compare with anything. Four months on a phone is the same shape with room
  // to read it, which is what a chart is for.
  const phone = useIsPhone()
  const want = months || (phone ? 4 : 6)
  const [data, setData] = useState(null)
  useEffect(() => {
    api.get(`/reports/pay/mine/history?months=${want}`).then(setData).catch(() => setData(null))
  }, [want])

  if (!data || !data.months?.length) return null
  const rows = data.months
  // An assumed month is not a month. The calculator will happily report a full
  // base salary for five months before somebody joined, and drawn as bars
  // those five phantoms tower over the one real month and set the scale for
  // it. So they contribute neither a bar nor a figure — only the words "no
  // record", which is what is actually known about them.
  const real = rows.filter((m) => !m.assumed)
  // A board where nothing has ever been worked out has nothing to draw. Six
  // empty columns under a heading is worse than no heading.
  const top = Math.max(...real.map((m) => m.total), 0)
  if (top <= 0) return null
  const settled = rows.filter((m) => m.settled)
  const last = settled[settled.length - 1] || null
  // The best month on the chart, and only when there is something to be best
  // THAN. One month is not a record, and two months that came to the same
  // figure have no winner — a crown on an arbitrary one of them is a fact the
  // chart invented.
  const best = real.length > 1 && real.filter((m) => m.total === top).length === 1
    ? real.find((m) => m.total === top)
    : null

  return (
    <div className="pay-hist">
      <div className="ph-head">
        <History size={14} />
        <b>{tx('The months behind this one')}</b>
        {last && (
          <span className="stat-sub ph-last">
            <CheckCircle2 size={12} /> {tx('last paid {month} · {day}', {
              month: monthWords(last.month),
              day: last.payout?.paid_at ? dayWords(last.payout.paid_at) : monthWords(last.month),
            })}
          </span>
        )}
      </div>
      <div className="ph-bars">
        {rows.map((m) => {
          const kind = m.settled ? 'settled' : m.assumed ? 'assumed' : m.running ? 'running' : 'open'
          const h = m.assumed ? 0 : top > 0 ? Math.max(4, Math.round((m.total / top) * 100)) : 4
          const crown = best && best.month === m.month
          return (
            <div className={'ph-col ph-' + kind + (crown ? ' ph-best' : '')} key={m.month}
              title={crown ? tx('Your best month so far') : undefined}>
              <span className="ph-amount">{m.assumed ? '' : shown ? money(m.total, '') : '•••'}</span>
              <span className="ph-bar-box">
                {!m.assumed && <span className="ph-bar" style={{ height: `${h}%` }} />}
              </span>
              <span className="ph-month">{monthWords(m.month)}</span>
              <span className="ph-state">
                {crown ? <><Crown size={11} /> {tx('best')}</>
                  : m.settled ? <CheckCircle2 size={11} />
                    : m.running ? tx('now')
                      : m.assumed ? tx('no record') : ''}
              </span>
            </div>
          )
        })}
      </div>
      <div className="cm-hint ph-note">
        {tx('A month is settled when an admin records it as paid. Until then the figure is worked out live and can still move.')}
      </div>
    </div>
  )
}
