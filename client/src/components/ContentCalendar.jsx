import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Clapperboard, Send } from 'lucide-react'
import { WEEKDAYS, MONTHS, localISO, todayISO } from '../lib/constants.js'

function monthMatrix(year, month) {
  const first = new Date(year, month, 1)
  const startIdx = (first.getDay() + 6) % 7
  const weeks = []
  for (let w = 0; w < 6; w++) {
    const days = []
    for (let d = 0; d < 7; d++) days.push(new Date(year, month, 1 - startIdx + w * 7 + d))
    weeks.push(days)
  }
  return weeks
}

// One month grid used for both calendars: mode 'release' reads release_date,
// mode 'recording' reads recording_date. Hold & drag a pill onto another day
// to move that date; click a day to open its planner.
export default function ContentCalendar({ items, mode, canMove, onMoveDate, onDayClick }) {
  const now = new Date()
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [dragId, setDragId] = useState(null)
  const [overCell, setOverCell] = useState(null)
  const today = todayISO()
  const dateField = mode === 'recording' ? 'recording_date' : 'release_date'
  const timeField = mode === 'recording' ? 'recording_time' : 'release_time'
  const Icon = mode === 'recording' ? Clapperboard : Send

  const byDate = useMemo(() => {
    const map = {}
    for (const it of items) {
      const d = it[dateField]
      if (!d) continue
      ;(map[d] = map[d] || []).push(it)
    }
    for (const k in map) map[k].sort((a, b) => (a[timeField] || '').localeCompare(b[timeField] || ''))
    return map
  }, [items, dateField, timeField])

  const weeks = monthMatrix(cursor.y, cursor.m)
  const shift = (n) => {
    const d = new Date(cursor.y, cursor.m + n, 1)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
  }

  const drop = (iso) => {
    const item = items.find((i) => i.id === dragId)
    if (item && item[dateField] !== iso) onMoveDate(item, dateField, iso)
    setDragId(null)
    setOverCell(null)
  }

  return (
    <div className="card cal">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous"><ChevronLeft size={18} /></button>
        <h3>{MONTHS[cursor.m]} {cursor.y}</h3>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Next"><ChevronRight size={18} /></button>
        <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>Today</button>
        <span className="cal-hint" style={{ marginLeft: 'auto' }}>
          {canMove ? 'Drag a task to another day · click a day to plan it' : 'Click a day to plan it'}
        </span>
      </div>

      <div className="cal-grid cal-weekhead">
        {WEEKDAYS.map((d) => <div key={d} className="cal-wd">{d}</div>)}
      </div>

      {weeks.map((week, wi) => (
        <div className="cal-grid" key={wi}>
          {week.map((date) => {
            const iso = localISO(date)
            const inMonth = date.getMonth() === cursor.m
            const dayItems = byDate[iso] || []
            return (
              <div
                key={iso}
                className={`cal-day editable${inMonth ? '' : ' out'}${iso === today ? ' today' : ''}${overCell === iso ? ' over' : ''}`}
                onDragOver={(e) => { if (canMove) { e.preventDefault(); setOverCell(iso) } }}
                onDrop={() => canMove && drop(iso)}
                onClick={() => onDayClick(iso)}
              >
                <div className="cal-daynum">{date.getDate()}</div>
                <div className="cal-events">
                  {dayItems.slice(0, 4).map((it) => (
                    <div
                      key={it.id}
                      className={`rel-ev ct-${it.type}${dragId === it.id ? ' dim' : ''}`}
                      draggable={canMove}
                      onDragStart={(e) => { e.stopPropagation(); setDragId(it.id) }}
                      onDragEnd={() => { setDragId(null); setOverCell(null) }}
                      title={it.title}
                    >
                      <Icon size={10} style={{ flexShrink: 0 }} /> {it[timeField] ? `${it[timeField]} ` : ''}{it.title}
                    </div>
                  ))}
                  {dayItems.length > 4 && <div className="cal-more">+{dayItems.length - 4} more</div>}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
