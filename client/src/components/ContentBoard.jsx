import { useRef, useState } from 'react'
import { Clapperboard, Send, CheckSquare, ImageIcon, Megaphone, Video, Scissors, Palette, UserRound, Plus, MessageSquare } from 'lucide-react'
import { dateLabel, typeInfo, isDeletedLabel } from '../lib/constants.js'
import { useChannels } from '../lib/channels.jsx'
import { tr as tx } from '../lib/i18n.jsx'
import Zoom from './Zoom.jsx'

// Simple kanban: one column per pipeline stage, drag a card to move it.
// Dragging into the final stage completes the task and fills its plan.
// The stage that belongs to YOUR craft is tinted and labelled — an operator
// walks in and sees the shooting column, an editor the editing one, without
// reading six headings first.
// With onMenu, a card answers a right-click the way the To-Do page's rows used
// to before that page was removed: open it, tick it off, copy it, bin it.
// With onQuickAdd, every working column grows a foot input: type a title,
// Enter — the task lands in that stage without a modal round-trip.
export default function ContentBoard({ items, statuses, dept, canMove, onMove, onOpen, onMenu, onQuickAdd, campaignsById = {}, teamById = {}, myStages = [] }) {
  const { byKey } = useChannels()
  // Ref = source of truth for the drop (a fast drop must never read a stale
  // state value); state only drives the dimmed styling.
  const dragRef = useRef(null)
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const [addCol, setAddCol] = useState(null)
  const [draft, setDraft] = useState('')
  const submitQuick = async (s) => {
    const title = draft.trim()
    if (!title) { setAddCol(null); return }
    setDraft('') // the input stays open — rapid entry is the whole point
    try { await onQuickAdd(title, s.id) } catch (e) { alert(e.message) }
  }

  const drop = (statusId) => {
    const item = items.find((i) => i.id === dragRef.current)
    if (item && item.status_id !== statusId) onMove(item, statusId)
    dragRef.current = null
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
            className={`board-col${overCol === s.id ? ' over' : ''}${isDeletedLabel(s.label) ? ' dead-col' : ''}${myStages.includes(s.id) ? ' my-col' : ''}`}
            style={{ borderTop: `3px solid ${s.color}`, background: `color-mix(in srgb, ${s.color} 6%, transparent)` }}
            onDragOver={(e) => { if (canMove) { e.preventDefault(); setOverCol(s.id) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol((c) => (c === s.id ? null : c)) }}
            onDrop={() => canMove && drop(s.id)}
          >
            <div className="board-col-head">
              <span className="status-dot" style={{ background: s.color }} />
              {s.label}
              {myStages.includes(s.id) && <span className="my-col-tag">{tx("yours")}</span>}
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
                    onContextMenu={onMenu ? (e) => onMenu(e, item) : undefined}
                    draggable={canMove}
                    onDragStart={(e) => {
                      dragRef.current = item.id
                      setDragId(item.id)
                      // Firefox refuses to start a drag without transfer data.
                      try { e.dataTransfer.setData('text/plain', String(item.id)); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
                    }}
                    onDragEnd={() => { dragRef.current = null; setDragId(null); setOverCol(null) }}
                    onClick={() => onOpen(item)}
                  >
                    {(item.photo_thumb || item.photo) && <Zoom className="tcard-photo" src={item.photo_thumb || item.photo} full={item.photo || item.photo_thumb} alt={item.title} />}
                    <div className="tcard-title">{item.title}</div>
                    <div className="tcard-badges">
                      <span className={`chip ct-${item.type}`}>{typeInfo(item.type).label}</span>
                      {item.recording_date && (
                        <span className="chip chip-muted"><Clapperboard size={10} /> {dateLabel(item.recording_date)}</span>
                      )}
                      {item.release_date && (
                        <span className="chip chip-muted"><Send size={10} /> {dateLabel(item.release_date)}</span>
                      )}
                      {/* Who the task is FOR. The board named the crew and
                          never the assignees; the To-Do row named both, and
                          "who owns this" is the first thing anyone asks of a
                          card. One name, +N for the rest. */}
                      {(() => {
                        const ids = (item.assignees?.length ? item.assignees : item.assignee_id ? [item.assignee_id] : [])
                          .filter((id) => teamById[id])
                        if (ids.length === 0) return null
                        return (
                          <span className="chip chip-muted" data-tip={tx('Whose task this is')}>
                            <UserRound size={10} /> {teamById[ids[0]].name.split(' ')[0]}{ids.length > 1 ? ` +${ids.length - 1}` : ''}
                          </span>
                        )
                      })()}
                      {item.operator_id && teamById[item.operator_id] && (
                        <span className="chip chip-muted" data-tip={tx("Operator — films it")}><Video size={10} /> {teamById[item.operator_id].name.split(' ')[0]}</span>
                      )}
                      {item.editor_id && teamById[item.editor_id] && (
                        <span className="chip chip-muted" data-tip={tx("Editor — cuts it")}><Scissors size={10} /> {teamById[item.editor_id].name.split(' ')[0]}</span>
                      )}
                      {/* The designer was shown on the To-Do row and nowhere
                          else; that page is gone and this round gives design
                          its own board, so the card names them too. */}
                      {item.designer_id && teamById[item.designer_id] && (
                        <span className="chip chip-muted" data-tip={tx("Designer — draws it")}><Palette size={10} /> {teamById[item.designer_id].name.split(' ')[0]}</span>
                      )}
                      {item.campaign_id && campaignsById[item.campaign_id] && (
                        <span className="chip chip-camp"><Megaphone size={10} /> {campaignsById[item.campaign_id].name}</span>
                      )}
                      {checks.length > 0 && (
                        <span className="chip chip-muted"><CheckSquare size={10} /> {done}/{checks.length}</span>
                      )}
                      {(item.comment_count || 0) > 0 && (
                        <span className="chip chip-muted" data-tip={tx("The task's thread")}><MessageSquare size={10} /> {item.comment_count}</span>
                      )}
                      {!!(item.has_photo || item.has_thumb || item.photo) && !item.photo_thumb && <span className="chip chip-muted"><ImageIcon size={10} /></span>}
                      {others.map((c) => (
                        <span key={c} className="chip chip-muted">also {byKey[c]?.label || c}</span>
                      ))}
                    </div>
                  </div>
                )
              })}
              {list.length === 0 && <div className="board-empty">{canMove ? 'Drop here' : '—'}</div>}
              {/* You plan work, you don't create it published or deleted. */}
              {onQuickAdd && !isDeletedLabel(s.label) && !s.is_final && (
                addCol === s.id ? (
                  <input className="input board-quick-input" autoFocus placeholder={tx("Title — Enter adds it")}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); submitQuick(s) }
                      if (e.key === 'Escape') { setAddCol(null); setDraft('') }
                    }}
                    onBlur={() => { if (!draft.trim()) setAddCol(null) }} />
                ) : (
                  <button type="button" className="board-quick-btn" onClick={() => { setAddCol(s.id); setDraft('') }}>
                    <Plus size={13} /> Add
                  </button>
                )
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
