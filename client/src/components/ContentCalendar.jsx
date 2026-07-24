import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Clapperboard, Send, Plus } from 'lucide-react'
import { WEEKDAYS, MONTHS, localISO, todayISO, addDaysISO, typeInfo, onColor } from '../lib/constants.js'

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

// Monday of the week that contains the given day.
function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localISO(d)
}
const fmtShort = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// The content calendar, used for both date fields: mode 'release' reads
// release_date, mode 'recording' reads recording_date. Two scales:
//  - Month: the classic grid, compact pills.
//  - Week: seven tall columns with rich cards (type, stage, time) — the
//    day-to-day working view. Cards drag between days in both scales;
//    click a card to open it, a day to plan it, + to add straight there.
export default function ContentCalendar({ items, mode, canMove, onMoveDate, onDayClick, statusesById = {}, onOpenItem, onAddAt, trayItems = [] }) {
  const [ty, tm] = todayISO().split('-').map(Number) // today in Tashkent time
  const [cursor, setCursor] = useState({ y: ty, m: tm - 1 })
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO()))
  // The last used scale is remembered — most people live in one of them.
  const [scale, setScaleState] = useState(() => localStorage.getItem('satashkent_cal_scale') || 'month')
  const setScale = (s) => { setScaleState(s); localStorage.setItem('satashkent_cal_scale', s) }
  // The dragged id lives in a ref (synchronous — a fast drop must never
  // outrun a state update) with state alongside for the dimmed styling.
  const dragRef = useRef(null)
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
  const wkDays = useMemo(() => [...Array(7)].map((_, i) => addDaysISO(weekStart, i)), [weekStart])

  const shift = (n) => {
    if (scale === 'week') return setWeekStart(addDaysISO(weekStart, n * 7))
    const d = new Date(cursor.y, cursor.m + n, 1)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
  }
  const goToday = () => {
    if (scale === 'week') return setWeekStart(mondayOf(todayISO()))
    const [y, m] = todayISO().split('-').map(Number)
    setCursor({ y, m: m - 1 })
  }

  const startDrag = (e, it) => {
    e.stopPropagation()
    dragRef.current = it.id
    setDragId(it.id)
    // Firefox refuses to start a drag without data on the transfer.
    try { e.dataTransfer.setData('text/plain', String(it.id)); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
  }
  const endDrag = () => {
    dragRef.current = null
    setDragId(null)
    setOverCell(null)
  }
  const drop = (iso) => {
    // The drag may have started on a calendar pill or in the unscheduled
    // tray — either way, landing on a day sets this calendar's date.
    const item = items.find((i) => i.id === dragRef.current) || trayItems.find((i) => i.id === dragRef.current)
    if (item && item[dateField] !== iso) onMoveDate(item, dateField, iso)
    endDrag()
  }

  const title = scale === 'week'
    ? `${fmtShort(wkDays[0])} – ${fmtShort(wkDays[6])}, ${wkDays[6].slice(0, 4)}`
    : `${MONTHS[cursor.m]} ${cursor.y}`

  return (
    <div className="card cal">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => shift(-1)} data-tip="Previous" aria-label="Previous"><ChevronLeft size={18} /></button>
        <h3>{title}</h3>
        <button className="icon-btn" onClick={() => shift(1)} data-tip="Next" aria-label="Next"><ChevronRight size={18} /></button>
        <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={goToday} data-tip="Jump back to today">Today</button>
        <div className="pill-group cal-scale">
          <button className={'pill' + (scale === 'month' ? ' active' : '')} onClick={() => setScale('month')} data-tip="Whole month at a glance">Month</button>
          <button className={'pill' + (scale === 'week' ? ' active' : '')} onClick={() => setScale('week')} data-tip="One week with full task cards">Week</button>
        </div>

      </div>

      {/* The waiting room: work with no date on this calendar yet. Drag a
          chip onto a day to schedule it; click it to open the task. Hidden
          entirely when everything is scheduled. */}
      {(trayItems.length > 0 || (dragId && items.some((i) => i.id === dragId))) && (
        <div
          className={'cal-tray' + (dragId && items.some((i) => i.id === dragId) ? ' tray-target' : '')}
          onDragOver={(e) => { if (canMove) e.preventDefault() }}
          onDrop={() => {
            // A scheduled pill dropped back on the tray loses its date.
            const item = items.find((i) => i.id === dragRef.current)
            if (canMove && item && item[dateField]) onMoveDate(item, dateField, null)
            endDrag()
          }}
        >
          <span className="cal-tray-label">Unscheduled{trayItems.length > 0 ? <b> · {trayItems.length}</b> : null}</span>
          <div className="cal-tray-items">
            {trayItems.map((it) => {
              const st = statusesById[it.status_id]
              return (
                <div
                  key={it.id}
                  className={`cal-tray-chip${dragId === it.id ? ' dim' : ''}`}
                  style={st ? { borderLeftColor: st.color } : undefined}
                  draggable={canMove}
                  onDragStart={(e) => startDrag(e, it)}
                  onDragEnd={endDrag}
                  onClick={() => onOpenItem && onOpenItem(it)}
                  title={canMove ? `${it.title} — drag onto a day to schedule, click to open` : it.title}
                >
                  <Icon size={10} style={{ flexShrink: 0 }} />
                  <span className="ev-txt">{it.title}</span>
                  <span className={`chip ct-${it.type} tray-type`}>{typeInfo(it.type).label}</span>
                  {canMove && (
                    <span className="tray-quick">
                      <button type="button" className="qbtn" data-tip="Schedule for today"
                        onClick={(e) => { e.stopPropagation(); onMoveDate(it, dateField, todayISO()) }}>Today</button>
                      <button type="button" className="qbtn" data-tip="Schedule for tomorrow"
                        onClick={(e) => { e.stopPropagation(); onMoveDate(it, dateField, addDaysISO(todayISO(), 1)) }}>Tmrw</button>
                    </span>
                  )}
                </div>
              )
            })}
            {trayItems.length === 0 && <span className="tt-none">drop here to unschedule</span>}
          </div>
        </div>
      )}

      {scale === 'week' ? (
        <div className="cal-grid wk-grid">
          {wkDays.map((iso, i) => {
            const dayItems = byDate[iso] || []
            const isToday = iso === today
            return (
              <div
                key={iso}
                className={`wk-col${isToday ? ' today' : ''}${i >= 5 ? ' wknd' : ''}${overCell === iso ? ' over' : ''}`}
                onDragOver={(e) => { if (canMove) { e.preventDefault(); setOverCell(iso) } }}
                onDrop={() => canMove && drop(iso)}
                onClick={() => onDayClick(iso)}
              >
                <div className="wk-head">
                  <span className="wk-dow">{WEEKDAYS[i]}</span>
                  <span className={`wk-num${isToday ? ' on' : ''}`}>{Number(iso.slice(8))}</span>
                  {dayItems.length > 0 && <span className="wk-count">{dayItems.length}</span>}
                  <span style={{ flex: 1 }} />
                  {onAddAt && (
                    <button className="icon-btn wk-add" data-tip="New task on this day" aria-label="New task on this day"
                      onClick={(e) => { e.stopPropagation(); onAddAt(iso) }}>
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                <div className="wk-cards">
                  {dayItems.map((it) => {
                    const st = statusesById[it.status_id]
                    return (
                      <div
                        key={it.id}
                        className={`wk-card${dragId === it.id ? ' dim' : ''}`}
                        style={st ? { borderLeftColor: st.color } : undefined}
                        draggable={canMove}
                        onDragStart={(e) => startDrag(e, it)}
                        onDragEnd={endDrag}
                        onClick={(e) => { e.stopPropagation(); if (onOpenItem) onOpenItem(it); else onDayClick(iso) }}
                        title={`${it.title}${st ? ` · ${st.label}` : ''}`}
                      >
                        <div className="wk-title">{it.title}</div>
                        <div className="wk-chips">
                          <span className={`chip ct-${it.type}`}>{typeInfo(it.type).label}</span>
                          {st && <span className="chip" style={{ background: st.color, color: onColor(st.color) }}>{st.label}</span>}
                          {it[timeField] && <span className="chip chip-muted"><Icon size={9} /> {it[timeField]}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <>
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
                      {dayItems.slice(0, 4).map((it) => {
                        // The pill wears its pipeline stage's color (To shoot =
                        // yellow, Editing = red, ...); type only as a fallback.
                        const st = statusesById[it.status_id]
                        return (
                          <div
                            key={it.id}
                            className={`rel-ev${st ? '' : ` ct-${it.type}`}${dragId === it.id ? ' dim' : ''}`}
                            style={st ? { background: st.color, color: onColor(st.color), borderLeftColor: st.color } : undefined}
                            draggable={canMove}
                            onDragStart={(e) => startDrag(e, it)}
                            onDragEnd={endDrag}
                            title={`${it.title}${st ? ` · ${st.label}` : ''}`}
                          >
                            <Icon size={10} style={{ flexShrink: 0 }} />
                            <span className="ev-txt">{it[timeField] ? `${it[timeField]} ` : ''}{it.title}</span>
                          </div>
                        )
                      })}
                      {dayItems.length > 4 && <div className="cal-more">+{dayItems.length - 4} more</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
