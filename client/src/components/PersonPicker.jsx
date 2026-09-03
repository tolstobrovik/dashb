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
export default function PersonPicker({
  value = null,
  onPick,
  groups = [],
  placeholder = '',
  disabled = false,
  tip = '',
  className = '',
  clearable = true,
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
  const picked = all.find((p) => p.id === value)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return groups
    return groups
      .map((g) => ({ ...g, people: (g.people || []).filter((p) => String(p.name).toLowerCase().includes(needle)) }))
      .filter((g) => g.people.length > 0)
  }, [groups, q])
  const first = shown.flatMap((g) => g.people).find((p) => !p.disabled)

  const take = (p) => { if (p?.disabled) return; onPick(p ? p.id : null); setOpen(false) }

  return (
    <div className={'pp' + (className ? ' ' + className : '')} ref={box}>
      <button type="button" className={'pp-field' + (open ? ' open' : '')} disabled={disabled}
        data-tip={tip || undefined} onClick={() => setOpen((v) => !v)}>
        {picked
          ? <><Avatar name={picked.name} color={picked.color} src={picked.avatar} size="xs" /><span>{picked.name}</span></>
          : <span className="pp-empty">{placeholder}</span>}
        <ChevronDown size={14} className="pp-caret" />
      </button>

      {open && (
        <div className="pp-pop">
          <div className="pp-search">
            <Search size={14} />
            <input ref={field} className="input" value={q} placeholder={tx('Type a name')}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); take(first) } }} />
            {q && <button type="button" className="icon-btn" onClick={() => setQ('')}><X size={13} /></button>}
          </div>
          <div className="pp-list">
            {clearable && !q && (
              <button type="button" className="pp-row pp-none" onClick={() => take(null)}>
                {placeholder || tx('— nobody —')}
              </button>
            )}
            {shown.map((g) => (
              <div key={g.label || 'all'}>
                {g.label && <div className="pp-group">{g.label}</div>}
                {g.people.map((p) => (
                  <button type="button" key={p.id}
                    className={'pp-row' + (p.id === value ? ' on' : '') + (p.disabled ? ' off' : '')}
                    disabled={p.disabled} onClick={() => take(p)}>
                    <Avatar name={p.name} color={p.color} src={p.avatar} size="xs" />
                    <span className="pp-name">{p.name}</span>
                    {p.hint && <span className="pp-hint">{p.hint}</span>}
                  </button>
                ))}
              </div>
            ))}
            {shown.length === 0 && <div className="pp-none-found">{tx('Nobody by that name')}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
