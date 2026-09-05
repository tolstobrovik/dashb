import { useEffect, useMemo, useState } from 'react'
import { Wallet, ChevronDown, Eye, EyeOff, Target } from 'lucide-react'
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

// Money on a screen other people can see over your shoulder.
//
// The board draws this on My Day, which is the page somebody has open while a
// colleague leans in to ask something. A salary is not a secret from the
// person earning it and IS one from the room, so it is covered until it is
// asked for — the way a banking app does it, and for the same reason.
//
// The choice is remembered per browser, not per account: it is about the room
// you are sitting in, not about you.
const SHOW_KEY = 'satashkent_pay_shown'
const readShown = () => { try { return localStorage.getItem(SHOW_KEY) === '1' } catch { return false } }

// What it would take to reach a number.
//
// People ask "how many more do I have to do" and answer it on paper with a
// rate they half-remember. The board holds every rate the admin set and every
// piece this person delivered, so it can answer properly — and it answers with
// THEIR mix of work, not an average of everybody's: somebody who shoots and
// cuts is told about shoots and cuts, and somebody who only writes is not
// offered a camera.
//
// Nothing here is hardcoded. Every rate comes down with the pay card, so
// changing what a reel is worth in the Admin panel changes this the next time
// the page loads and nowhere else.
function planFor(pay, target) {
  const gap = Math.max(0, target - (Number(pay.total) || 0))
  if (!gap) return { gap: 0, done: true, ways: [], mix: null }

  // Only hats that pay something. A rate of zero is not a way to earn.
  const paying = (pay.lines || []).filter((l) => Number(l.rate) > 0)
  if (!paying.length) return { gap, done: false, ways: [], mix: null }

  // One kind at a time: "or N of these".
  const ways = paying
    .map((l) => ({ hat: l.hat, label: l.label, rate: l.rate, need: Math.ceil(gap / l.rate) }))
    .sort((a, b) => a.need - b.need)

  // And the same gap closed the way they ACTUALLY work — their delivered
  // counts this month as the shape, scaled up until it covers the gap. A plan
  // shaped like somebody else's month is a plan they cannot follow.
  const doing = paying.filter((l) => l.count > 0)
  let mix = null
  if (doing.length > 1) {
    const perRound = doing.reduce((n, l) => n + l.count * l.rate, 0)
    if (perRound > 0) {
      const rounds = gap / perRound
      const parts = doing
        .map((l) => ({ label: l.label, n: Math.ceil(l.count * rounds) }))
        .filter((x) => x.n > 0)
      const worth = doing.reduce((n, l, i) => n + (parts[i]?.n || 0) * l.rate, 0)
      if (parts.length) mix = { parts, worth }
    }
  }
  return { gap, done: false, ways, mix }
}

export default function MyPay() {
  const [pay, setPay] = useState(null)
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(readShown)
  const [goal, setGoal] = useState('')
  const showMoney = (on) => {
    setShown(on)
    try { localStorage.setItem(SHOW_KEY, on ? '1' : '0') } catch { /* private window */ }
  }

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
          <b className={shown ? '' : 'pay-hidden'}>{shown ? money(pay.total, cur) : '••• •••'}</b>
          <span className="stat-sub">this month so far</span>
        </span>
        <span className="my-pay-facts">
          <span><b>{pay.delivered}</b>{pay.quota > 0 ? ` / ${pay.quota}` : ''} delivered</span>
          {pay.onTimePct !== null && (
            <span className={pay.onTimePct >= (pay.rates.ontime_target || 0) ? 'pay-good' : 'pay-bad'}>
              <b>{pay.onTimePct}%</b> on time
            </span>
          )}
          {/* The sum of what their work was watched. Shown once there is a
              number to show, or once the card pays on views at all. */}
          {(pay.views > 0 || pay.viewsTarget > 0 || pay.rates.per_1k_views > 0) && (
            <span className={pay.viewsTarget > 0 && pay.viewsMet ? 'pay-good' : undefined}>
              <b>{(pay.views || 0).toLocaleString()}</b>
              {pay.viewsTarget > 0 ? ` / ${pay.viewsTarget.toLocaleString()} views` : ' views'}
            </span>
          )}
        </span>
        <ChevronDown size={16} className={'my-pay-caret' + (open ? ' open' : '')} />
      </button>
      {/* Its own control, outside the fold: covering the number and opening the
          breakdown are different questions, and one button cannot answer both. */}
      <button type="button" className="my-pay-eye" onClick={() => showMoney(!shown)}
        data-tip={shown ? 'Hide the money' : 'Show the money'} data-tip-left=""
        aria-label={shown ? 'Hide the money' : 'Show the money'} aria-pressed={shown}>
        {shown ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>

      {open && <GoalBox pay={pay} cur={cur} goal={goal} setGoal={setGoal} shown={shown} />}

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
          {pay.viewsPay > 0 && (
            <div className="my-pay-line">
              <span>On views</span>
              <span className="stat-sub">{(pay.views || 0).toLocaleString()} × {money(pay.rates.per_1k_views, cur)} / 1,000</span>
              <b>{money(pay.viewsPay, cur)}</b>
            </div>
          )}
          {pay.viewsBonus > 0 && (
            <div className="my-pay-line">
              <span>Views bonus</span>
              <span className="stat-sub">{pay.viewsTarget.toLocaleString()} in the month</span>
              <b className="pay-good">+{money(pay.viewsBonus, cur)}</b>
            </div>
          )}
          {!pay.viewsBonus && pay.rates.views_bonus > 0 && pay.viewsLeft > 0 && (
            <div className="my-pay-line">
              <span className="stat-sub">Views bonus</span>
              <span className="stat-sub">{pay.viewsLeft.toLocaleString()} more views to go</span>
              <span className="stat-sub">{money(pay.rates.views_bonus, cur)}</span>
            </div>
          )}
          {/* A sum drawn from a third of the pieces reads as the whole month. */}
          {pay.viewsCounted > 0 && pay.viewsCounted < pay.delivered && (
            <div className="my-pay-line">
              <span className="stat-sub">Counted so far</span>
              <span className="stat-sub">{pay.viewsCounted} of {pay.delivered} pieces have a number on them</span>
              <span />
            </div>
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

// Type a number, see what reaches it.
function GoalBox({ pay, cur, goal, setGoal, shown }) {
  const target = Number(String(goal).replace(/\s/g, '')) || 0
  const plan = useMemo(() => (target > 0 ? planFor(pay, target) : null), [pay, target])

  return (
    <div className="pay-goal">
      <label className="pay-goal-ask">
        <Target size={15} />
        <span className="stat-sub">What do you want to make this month?</span>
        <input className="input" inputMode="numeric" value={goal} placeholder="5 000 000"
          onChange={(e) => setGoal(e.target.value.replace(/[^\d\s]/g, ''))} />
      </label>

      {plan && plan.done && (
        <div className="pay-goal-hit">You are there already.</div>
      )}

      {plan && !plan.done && plan.ways.length === 0 && (
        <div className="stat-sub">No rates are set for the work you do, so there is nothing to work out.</div>
      )}

      {plan && !plan.done && plan.ways.length > 0 && (
        <>
          <div className="pay-goal-gap">
            <span className="stat-sub">Still to earn</span>
            <b>{shown ? money(plan.gap, cur) : '••• •••'}</b>
          </div>
          {/* Their own mix first: the plan somebody can actually follow. */}
          {plan.mix && (
            <div className="pay-goal-mix">
              {plan.mix.parts.map((p) => (
                <span key={p.label} className="pay-goal-part"><b>{p.n}</b> {p.label.toLowerCase()}</span>
              ))}
            </div>
          )}
          <div className="pay-goal-ways">
            <span className="stat-sub">or</span>
            {plan.ways.map((w) => (
              <span key={w.hat} className="pay-goal-way">
                <b>{w.need}</b> {w.label.toLowerCase()}
                <i className="stat-sub"> · {money(w.rate, cur)} each</i>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
