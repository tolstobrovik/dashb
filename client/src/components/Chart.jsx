import { useEffect, useMemo, useRef, useState } from 'react'
import { tr as tx, locale } from '../lib/i18n.jsx'

// Charts, drawn by hand.
//
// The board already draws its pie this way, for the reason that applies here
// too: a charting library and its d3 dependencies weigh more than every page
// that would use them put together, and none of them would give the shape
// asked for without a stylesheet fighting theirs. So this is the whole kit —
// an area chart, a bar chart and a sparkline — in SVG, on the board's own
// tokens, in about the space one library's import statement would cost.
//
// The shape is the one people recognise from a modern dashboard: no chart
// border, no axis lines, a few faint horizontal rules to read values against,
// a smooth curve over a fill that fades out, and the labels small and quiet
// underneath. Everything that is not data is turned down until the data is
// the only thing with contrast.
//
// Hovering is the whole interaction: a guide line at the nearest reading and a
// card saying what it was. There is nothing to click, because a chart on this
// board answers "when were we busy" and the answer is the picture.

// ---- measuring ----------------------------------------------------------
// Drawing into a fixed viewBox and letting SVG scale is one line shorter and
// wrong: it scales the strokes and the type with the box, so the same chart is
// hairline-thin on a desk and fat on a phone. Real pixels, measured.
function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Some browsers hand back a zero on the first frame of a folded section.
    const read = () => setW(Math.round(el.getBoundingClientRect().width))
    read()
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// ---- the curve ----------------------------------------------------------
// Monotone cubic (Fritsch–Carlson). A plain Bézier through the same points
// overshoots: three quiet days after a busy one and the curve dips below zero
// between them, drawing work that never happened. This one cannot — between
// two readings it stays between them.
function monotonePath(pts) {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0].x},${pts[0].y}`
  if (n === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`
  const dx = [], dy = [], m = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    dy[i] = pts[i + 1].y - pts[i].y
    m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i]
  }
  const t = [m[0]]
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) { t[i] = 0; continue }
    const w1 = 2 * dx[i] + dx[i - 1]
    const w2 = dx[i] + 2 * dx[i - 1]
    t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i])
  }
  t[n - 1] = m[n - 2]
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3
    const y1 = pts[i].y + (t[i] * dx[i]) / 3
    const x2 = pts[i + 1].x - dx[i] / 3
    const y2 = pts[i + 1].y - (t[i + 1] * dx[i]) / 3
    d += `C${x1},${y1} ${x2},${y2} ${pts[i + 1].x},${pts[i + 1].y}`
  }
  return d
}

// ---- scales -------------------------------------------------------------
// A y-axis that starts wherever the data starts exaggerates every wobble into
// a cliff. It starts at zero, always, and the top is rounded up to something a
// person would have chosen — 8, 10, 25, 50 — so the rules land on round
// numbers and the labels beside them are readable.
const niceTop = (max) => {
  if (max <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(max))
  const n = max / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * pow
}
const short = (n) => {
  const v = Math.abs(n)
  if (v >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`
  if (v >= 1_000) return `${Math.round(n / 100) / 10}k`
  return String(Math.round(n * 10) / 10)
}
// A date label a person reads, not an ISO string. Days when the window is
// short, months when it is long — a hundred "3 Sep"s is not an axis.
const tick = (iso, span) => {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(+d)) return iso
  return d.toLocaleDateString(locale(), span > 120
    ? { month: 'short', timeZone: 'UTC' }
    : { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const PAD = { top: 12, right: 8, bottom: 24, left: 34 }

// ---- the area chart -----------------------------------------------------
// `series` is [{ key, label, color, values: number[] }]; `labels` is the x
// axis, one per reading. Stacked by default, because the question these
// answer is nearly always "how much altogether, and how was it split".
export function AreaChart({
  series = [], labels = [], height = 220, stacked = true, valueLabel = '', emptyText = '',
}) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const n = labels.length
  const live = series.filter((s) => (s.values || []).some((v) => Number(v) > 0))
  const totalOf = (i) => series.reduce((a, s) => a + (Number(s.values?.[i]) || 0), 0)

  // Stacked tops, per series, per reading.
  const stacks = useMemo(() => {
    const out = series.map(() => [])
    for (let i = 0; i < n; i++) {
      let run = 0
      series.forEach((s, si) => {
        const v = Number(s.values?.[i]) || 0
        run = stacked ? run + v : v
        out[si][i] = run
      })
    }
    return out
  }, [series, n, stacked])

  const max = useMemo(() => {
    let m = 0
    for (let i = 0; i < n; i++) {
      for (const col of stacks) m = Math.max(m, col[i] || 0)
    }
    return niceTop(m)
  }, [stacks, n])

  if (n === 0 || live.length === 0) {
    return (
      <div className="chart-empty" style={{ height }} ref={ref}>
        {emptyText || tx('Nothing to draw yet')}
      </div>
    )
  }

  const iw = Math.max(0, w - PAD.left - PAD.right)
  const ih = Math.max(0, height - PAD.top - PAD.bottom)
  const xAt = (i) => PAD.left + (n === 1 ? iw / 2 : (i * iw) / (n - 1))
  const yAt = (v) => PAD.top + ih - (Math.max(0, v) / max) * ih

  // Four rules including the floor: enough to read a value against, few
  // enough that the grid never competes with the line.
  const rules = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: max * f, y: yAt(max * f) }))
  // A label every so often, so they never collide however narrow it gets.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 62))))

  return (
    <div className="chart" ref={ref}>
      {w > 0 && (
        <svg
          width={w} height={height} className="chart-svg" role="img"
          aria-label={`${valueLabel || tx('Activity')} — ${labels[0]} ${tx('to')} ${labels[n - 1]}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            const x = e.clientX - box.left
            const i = n === 1 ? 0 : Math.round(((x - PAD.left) / (iw || 1)) * (n - 1))
            setHover(Math.max(0, Math.min(n - 1, i)))
          }}
        >
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`cg-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.34" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>

          {rules.map((r, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={w - PAD.right} y1={r.y} y2={r.y} className="chart-rule" />
              <text x={PAD.left - 8} y={r.y + 3.5} className="chart-axis" textAnchor="end">{short(r.v)}</text>
            </g>
          ))}

          {/* Drawn back to front so the lower band sits on top of the taller
              one it is part of, which is what makes a stack readable. */}
          {[...series].reverse().map((s) => {
            const si = series.indexOf(s)
            const pts = labels.map((_, i) => ({ x: xAt(i), y: yAt(stacks[si][i] || 0) }))
            const line = monotonePath(pts)
            const floor = stacked && si > 0
              ? labels.map((_, i) => ({ x: xAt(i), y: yAt(stacks[si - 1][i] || 0) })).reverse()
              : [{ x: xAt(n - 1), y: yAt(0) }, { x: xAt(0), y: yAt(0) }]
            const fill = `${line}${stacked && si > 0 ? monotonePath(floor).replace(/^M/, 'L') : `L${floor[0].x},${floor[0].y}L${floor[1].x},${floor[1].y}`}Z`
            return (
              <g key={s.key}>
                <path d={fill} fill={`url(#cg-${s.key})`} />
                <path d={line} fill="none" stroke={s.color} strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )
          })}

          {labels.map((l, i) => (i % every === 0 || i === n - 1 ? (
            <text key={i} x={xAt(i)} y={height - 7} className="chart-axis" textAnchor="middle">
              {tick(l, n)}
            </text>
          ) : null))}

          {hover !== null && (
            <g className="chart-guide">
              <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={PAD.top + ih} />
              {series.map((s, si) => (
                (Number(s.values?.[hover]) || 0) > 0
                  ? <circle key={s.key} cx={xAt(hover)} cy={yAt(stacks[si][hover] || 0)} r="3.5"
                      fill="var(--surface)" stroke={s.color} strokeWidth="2" />
                  : null
              ))}
            </g>
          )}
        </svg>
      )}

      {hover !== null && (
        <div className="chart-tip" style={{ left: `${Math.min(Math.max(xAt(hover), 70), Math.max(70, w - 70))}px` }}>
          <b>{tick(labels[hover], n)}</b>
          {series.map((s) => (
            <span key={s.key} className="chart-tip-row">
              <i style={{ background: s.color }} />
              {tx(s.label)}<b>{Number(s.values?.[hover]) || 0}</b>
            </span>
          ))}
          {series.length > 1 && (
            <span className="chart-tip-row chart-tip-total">
              {tx('Altogether')}<b>{totalOf(hover)}</b>
            </span>
          )}
        </div>
      )}

      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.key}><i style={{ background: s.color }} />{tx(s.label)}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- the bar chart ------------------------------------------------------
// For a handful of named things compared against each other — people, channels,
// weekdays. Horizontal, because the names are words and words read across.
export function BarChart({ rows = [], height = 20, emptyText = '', tone }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.value) || 0))
  if (rows.length === 0) return <div className="chart-empty chart-empty-sm">{emptyText || tx('Nothing to draw yet')}</div>
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div className="hbar" key={r.key ?? r.label} style={{ height }}>
          <span className="hbar-name" title={r.label}>{r.label}</span>
          <span className="hbar-track">
            <span
              className={'hbar-fill' + (tone ? ` hbar-${tone(r)}` : '')}
              style={{ width: `${Math.round(((Number(r.value) || 0) / max) * 100)}%`, background: r.color || undefined }}
            />
          </span>
          <b className="hbar-val">{r.display ?? (Number(r.value) || 0).toLocaleString()}</b>
        </div>
      ))}
    </div>
  )
}

// ---- the sparkline ------------------------------------------------------
// A trend beside a number, no axis and no interaction. It says "and it is
// going this way", which is the half of a statistic a bare figure leaves out.
export function Sparkline({ values = [], color = 'var(--brand-500)', width = 88, height = 28 }) {
  const n = values.length
  if (n < 2) return null
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => ({
    x: (i * (width - 2)) / (n - 1) + 1,
    y: height - 3 - ((Number(v) || 0) / max) * (height - 6),
  }))
  return (
    <svg width={width} height={height} className="spark" aria-hidden="true">
      <path d={monotonePath(pts)} fill="none" stroke={color} strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ---- a number, and which way it is going --------------------------------
// The row of figures a dashboard opens with. A statistic on its own is half a
// sentence — "14 late" is only alarming next to last month's four — so where
// there is a history to draw, the trend sits behind the number rather than in
// a second card explaining it.
export function Stat({ label, value, sub, tone, trend, color = 'var(--brand-500)' }) {
  return (
    <div className={'stat-card' + (tone ? ` stat-${tone}` : '')}>
      <span className="stat-card-label">{tx(label)}</span>
      <span className="stat-card-row">
        <b className="stat-card-value">{value}</b>
        {trend?.length > 1 && <Sparkline values={trend} color={color} />}
      </span>
      {sub && <span className="stat-card-sub">{sub}</span>}
    </div>
  )
}

// ---- the card these live in ---------------------------------------------
// Title, one line saying what the picture is of, an optional control on the
// right, and the chart. Nothing else — the header of a chart card is where
// dashboards go to grow a toolbar.
export function ChartCard({ title, sub, right, children, className = '' }) {
  return (
    <section className={`card chart-card ${className}`}>
      <header className="chart-card-head">
        <div>
          <h3>{tx(title)}</h3>
          {sub && <p>{typeof sub === 'string' ? tx(sub) : sub}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  )
}

// ---- a range picker ------------------------------------------------------
// The one control a chart card is allowed. Segmented, because there are three
// or four of them and a dropdown to choose between four things is a click
// spent hiding three words.
export function RangePick({ value, onChange, options }) {
  return (
    <div className="seg chart-range" role="tablist">
      {options.map((o) => (
        <button key={o.key} role="tab" aria-selected={value === o.key}
          className={'seg-btn' + (value === o.key ? ' on' : '')}
          onClick={() => onChange(o.key)}>{tx(o.label)}</button>
      ))}
    </div>
  )
}

export default AreaChart
