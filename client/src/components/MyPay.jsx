import { useEffect, useState } from 'react'
import { Wallet, ChevronDown, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/constants.js'
import { useAuth } from '../lib/auth.jsx'
import { tr as tx } from '../lib/i18n.jsx'
import SalaryPlanner, { money } from './SalaryPlanner.jsx'
import PayGoals, { PayGoalLine } from './PayGoals.jsx'
import PayHistory from './PayHistory.jsx'
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
  const amt = (n) => (shown ? money(n, cur) : '••••••')

  // A month somebody has been paid for is not an estimate any more, and the
  // card should stop calling it one. "Expected" over a figure that has already
  // reached a bank account is the kind of small wrongness that makes people
  // stop believing the rest of the page.
  const settled = hasRates ? pay.payout : null
  // …and neither is anything under it. The first cut put the frozen total
  // above a breakdown the calculator re-derived on every load: a number that
  // cannot move, itemised by numbers that can. They agree the day the month
  // closes, and stop agreeing the first time somebody edits an old task. So a
  // settled month is READ from the record, whole — lines, rates, counts and
  // the pieces it was paid for.
  const frozen = settled?.breakdown && Object.keys(settled.breakdown).length ? settled.breakdown : null
  const view = frozen
    ? { ...pay, ...frozen, total: settled.total, rates: frozen.rates || pay.rates,
        lines: frozen.lines || [], items: frozen.items || [],
        quotaLeft: null, viewsLeft: null,
        quotaMet: (frozen.quotaBonus || 0) > 0, viewsMet: (frozen.viewsBonus || 0) > 0 }
    : pay
  const earning = hasRates ? (view.lines || []).filter((l) => l.count > 0) : []

  return (
    <div className={'card card-pad my-pay' + (shown ? '' : ' my-pay-hidden') + (settled ? ' my-pay-settled' : '')}>
      <button type="button" className="my-pay-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Wallet size={17} />
        <span className="my-pay-sum">
          <b>{amt(settled ? view.total : (hasRates ? pay.total : 0) + (hasKpi ? kpi.total : 0))}</b>
          <span className="stat-sub">
            {settled
              ? <><CheckCircle2 size={12} /> {tx('paid this month')}</>
              : tx('expected this month')}
          </span>
        </span>
        <span role="button" tabIndex={0} className="icon-btn my-pay-eye" onClick={toggle}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e) }}
          aria-label={shown ? tx('Hide the amount') : tx('Show the amount')} data-tip={shown ? tx('Hide the amount') : tx('Show the amount')}>
          {shown ? <EyeOff size={15} /> : <Eye size={15} />}
        </span>
        <span className="my-pay-facts">
          {hasRates && <>
          <span><b>{view.delivered}</b>{view.quota > 0 ? ` / ${view.quota}` : ''} {tx('delivered')}</span>
          {view.onTimePct !== null && (
            <span className={view.onTimePct >= (view.rates.ontime_target || 0) ? 'pay-good' : 'pay-bad'}>
              <b>{view.onTimePct}%</b> {tx('on time')}
            </span>
          )}
          {(view.views > 0 || view.viewsTarget > 0 || view.rates.per_1k_views > 0) && (
            <span className={view.viewsTarget > 0 && view.viewsMet ? 'pay-good' : undefined}>
              <b>{money(view.views || 0, '')}</b>
              {view.viewsTarget > 0 ? ` / ${money(view.viewsTarget, '')}` : ''} {tx('views')}
            </span>
          )}
          </>}
        </span>
        <ChevronDown size={16} className={'my-pay-caret' + (open ? ' open' : '')} />
        {/* Folded, this card is a number and a caret — and on My Day, where it
            is always folded, that meant the whole of what is still winnable
            was behind a press nobody makes on a Tuesday. One line comes out
            to meet them: the goal that most wants attention today. */}
        {!open && !settled && hasRates && (
          <PayGoalLine goals={pay.goals} period={pay.period} currency={cur} shown={shown} />
        )}
      </button>

      {open && (
        <div className="my-pay-lines">
          {!shown && <div className="stat-sub my-pay-veil">{tx('Amounts are hidden — press the eye to show them')}</div>}
          {/* What is still winnable, before the accounting of what already is.
              The lines below answer "what did I earn"; this answers "what can
              I still do about it", which is the question with a week left in
              the month. A month that has been closed and paid has nothing
              left on the table, so it says nothing. */}
          {hasRates && !settled && (
            <PayGoals goals={pay.goals} period={pay.period} currency={cur}
              userId={user?.id} month={(pay.period?.to || '').slice(0, 7)} shown={shown} />
          )}
          {hasRates && <>
          {view.base > 0 && (
            <div className="my-pay-line"><span>{tx('Base')}</span><span /><b>{amt(view.base)}</b></div>
          )}
          {earning.map((l) => (
            <div className="my-pay-line" key={l.hat}>
              <span>{tx(l.label)}</span>
              <span className="stat-sub">{l.count} × {amt(l.rate)}</span>
              <b>{amt(l.amount)}</b>
            </div>
          ))}
          {view.viewsPay > 0 && (
            <div className="my-pay-line">
              <span>{tx('On views')}</span>
              <span className="stat-sub">{money(view.views || 0, '')} × {amt(view.rates.per_1k_views)} / 1 000</span>
              <b>{amt(view.viewsPay)}</b>
            </div>
          )}
          {view.viewsBonus > 0 && (
            <div className="my-pay-line">
              <span>{tx('Views bonus')}</span>
              <span className="stat-sub">{money(view.viewsTarget, '')} {tx('in the month')}</span>
              <b className="pay-good">+{amt(view.viewsBonus)}</b>
            </div>
          )}
          {view.viewsCounted > 0 && view.viewsCounted < view.delivered && (
            <div className="my-pay-line">
              <span className="stat-sub">{tx('Counted so far')}</span>
              <span className="stat-sub">{tx('{counted} of {delivered} pieces have a number on them', { counted: view.viewsCounted, delivered: view.delivered })}</span>
              <span />
            </div>
          )}
          {view.quotaBonus > 0 && (
            <div className="my-pay-line">
              <span>{tx('Quota bonus')}</span>
              <span className="stat-sub">{view.quota} {tx('in the month')}</span>
              <b className="pay-good">+{amt(view.quotaBonus)}</b>
            </div>
          )}
          {view.onTimeBonus > 0 && (
            <div className="my-pay-line">
              <span>{tx('On-time bonus')}</span>
              <span className="stat-sub">{tx('{target}% or better', { target: view.rates.ontime_target })}</span>
              <b className="pay-good">+{amt(view.onTimeBonus)}</b>
            </div>
          )}
          {view.penalty > 0 && (
            <div className="my-pay-line">
              <span>{tx('Late')}</span>
              <span className="stat-sub">{view.late} × {amt(view.rates.late_penalty)}</span>
              <b className="pay-bad">−{amt(view.penalty)}</b>
            </div>
          )}
          <div className="my-pay-line my-pay-total">
            <span>{settled ? tx('Paid this month') : tx('Expected this month')}</span><span /><b>{amt(view.total)}</b>
          </div>

          {(view.items || []).length > 0 && (
            <details className="my-pay-items">
              <summary className="stat-sub">
                {tx('{n} delivered', { n: view.items.length })}{view.late > 0 ? ` · ${tx('{n} late', { n: view.late })}` : ''}
              </summary>
              <div>
                {view.items.map((it) => (
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

          <PayHistory shown={shown} />

          {hasRates && <SalaryPlanner pay={pay} />}
        </div>
      )}
    </div>
  )
}
