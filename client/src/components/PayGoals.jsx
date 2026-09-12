import { useEffect, useRef } from 'react'
import { Trophy, Target, Clock, Eye, TriangleAlert, Flame } from 'lucide-react'
import { money } from './SalaryPlanner.jsx'

// The board spaces its thousands. A comma here would be a second number
// system on a card that already has money on it.
const num = (n) => money(n, '')
import { celebrate } from '../lib/celebrate.js'
import { playDing } from '../lib/sound.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- what is still on the table ---------------------------------------------
//
// The pay card could say what the month HAD earned. It could not say what was
// still winnable, which is the thing anybody actually wants on the 18th: how
// far off the bonus is, and whether the days left are enough.
//
// A bonus was one grey line reading "5 more to go". That is a fact with no
// sense of scale — five more could be a comfortable week or an impossible
// afternoon, and the line read the same either way. So each one is drawn as a
// ring you can see yourself moving around, with the money on it, and the state
// of the month said in a sentence somebody can act on:
//
//   won      it is yours — and the moment it lands, it is celebrated
//   close    a day or two of ordinary work does it
//   open     not yet, and the month is running at a pace that gets there
//   behind   at this pace the month ends short — SAID WHILE THERE IS STILL
//            TIME, which is the entire point of saying it
//   lost     the days have gone
//
// The states come from the server, worked out from real deliveries. Nothing
// here can be moved by anything a browser sends. That matters more than it
// sounds: a reward that can be farmed stops being a reward within a week.
//
// None of this rings. The obvious next thought is a nightly "your quota bonus
// is slipping" notice, and it is the wrong thought: this board used to send a
// daily digest, every linked member's phone went off at midnight whether or
// not anything had changed, and the team asked for it to stop — a board that
// speaks every day is a board people mute. A warning that is waiting when you
// look is worth more than one that interrupts you, and money is exactly the
// subject where that is most true.

const ICON = { quota: Target, ontime: Clock, views: Eye }
const TONE = { won: 'won', close: 'close', open: 'open', behind: 'behind', lost: 'lost' }

// The ring. 44px, two arcs — the track and how far round the year has got —
// with the pct in the middle. Drawn rather than animated: a bar that fills
// itself on every render is a page that never settles.
function Ring({ pct, state }) {
  const R = 19
  const C = 2 * Math.PI * R
  const on = Math.max(0, Math.min(100, pct || 0))
  return (
    <svg className={'pg-ring pg-' + state} viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
      <circle className="pg-ring-track" cx="22" cy="22" r={R} fill="none" strokeWidth="4" />
      <circle className="pg-ring-on" cx="22" cy="22" r={R} fill="none" strokeWidth="4"
        strokeDasharray={`${(on / 100) * C} ${C}`} strokeLinecap="round"
        transform="rotate(-90 22 22)" />
      {state === 'won'
        ? <path className="pg-ring-tick" d="M15.5 22.5 L20 27 L28.5 17.5" fill="none" strokeWidth="2.6"
            strokeLinecap="round" strokeLinejoin="round" />
        : <text className="pg-ring-pct" x="22" y="22" textAnchor="middle" dominantBaseline="central">{on}</text>}
    </svg>
  )
}

// What to say about a goal, in one line somebody can act on. Every branch
// names a NUMBER and a VERB — "3 more delivered on time and it is yours",
// "15 to go in 18 days" — because "you are behind" is a mood, not an
// instruction, and a mood is not something anybody can do anything about.
function words(g) {
  const d = g.days_left
  if (g.state === 'won') return tx('Earned — {amount} is in your total', { amount: money(g.pays, '') })
  if (g.state === 'lost') {
    if (g.key === 'ontime') return tx('Out of reach this month')
    return d <= 0 ? tx('The month has gone') : tx('More than the days left can carry')
  }
  if (g.key === 'ontime') {
    const more = g.on_time_more
    if (!more) return tx('Deliver on time and it is yours')
    if (g.state === 'behind') return tx('{n} more on time would do it — more days than are left', { n: more })
    return more === 1
      ? tx('One more delivered on time and it is yours')
      : tx('{n} more delivered on time and it is yours', { n: more })
  }
  if (g.key === 'views') {
    if (g.state === 'behind') return tx('{n} views short with {d} days left', { n: num(g.left || 0), d })
    return tx('{n} more views to go', { n: num(g.left || 0) })
  }
  // The quota, which is the one people plan their week around.
  if (g.state === 'behind') {
    const rate = g.per_day || 0
    return rate <= 1
      ? tx('{n} to go in {d} days — about one a day', { n: g.left, d })
      : tx('{n} to go in {d} days — that is {r} a day', { n: g.left, d, r: Math.ceil(rate) })
  }
  if (g.state === 'close') return g.left === 1 ? tx('One more and it is yours') : tx('{n} more and it is yours', { n: g.left })
  return tx('{n} to go, {d} days left', { n: g.left, d })
}

// ---- the moment a bonus lands ------------------------------------------------
// Confetti on arrival at a page that merely REPORTS a bonus already earned
// would fire every morning for the rest of the month. It fires on the
// CROSSING, once, and the crossing is remembered per person per month so a
// refresh is not a second party.
const WON_KEY = (uid, month) => `satashkent_pay_won_${uid}_${month}`
const readWon = (k) => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')) } catch { return new Set() } }
const writeWon = (k, set) => { try { localStorage.setItem(k, JSON.stringify([...set])) } catch { /* private window */ } }


// ---- the one line that fits on a folded card ---------------------------------
//
// The goals block lives inside the pay card, and on My Day that card is folded
// — so on the page people actually spend their day on, the whole thing was
// invisible until somebody thought to open a card about money. Which nobody
// does on a Tuesday.
//
// So the folded card carries ONE line: the goal that most wants attention.
// Slipping beats nearly, nearly beats the rest, and a month with every bonus
// already earned says so, because that is the line worth reading twice.
export function PayGoalLine({ goals, period, currency, shown = true }) {
  if (!goals || goals.length === 0) return null
  const live = goals.filter((g) => g.state !== 'lost')
  if (live.length === 0) return null
  if (live.every((g) => g.state === 'won')) {
    return (
      <span className="pg-line pg-line-won">
        <Trophy size={12} />
        {live.length === 1 ? tx('Bonus earned this month') : tx('Every bonus earned this month')}
      </span>
    )
  }
  const ORDER = { behind: 0, close: 1, open: 2, won: 3 }
  const top = [...live].sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9))[0]
  if (!top || top.state === 'won') return null
  const I = ICON[top.key] || Target
  return (
    <span className={'pg-line pg-line-' + top.state}>
      {top.state === 'behind' ? <TriangleAlert size={12} /> : <I size={12} />}
      <b>{tx(top.label)}</b>
      <span>{words({ ...top, days_left: period?.days_left ?? top.days_left })}</span>
      <em>{shown ? money(top.pays, currency) : '••••••'}</em>
    </span>
  )
}

export default function PayGoals({ goals, period, currency, userId, month, shown = true }) {
  const seen = useRef(false)
  useEffect(() => {
    if (!goals || !goals.length || !month) return
    const key = WON_KEY(userId, month)
    const known = readWon(key)
    const won = goals.filter((g) => g.state === 'won')
    const fresh = won.filter((g) => !known.has(g.key))
    // The first time this page is ever opened in a month that already has
    // bonuses in it, they are recorded silently. Somebody who earned the quota
    // last Tuesday does not want a party about it on Friday.
    if (!seen.current) {
      seen.current = true
      if (known.size === 0 && won.length > 0) { writeWon(key, new Set(won.map((g) => g.key))); return }
    }
    if (!fresh.length) return
    writeWon(key, new Set([...known, ...fresh.map((g) => g.key)]))
    const total = fresh.reduce((a, g) => a + g.pays, 0)
    celebrate()
    playDing()
    toast(fresh.length === 1
      ? tx('{goal} earned · +{amount}', { goal: tx(fresh[0].label), amount: money(total, currency) })
      : tx('{n} bonuses earned · +{amount}', { n: fresh.length, amount: money(total, currency) }))
  }, [goals, month, userId, currency])

  if (!goals || goals.length === 0) return null
  const open = goals.filter((g) => g.state !== 'won' && g.state !== 'lost')
  const onTable = open.reduce((a, g) => a + g.pays, 0)
  const warn = goals.filter((g) => g.state === 'behind')
  // Slipping first, then nearly, then the rest, then the ones already won and
  // the ones already gone. A person opens this with a week left in the month
  // to find out what to do next, and what to do next is never the bonus they
  // have already earned.
  const ORDER = { behind: 0, close: 1, open: 2, won: 3, lost: 4 }
  const shownGoals = [...goals].sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9))

  return (
    <div className="pay-goals">
      <div className="pg-head">
        <Trophy size={14} />
        <b>{tx('Still on the table')}</b>
        {onTable > 0 && <span className="pg-purse">{shown ? money(onTable, currency) : '••••••'}</span>}
        {period?.days_left > 0 && (
          <span className="stat-sub pg-days">
            {period.days_left === 1 ? tx('1 day left') : tx('{n} days left', { n: period.days_left })}
          </span>
        )}
      </div>

      {/* The warning, said once at the top rather than three times down the
          list. It is the only red thing on the card, so it has to be worth it. */}
      {warn.length > 0 && period?.days_left > 0 && (
        <div className="pg-warn">
          <TriangleAlert size={14} />
          <span>
            {warn.length === 1
              ? tx('{goal} is slipping — at this pace the month ends short.', { goal: tx(warn[0].label) })
              : tx('{n} bonuses are slipping — at this pace the month ends short.', { n: warn.length })}
          </span>
        </div>
      )}

      <div className="pg-list">
        {shownGoals.map((g) => {
          const I = ICON[g.key] || Target
          return (
            <div className={'pg-goal pg-' + TONE[g.state]} key={g.key}>
              <Ring pct={g.pct} state={g.state} />
              <div className="pg-goal-body">
                <span className="pg-goal-name">
                  <I size={13} /> {tx(g.label)}
                  {g.state === 'close' && <em className="pg-flame"><Flame size={11} /> {tx('nearly')}</em>}
                </span>
                <span className="pg-goal-say">{words(g)}</span>
              </div>
              <span className="pg-goal-pays">{shown ? money(g.pays, '') : '••••'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
