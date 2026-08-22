import { useEffect, useState } from 'react'
import { Wallet, ChevronDown } from 'lucide-react'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/constants.js'

// What this month is worth to the person looking at it.
//
// Everybody's pay was worked out somewhere else, on numbers that came from
// here, and then told to them at the end of the month. The board already
// knows, to the day, what each person delivered and how much of it landed on
// the day they promised — so it can say so as the month goes, while there is
// still something anybody can do about it.
//
// It shows nothing at all until an admin has set rates. A card reading
// "0 UZS" is worse than no card: it looks like a statement about the person
// rather than about the setup.

const money = (n, cur) => `${Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ')} ${cur || ''}`.trim()

export default function MyPay() {
  const [pay, setPay] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const t = todayISO()
    const from = t.slice(0, 8) + '01'
    api.get(`/reports/pay/mine?from=${from}&to=${t}`).then(setPay).catch(() => setPay(null))
  }, [])

  if (!pay || pay.source === 'none') return null
  const cur = pay.currency
  const earning = pay.lines.filter((l) => l.count > 0)

  return (
    <div className="card card-pad my-pay">
      <button type="button" className="my-pay-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Wallet size={17} />
        <span className="my-pay-sum">
          <b>{money(pay.total, cur)}</b>
          <span className="stat-sub">this month so far</span>
        </span>
        <span className="my-pay-facts">
          <span><b>{pay.delivered}</b> delivered</span>
          {pay.onTimePct !== null && (
            <span className={pay.onTimePct >= (pay.rates.ontime_target || 0) ? 'pay-good' : 'pay-bad'}>
              <b>{pay.onTimePct}%</b> on time
            </span>
          )}
        </span>
        <ChevronDown size={16} className={'my-pay-caret' + (open ? ' open' : '')} />
      </button>

      {open && (
        <div className="my-pay-lines">
          {pay.base > 0 && (
            <div className="my-pay-line"><span>Base</span><span /><b>{money(pay.base, cur)}</b></div>
          )}
          {earning.map((l) => (
            <div className="my-pay-line" key={l.hat}>
              <span>{l.label}</span>
              <span className="stat-sub">{l.count} × {money(l.rate, cur)}</span>
              <b>{money(l.amount, cur)}</b>
            </div>
          ))}
          {pay.bonus > 0 && (
            <div className="my-pay-line">
              <span>On-time bonus</span>
              <span className="stat-sub">{pay.rates.ontime_target}% or better</span>
              <b className="pay-good">+{money(pay.bonus, cur)}</b>
            </div>
          )}
          {/* Why the bonus is not there yet — a number missing with no reason
              given is the thing people come and ask about. */}
          {!pay.bonus && pay.rates.ontime_bonus > 0 && pay.onTimePct !== null && (
            <div className="my-pay-line">
              <span className="stat-sub">On-time bonus</span>
              <span className="stat-sub">needs {pay.rates.ontime_target}% — you are on {pay.onTimePct}%</span>
              <span className="stat-sub">{money(pay.rates.ontime_bonus, cur)}</span>
            </div>
          )}
          {pay.penalty > 0 && (
            <div className="my-pay-line">
              <span>Late</span>
              <span className="stat-sub">{pay.late} × {money(pay.rates.late_penalty, cur)}</span>
              <b className="pay-bad">−{money(pay.penalty, cur)}</b>
            </div>
          )}
          <div className="my-pay-line my-pay-total">
            <span>So far this month</span><span /><b>{money(pay.total, cur)}</b>
          </div>
          <div className="cm-hint">
            Counted on the day your part was delivered. Work that reached you after
            its own day had gone is not counted against you.
          </div>
        </div>
      )}
    </div>
  )
}
