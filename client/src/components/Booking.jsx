import { useState } from 'react'
import { CalendarCheck, CalendarX, Clock, Check, X, Hourglass } from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { tr as tx, locale } from '../lib/i18n.jsx'

// ---- the time the crew agreed to ----
// A shoot day used to be a fact the moment somebody typed it. It is not: the
// person holding the camera has an afternoon that is either free or not, and
// the board found out which on the day. Same for an editor handed a deadline.
//
// So a booking is a question now, and this is where it is asked and answered.
// The planner books; the person holding it says yes or no; a "no" carries a
// reason, because a no with no reason cannot be planned around. Once it is
// accepted the slot is theirs — moving it is the admin's to do, and doing it
// asks the question again rather than leaving a tick over a time nobody
// agreed to.

const HOURS = (from, to) => {
  if (!from || !to) return ''
  const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const mins = m(to) - m(from)
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const r = mins % 60
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`
}

const dayWords = (iso) => {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function Booking({ item, which, label, holderName, mine, onAnswered }) {
  const [busy, setBusy] = useState(false)
  const [saying, setSaying] = useState(null) // null | { note }
  if (!item) return null

  const K = which === 'shoot'
    ? { ack: 'shoot_ack', at: 'shoot_ack_at', note: 'shoot_ack_note', day: 'recording_date', from: 'recording_time', to: 'recording_end' }
    : { ack: 'edit_ack', at: 'edit_ack_at', note: 'edit_ack_note', day: 'edit_ready_date', from: null, to: null }
  const day = item[K.day]
  if (!day || !holderName) return null // half a plan owes nobody an answer

  const state = item[K.ack] || ''
  const from = K.from ? item[K.from] : null
  const to = K.to ? item[K.to] : null
  const span = HOURS(from, to)

  const answer = async (ok, note = '') => {
    setBusy(true)
    try {
      const next = await api.post(`/content/${item.id}/confirm`, { which, ok, note })
      toast(ok ? tx('Confirmed — it is in your day now') : tx('Said. Whoever booked it has been told.'))
      setSaying(null)
      onAnswered?.(next)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const Icon = state === 'yes' ? CalendarCheck : state === 'no' ? CalendarX : Hourglass
  return (
    <div className={`bk bk-${state || 'wait'}`}>
      <div className="bk-slot">
        <Icon size={15} className="bk-ico" />
        <span className="bk-when">
          <b>{dayWords(day)}</b>
          {from && <span className="bk-time"><Clock size={11} /> {from}{to ? `–${to}` : ''}{span ? ` · ${span}` : ''}</span>}
        </span>
        <span className="bk-label">{label}</span>
      </div>

      <div className="bk-line">
        {state === 'yes' && <span className="bk-said bk-yes"><Check size={13} strokeWidth={3} /> {tx('{name} confirmed', { name: holderName })}</span>}
        {state === 'no' && (
          <span className="bk-said bk-no">
            <X size={13} strokeWidth={3} /> {tx('{name} can’t make it', { name: holderName })}
            {item[K.note] ? <i className="bk-why">“{item[K.note]}”</i> : null}
          </span>
        )}
        {!state && <span className="bk-said bk-wait">{tx('Waiting on {name}', { name: holderName })}</span>}

        {mine && !saying && (
          <span className="bk-do">
            {state !== 'yes' && (
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => answer(true)}>
                <Check size={13} /> {tx('I can make it')}
              </button>
            )}
            {state !== 'no' && (
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setSaying({ note: '' })}>
                <X size={13} /> {tx('I can’t')}
              </button>
            )}
          </span>
        )}
      </div>

      {mine && saying && (
        <div className="bk-form">
          <textarea className="input" rows={2} autoFocus value={saying.note}
            onChange={(e) => setSaying({ note: e.target.value })}
            placeholder={tx('What is in the way? Another shoot, an exam, out of town…')} />
          <div className="bk-actions">
            <span className="stat-sub">{tx('Said now, it can still be moved.')}</span>
            <button type="button" className="btn btn-sm" onClick={() => setSaying(null)}>{tx('Cancel')}</button>
            <button type="button" className="btn btn-sm btn-danger" disabled={busy || !saying.note.trim()}
              onClick={() => answer(false, saying.note.trim())}>{tx('Send it')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
