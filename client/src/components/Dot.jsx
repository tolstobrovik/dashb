import { tr } from '../lib/i18n.jsx'
// One vocabulary for "what state is this in", instead of fourteen badges.
//
// A STAGE is a name an admin chose with a colour they chose — it needs its
// word, because nothing about "Editing" is guessable from teal. It gets a dot
// in that colour and the word beside it in the quietest weight the row has.
// A STATE — late, on time, waiting — is one of three things everybody already
// knows the colour of, so it is the dot alone, with the word in the tooltip
// and in the accessible name.
export function StageDot({ status, icon: Icon }) {
  if (!status) return null
  return (
    <span className="sdot" title={status.label}>
      <i style={{ background: status.color }} />
      {Icon ? <Icon size={9} /> : null}
      <span>{status.label}</span>
    </span>
  )
}
// The colours, decoded, in one quiet row above a calendar: every stage the
// board has, in pipeline order, as the same dot the blocks wear.
export function StageLegend({ statusesById }) {
  const stages = Object.values(statusesById || {}).filter((s) => s && !/^deleted$/i.test(s.label || '')).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
  if (stages.length < 2) return null
  return (
    <div className="cal-legend" aria-label="Legend">
      {stages.map((s) => <span key={s.id} className="chip st-legend"><i className="dot" style={{ background: s.color }} />{s.label}</span>)}
    </div>
  )
}
export function Dot({ tone = 'ok', label }) {
  return <i className={`dot dot-${tone}`} role="img" aria-label={label} data-tip={label} />
}

// The same vocabulary, when the thing also has a COUNT.
//
// Channel rows, crew cards and the missed register said "3 open · 2 overdue ·
// 5 done" — three short sentences where three marks would do. Read at a glance
// you are not reading them at all: you are looking for whether the red one is
// there. So the number keeps its digit and loses its noun; what the digit
// means is the colour, and the word lives in the tooltip, which is where a
// legend belongs — on the thing itself, when you ask it, rather than printed
// beside every instance for ever.
//
// Zero is not drawn. A row that owes nothing should look like a row that owes
// nothing, and "0 overdue" is a reassurance nobody asked for taking up the
// space that matters the moment it becomes 1.
const COUNT_TONES = {
  open: { cls: 'cdot-open', tip: 'Open right now' },
  late: { cls: 'cdot-late', tip: 'Past its day' },
  done: { cls: 'cdot-done', tip: 'Finished' },
  wait: { cls: 'cdot-wait', tip: 'Waiting on somebody' },
}
export function CountDot({ n, tone = 'open', tip, always = false }) {
  const count = Number(n) || 0
  if (!count && !always) return null
  const t = COUNT_TONES[tone] || COUNT_TONES.open
  const word = tr(tip || t.tip)
  return (
    <span className={`cdot ${t.cls}`} data-tip={word} role="img" aria-label={`${count} ${word}`}>
      <i />{count}
    </span>
  )
}
// A row of them, in the order somebody scans: what is wrong first.
export function Dots({ late = 0, open = 0, done = 0, wait = 0 }) {
  if (!late && !open && !done && !wait) return null
  return (
    <span className="cdots">
      <CountDot n={late} tone="late" />
      <CountDot n={wait} tone="wait" />
      <CountDot n={open} tone="open" />
      <CountDot n={done} tone="done" />
    </span>
  )
}
