import { Plus, Minus, CheckCircle2 } from 'lucide-react'

// Progress meter: same-ramp track, fill carries state (brand → green when complete).
// Shows both the raw count (8/18 reels) and the percentage, per the brief.
// auto = a plan metric: it fills from completed tasks, not from +/- clicks.
export default function Meter({ label, current, target, unit, period, onStep, canEdit, auto = false }) {
  const safeTarget = Math.max(1, target)
  const pct = Math.min(100, Math.round((current / safeTarget) * 100))
  const complete = current >= target

  return (
    <div className="meter">
      <div className="meter-top">
        <span className="meter-label">{label}</span>
        <span className="meter-count">
          <b>{current}</b>/{target}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div className="meter-track">
        <div className={`meter-fill${complete ? ' is-complete' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="meter-foot">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {complete ? (
            <span className="meter-pct" style={{ color: 'var(--good-ink)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={14} /> Complete
            </span>
          ) : (
            <span className="meter-pct" style={{ color: 'var(--brand-600)' }}>{pct}%</span>
          )}
          {period && <span className="badge badge-muted" style={{ textTransform: 'capitalize' }}>{period}</span>}
          {auto && <span className="badge badge-muted" title="Fills when tasks reach the final stage">from tasks</span>}
        </div>
        {canEdit && onStep && (
          <div className="meter-adjust">
            <button className="step-btn" onClick={() => onStep(-1)} disabled={current <= 0} aria-label="Decrease">
              <Minus size={15} />
            </button>
            <button className="step-btn" onClick={() => onStep(1)} aria-label="Increase">
              <Plus size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
