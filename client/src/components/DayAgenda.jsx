import { useMemo } from 'react'
import { ArrowLeft, Plus, Clapperboard, Send } from 'lucide-react'
import { MONTHS, typeInfo, onColor } from '../lib/constants.js'
import { tr as tx, locale } from '../lib/i18n.jsx'

// A clean, simple day view: everything happening that day in time order —
// recordings and releases side by side, no hour grid to decipher.
export default function DayAgenda({ date, items, statusesById, canEdit, onOpen, onAdd, onBack }) {
  const entries = useMemo(() => {
    const list = []
    for (const it of items) {
      if (it.recording_date === date) list.push({ item: it, kind: 'recording', time: it.recording_time || '' })
      if (it.release_date === date) list.push({ item: it, kind: 'release', time: it.release_time || '' })
    }
    return list.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
  }, [items, date])

  const dt = new Date(`${date}T00:00:00`)
  const heading = dt.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="card planner">
      <div className="planner-head">
        <button className="btn btn-sm" onClick={onBack}><ArrowLeft size={15} />{' '}{tx("Month")}</button>
        <h3>{heading}</h3>
        <div style={{ flex: 1 }} />
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => onAdd(date)}><Plus size={15} />{' '}{tx("Add")}</button>}
      </div>

      {entries.length === 0 ? (
        <div className="empty">Nothing planned this day{canEdit ? ' — add something.' : '.'}</div>
      ) : (
        <div className="agenda">
          {entries.map(({ item, kind, time }, i) => {
            const status = statusesById[item.status_id]
            return (
              <button key={`${item.id}-${kind}-${i}`} className={`agenda-row ct-${item.type}`} onClick={() => onOpen(item)}>
                <span className="agenda-time">{time || '—'}</span>
                <span className={`kind-badge kind-${kind}`}>
                  {kind === 'recording' ? <Clapperboard size={12} /> : <Send size={12} />}
                  {kind === 'recording' ? 'Shoot' : 'Release'}
                </span>
                <span className="agenda-title">{item.title}</span>
                <span className={`chip ct-${item.type}`}>{typeInfo(item.type).label}</span>
                {status && <span className="chip" style={{ background: status.color, color: onColor(status.color) }}>{status.label}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
