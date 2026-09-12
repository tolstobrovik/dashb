import { useEffect, useMemo, useState } from 'react'
import { Calculator } from 'lucide-react'
import { api } from '../lib/api.js'
import { tr as tx } from '../lib/i18n.jsx'

// Money reads as money: grouped thousands, no decimals. UZS runs to millions.
export const money = (n, cur) => `${Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ')} ${cur || ''}`.trim()

// "I want to earn X this month — what does that take?"
//
// The answer is worked out from what this person has actually been doing —
// their pace, month by month, by what it was — and from the pay the board has
// set: the skip-rate tiers an admin keeps in Settings, read live, never
// written in here. A tier is what a piece pays the person who filmed it and
// the person who cut it, by how much of it was watched; a person who only
// cuts YouTube videos is paid the cut. Their own average skip rate picks the
// tier by default, and the ladder is right there to see what a better (or
// worse) band would do to the number — that is the penalty, made visible.
//
// The plan fills the gap fewest-pieces-first, but never suggests more than
// one-and-a-half times the pace a kind of work has actually shown, and never
// suggests a kind of work the person has never done while they have history
// in others. When that cannot reach the number, it says how far short.
const BUCKETS = ['reel', 'youtube', 'target']
const label = (k) => (k === 'reel' ? tx('reels') : k === 'youtube' ? tx('YouTube videos') : tx('targets'))
const tierFor = (tiers, skip) => (skip == null ? null : tiers.find((t) => skip >= t.min && skip <= t.max) || null)
const clean = (v) => Number(String(v).replace(/[^\d]/g, '')) || 0

export default function SalaryPlanner({ pay }) {
  const [pace, setPace] = useState(null)
  const [tiers, setTiers] = useState([])
  const [target, setTarget] = useState('')
  const [tierName, setTierName] = useState(null)

  useEffect(() => {
    api.get('/reports/work/mine/pace?months=3').then(setPace).catch(() => setPace({ by: {}, pieces: 0, shares: null, skip_avg: null }))
    api.get('/fields').then((f) => setTiers(Array.isArray(f?.skip_tiers) ? f.skip_tiers : [])).catch(() => {})
  }, [])
  // The band their own skip rate lands in; the best band when nothing has
  // been measured yet — a newcomer is shown what good work pays.
  useEffect(() => {
    if (tierName === null && tiers.length && pace) setTierName((tierFor(tiers, pace.skip_avg) || tiers[0]).name)
  }, [tiers, pace, tierName])

  const tier = tiers.find((t) => t.name === tierName) || null
  const rates = pay?.rates || {}
  const cur = pay?.currency
  const base = Number(pay?.base) || 0

  const rows = useMemo(() => {
    if (!pace) return []
    const by = pace.by || {}
    const assumed = { film: 1, edit: 1, made: 1 } // no history at all: assume they carry a piece alone
    return BUCKETS.map((key) => {
      const b = by[key] || {}
      const avg = Number(b.avg) || 0
      const sh = b.shares || pace.shares || assumed
      const value = tier
        ? Math.round(tier.per_film * sh.film + tier.per_edit * sh.edit)
        : Math.round((rates.per_shoot || 0) * sh.film + (rates.per_edit || 0) * sh.edit + (rates.per_publish || 0) * sh.made)
      const cap = avg > 0 ? Math.max(1, Math.ceil(avg * 1.5)) : (pace.pieces > 0 ? 0 : 4)
      return { key, avg, value, cap }
    })
  }, [pace, tier, rates])

  const plan = useMemo(() => {
    const goal = clean(target)
    if (!goal || !pace) return null
    const need = Math.max(0, goal - base)
    const atPace = Math.round(base + rows.reduce((s, r) => s + r.avg * r.value, 0))
    let left = need
    const mix = rows.map((r) => ({ ...r, n: 0 }))
    for (const r of [...mix].sort((a, b) => b.value - a.value)) {
      if (r.value <= 0 || r.cap <= 0 || left <= 0) continue
      r.n = Math.min(r.cap, Math.ceil(left / r.value))
      left -= r.n * r.value
    }
    const total = base + mix.reduce((s, r) => s + r.n * r.value, 0)
    return { goal, need, atPace, mix: mix.filter((r) => r.n > 0), total, reachable: left <= 0, gap: Math.max(0, left) }
  }, [target, pace, rows, base])

  const paceLine = pace && pace.pieces > 0
    ? tx('Your pace: {reels} reels · {youtube} YouTube videos · {targets} targets a month', {
      reels: rows[0]?.avg ?? 0, youtube: rows[1]?.avg ?? 0, targets: rows[2]?.avg ?? 0,
    })
    : pace ? tx('No history yet — assuming you film and cut each piece') : null

  return (
    <div className="planner">
      <div className="planner-head">
        <Calculator size={15} />
        <b>{tx('Desired salary')}</b>
        <span className="stat-sub">{tx('what it takes at your pace')}</span>
      </div>
      <div className="planner-row">
        <input className="input planner-in" inputMode="numeric" value={target} placeholder={tx('e.g. 6 000 000')}
          onChange={(e) => setTarget(e.target.value)} aria-label={tx('Desired salary')} />
        {cur && <span className="stat-sub">{cur}</span>}
        {tiers.length > 0 && (
          <div className="seg planner-tiers" role="radiogroup" aria-label={tx('Skip-rate tier')}>
            {tiers.map((t) => (
              <button key={t.name} type="button" className={'seg-btn' + (t.name === tierName ? ' on' : '')}
                onClick={() => setTierName(t.name)} data-tip={`${t.min}–${t.max}%`}>{t.name}</button>
            ))}
          </div>
        )}
      </div>
      <div className="stat-sub planner-note">
        {tier
          ? tx('Tier {name}: {film} for filming, {edit} for the cut, at {min}–{max}% skip rate', {
            name: tier.name, film: money(tier.per_film, cur), edit: money(tier.per_edit, cur), min: tier.min, max: tier.max,
          })
          : tiers.length === 0 ? tx('No skip-rate tiers set — using your rate card') : null}
        {pace?.skip_avg != null && tiers.length > 0 && ` · ${tx('your average skip rate is {pct}%', { pct: pace.skip_avg })}`}
      </div>
      {paceLine && <div className="stat-sub planner-note">{paceLine}</div>}
      {plan && (
        <div className="planner-out">
          {plan.need === 0 ? (
            <div className="planner-line">{tx('Your base already covers it.')}</div>
          ) : (
            <>
              <div className="planner-line stat-sub">
                {tx('Base {base} · {need} to earn from pieces', { base: money(base, cur), need: money(plan.need, cur) })}
              </div>
              <div className="planner-mix">
                {plan.mix.map((r) => (
                  <span key={r.key} className="planner-chip">
                    <b>{r.n}</b> {label(r.key)} <span className="stat-sub">× {money(r.value, cur)}</span>
                  </span>
                ))}
                {plan.mix.length === 0 && <span className="stat-sub">{tx('Nothing in your history pays under this tier.')}</span>}
              </div>
              <div className="planner-line">
                {plan.reachable
                  ? tx('That reaches {total} — up from {pace} at your current pace', { total: money(plan.total, cur), pace: money(plan.atPace, cur) })
                  : tx('Within 1.5× your pace you reach {total} — {gap} short', { total: money(plan.total, cur), gap: money(plan.gap, cur) })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
