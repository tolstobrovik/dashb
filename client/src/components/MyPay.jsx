import { useEffect, useState } from 'react'
import { Wallet, ChevronDown, Eye, EyeOff } from 'lucide-react'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/constants.js'
import { useAuth } from '../lib/auth.jsx'
import { tr as tx } from '../lib/i18n.jsx'
import SalaryPlanner, { money } from './SalaryPlanner.jsx'
import { Dot } from './Dot.jsx'

// What this month is worth to the person looking at it — and, under it, what
// the month they WANT would take.
//
// The amount is hidden until they ask for it, the way a banking app hides a
// balance: My Day is open on desks and phones in a shared office, and pay is
// the one number on it that is nobody else's business. The choice is
// remembered per person; the counts beside it (delivered, on time, views)
// are not money and stay in view.
//
// It shows nothing at all until an admin has set rates. A card reading
// "0 UZS" is worse than no card: it looks like a statement about the person
// rather than about the setup.

const SHOWN_KEY = (uid) => `satashkent_pay_shown_${uid}`

// `startOpen` is for the Payment page, where the breakdown IS the page and
// folding it away would leave a card with one number on it.
export default function MyPay({ startOpen = false }) {
  const { user } = useAuth()
  const [pay, setPay] = useState(null)
  const [open, setOpen] = useState(startOpen)
  const [shown, setShown] = useState(() => { try { return localStorage.getItem(SHOWN_KEY(user?.id)) === '1' } catch { return false } })
  const toggle = (e) => {
    e.stopPropagation()
    setShown((v) => { try { localStorage.setItem(SHOWN_KEY(user?.id), v ? '' : '1') } catch { /* ok */ } return !v })
  }

  const [kpi, setKpi] = useState(null)
  useEffect(() => {
    const t = todayISO()
    const from = t.slice(0, 8) + '01'
    api.get(`/reports/pay/mine?from=${from}&to=${t}`).then(setPay).catch(() => setPay(null))
    // The month's KPI card, if an admin has set one. Nothing is shown when
    // there is none: an empty ladder is a statement about the setup rather
    // than about the person.
    api.get('/reports/kpi/mine').then((d) => setKpi(d?.card || null)).catch(() => setKpi(null))
  }, [])

  // A KPI card stands on its own. Somebody paid a fixed salary against a set
  // of grades has no piece rates at all, and bailing out on the rate card left
  // them looking at a page with nothing on it about their own month.
  const hasRates = !!pay && pay.source !== 'none'
  const hasKpi = !!kpi && (kpi.ladders.length > 0 || kpi.fixed > 0)
  if (!hasRates && !hasKpi) return null
  const cur = (hasRates ? pay.currency : kpi?.currency) || 'UZS'
  const earning = hasRates ? pay.lines.filter((l) => l.count > 0) : []
  const amt = (n) => (shown ? money(n, cur) : '••••••')

  return (
    <div className={'card card-pad my-pay' + (shown ? '' : ' my-pay-hidden')}>
      <button type="button" className="my-pay-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Wallet size={17} />
        <span className="my-pay-sum">
          <b>{amt((hasRates ? pay.total : 0) + (hasKpi ? kpi.total : 0))}</b>
          <span className="stat-sub">{tx('expected this month')}</span>
        </span>
        <span role="button" tabIndex={0} className="icon-btn my-pay-eye" onClick={toggle}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e) }}
          aria-label={shown ? tx('Hide the amount') : tx('Show the amount')} data-tip={shown ? tx('Hide the amount') : tx('Show the amount')}>
          {shown ? <EyeOff size={15} /> : <Eye size={15} />}
        </span>
        <span className="my-pay-facts">
          {hasRates && <>
          <span><b>{pay.delivered}</b>{pay.quota > 0 ? ` / ${pay.quota}` : ''} {tx('delivered')}</span>
          {pay.onTimePct !== null && (
            <span className={pay.onTimePct >= (pay.rates.ontime_target || 0) ? 'pay-good' : 'pay-bad'}>
              <b>{pay.onTimePct}%</b> {tx('on time')}
            </span>
          )}
          {(pay.views > 0 || pay.viewsTarget > 0 || pay.rates.per_1k_views > 0) && (
            <span className={pay.viewsTarget > 0 && pay.viewsMet ? 'pay-good' : undefined}>
              <b>{(pay.views || 0).toLocaleString()}</b>
              {pay.viewsTarget > 0 ? ` / ${pay.viewsTarget.toLocaleString()}` : ''} {tx('views')}
            </span>
          )}
          </>}
        </span>
        <ChevronDown size={16} className={'my-pay-caret' + (open ? ' open' : '')} />
      </button>

      {open && (
        <div className="my-pay-lines">
          {!shown && <div className="stat-sub my-pay-veil">{tx('Amounts are hidden — press the eye to show them')}</div>}
          {hasRates && <>
          {pay.base > 0 && (
            <div className="my-pay-line"><span>{tx('Base')}</span><span /><b>{amt(pay.base)}</b></div>
          )}
          {earning.map((l) => (
            <div className="my-pay-line" key={l.hat}>
              <span>{tx(l.label)}</span>
              <span className="stat-sub">{l.count} × {amt(l.rate)}</span>
              <b>{amt(l.amount)}</b>
            </div>
          ))}
          {pay.viewsPay > 0 && (
            <div className="my-pay-line">
              <span>{tx('On views')}</span>
              <span className="stat-sub">{(pay.views || 0).toLocaleString()} × {amt(pay.rates.per_1k_views)} / 1 000</span>
              <b>{amt(pay.viewsPay)}</b>
            </div>
          )}
          {pay.viewsBonus > 0 && (
            <div className="my-pay-line">
              <span>{tx('Views bonus')}</span>
              <span className="stat-sub">{pay.viewsTarget.toLocaleString()} {tx('in the month')}</span>
              <b className="pay-good">+{amt(pay.viewsBonus)}</b>
            </div>
          )}
          {!pay.viewsBonus && pay.rates.views_bonus > 0 && pay.viewsLeft > 0 && (
            <div className="my-pay-line">
              <span className="stat-sub">{tx('Views bonus')}</span>
              <span className="stat-sub">{tx('{n} more views to go', { n: pay.viewsLeft.toLocaleString() })}</span>
              <span className="stat-sub">{amt(pay.rates.views_bonus)}</span>
            </div>
          )}
          {pay.viewsCounted > 0 && pay.viewsCounted < pay.delivered && (
            <div className="my-pay-line">
              <span className="stat-sub">{tx('Counted so far')}</span>
              <span className="stat-sub">{tx('{counted} of {delivered} pieces have a number on them', { counted: pay.viewsCounted, delivered: pay.delivered })}</span>
              <span />
            </div>
          )}
          {pay.quotaBonus > 0 && (
            <div className="my-pay-line">
              <span>{tx('Quota bonus')}</span>
              <span className="stat-sub">{pay.quota} {tx('in the month')}</span>
              <b className="pay-good">+{amt(pay.quotaBonus)}</b>
            </div>
          )}
          {!pay.quotaBonus && pay.rates.quota_bonus > 0 && pay.quotaLeft > 0 && (
            <div className="my-pay-line">
              <span className="stat-sub">{tx('Quota bonus')}</span>
              <span className="stat-sub">{tx('{n} more to go', { n: pay.quotaLeft })}</span>
              <span className="stat-sub">{amt(pay.rates.quota_bonus)}</span>
            </div>
          )}
          {pay.onTimeBonus > 0 && (
            <div className="my-pay-line">
              <span>{tx('On-time bonus')}</span>
              <span className="stat-sub">{tx('{target}% or better', { target: pay.rates.ontime_target })}</span>
              <b className="pay-good">+{amt(pay.onTimeBonus)}</b>
            </div>
          )}
          {!pay.onTimeBonus && pay.rates.ontime_bonus > 0 && pay.onTimePct !== null && (
            <div className="my-pay-line">
              <span className="stat-sub">{tx('On-time bonus')}</span>
              <span className="stat-sub">{tx('needs {target}% — you are on {pct}%', { target: pay.rates.ontime_target, pct: pay.onTimePct })}</span>
              <span className="stat-sub">{amt(pay.rates.ontime_bonus)}</span>
            </div>
          )}
          {pay.penalty > 0 && (
            <div className="my-pay-line">
              <span>{tx('Late')}</span>
              <span className="stat-sub">{pay.late} × {amt(pay.rates.late_penalty)}</span>
              <b className="pay-bad">−{amt(pay.penalty)}</b>
            </div>
          )}
          <div className="my-pay-line my-pay-total">
            <span>{tx('Expected this month')}</span><span /><b>{amt(pay.total)}</b>
          </div>

          {(pay.items || []).length > 0 && (
            <details className="my-pay-items">
              <summary className="stat-sub">
                {tx('{n} delivered', { n: pay.items.length })}{pay.late > 0 ? ` · ${tx('{n} late', { n: pay.late })}` : ''}
              </summary>
              <div>
                {pay.items.map((it) => (
                  <div key={`${it.hat}${it.id}`} className="my-pay-item">
                    <span>{it.title}</span>
                    <span className="stat-sub">{it.day}</span>
                    {it.late ? <Dot tone="late" label={tx('late')} /> : <Dot tone="ok" label={tx('on time')} />}
                  </div>
                ))}
              </div>
            </details>
          )}

          </>}

          {/* The KPI card for the month: every ladder the admin set, the reading
              it was graded on, the grade it reached and what that band pays.
              A ladder nobody took a reading for says so instead of grading a D
              against a number that was never taken, and a bonus held behind a
              floor says which floor rather than showing a bare nought. */}
          {kpi && (kpi.ladders.length > 0 || kpi.fixed > 0) && (
            <div className="kpi-card">
              <div className="section-head"><h3>{tx('This month’s KPI')}</h3></div>
              {kpi.fixed > 0 && (
                <div className="my-pay-line"><span>{tx('Fixed')}</span><span /><b>{amt(kpi.fixed)}</b></div>
              )}
              {kpi.ladders.map((l) => (
                <div className="my-pay-line kpi-line" key={l.key}>
                  <span>{tx(l.label)}{l.grade ? <b className="kpi-grade">{l.grade}</b> : null}</span>
                  <span className="stat-sub">
                    {l.value === null
                      ? tx('no reading yet')
                      : `${l.value}${l.unit || ''}`}
                    {l.gated ? ` · ${tx('needs {n} to qualify', { n: l.gated.need })}` : ''}
                  </span>
                  {l.pays > 0 ? <b className="pay-good">+{amt(l.pays)}</b> : <span className="stat-sub">{amt(0)}</span>}
                </div>
              ))}
              <div className="my-pay-line my-pay-total">
                <span>{tx('KPI this month')}</span><span /><b>{amt(kpi.total)}</b>
              </div>
            </div>
          )}

          {hasRates && <div className="cm-hint">
            {tx('Counted on the day your part was delivered. Work that reached you after its own day had gone is not counted against you.')}
          </div>}

          {hasRates && <SalaryPlanner pay={pay} />}
        </div>
      )}
    </div>
  )
}
