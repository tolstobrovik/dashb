import { useEffect, useMemo } from 'react'
import { X, Plus, Clapperboard, Send, Scissors, Palette } from 'lucide-react'
import { typeInfo } from '../lib/constants.js'
import { tr as tx, locale } from '../lib/i18n.jsx'
import { StageDot } from './Dot.jsx'

// One day, whole, on top of the calendar: everything with a date on it that
// day, in time order — the shoot, the cut due, the artwork due, the release —
// one row per task however many of those it has, coloured by the stage it is
// at, the way every other calendar block is. A full-screen sheet rather than
// a card swapped in for the grid: the grid is still there underneath when
// this closes, exactly where you left it.
const KIND = {
  recording: { icon: Clapperboard, word: () => tx('Shoot'), time: 'recording_time' },
  edit: { icon: Scissors, word: () => tx('Edit due'), time: null },
  design: { icon: Palette, word: () => tx('Design due'), time: null },
  release: { icon: Send, word: () => tx('Release'), time: 'release_time' },
}
export default function DayAgenda({ date, items, statusesById, canEdit, onOpen, onAdd, onBack }) {
  const entries = useMemo(() => {
    const byId = new Map()
    const add = (it, kind) => {
      const e = byId.get(it.id) || { item: it, kinds: [], time: '' }
      e.kinds.push(kind)
      const t = KIND[kind].time ? it[KIND[kind].time] || '' : ''
      if (t && (!e.time || t < e.time)) e.time = t
      byId.set(it.id, e)
    }
    for (const it of items) {
      if (it.recording_date === date) add(it, 'recording')
      if (it.edit_ready_date === date) add(it, 'edit')
      if (it.design_ready_date === date) add(it, 'design')
      if (it.release_date === date) add(it, 'release')
    }
    return [...byId.values()].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.item.title.localeCompare(b.item.title))
  }, [items, date])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onBack?.() } }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onBack])

  const dt = new Date(`${date}T00:00:00`)
  const heading = dt.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="day-sheet" role="dialog" aria-modal="true" aria-label={heading} onClick={(e) => { if (e.target === e.currentTarget) onBack?.() }}>
      <div className="card planner day-sheet-card">
        <div className="planner-head">
          <h3>{heading}</h3>
          <span className="stat-sub">{entries.length ? tx('{n} tasks', { n: entries.length }) : ''}</span>
          <div style={{ flex: 1 }} />
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => onAdd(date)}><Plus size={15} />{' '}{tx('Add')}</button>}
          <button className="icon-btn" onClick={onBack} aria-label={tx('Close')}><X size={18} /></button>
        </div>

        {entries.length === 0 ? (
          <div className="empty">{tx('No tasks')}</div>
        ) : (
          <div className="agenda">
            {entries.map(({ item, kinds, time }) => {
              const status = statusesById[item.status_id]
              return (
                <button key={item.id} className={'agenda-row' + (status ? ' st-tint' : '')}
                  style={status ? { '--st': status.color } : undefined} onClick={() => onOpen(item)}>
                  <span className="agenda-time">{time || '—'}</span>
                  <span className="agenda-kinds">
                    {kinds.map((k) => { const K = KIND[k]; const Icon = K.icon; return <span key={k} className={`kind-badge kind-${k}`}><Icon size={12} /> {K.word()}</span> })}
                  </span>
                  <span className="agenda-title">{item.title}</span>
                  <span className={`chip ct-${item.type}`}>{typeInfo(item.type).label}</span>
                  {status && <StageDot status={status} />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
