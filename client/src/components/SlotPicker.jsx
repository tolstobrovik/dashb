import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Clock, Loader2, AlertCircle, Plus } from 'lucide-react'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/constants.js'
import { tr as tx, locale } from '../lib/i18n.jsx'

// ---- picking a time out of somebody else's week ----
//
// Booking a shoot was typing a date and a time, and finding out afterwards —
// from a refusal, or from the operator on the day — whether that time existed.
// The person holding the camera knows their week; the form did not, so the
// planner guessed and a human corrected the guess every time.
//
// That much was right. What was wrong was the shape of the answer.
//
// It drew the operator's week as seven columns, each with the hours they were
// already booked listed as chips, and under those every free half-hour start
// as a button of its own. On a working week that is somewhere near a hundred
// buttons — a wall of times to compare against each other, when the question
// being asked has an obvious shape: WHEN IS THE NEXT TIME THIS PERSON IS FREE
// FOR TWO HOURS. Nobody scans ninety-six options; they take one of the first
// three or they go and ask.
//
// So it is a list, in the order the days come, and each day offers what a
// person offers out loud: a morning and an afternoon. Two lines a day, not
// fourteen. The exact half-hours are still there, one press behind "another
// time on this day", because somebody occasionally does need 14:30 and taking
// that away to tidy the screen would be tidying away the feature.
//
// Lengths went from six to four for the same reason. 30m, an hour, two hours,
// half a day are the shapes a shoot actually comes in; 90 and 180 minutes were
// two more buttons to read past, and a ninety-minute shoot books two hours.

const LENGTHS = [
  { m: 30, label: '30m' },
  { m: 60, label: '1h' },
  { m: 120, label: '2h' },
  { m: 240, label: 'Half day' },
]
const dayWords = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
const hourOf = (t) => Number(String(t).slice(0, 2))

export default function SlotPicker({ userId, excludeId, value, onPick, defaultMins = 120 }) {
  const today = todayISO()
  const [days, setDays] = useState(7)
  const [mins, setMins] = useState(() => (LENGTHS.some((l) => l.m === defaultMins) ? defaultMins : 120))
  const [openDay, setOpenDay] = useState(null)   // a day whose exact starts are showing
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!userId) { setData(null); return }
    let alive = true
    setBusy(true); setErr('')
    api.get(`/users/${userId}/slots?from=${today}&days=${days}&mins=${mins}${excludeId ? `&exclude=${excludeId}` : ''}`)
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setErr(e.message) })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [userId, days, mins, excludeId, today])

  // Every day that has something to offer, with the morning and the afternoon
  // picked out of its free starts. A day nobody works, or one that is full, is
  // not a row — it is nothing, and the count at the bottom says how many days
  // were looked at.
  const rows = useMemo(() => (data?.calendar || [])
    .filter((d) => d.working && d.slots.length > 0)
    .map((d) => {
      const am = d.slots.filter((s) => hourOf(s.from) < 12)
      const pm = d.slots.filter((s) => hourOf(s.from) >= 12)
      return {
        day: d.day,
        offer: [am[0], pm[0]].filter(Boolean),
        rest: d.slots.filter((s) => s !== am[0] && s !== pm[0]),
        all: d.slots,
      }
    }), [data])

  if (!userId) {
    return (
      <div className="sp sp-empty">
        <CalendarClock size={15} />
        <span className="stat-sub">{tx('Pick who is filming it and their free times appear here.')}</span>
      </div>
    )
  }

  const part = (from) => (hourOf(from) < 12 ? tx('morning') : hourOf(from) < 17 ? tx('afternoon') : tx('evening'))

  return (
    <div className="sp">
      <div className="sp-head">
        <Clock size={13} />
        <span className="stat-sub">{tx('How long?')}</span>
        <div className="seg sp-len" role="tablist">
          {LENGTHS.map((l) => (
            <button key={l.m} type="button" role="tab" aria-selected={mins === l.m}
              className={'seg-btn' + (mins === l.m ? ' on' : '')}
              onClick={() => { setMins(l.m); setOpenDay(null) }}>{tx(l.label)}</button>
          ))}
        </div>
      </div>

      {data?.hours === null && (
        <div className="sp-note">
          <AlertCircle size={13} />
          {tx('{name} has not set their working hours — this is 09:00–18:00 until they do.', { name: data.user.name })}
        </div>
      )}
      {err && <div className="form-error">{err}</div>}

      {busy && !data && <div className="sp-load"><Loader2 size={16} className="spin" /></div>}

      <div className="sp-list">
        {rows.map((r) => {
          const open = openDay === r.day
          const shown = open ? r.all : r.offer
          return (
            <div className="sp-row" key={r.day}>
              <span className="sp-row-day">{dayWords(r.day)}{r.day === today ? ` · ${tx('today')}` : ''}</span>
              <div className="sp-row-times">
                {shown.map((s) => {
                  const on = value?.date === r.day && value?.from === s.from
                  return (
                    <button key={s.from} type="button" className={'sp-slot' + (on ? ' on' : '')}
                      onClick={() => onPick({ date: r.day, from: s.from, to: s.to, mins })}>
                      {s.from}–{s.to}
                      {!open && <em>{part(s.from)}</em>}
                    </button>
                  )
                })}
                {/* The exact half-hours, for the one booking in twenty that
                    needs 14:30 rather than 14:00. */}
                {!open && r.rest.length > 0 && (
                  <button type="button" className="sp-more" onClick={() => setOpenDay(r.day)}>
                    <Plus size={12} />{tx('another time')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {data && rows.length === 0 && !busy && (
        <div className="sp-note">
          <AlertCircle size={13} />
          {tx('Nothing free in the next {n} days at this length.', { n: days })}
        </div>
      )}

      {/* Looking further out is one press, not a pair of week arrows that
          make somebody walk forwards a week at a time to find out there is
          nothing for a fortnight. */}
      {data && days < 28 && (
        <button type="button" className="sp-further" onClick={() => setDays((d) => d + 14)}>
          {tx('Look further ahead')}
        </button>
      )}
    </div>
  )
}
