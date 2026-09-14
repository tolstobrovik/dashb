import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, AlertCircle, Clock } from 'lucide-react'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/constants.js'
import { tr as tx, locale } from '../lib/i18n.jsx'
import { useIsPhone } from '../lib/usePhone.js'

// ---- somebody's week, drawn as a week ---------------------------------------
//
// Booking a shoot has been two things on this board and neither was the shape
// of the question. First it was a wall of ninety-six half-hour buttons, which
// nobody scans. Then it was a list — a morning and an afternoon per day —
// which is readable but answers only "when could I book this", never "what
// does their week actually look like".
//
// The question a planner is really asking is spatial. Is Tuesday afternoon
// gone? Is there a clear run on Thursday morning? A LIST cannot say that; a
// grid says it without being read. So this is the week as a week, in the shape
// everybody already knows from a calendar, and the answer is the shape.
//
// What the colours mean, and nothing else is coloured:
//
//   red      taken — a shoot already booked in that hour
//   amber    studying — lectures and anything else on their repeating week
//   grey     outside the hours they work, or a day they do not work at all
//   clear    free, and pressing it books that time
//
// Minimal on purpose. No grid lines where an edge already does the work, no
// hour on every row, no chrome around the thing being looked at. The data is
// the only ink that carries colour.

const DAY_MS = 86400000
// The granularity the server offers starts at, and therefore the height of one
// clickable cell. Kept in step with SLOT_STEP on the other side.
const STEP = 30
const toMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5))
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
// The Monday of the week a date falls in — a working week reads Mon→Sun, not
// Sun→Sat, wherever the browser thinks its weeks begin.
const mondayOf = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  return addDays(iso, -back)
}
const dayName = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' })
const dayNum = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', timeZone: 'UTC' })

// The hours the grid is drawn between. Not midnight to midnight: fourteen
// empty rows nobody works in push the six that matter off the screen. It is
// the span this person actually has, widened by an hour at each end so a shoot
// that starts early is visible rather than clipped out of existence.
function span(cal, hours, study) {
  let lo = hours ? toMin(hours.from) : 9 * 60
  let hi = hours ? toMin(hours.to) : 18 * 60
  for (const d of cal || []) {
    for (const b of [...(d.busy || []), ...(d.study || [])]) {
      lo = Math.min(lo, toMin(b.from))
      hi = Math.max(hi, toMin(b.to))
    }
  }
  for (const b of study || []) { lo = Math.min(lo, toMin(b.from)); hi = Math.max(hi, toMin(b.to)) }
  lo = Math.max(0, Math.floor(lo / 60) * 60 - 60)
  hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60 + 60)
  if (hi - lo < 6 * 60) hi = Math.min(24 * 60, lo + 6 * 60)
  return { lo, hi }
}

export default function Timetable({ userId, excludeId, value, onPick, mins = 120 }) {
  const today = todayISO()
  // A WEEK on a desk, ONE DAY on a phone.
  //
  // Seven columns on a 390px screen is seven strips of forty pixels, and the
  // first cut squashed nine hours into fifty-four of them: every half-hour
  // label landed on top of the last and the shape — the only thing a grid is
  // for — was gone. Google Calendar does not show a week on a phone either.
  // So a phone gets one day at full height and walks through them a day at a
  // time, which is the same calendar asking the same question in the space it
  // actually has.
  const phone = useIsPhone()
  const span7 = phone ? 1 : 7
  const [week, setWeek] = useState(() => today)
  // On a phone the cursor is a day; on a desk it is the Monday of a week.
  const start = phone ? week : mondayOf(week)
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const seen = useRef('')

  useEffect(() => {
    if (!userId) { setData(null); return }
    let alive = true
    setBusy(true); setErr('')
    const key = `${userId}:${start}:${span7}:${mins}:${excludeId || ''}`
    seen.current = key
    api.get(`/users/${userId}/slots?from=${start}&days=${span7}&mins=${mins}${excludeId ? `&exclude=${excludeId}` : ''}`)
      .then((d) => { if (alive && seen.current === key) setData(d) })
      .catch((e) => { if (alive) setErr(e.message) })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [userId, start, span7, mins, excludeId])

  const cal = data?.calendar || []
  const { lo, hi } = useMemo(() => span(cal, data?.hours, data?.study), [cal, data])
  const rows = (hi - lo) / 60
  // Where a time sits in the grid, as a share of its height. One arithmetic
  // for every block on it, so nothing can drift a pixel out of true.
  const at = (t) => ((toMin(t) - lo) / (hi - lo)) * 100

  if (!userId) {
    return (
      <div className="tt tt-empty">
        <Clock size={15} />
        <span className="stat-sub">{tx('Pick who is filming it and their week appears here.')}</span>
      </div>
    )
  }

  const hours = data?.hours
  const openAt = hours ? toMin(hours.from) : 9 * 60
  const shutAt = hours ? toMin(hours.to) : 18 * 60

  return (
    <div className="tt">
      <div className="tt-head">
        <button type="button" className="btn btn-sm btn-icon"
          aria-label={phone ? tx('Previous day') : tx('Previous week')}
          onClick={() => setWeek((w) => addDays(w, -span7))} disabled={start <= today}>
          <ChevronLeft size={15} />
        </button>
        <b className="tt-when">
          {phone
            ? new Date(`${start}T00:00:00Z`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
            : <>
                {new Date(`${start}T00:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                {' – '}
                {new Date(`${addDays(start, 6)}T00:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' })}
              </>}
        </b>
        <button type="button" className="btn btn-sm btn-icon"
          aria-label={phone ? tx('Next day') : tx('Next week')}
          onClick={() => setWeek((w) => addDays(w, span7))}>
          <ChevronRight size={15} />
        </button>
        {busy && <Loader2 size={14} className="spin tt-spin" />}
        <span className="tt-key">
          <i className="tt-k tt-k-busy" />{tx('taken')}
          <i className="tt-k tt-k-study" />{tx('studying')}
          <i className="tt-k tt-k-off" />{tx('not working')}
        </span>
      </div>

      {data?.hours === null && (
        <div className="tt-note">
          <AlertCircle size={13} />
          {tx('{name} has not set their working hours — this is 09:00–18:00 until they do.', { name: data.user.name })}
        </div>
      )}
      {err && <div className="form-error">{err}</div>}

      <div className={'tt-grid' + (phone ? ' tt-one' : '')} style={{ '--tt-rows': rows }}>
        {/* The hours down the side. Every second one carries a number: an hour
            on every row is a column of digits competing with the week. */}
        <div className="tt-hours" aria-hidden="true">
          {Array.from({ length: rows + 1 }, (_, i) => (
            <span key={i} className="tt-hour" style={{ top: `${(i / rows) * 100}%` }}>
              {i % 2 === 0 ? toHHMM(lo + i * 60) : ''}
            </span>
          ))}
        </div>

        {cal.map((d) => {
          const isToday = d.day === today
          const past = d.day < today
          return (
            <div className={'tt-col' + (isToday ? ' tt-today' : '') + (past ? ' tt-past' : '')} key={d.day}>
              <div className="tt-col-head">
                <span className="tt-dow">{dayName(d.day)}</span>
                <span className="tt-dom">{dayNum(d.day)}</span>
              </div>
              <div className="tt-body">
                {Array.from({ length: rows }, (_, i) => (
                  <span key={i} className="tt-line" style={{ top: `${((i + 1) / rows) * 100}%` }} aria-hidden="true" />
                ))}

                {/* Outside their hours, and days they do not work at all. Drawn
                    first so everything real sits on top of it. */}
                {!d.working
                  ? <span className="tt-off" style={{ top: 0, height: '100%' }} title={tx('not working')} />
                  : <>
                      {openAt > lo && <span className="tt-off" style={{ top: 0, height: `${at(toHHMM(openAt))}%` }} />}
                      {shutAt < hi && <span className="tt-off" style={{ top: `${at(toHHMM(shutAt))}%`, height: `${100 - at(toHHMM(shutAt))}%` }} />}
                    </>}

                {/* Lectures and the rest of the repeating week. */}
                {(d.study || []).map((b, i) => (
                  <span key={`s${i}`} className="tt-block tt-study"
                    style={{ top: `${at(b.from)}%`, height: `${at(b.to) - at(b.from)}%` }}
                    title={`${b.label || tx('studying')} · ${b.from}–${b.to}`}>
                    <em>{b.label || tx('studying')}</em>
                  </span>
                ))}

                {/* Shoots already in the day. A slot the reader may not see
                    keeps its hour and loses its name — the hour is everybody's
                    business, what is in it is not. */}
                {(d.busy || []).map((b, i) => (
                  <span key={`b${i}`} className="tt-block tt-busy"
                    style={{ top: `${at(b.from)}%`, height: `${at(b.to) - at(b.from)}%` }}
                    title={`${b.title || tx('taken')} · ${b.from}–${b.to}`}>
                    <em>{b.title || tx('taken')}</em>
                  </span>
                ))}

                {/* And what is free.
                    Each start is its OWN half-hour, not a block as long as the
                    shoot. The first cut drew one button per start at full
                    length, so a two-hour shoot offered every thirty minutes
                    produced four buttons stacked on the same hour: whatever
                    was drawn last swallowed the clicks, and pressing the gap
                    you were looking at booked a different one. Non-overlapping
                    cells mean the thing under the pointer is the thing that
                    gets booked. The shoot's real extent is drawn once, on the
                    one that was chosen. */}
                {(d.slots || []).map((sl) => {
                  const on = value?.date === d.day && value?.from === sl.from
                  const cellEnd = toHHMM(Math.min(toMin(sl.to), toMin(sl.from) + STEP))
                  return (
                    <button key={sl.from} type="button"
                      className={'tt-free' + (on ? ' on' : '')}
                      style={{ top: `${at(sl.from)}%`, height: `${at(cellEnd) - at(sl.from)}%` }}
                      title={tx('Book {from}–{to}', { from: sl.from, to: sl.to })}
                      onClick={() => onPick({ date: d.day, from: sl.from, to: sl.to, mins })}>
                      <em>{sl.from}</em>
                    </button>
                  )
                })}

                {/* The one already chosen, wherever it is — including a time
                    picked before something else took the hour around it. */}
                {value?.date === d.day && (
                  <span className="tt-block tt-picked"
                    style={{ top: `${at(value.from)}%`, height: `${Math.max(2, at(value.to || toHHMM(toMin(value.from) + mins)) - at(value.from))}%` }}>
                    <em>{value.from}</em>
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {data && cal.every((d) => !d.working || d.slots.length === 0) && !busy && (
        <div className="tt-note">
          <AlertCircle size={13} />
          {tx('Nothing free this week at this length — try a shorter shoot, or look at next week.')}
        </div>
      )}
    </div>
  )
}
