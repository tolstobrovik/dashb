import { useState } from 'react'
import { Clapperboard, Send, CheckSquare, ImageIcon } from 'lucide-react'
import { dateLabel, typeInfo } from '../lib/constants.js'
import { useChannels } from '../lib/channels.jsx'

// Simple kanban: one column per pipeline stage, drag a card to move it.
// Dragging into the final stage completes the task and fills its plan.
export default function ContentBoard({ items, statuses, dept, canMove, onMove, onOpen }) {
  const { byKey } = useChannels()
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)

  const drop = (statusId) => {
    const item = items.find((i) => i.id === dragId)
    if (item && item.status_id !== statusId) onMove(item, statusId)
    setDragId(null)
    setOverCol(null)
  }

  return (
    <div className="board">
      {statuses.map((s) => {
        const list = items.filter((i) => i.status_id === s.id)
        return (
          <div
            key={s.id}
            className={`board-col${overCol === s.id ? ' over' : ''}`}
            style={{ borderTop: `3px solid ${s.color}` }}
            onDragOver={(e) => { if (canMove) { e.preventDefault(); setOverCol(s.id) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol((c) => (c === s.id ? null : c)) }}
            onDrop={() => canMove && drop(s.id)}
          >
            <div className="board-col-head">
              <span className="status-dot" style={{ background: s.color }} />
              {s.label}
              <span className="count">{list.length}</span>
            </div>
            <div className="board-col-body">
              {list.map((item) => {
                const checks = item.checklist || []
                const done = checks.filter((c) => c.done).length
                const others = item.channels.filter((c) => c !== dept)
                return (
                  <div
                    key={item.id}
                    className={`tcard${dragId === item.id ? ' dim' : ''}`}
                    draggable={canMove}
                    onDragStart={() => setDragId(item.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null) }}
                    onClick={() => onOpen(item)}
                  >
                    {item.photo && <img className="tcard-photo" src={item.photo} alt="" />}
                    <div className="tcard-title">{item.title}</div>
                    <div className="tcard-badges">
                      <span className={`chip ct-${item.type}`}>{typeInfo(item.type).label}</span>
                      {item.recording_date && (
                        <span className="chip chip-muted"><Clapperboard size={10} /> {dateLabel(item.recording_date)}</span>
                      )}
                      {item.release_date && (
                        <span className="chip chip-muted"><Send size={10} /> {dateLabel(item.release_date)}</span>
                      )}
                      {checks.length > 0 && (
                        <span className="chip chip-muted"><CheckSquare size={10} /> {done}/{checks.length}</span>
                      )}
                      {item.photo && <span className="chip chip-muted"><ImageIcon size={10} /></span>}
                      {others.map((c) => (
                        <span key={c} className="chip chip-muted">also {byKey[c]?.label || c}</span>
                      ))}
                    </div>
                  </div>
                )
              })}
              {list.length === 0 && <div className="board-empty">{canMove ? 'Drop here' : '—'}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
