import { useEffect, useState } from 'react'
import { Plus, Trash2, Gauge } from 'lucide-react'
import { api } from '../lib/api.js'
import Modal from './Modal.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// Building one person's month, band by band.
//
// The sheets this replaces are a table each: a metric down the side, five rows
// from A+ to D, and what the row pays. So this is that table, and nothing
// more. What it deliberately does NOT do is offer a set of ready-made KPIs:
// every one of the five sheets is different, they are rewritten in the last
// five days of every month, and a board that shipped with somebody's grades
// baked in would be wrong the first time anybody changed their mind.
//
// A metric is either one the board measures — it fills the reading in itself
// and shows what it got — or one nobody here can see, like leads or forwards,
// which is typed in for the month beside the ladder that reads it.
const AUTO = [
  { key: 'skip_rate', label: 'Average skip rate', unit: '%' },
  { key: 'late', label: 'Pieces delivered late', unit: '' },
  { key: 'delivered', label: 'Pieces delivered', unit: '' },
  { key: 'on_time_pct', label: 'Delivered on time', unit: '%' },
  { key: 'views', label: 'Views in the month', unit: '' },
]
const GRADES = ['A+', 'A', 'B', 'C', 'D']
const blankLadder = (n) => ({
  key: `k${n}`, label: '', metric: 'manual', unit: '',
  bands: GRADES.map((grade) => ({ grade, from: '', to: '', pays: '' })),
})
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))

export default function KpiCard({ userId, name, month, onClose }) {
  const [form, setForm] = useState(null)
  const [stats, setStats] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get(`/reports/kpi/${userId}?month=${month}`).then((d) => {
      setStats(d.stats || {})
      setForm(d.raw
        ? { currency: d.raw.currency, fixed: String(d.raw.fixed || ''), ladders: d.raw.ladders, readings: d.raw.readings || {}, note: d.raw.note || '' }
        : { currency: 'UZS', fixed: '', ladders: [], readings: {}, note: '' })
    }).catch((e) => setErr(e.message))
  }, [userId, month])

  if (!form) return <Modal title={tx('KPI')} onClose={onClose}><div className="empty faint">{tx('Loading…')}</div></Modal>

  const setLadder = (i, patch) => setForm({ ...form, ladders: form.ladders.map((l, n) => (n === i ? { ...l, ...patch } : l)) })
  const setBand = (i, bi, patch) => setLadder(i, {
    bands: form.ladders[i].bands.map((b, n) => (n === bi ? { ...b, ...patch } : b)),
  })

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const ladders = form.ladders.map((l) => ({
        ...l,
        bands: l.bands
          .filter((b) => b.pays !== '' || b.from !== '' || b.to !== '')
          .map((b) => ({ grade: b.grade, from: num(b.from), to: num(b.to), pays: Number(b.pays) || 0 })),
      })).filter((l) => l.bands.length > 0)
      await api.put(`/reports/kpi/${userId}/${month}`, {
        currency: form.currency, fixed: Number(form.fixed) || 0,
        ladders, readings: form.readings, note: form.note,
      })
      onClose(true)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={`${tx('KPI')} · ${name} · ${month}`} onClose={() => onClose(false)} wide footer={
      <>
        <span className="stat-sub">{tx('Set for this month only. Next month starts from whatever you leave here.')}</span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => onClose(false)}>{tx('Cancel')}</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? tx('Saving…') : tx('Save')}</button>
      </>
    }>
      {err && <div className="form-error">{err}</div>}
      <div className="kpi-edit">
        <div className="kpi-edit-top">
          <label className="field"><span>{tx('Fixed pay')}</span>
            <input className="input" type="number" min="0" value={form.fixed}
              onChange={(e) => setForm({ ...form, fixed: e.target.value })} />
          </label>
          <label className="field"><span>{tx('Currency')}</span>
            <input className="input" value={form.currency} maxLength={8}
              onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </label>
        </div>

        {form.ladders.map((l, i) => {
          const auto = AUTO.find((a) => a.key === l.metric)
          const reading = auto ? stats[l.metric] : form.readings[l.key]
          return (
            <div className="kpi-ladder" key={l.key}>
              <div className="kpi-ladder-head">
                <input className="input" placeholder={tx('What this bonus is called')} value={l.label}
                  onChange={(e) => setLadder(i, { label: e.target.value })} />
                <select className="select" value={l.metric} onChange={(e) => setLadder(i, { metric: e.target.value })}>
                  {AUTO.map((a) => <option key={a.key} value={a.key}>{tx(a.label)}</option>)}
                  <option value="manual">{tx('A number you enter')}</option>
                </select>
                <button className="icon-btn" onClick={() => setForm({ ...form, ladders: form.ladders.filter((_, n) => n !== i) })}
                  data-tip={tx('Remove')}><Trash2 size={14} /></button>
              </div>
              <div className="kpi-reading">
                {auto
                  ? <span className="stat-sub">{tx('The board measured')} <b>{reading ?? tx('nothing yet')}</b></span>
                  : (
                    <label className="stat-sub">{tx('This month it was')}
                      <input className="input" type="number" value={form.readings[l.key] ?? ''}
                        onChange={(e) => setForm({ ...form, readings: { ...form.readings, [l.key]: e.target.value } })} />
                    </label>
                  )}
                <label className="stat-sub">{tx('Pays nothing under')}
                  <input className="input" type="number" placeholder="—" value={l.gate?.min ?? ''}
                    onChange={(e) => setLadder(i, { gate: e.target.value === '' ? null : { metric: 'manual', min: e.target.value } })} />
                </label>
                {l.gate && (
                  <label className="stat-sub">{tx('and it was')}
                    <input className="input" type="number" value={form.readings[`${l.key}_gate`] ?? ''}
                      onChange={(e) => setForm({ ...form, readings: { ...form.readings, [`${l.key}_gate`]: e.target.value } })} />
                  </label>
                )}
              </div>
              <table className="tbl kpi-bands">
                <thead><tr><th>{tx('Grade')}</th><th>{tx('From')}</th><th>{tx('To')}</th><th>{tx('Pays')}</th></tr></thead>
                <tbody>
                  {l.bands.map((b, bi) => (
                    <tr key={b.grade}>
                      <td><b>{b.grade}</b></td>
                      <td><input className="input" type="number" placeholder="—" value={b.from ?? ''} onChange={(e) => setBand(i, bi, { from: e.target.value })} /></td>
                      <td><input className="input" type="number" placeholder="—" value={b.to ?? ''} onChange={(e) => setBand(i, bi, { to: e.target.value })} /></td>
                      <td><input className="input" type="number" placeholder="0" value={b.pays ?? ''} onChange={(e) => setBand(i, bi, { pays: e.target.value })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="cm-hint">{tx('Leave a box empty to mean “no limit this way”. 55 and nothing is “55 or more”.')}</div>
            </div>
          )
        })}

        <button className="btn" onClick={() => setForm({ ...form, ladders: [...form.ladders, blankLadder(form.ladders.length + 1)] })}>
          <Plus size={14} /> {tx('Add a bonus')}
        </button>
        {form.ladders.length === 0 && (
          <div className="cm-hint" style={{ marginTop: 8 }}>
            <Gauge size={13} style={{ verticalAlign: -2 }} /> {tx('A bonus is a number, five bands and what each band pays. Nothing here is filled in for you, because every sheet is different and they are rewritten every month.')}
          </div>
        )}
      </div>
    </Modal>
  )
}
