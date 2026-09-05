import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, Clock, Loader2, AlertCircle } from 'lucide-react'
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
// So the form asks the two questions in the order they are actually answered:
// HOW LONG do you need, and then WHICH of these does the operator have free.
// Everything grey is already spoken for; everything you can press is real.
//
// It is a week at a time because that is the horizon a shoot gets booked in,
// and because a month of half-hour slots is 1,300 buttons nobody reads.

const LENGTHS = [30, 60, 90, 120, 180, 240]
const lenLabel = (m) => (m % 60 === 0 ? `${m / 60}${tx('h')}` : `${m}${tx('m')}`)
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dayWords = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export default function SlotPicker({ userId, excludeId, value, onPick, defaultMins = 120 }) {
  const today = todayISO()
  const [from, setFrom] = useState(today)
  const [mins, setMins] = useState(defaultMins)
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!userId) { setData(null); return }
    let alive = true
    setBusy(true); setErr('')
    api.get(`/users/${userId}/slots?from=${from}&days=7&mins=${mins}${excludeId ? `&exclude=${excludeId}` : ''}`)
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setErr(e.message) })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [userId, from, mins, excludeId])

  const anyFree = useMemo(() => (data?.calendar || []).some((d) => d.slots.length > 0), [data])

  if (!userId) {
    return (
      <div className="sp sp-empty">
        <CalendarClock size={15} />
        <span className="stat-sub">{tx('Pick who is filming it and their free times appear here.')}</span>
      </div>
    )
  }

  return (
    <div className="sp">
      <div className="sp-head">
        <span className="sp-len">
          <Clock size={13} />
          <span className="stat-sub">{tx('How long?')}</span>
          <span className="pill-group">
            {LENGTHS.map((m) => (
              <button key={m} type="button" className={'pill' + (mins === m ? ' active' : '')}
                onClick={() => setMins(m)}>{lenLabel(m)}</button>
            ))}
          </span>
        </span>
        <span className="spacer" />
        <span className="sp-nav">
          <button type="button" className="icon-btn" disabled={from <= today}
            onClick={() => setFrom((f) => addDays(f, -7))} aria-label={tx('Previous week')}><ChevronLeft size={16} /></button>
          <button type="button" className="icon-btn"
            onClick={() => setFrom((f) => addDays(f, 7))} aria-label={tx('Next week')}><ChevronRight size={16} /></button>
        </span>
      </div>

      {data?.hours === null && (
        <div className="sp-note">
          <AlertCircle size={13} />
          {tx('{name} has not set their working hours — this is 09:00–18:00 until they do.', { name: data.user.name })}
        </div>
      )}
      {err && <div className="form-error">{err}</div>}

      <div className="sp-week">
        {busy && !data && <div className="sp-load"><Loader2 size={16} className="spin" /></div>}
        {(data?.calendar || []).map((d) => (
          <div key={d.day} className={'sp-day' + (d.working ? '' : ' sp-off') + (d.day === today ? ' sp-today' : '')}>
            <div className="sp-day-h">
              <b>{dayWords(d.day)}</b>
              {!d.working && <span className="stat-sub">{tx('not working')}</span>}
            </div>
            {d.busy.length > 0 && (
              <div className="sp-busy">
                {d.busy.map((b) => (
                  <span key={b.id} className="sp-taken" title={b.title}>{b.from}–{b.to}</span>
                ))}
              </div>
            )}
            <div className="sp-slots">
              {d.working && d.slots.length === 0 && <span className="stat-sub sp-none">{tx('full')}</span>}
              {d.slots.map((s) => {
                const on = value?.date === d.day && value?.from === s.from
                return (
                  <button key={s.from} type="button" className={'sp-slot' + (on ? ' on' : '')}
                    onClick={() => onPick({ date: d.day, from: s.from, to: s.to, mins })}>
                    {s.from}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {data && !anyFree && (
        <div className="sp-note">
          <AlertCircle size={13} />
          {tx('Nothing that long is free this week — try a shorter shoot, or look at next week.')}
        </div>
      )}
    </div>
  )
}
