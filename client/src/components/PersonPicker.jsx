import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import Avatar from './Avatar.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// Picking a person, by typing their name.
//
// These were native <select> elements, and a native select's type-ahead JUMPS:
// press J and it moves the highlight to the first name beginning with J, then
// forgets you pressed anything. On a list of twenty people that is worse than
// useless — you cannot see who else matches, and pressing the second letter
// starts the jump again. What everybody expects, because every other search on
// every other app does it, is for the LIST to get shorter.
//
// So it narrows. The match is on any part of the name, not just the start,
// because half this team is found by a surname or a second name.
// However many people the board grows to, the popup draws this many and says
// how many more a letter would reach. Cheaper than virtualising a list nobody
// scrolls: people type a name, they do not scroll to it.
const CAP = 40

export default function PersonPicker({
  value = null,
  onPick,
  groups = [],
  placeholder = '',
  disabled = false,
  tip = '',
  className = '',
  clearable = true,
  // The person this task remembers, when they are no longer on the team.
  gone = null,
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef(null)
  const field = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key, true) }
  }, [open])
  useEffect(() => { if (open) { setQ(''); setTimeout(() => field.current?.focus(), 20) } }, [open])

  const all = useMemo(() => groups.flatMap((g) => g.people || []), [groups])
  // Somebody who left is still on the work they did. A task from last year
  // whose editor has since been taken off the board must keep saying who cut
  // it — dropping the name would quietly rewrite the record, and crashing on
  // it is worse. The pill for a person who is no longer here reads as itself,
  // greyed, and cannot be picked again.
  const picked = all.find((p) => p.id === value)
    || (value != null && gone ? { id: value, name: gone.name || tx('No longer here'), archived: true } : null)

  // The list narrows as you type, and on a big team it narrows on a beat
  // rather than on every keystroke: a hundred names re-filtered and re-laid
  // out per letter is what makes a search box feel slow.
  const [needle, setNeedle] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim().toLowerCase()), q.length > 2 ? 90 : 0)
    return () => clearTimeout(t)
  }, [q])

  const shown = useMemo(() => {
    const trimmed = groups
      .map((g) => ({
        ...g,
        people: (g.people || []).filter((p) => !needle || String(p.name).toLowerCase().includes(needle)),
      }))
      .filter((g) => g.people.length > 0)
    // However long the team gets, the popup draws a screenful. What is not
    // drawn is not lost: it is one more letter away, and the count says so.
    let budget = CAP
    const capped = []
    for (const g of trimmed) {
      if (budget <= 0) break
      capped.push(budget >= g.people.length ? g : { ...g, people: g.people.slice(0, budget) })
      budget -= g.people.length
    }
    const total = trimmed.reduce((n, g) => n + g.people.length, 0)
    return { groups: capped, hidden: Math.max(0, total - CAP) }
  }, [groups, needle])
  const first = shown.groups.flatMap((g) => g.people).find((p) => !p.disabled)

  // A click inside a <label> is forwarded by the browser to that label's
  // control — here, the picker's own button — which re-opens the list the
  // moment somebody picks from it. Nothing in this popup has a default action
  // worth keeping, so none of them keep one.
  const take = (e, p) => {
    e?.preventDefault()
    if (p?.disabled) return
    onPick(p ? p.id : null)
    setOpen(false)
  }

  return (
    <div className={'pp' + (className ? ' ' + className : '')} ref={box}>
      <button type="button" className={'pp-field' + (open ? ' open' : '')} disabled={disabled}
        data-tip={tip || undefined} onClick={() => setOpen((v) => !v)}>
        {picked
          ? (
            <>
              <Avatar name={picked.name} color={picked.color} src={picked.avatar} size="xs" />
              <span className={picked.archived ? 'pp-archived' : undefined}>{picked.name}</span>
            </>
          )
          : <span className="pp-empty">{placeholder}</span>}
        <ChevronDown size={14} className="pp-caret" />
      </button>

      {open && (
        <div className="pp-pop">
          <div className="pp-search">
            <Search size={14} />
            <input ref={field} className="input" value={q} placeholder={tx('Type a name')}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); take(e, first) } }} />
            {q && <button type="button" className="icon-btn" onClick={() => setQ('')}><X size={13} /></button>}
          </div>
          <div className="pp-list">
            {clearable && !q && (
              <button type="button" className="pp-row pp-none" onClick={(e) => take(e, null)}>
                {placeholder || tx('— nobody —')}
              </button>
            )}
            {shown.groups.map((g) => (
              <div key={g.label || 'all'}>
                {g.label && <div className="pp-group">{g.label}</div>}
                {g.people.map((p) => (
                  <button type="button" key={p.id}
                    className={'pp-row' + (p.id === value ? ' on' : '') + (p.disabled ? ' off' : '')}
                    disabled={p.disabled} onClick={(e) => take(e, p)}>
                    <Avatar name={p.name} color={p.color} src={p.avatar} size="xs" />
                    <span className="pp-name">{p.name}</span>
                    {p.hint && <span className="pp-hint">{p.hint}</span>}
                  </button>
                ))}
              </div>
            ))}
            {shown.hidden > 0 && (
              <div className="pp-more">{tx('{n} more — keep typing', { n: shown.hidden })}</div>
            )}
            {shown.groups.length === 0 && <div className="pp-none-found">{tx('Nobody by that name')}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
