import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Clapperboard, Send, Plus } from 'lucide-react'
import { WEEKDAYS, MONTHS, localISO, todayISO, addDaysISO, typeInfo, onColor, statusIcon, isDeletedLabel } from '../lib/constants.js'
import { tr as tx } from '../lib/i18n.jsx'

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
export default function ContentCalendar({ items, mode, canMove, onMoveDate, onDayClick, statusesById = {}, onOpenItem, onAddAt, trayItems = [], onRange }) {
  const [ty, tm] = todayISO().split('-').map(Number) // today in Tashkent time
  const [cursor, setCursor] = useState({ y: ty, m: tm - 1 })
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO()))
  // The last used scale is remembered — most people live in one of them.
  const [scale, setScaleState] = useState(() => localStorage.getItem('satashkent_cal_scale') || 'month')
  const setScale = (s) => { setScaleState(s); localStorage.setItem('satashkent_cal_scale', s) }
  const today = todayISO()
  const dateField = mode === 'recording' ? 'recording_date' : 'release_date'
  const timeField = mode === 'recording' ? 'recording_time' : 'release_time'
  const Icon = mode === 'recording' ? Clapperboard : Send

  // ---- dragging, by pointer ----
  // HTML5 drag-and-drop exists on desktops only — phones and tablets never
  // fire it, which used to leave the calendar immovable on touch. Pills move
  // with pointer events instead: press and slide with a mouse, press-and-HOLD
  // with a finger (a finger that moves right away is scrolling and stays
  // undisturbed). Day cells and the tray are found by what's under the
  // pointer (data-drop), and a small ghost chip rides along so the task stays
  // visible under a finger.
  const [dragId, setDragId] = useState(null)
  const [overCell, setOverCell] = useState(null) // a day's iso | 'tray' | null
  const [ghost, setGhost] = useState(null) // { x, y, title } under the pointer
  const ctx = useRef({})
  ctx.current = { items, trayItems, dateField, canMove, onMoveDate }
  const dnd = useRef(null)
  if (!dnd.current) {
    // Built once; everything mutable lives on this object or in ctx, so the
    // window-level listeners can never go stale between renders.
    const d = { press: null }
    d.blockScroll = (e) => { if (d.press?.started) e.preventDefault() }
    d.swallowClick = (e) => { e.stopPropagation(); e.preventDefault() }
    d.cleanup = () => {
      if (d.press?.timer) clearTimeout(d.press.timer)
      if (d.press?.raf) cancelAnimationFrame(d.press.raf)
      d.press = null
      setDragId(null); setOverCell(null); setGhost(null)
      window.removeEventListener('pointermove', d.move)
      window.removeEventListener('pointerup', d.up)
      window.removeEventListener('pointercancel', d.cancel)
      document.removeEventListener('touchmove', d.blockScroll)
    }
    d.cancel = () => d.cleanup()
    // The month grid scrolls sideways on a phone — the pill's own scrollable
    // ancestor, so a drag can walk it to columns past the screen's edge.
    d.scrollBoxOf = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 4) {
          const o = getComputedStyle(n).overflowX
          if (o === 'auto' || o === 'scroll') return n
        }
      }
      return null
    }
    d.activate = () => {
      const p = d.press
      if (!p || p.started) return
      p.started = true
      p.scrollBox = d.scrollBoxOf(p.el)
      p.px = p.x; p.py = p.y
      setDragId(p.item.id)
      setGhost({ x: p.x, y: p.y, title: p.item.title })
      p.raf = requestAnimationFrame(d.tick)
    }
    // The edge auto-scroll heartbeat: a pointer PARKED at an edge produces no
    // more move events, so the walking is driven by frames, not by movement —
    // down/up through the page, and sideways through the phone's month grid.
    d.tick = () => {
      const p = d.press
      if (!p || !p.started) return
      const sb = p.scrollBox
      const r = sb?.getBoundingClientRect()
      const down = p.py > window.innerHeight - 56
      const up = p.py < 72
      const right = r && p.px > r.right - 44
      const left = r && p.px < r.left + 44
      // Walking only begins once the pointer has DWELLED at the edge: a drop
      // aimed at a day that happens to sit near the window's edge must not
      // have the ground pulled out from under it, while a deliberate park
      // still travels to what lies beyond.
      if (down || up || right || left) {
        p.bandSince ||= Date.now()
        if (Date.now() - p.bandSince > 250) {
          if (down) window.scrollBy(0, 10)
          else if (up) window.scrollBy(0, -10)
          // slow enough to aim: about a column per beat, highlight leading the way
          if (right) sb.scrollLeft += 6
          else if (left) sb.scrollLeft -= 6
        }
      } else p.bandSince = 0
      setOverCell(d.targetAt(p.px, p.py))
      p.raf = requestAnimationFrame(d.tick)
    }
    d.targetAt = (x, y) => {
      const cx = Math.min(Math.max(x, 1), window.innerWidth - 2)
      const cy = Math.min(Math.max(y, 1), window.innerHeight - 2)
      return document.elementFromPoint(cx, cy)?.closest?.('[data-drop]')?.getAttribute('data-drop') || null
    }
    d.move = (e) => {
      const p = d.press
      if (!p) return
      if (!p.started) {
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y)
        if (p.touch) { if (moved > 10) d.cleanup(); return } // scrolling — let it be
        if (moved <= 4) return
        d.activate()
      }
      e.preventDefault() // no text selection while a pill is in the air
      p.px = e.clientX; p.py = e.clientY // the tick reads the parked position
      setGhost({ x: e.clientX, y: e.clientY, title: p.item.title })
      setOverCell(d.targetAt(e.clientX, e.clientY))
    }
    d.up = (e) => {
      const p = d.press
      if (p?.started) {
        const { items: its, trayItems: tray, dateField: field, onMoveDate: move } = ctx.current
        const item = its.find((i) => i.id === p.item.id) || tray.find((i) => i.id === p.item.id) || p.item
        const target = d.targetAt(e.clientX || p.px, e.clientY || p.py)
        if (target === 'tray') { if (item[field]) move(item, field, null) }
        else if (target && item[field] !== target) move(item, field, target)
        // the click that follows a finished drag must not open anything
        window.addEventListener('click', d.swallowClick, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', d.swallowClick, { capture: true }), 400)
      }
      d.cleanup()
    }
    d.start = (e, item) => {
      if (!ctx.current.canMove) return
      if (d.press) return // a second finger never steals the gesture
      if (e.button !== undefined && e.button !== 0) return
      const touch = e.pointerType === 'touch'
      const p = { item, el: e.currentTarget, x: e.clientX, y: e.clientY, touch, started: false, timer: null }
      d.press = p
      // a held finger means "pick it up" — a beat long enough to tell a hold
      // from the start of a scroll
      if (touch) p.timer = setTimeout(() => { if (d.press === p) d.activate() }, 280)
      window.addEventListener('pointermove', d.move, { passive: false })
      window.addEventListener('pointerup', d.up)
      window.addEventListener('pointercancel', d.cancel)
      // Registered at the gesture's FIRST moment on purpose: the browser
      // decides at touchstart whether this gesture's moves stay cancelable.
      // Before the hold matures it never preventDefaults, so a finger that
      // meant "scroll" scrolls; after it, the drag owns the screen.
      document.addEventListener('touchmove', d.blockScroll, { passive: false })
    }
    dnd.current = d
  }
  const startDrag = (e, it) => dnd.current.start(e, it)

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

  const title = scale === 'week'
    ? `${fmtShort(wkDays[0])} – ${fmtShort(wkDays[6])}, ${wkDays[6].slice(0, 4)}`
    : `${MONTHS[cursor.m]} ${cursor.y}`

  // Tell the page above which span is on screen. Only the calendar knows where
  // it is parked, and the schedule pages promise their export carries exactly
  // what is shown — a promise they cannot keep without this. Held in a ref so
  // an inline arrow from the parent can't re-fire the effect every render.
  const spanFrom = scale === 'week' ? wkDays[0] : localISO(weeks[0][0])
  const spanTo = scale === 'week' ? wkDays[6] : localISO(weeks[5][6])
  const rangeRef = useRef(onRange)
  rangeRef.current = onRange
  useEffect(() => { rangeRef.current?.(spanFrom, spanTo) }, [spanFrom, spanTo])

  return (
    <div className="card cal">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => shift(-1)} data-tip={tx("Previous")} aria-label={tx("Previous")}><ChevronLeft size={18} /></button>
        <h3>{title}</h3>
        <button className="icon-btn" onClick={() => shift(1)} data-tip={tx("Next")} aria-label={tx("Next")}><ChevronRight size={18} /></button>
        <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={goToday} data-tip={tx("Jump back to today")}>{tx("Today")}</button>
        <div className="pill-group cal-scale">
          <button className={'pill' + (scale === 'month' ? ' active' : '')} onClick={() => setScale('month')} data-tip={tx("Whole month at a glance")}>{tx("Month")}</button>
          <button className={'pill' + (scale === 'week' ? ' active' : '')} onClick={() => setScale('week')} data-tip={tx("One week with full task cards")}>{tx("Week")}</button>
        </div>

      </div>

      {/* The waiting room: work with no date on this calendar yet. Drag a
          chip onto a day to schedule it; click it to open the task. Hidden
          entirely when everything is scheduled. */}
      {(trayItems.length > 0 || (dragId && items.some((i) => i.id === dragId))) && (
        <div
          data-drop="tray"
          className={'cal-tray' + (dragId && items.some((i) => i.id === dragId) ? ' tray-target' : '') + (overCell === 'tray' ? ' over' : '')}
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
                  onPointerDown={(e) => startDrag(e, it)}
                  onContextMenu={(e) => { if (dragId === it.id) e.preventDefault() }}
                  onClick={() => onOpenItem && onOpenItem(it)}
                  title={canMove ? `${it.title} — drag onto a day to schedule, click to open` : it.title}
                >
                  <Icon size={10} style={{ flexShrink: 0 }} />
                  <span className="ev-txt">{it.title}</span>
                  <span className={`chip ct-${it.type} tray-type`}>{typeInfo(it.type).label}</span>
                  {canMove && (
                    <span className="tray-quick">
                      <button type="button" className="qbtn" data-tip={tx("Schedule for today")}
                        onClick={(e) => { e.stopPropagation(); onMoveDate(it, dateField, todayISO()) }}>{tx("Today")}</button>
                      <button type="button" className="qbtn" data-tip={tx("Schedule for tomorrow")}
                        onClick={(e) => { e.stopPropagation(); onMoveDate(it, dateField, addDaysISO(todayISO(), 1)) }}>{tx("Tmrw")}</button>
                    </span>
                  )}
                </div>
              )
            })}
            {trayItems.length === 0 && <span className="tt-none">{tx("drop here to unschedule")}</span>}
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
                data-drop={iso}
                className={`wk-col${isToday ? ' today' : ''}${i >= 5 ? ' wknd' : ''}${overCell === iso ? ' over' : ''}`}
                onClick={() => onDayClick(iso)}
              >
                <div className="wk-head">
                  <span className="wk-dow">{WEEKDAYS[i]}</span>
                  <span className={`wk-num${isToday ? ' on' : ''}`}>{Number(iso.slice(8))}</span>
                  {dayItems.length > 0 && <span className="wk-count">{dayItems.length}</span>}
                  <span style={{ flex: 1 }} />
                  {onAddAt && (
                    <button className="icon-btn wk-add" data-tip={tx("New task on this day")} aria-label={tx("New task on this day")}
                      onClick={(e) => { e.stopPropagation(); onAddAt(iso) }}>
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                <div className="wk-cards">
                  {dayItems.map((it) => {
                    const st = statusesById[it.status_id]
                    const TIcon = typeInfo(it.type).icon
                    const SIcon = st ? statusIcon(st.label) : null
                    const dead = st ? isDeletedLabel(st.label) : false
                    return (
                      <div
                        key={it.id}
                        className={`wk-card${dragId === it.id ? ' dim' : ''}${dead ? ' cal-dead' : ''}`}
                        style={st ? { borderLeftColor: st.color } : undefined}
                        onPointerDown={(e) => startDrag(e, it)}
                        onContextMenu={(e) => { if (dragId === it.id) e.preventDefault() }}
                        onClick={(e) => { e.stopPropagation(); if (onOpenItem) onOpenItem(it); else onDayClick(iso) }}
                        title={`${it.title}${st ? ` · ${st.label}` : ''}`}
                      >
                        <div className="wk-title">{it.title}</div>
                        <div className="wk-chips">
                          <span className={`chip ct-${it.type}`}><TIcon size={9} /> {typeInfo(it.type).label}</span>
                          {st && <span className="chip" style={{ background: st.color, color: onColor(st.color) }}>{SIcon && <SIcon size={9} />} {st.label}</span>}
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
                    data-drop={iso}
                    className={`cal-day editable${inMonth ? '' : ' out'}${iso === today ? ' today' : ''}${overCell === iso ? ' over' : ''}`}
                    onClick={() => onDayClick(iso)}
                  >
                    <div className="cal-daynum">{date.getDate()}</div>
                    <div className="cal-events">
                      {dayItems.map((it) => {
                        // Every task shows — a crowded day makes its week row
                        // taller instead of hiding work behind a "+N more".
                        // The pill wears its pipeline stage's color (To shoot =
                        // yellow, Editing = red, ...), the type's little icon
                        // (post, reel, video...) and the stage's glyph; killed
                        // work stays on the record — dimmed, struck through,
                        // its status written under the title.
                        const st = statusesById[it.status_id]
                        const TIcon = typeInfo(it.type).icon
                        const SIcon = st && statusIcon(st.label)
                        const dead = st ? isDeletedLabel(st.label) : false
                        return (
                          <div
                            key={it.id}
                            className={`rel-ev${st ? '' : ` ct-${it.type}`}${dragId === it.id ? ' dim' : ''}${dead ? ' cal-dead' : ''}`}
                            style={st ? { background: st.color, color: onColor(st.color), borderLeftColor: st.color } : undefined}
                            onPointerDown={(e) => startDrag(e, it)}
                            onContextMenu={(e) => { if (dragId === it.id) e.preventDefault() }}
                            // Clicking a TASK opens that task. Only clicking
                            // the empty part of a day opens the day. Without
                            // this the click fell through to the cell and you
                            // got a day summary you then had to read to find
                            // the thing you had already pointed at. A click
                            // that ends a drag is swallowed higher up, so
                            // dropping a pill still never opens anything.
                            onClick={(e) => { e.stopPropagation(); if (onOpenItem) onOpenItem(it); else onDayClick(iso) }}
                            title={`${it.title} · ${typeInfo(it.type).label}${st ? ` · ${st.label}` : ''}`}
                          >
                            <TIcon size={10} style={{ flexShrink: 0 }} />
                            {SIcon && <SIcon size={10} style={{ flexShrink: 0, opacity: 0.75 }} />}
                            <span className="ev-txt">
                              {it[timeField] ? `${it[timeField]} ` : ''}{it.title}
                              {dead && <i className="ev-sub">{st.label}</i>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}

      {/* The pill in flight — pinned to the pointer so the task's name stays
          visible even under a finger. */}
      {ghost && (
        // Moved by transform, not by left/top: the browser slides an already
        // painted layer instead of re-laying-out the page on every frame.
        <div className="drag-ghost" style={{ transform: `translate3d(${ghost.x + 14}px, ${ghost.y + 12}px, 0)` }}>{ghost.title}</div>
      )}
    </div>
  )
}
