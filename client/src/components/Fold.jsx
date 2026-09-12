import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'

// A section that folds away, and stays folded.
//
// "Too much on screen" was the complaint that shaped this round. Most of the
// answer was subtraction — eight destinations went — but the pages that are
// left still stack six or seven blocks, and which of them matter depends
// entirely on who is looking and what they came to do. So they fold, one tap,
// and the choice is remembered per account and per section: an editor who
// never reads Campaigns closes it once.
//
// Open by default, always. A section nobody has touched has to look exactly
// the way it looked before it learned this trick — a page that opens folded is
// a page whose contents have been hidden from someone who never asked.
export default function Fold({ id, title, icon, count, extra, children, tone }) {
  const key = `satashkent_fold_${id}`
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== '0' } catch { return true }
  })
  const flip = () => setOpen((was) => {
    try { localStorage.setItem(key, was ? '0' : '1') } catch { /* private window */ }
    return !was
  })
  return (
    <>
      <div className="section-head fold-head">
        <button type="button" className="fold-btn" onClick={flip} aria-expanded={open}
          data-tip={open ? tx('Fold this away') : tx('Open this again')}>
          {icon}
          <h2 style={tone ? { color: tone } : undefined}>{title}</h2>
          {count !== undefined && <span className="count">· {count}</span>}
          <ChevronDown size={15} className={'fold-caret' + (open ? ' open' : '')} />
        </button>
        {open && extra}
      </div>
      {open && children}
    </>
  )
}
