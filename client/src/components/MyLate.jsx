import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, Hand, ArrowRight, Check } from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { useT } from '../lib/i18n.jsx'

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

export default function MyLate({ onOpen }) {
  const { t } = useT()
  const phaseWord = (p) => (p ? t(`late.phase.${p}`) : '')
  const lateWord = (n) => (n === 1 ? t('late.day_one') : t('late.day_many', { n }))
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
      toast(t('late.asked'))
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
      toast(t('late.said'))
      setSaying(null)
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <div className="card card-pad my-late">
      <div className="my-late-head">
        <AlertTriangle size={17} />
        <b>{open.length > 0
          ? (open.length === 1 ? t('late.heading_one') : t('late.heading_many', { n: open.length }))
          : t('late.allanswered')}</b>
        {spokenFor > 0 && <span className="stat-sub">· {t('late.answered', { n: spokenFor })}</span>}
      </div>

      {open.map((r) => (
        <div key={r.id} className="my-late-row">
          <span className="my-late-when">{lateWord(r.days_late)}</span>
          <button type="button" className="my-late-main" onClick={() => onOpen?.(r.content_id)}>
            <span className="my-late-title">{r.title}</span>
            <span className="my-late-what">{phaseWord(r.phase) || r.what} · {t('late.wasdue', { d: r.due })}</span>
          </button>
          <span className="my-late-do">
            <button type="button" className="btn btn-sm"
              onClick={() => { setSaying(null); setAsking({ row: r, to: '', reason: '' }) }}>
              <CalendarClock size={13} /> {t('late.newday')}
            </button>
            <button type="button" className="btn btn-sm"
              onClick={() => { setAsking(null); setSaying({ row: r, reason: '' }) }}>
              <Hand size={13} /> {t('late.saywhy')}
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpen?.(r.content_id)}>
              <ArrowRight size={13} /> {t('late.finish')}
            </button>
          </span>

          {asking?.row.id === r.id && (
            <div className="my-late-form">
              <div className="ask-row">
                <span className="ask-was">{t('late.moveto')}</span>
                <input className="input" type="date" value={asking.to}
                  onChange={(e) => setAsking({ ...asking, to: e.target.value })} />
              </div>
              <textarea className="input" rows={2} autoFocus value={asking.reason}
                onChange={(e) => setAsking({ ...asking, reason: e.target.value })}
                placeholder={t('late.whathappened')} />
              <div className="pravki-actions">
                <span className="stat-sub">{t('late.promisedhint')}</span>
                <button type="button" className="btn btn-sm" onClick={() => setAsking(null)}>{t('common.cancel')}</button>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy || !asking.reason.trim()} onClick={askMove}>
                  <Check size={13} /> {t('late.ask')}
                </button>
              </div>
            </div>
          )}
          {saying?.row.id === r.id && (
            <div className="my-late-form">
              <textarea className="input" rows={2} autoFocus value={saying.reason}
                onChange={(e) => setSaying({ ...saying, reason: e.target.value })}
                placeholder={t('late.intheway')} />
              <div className="pravki-actions">
                <span className="stat-sub">{t('late.sayhint')}</span>
                <button type="button" className="btn btn-sm" onClick={() => setSaying(null)}>{t('common.cancel')}</button>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy || !saying.reason.trim()} onClick={sayIt}>
                  <Hand size={13} /> {t('late.sayit')}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
