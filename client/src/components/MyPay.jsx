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

  // Somebody with no rate card but a KPI carrying money still has a month
  // worth showing them.
  if (!pay || (pay.source === 'none' && !(pay.kpis || []).length)) return null
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
          <span><b>{pay.delivered}</b>{pay.quota > 0 ? ` / ${pay.quota}` : ''} delivered</span>
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
          {/* The KPIs the team keeps, each with what the board counted and
              whether that reached the target. This is the part people argue
              about at the end of the month, so it shows the arithmetic rather
              than the conclusion. */}
          {(pay.kpis || []).length > 0 && (
            <>
              <div className="my-pay-line my-pay-sub"><span>KPI</span><span /><span /></div>
              {pay.kpis.map((k) => (
                <div className="my-pay-line" key={k.id}>
                  <span className={k.met ? 'pay-good' : ''}>
                    {k.met ? '✓ ' : ''}{k.name}
                  </span>
                  <span className="stat-sub">
                    {k.actual === null ? '—' : k.actual}{k.unit ? ` ${k.unit}` : ''}
                    {k.target !== null && ` · ${k.direction === 'atmost' ? '≤' : '≥'} ${k.target}`}
                  </span>
                  {k.earned > 0
                    ? <b className="pay-good">+{money(k.earned, cur)}</b>
                    : <span className="stat-sub">{k.reward > 0 ? money(k.reward, cur) : ''}</span>}
                </div>
              ))}
            </>
          )}
          {pay.quotaBonus > 0 && (
            <div className="my-pay-line">
              <span>Quota bonus</span>
              <span className="stat-sub">{pay.quota} in the month</span>
              <b className="pay-good">+{money(pay.quotaBonus, cur)}</b>
            </div>
          )}
          {/* The one that is worth chasing, said plainly while there is still
              time to chase it. */}
          {!pay.quotaBonus && pay.rates.quota_bonus > 0 && pay.quotaLeft > 0 && (
            <div className="my-pay-line">
              <span className="stat-sub">Quota bonus</span>
              <span className="stat-sub">{pay.quotaLeft} more to go</span>
              <span className="stat-sub">{money(pay.rates.quota_bonus, cur)}</span>
            </div>
          )}
          {pay.onTimeBonus > 0 && (
            <div className="my-pay-line">
              <span>On-time bonus</span>
              <span className="stat-sub">{pay.rates.ontime_target}% or better</span>
              <b className="pay-good">+{money(pay.onTimeBonus, cur)}</b>
            </div>
          )}
          {/* Why the bonus is not there yet — a number missing with no reason
              given is the thing people come and ask about. */}
          {!pay.onTimeBonus && pay.rates.ontime_bonus > 0 && pay.onTimePct !== null && (
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

          {/* Which pieces, and which of them were late. A number saying you
              were late four times invites an argument; a list saying WHICH
              four ends it. */}
          {(pay.items || []).length > 0 && (
            <details className="my-pay-items">
              <summary className="stat-sub">
                {pay.items.length} delivered{pay.late > 0 ? ` · ${pay.late} late` : ''}
              </summary>
              <div>
                {pay.items.map((it) => (
                  <div key={`${it.hat}${it.id}`} className="my-pay-item">
                    <span>{it.title}</span>
                    <span className="stat-sub">{it.day}</span>
                    {it.late
                      ? <span className="pay-bad">late</span>
                      : <span className="pay-good">on time</span>}
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="cm-hint">
            Counted on the day your part was delivered. Work that reached you after
            its own day had gone is not counted against you.
          </div>
        </div>
      )}
    </div>
  )
}
