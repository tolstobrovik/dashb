import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, Hand, ArrowRight, Check } from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'

// Late work, handed to the person carrying it.
//
// It used to pile into one strip above an admin's calendar — fifty pieces
// going back a month, to be dragged back onto days one at a time by somebody
// who did not know why any of them had slipped. That is the wrong person
// doing the wrong job. The people who know are the ones holding the work.
//
// So each person is shown what THEY are late on, with the three answers that
// actually exist: give it a new day (which, for a day already promised, means
// asking an admin), say what is in the way, or open it and finish it. Nothing
// here is a nag for its own sake — a piece somebody has already spoken for
// drops off the list the moment they speak.

const PHASE_WORD = {
  shoot: 'the shoot', edit: 'the cut', design: 'the artwork', release: 'the release',
}
const lateWord = (n) => (n === 1 ? 'a day late' : `${n} days late`)

export default function MyLate({ onOpen }) {
  const [rows, setRows] = useState(null)
  const [asking, setAsking] = useState(null)   // null | { row, to, reason }
  const [saying, setSaying] = useState(null)   // null | { row, reason }
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/content/late/mine')
    .then((d) => setRows(Array.isArray(d) ? d : []))
    .catch(() => setRows([]))
  useEffect(() => { load() }, [])

  if (!rows || rows.length === 0) return null
  // Work somebody has already answered for is still late, but it is no longer
  // asking anything of them — it sits quietly under the count.
  const open = rows.filter((r) => !r.asked && !r.flagged)
  const spokenFor = rows.length - open.length

  const askMove = async () => {
    if (!asking || busy) return
    setBusy(true)
    try {
      await api.post(`/content/${asking.row.content_id}/date-requests`, {
        field: asking.row.field, to_date: asking.to || null, reason: asking.reason.trim(),
      })
      toast('Asked — the admins have it')
      setAsking(null)
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const sayIt = async () => {
    if (!saying || busy) return
    setBusy(true)
    try {
      await api.post(`/content/${saying.row.content_id}/flags`, {
        kind: 'at_risk', reason: saying.reason.trim(),
      })
      toast('Said — the people who plan have it')
      setSaying(null)
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <div className="card card-pad my-late">
      <div className="my-late-head">
        <AlertTriangle size={17} />
        <b>{open.length > 0
          ? `${open.length} thing${open.length === 1 ? '' : 's'} of yours ${open.length === 1 ? 'is' : 'are'} past their day`
          : 'Everything late is spoken for'}</b>
        {spokenFor > 0 && <span className="stat-sub">· {spokenFor} already answered for</span>}
      </div>

      {open.map((r) => (
        <div key={r.id} className="my-late-row">
          <span className="my-late-when">{lateWord(r.days_late)}</span>
          <button type="button" className="my-late-main" onClick={() => onOpen?.(r.content_id)}>
            <span className="my-late-title">{r.title}</span>
            <span className="my-late-what">{PHASE_WORD[r.phase] || r.what} · was due {r.due}</span>
          </button>
          <span className="my-late-do">
            <button type="button" className="btn btn-sm"
              onClick={() => { setSaying(null); setAsking({ row: r, to: '', reason: '' }) }}>
              <CalendarClock size={13} /> New day
            </button>
            <button type="button" className="btn btn-sm"
              onClick={() => { setAsking(null); setSaying({ row: r, reason: '' }) }}>
              <Hand size={13} /> Say why
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpen?.(r.content_id)}>
              <ArrowRight size={13} /> Finish it
            </button>
          </span>

          {asking?.row.id === r.id && (
            <div className="my-late-form">
              <div className="ask-row">
                <span className="ask-was">move to</span>
                <input className="input" type="date" value={asking.to}
                  onChange={(e) => setAsking({ ...asking, to: e.target.value })} />
              </div>
              <textarea className="input" rows={2} autoFocus value={asking.reason}
                onChange={(e) => setAsking({ ...asking, reason: e.target.value })}
                placeholder="What happened? The location fell through, the other shoot overran…" />
              <div className="pravki-actions">
                <span className="stat-sub">A day that was promised moves on an admin’s yes, not before.</span>
                <button type="button" className="btn btn-sm" onClick={() => setAsking(null)}>Cancel</button>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy || !asking.reason.trim()} onClick={askMove}>
                  <Check size={13} /> Ask
                </button>
              </div>
            </div>
          )}
          {saying?.row.id === r.id && (
            <div className="my-late-form">
              <textarea className="input" rows={2} autoFocus value={saying.reason}
                onChange={(e) => setSaying({ ...saying, reason: e.target.value })}
                placeholder="What is in the way? Said now, it can still be planned around." />
              <div className="pravki-actions">
                <span className="stat-sub">Goes to the people who plan, with your name on it.</span>
                <button type="button" className="btn btn-sm" onClick={() => setSaying(null)}>Cancel</button>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy || !saying.reason.trim()} onClick={sayIt}>
                  <Hand size={13} /> Say it
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
