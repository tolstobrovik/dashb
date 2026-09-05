import { tr as tx } from '../lib/i18n.jsx'

// Counts as dots, not as sentences.
//
// The board said "3 open · 2 overdue · 5 done" in words, on every channel row,
// every crew card and every person in the register — three short sentences
// where three marks would do. Read at a glance you are not reading them at
// all: you are looking for whether the red one is there.
//
// So the number keeps its digit and loses its noun. What the digit MEANS is a
// colour and a tooltip, which is where a legend belongs — on the thing itself,
// when you ask it, rather than printed beside every instance for ever.
//
// Zero is not drawn. A row that owes nothing should look like a row that owes
// nothing, and "0 overdue" is a reassurance nobody asked for taking up the
// space that matters when it becomes 1.
const TONES = {
  open: { cls: 'dot-open', tip: 'Open right now' },
  late: { cls: 'dot-late', tip: 'Past its day' },
  done: { cls: 'dot-done', tip: 'Finished' },
  wait: { cls: 'dot-wait', tip: 'Waiting on somebody' },
}

export function Dot({ n, tone = 'open', tip, always = false }) {
  const count = Number(n) || 0
  if (!count && !always) return null
  const t = TONES[tone] || TONES.open
  return (
    <span className={`dot ${t.cls}`} data-tip={tx(tip || t.tip)}>
      <i className="dot-mark" />{count}
    </span>
  )
}

// A row of them, in the order somebody scans: what is wrong first.
export function Dots({ late = 0, open = 0, done = 0, wait = 0 }) {
  if (!late && !open && !done && !wait) return null
  return (
    <span className="dots">
      <Dot n={late} tone="late" />
      <Dot n={wait} tone="wait" />
      <Dot n={open} tone="open" />
      <Dot n={done} tone="done" />
    </span>
  )
}
