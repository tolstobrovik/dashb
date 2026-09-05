import { useEffect, useMemo, useState } from 'react'
import { Plus, Play, Pause, Flag, CalendarClock, Trash2, AlertCircle, Rocket, ImagePlus, X, Pencil } from 'lucide-react'
import { api } from '../lib/api.js'
import Modal from './Modal.jsx'
import { useContextMenu } from './ContextMenu.jsx'
import { todayISO, addDaysISO, dateLabel } from '../lib/constants.js'
import { PcChecklist, scalePhoto } from './ProjectBits.jsx'
import { playLaunch, playHalt, playDone } from '../lib/sound.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'
import Zoom from './Zoom.jsx'

// Launch programs on a timeline — built for the Target team. Each program is
// a bar: blue while planned, green while running, amber when halted, gray
// when finished. The red line is today; a running program past its end date
// asks to be finished or extended.

export const PROGRAM_STATES = [
  { key: 'planned', label: 'Planned', color: '#2a78d6', icon: CalendarClock, hint: 'Queued — hasn’t launched yet' },
  { key: 'running', label: 'Running', color: '#1D9E75', icon: Play, hint: 'Live right now' },
  { key: 'paused', label: 'Halted', color: '#BA7517', icon: Pause, hint: 'Stopped mid-flight — can resume' },
  { key: 'done', label: 'Finished', color: '#6d6a70', icon: Flag, hint: 'Wrapped up' },
]
const stateOf = (k) => PROGRAM_STATES.find((s) => s.key === k) || PROGRAM_STATES[0]

// Where the ads run. Solid, distinctive colors; 'both' shows in every lens.
export const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', short: 'IG', color: '#d6499b' },
  { key: 'telegram', label: 'Telegram', short: 'TG', color: '#2a9fd6' },
  { key: 'both', label: 'Both', short: 'IG+TG', color: '#7b5ad6' },
]
const platformOf = (k) => PLATFORMS.find((s) => s.key === k) || PLATFORMS[2]

// The branches (filials) a launch is aimed at — worn big on the bar itself.
export const BRANCHES = [
  { key: 'shahristan', label: 'Shahristan' },
  { key: 'chilanzar', label: 'Chilanzar' },
  { key: 'drujba', label: 'Drujba' },
  { key: 'andijan', label: 'Andijan' },
  { key: 'bukhara', label: 'Bukhara' },
]
const branchLabel = (k) => (BRANCHES.find((b) => b.key === k)?.label || k).toUpperCase()
const branchesOf = (p) => { try { return JSON.parse(p.branches || '[]') } catch { return [] } }
// Every branch selected reads as one word — not a wall of city names.
const branchTxt = (p) => {
  const bs = branchesOf(p)
  if (bs.length === 0) return null
  return bs.length === BRANCHES.length ? 'ALL' : bs.map(branchLabel).join(' · ')
}
const creativesN = (p) => { try { return JSON.parse(p.creatives || '[]').length } catch { return 0 } }
const ORDER = { running: 0, paused: 1, planned: 2, done: 3 }

const day = (iso) => Date.parse(`${iso}T00:00:00Z`)
const DAY = 86400000

/* Creatives — each ad variation: name, the script, an optional photo. */
function CreativesEditor({ items, canEdit, onChange }) {
  const set = (i, patch) => onChange(items.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const pickPhoto = async (i, e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { alert('Image is too large — keep it under 15 MB'); return }
    try {
      const [main, thumb] = await Promise.all([scalePhoto(file, 700, 0.8), scalePhoto(file, 120, 0.7)])
      set(i, { photo: main, photo_thumb: thumb })
    } catch (err) { alert(err.message) }
  }
  return (
    <div className="field" style={{ marginTop: 4 }}>
      <div className="pc-check-head">
        <h3>Creatives</h3>
        <span className="stat-sub">{items.length ? `${items.length} of 20` : 'scripts and visuals for this run'}</span>
      </div>
      {items.map((c, i) => (
        <div key={i} className="creative-card">
          <div className="creative-top">
            {c.photo_thumb || c.photo ? (
              <Zoom className="creative-thumb" src={c.photo_thumb || c.photo} full={c.photo || c.photo_thumb} alt={c.title || ''} />
            ) : canEdit ? (
              <label className="creative-thumb creative-pick" data-tip="Attach a photo">
                <ImagePlus size={16} />
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pickPhoto(i, e)} />
              </label>
            ) : null}
            <input className="input pc-mini" style={{ flex: 1, fontWeight: 700 }} disabled={!canEdit}
              value={c.name} placeholder="Creative name…"
              onChange={(e) => set(i, { name: e.target.value })} />
            {canEdit && (c.photo || c.photo_thumb) && (
              <button type="button" className="icon-btn" data-tip="Remove the photo" data-tip-left=""
                onClick={() => set(i, { photo: null, photo_thumb: null })} aria-label="Remove photo"><X size={14} /></button>
            )}
            {canEdit && (
              <button type="button" className="icon-btn del-btn" data-tip="Delete this creative" data-tip-left=""
                onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Delete creative"><Trash2 size={14} /></button>
            )}
          </div>
          <textarea className="input" rows={2} disabled={!canEdit} value={c.script}
            placeholder="Script / description — hook, text, CTA…"
            onChange={(e) => set(i, { script: e.target.value })} />
        </div>
      ))}
      {canEdit && items.length < 20 && (
        <button type="button" className="btn btn-sm" style={{ marginTop: 6 }}
          onClick={() => onChange([...items, { name: '', script: '', photo: null, photo_thumb: null }])}>
          <Plus size={14} /> Add creative
        </button>
      )}
    </div>
  )
}

function ProgramForm({ program, channel, isAdmin, onClose, onSaved, onDeleted }) {
  const creating = !program
  const [err, setErr] = useState('')
  const [form, setForm] = useState(() => ({
    name: program?.name || '',
    status: program?.status || 'planned',
    platform: program?.platform || 'both',
    start_date: program?.start_date || todayISO(),
    end_date: program?.end_date || '',
    budget: program?.budget ?? '',
    note: program?.note || '',
    checklist: (() => { try { return JSON.parse(program?.checklist || '[]') } catch { return [] } })(),
    creatives: (() => { try { return JSON.parse(program?.creatives || '[]') } catch { return [] } })(),
    branches: (() => { try { return JSON.parse(program?.branches || '[]') } catch { return [] } })(),
  }))
  const toggleBranch = (k) =>
    setForm((f) => ({ ...f, branches: f.branches.includes(k) ? f.branches.filter((b) => b !== k) : [...f.branches, k] }))
  const save = async () => {
    if (!form.name.trim()) { setErr('Give the program a name'); return }
    setErr('')
    try {
      const payload = { ...form, name: form.name.trim(), start_date: form.start_date || null, end_date: form.end_date || null, budget: form.budget === '' ? null : Number(form.budget) }
      if (!isAdmin) delete payload.checklist // the server allows checklist edits for admins only
      payload.creatives = form.creatives.filter((c) => c.name.trim())
      const saved = creating
        ? await api.post('/programs', { ...payload, channel })
        : await api.patch(`/programs/${program.id}`, payload)
      toast(creating ? 'Program launched — synced' : 'Program saved — synced')
      onSaved(saved)
      onClose()
    } catch (e) { setErr(e.message) }
  }
  const del = async () => {
    if (!confirm(`Delete the program “${program.name}”?`)) return
    try { await api.del(`/programs/${program.id}`); toast(tx('Program deleted')); onDeleted(program); onClose() } catch (e) { setErr(e.message) }
  }
  return (
    <Modal
      title={creating ? 'New program' : 'Program'}
      onClose={onClose}
      footer={<>
        {!creating && <button className="btn btn-danger" onClick={del}><Trash2 size={15} /> Delete</button>}
        <span className="foot-gap" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{creating ? 'Launch plan' : 'Save'}</button>
      </>}
    >
      {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
      <div className="field"><label>Name</label>
        <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Lead gen — August intake" />
      </div>
      <div className="field"><label>State</label>
        <div className="prog-states">
          {PROGRAM_STATES.map((s) => {
            const Icon = s.icon
            const on = form.status === s.key
            return (
              <button key={s.key} type="button" data-tip={s.hint}
                className={'prog-state' + (on ? ' on' : '')}
                style={on ? { background: s.color, borderColor: s.color, color: '#fff' } : undefined}
                onClick={() => setForm({ ...form, status: s.key })}>
                <Icon size={14} /> {s.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="field"><label>Platform</label>
        <div className="prog-states">
          {PLATFORMS.map((pl) => {
            const on = form.platform === pl.key
            return (
              <button key={pl.key} type="button" data-tip={pl.key === 'both' ? 'Runs on Instagram and Telegram' : `Runs on ${pl.label}`}
                className={'prog-state' + (on ? ' on' : '')}
                style={on ? { background: pl.color, borderColor: pl.color, color: '#fff' } : undefined}
                onClick={() => setForm({ ...form, platform: pl.key })}>
                {pl.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="field"><label>Branch <span className="stat-sub">— which filial this launch targets (pick several if needed)</span></label>
        <div className="checkbox-row">
          {BRANCHES.map((b) => (
            <label key={b.key} className={'checkbox-chip chip-sm' + (form.branches.includes(b.key) ? ' on' : '')}>
              <input type="checkbox" checked={form.branches.includes(b.key)} onChange={() => toggleBranch(b.key)} />
              {b.label}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>Start</label>
          <input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        </div>
        <div className="field"><label>End <span className="stat-sub">(blank = open-ended)</span></label>
          <input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        </div>
      </div>
      <div className="field"><label>Budget <span className="stat-sub">(optional)</span></label>
        <input className="input" type="number" min="0" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
      </div>
      <div className="field"><label>Note <span className="stat-sub">(optional)</span></label>
        <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
          placeholder="Audience, creative, landing…" />
      </div>
      <CreativesEditor
        items={form.creatives}
        canEdit
        onChange={(items) => setForm({ ...form, creatives: items })}
      />
      {/* The launch checklist — a to-do list in miniature, admin's hands only */}
      {(isAdmin || form.checklist.length > 0) && (
        <div className="field" style={{ marginTop: 4 }}>
          <PcChecklist
            items={form.checklist}
            canTick={isAdmin} canEditItems={isAdmin} compact
            onChange={(items) => setForm({ ...form, checklist: items })}
          />
        </div>
      )}
    </Modal>
  )
}

export default function ProgramsGantt({ channel, canManage, isAdmin = false, lens = 'all', big = false }) {
  const [programs, setPrograms] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [modal, setModal] = useState(null) // null | 'new' | program

  useEffect(() => {
    setLoaded(false)
    api.get(`/programs?channel=${channel}`).then((p) => { setPrograms(p); setLoaded(true) }).catch(() => setLoaded(true))
  }, [channel])
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || modal) return
      api.poll(`/programs?channel=${channel}`).then((f) => { if (f) setPrograms(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    return () => clearInterval(id)
  }, [channel, modal])

  const today = todayISO()
  const replace = (saved) => setPrograms((prev) => {
    const has = prev.some((p) => p.id === saved.id)
    return has ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved]
  })
  const quickState = async (p, status) => {
    try {
      replace(await api.patch(`/programs/${p.id}`, { status }))
      if (status === 'running') playLaunch()
      else if (status === 'paused') playHalt()
      else if (status === 'done') playDone()
    toast(status === 'running' ? 'Program running — synced' : status === 'paused' ? 'Program halted — synced' : 'Program finished — synced')
    } catch (e) { alert(e.message) }
  }

  // Right-click a row: run / halt / finish / open / delete in one gesture.
  const { openMenu } = useContextMenu()
  const removeProgram = async (prog) => {
    if (!confirm(`Delete the program “${prog.name}”?`)) return
    try {
      await api.del(`/programs/${prog.id}`)
      setPrograms((prev) => prev.filter((x) => x.id !== prog.id))
      toast(tx('Program deleted'))
    } catch (e) { alert(e.message) }
  }
  const rowMenu = (e, prog) => canManage && openMenu(e, [
    { label: 'Open', icon: Pencil, onClick: () => setModal(prog) },
    prog.status !== 'running' && prog.status !== 'done' && { label: 'Start / resume', icon: Play, onClick: () => quickState(prog, 'running') },
    prog.status === 'running' && { label: 'Halt', icon: Pause, onClick: () => quickState(prog, 'paused') },
    prog.status !== 'done' && { label: 'Mark as finished', icon: Flag, onClick: () => quickState(prog, 'done') },
    { sep: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => removeProgram(prog) },
  ])

  // The lens: Instagram / Telegram / both. 'both' programs show everywhere.
  const visible = useMemo(
    () => (lens === 'all' ? programs : programs.filter((p) => p.platform === 'both' || p.platform === lens)),
    [programs, lens])
  const dated = useMemo(
    () => [...visible].filter((p) => p.start_date)
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.end_date || '9999').localeCompare(b.end_date || '9999')),
    [visible])
  const undated = useMemo(() => visible.filter((p) => !p.start_date), [visible])
  const counts = useMemo(() => {
    const c = { running: 0, paused: 0, planned: 0, done: 0 }
    for (const p of visible) c[p.status] = (c[p.status] || 0) + 1
    return c
  }, [visible])

  // Axis: cover every program generously, capped so one long run can't
  // flatten the rest; open-ended running bars stretch to the axis edge.
  const axis = useMemo(() => {
    let lo = day(addDaysISO(today, -7)), hi = day(addDaysISO(today, 45)) // blank runway ahead
    for (const p of dated) {
      lo = Math.min(lo, day(p.start_date))
      hi = Math.max(hi, day(p.end_date || addDaysISO(today, 14)) + 10 * DAY)
    }
    lo = Math.max(lo, day(addDaysISO(today, -120)))
    hi = Math.min(hi, day(addDaysISO(today, 210)))
    return { lo, hi, span: hi - lo }
  }, [dated, today])
  const pct = (iso) => Math.min(100, Math.max(0, ((day(iso) - axis.lo) / axis.span) * 100))

  // Month headers + Monday ticks across the axis
  const months = useMemo(() => {
    const out = []
    const d = new Date(axis.lo)
    d.setUTCDate(1)
    while (d.getTime() <= axis.hi) {
      const left = Math.max(0, ((d.getTime() - axis.lo) / axis.span) * 100)
      out.push({ left, label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) })
      d.setUTCMonth(d.getUTCMonth() + 1)
    }
    return out
  }, [axis])
  const mondays = useMemo(() => {
    const out = []
    const d = new Date(axis.lo)
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1)
    while (d.getTime() <= axis.hi) {
      out.push({ left: ((d.getTime() - axis.lo) / axis.span) * 100, label: String(d.getUTCDate()) })
      d.setUTCDate(d.getUTCDate() + 7)
    }
    return out
  }, [axis])

  if (!loaded) return <div className="card card-pad empty">Loading programs…</div>

  if (programs.length === 0) {
    return (
      <div className="card card-pad empty" style={{ textAlign: 'center' }}>
        <Rocket size={26} style={{ color: 'var(--brand-500)' }} />
        <div style={{ fontWeight: 700, color: 'var(--ink-2)', margin: '6px 0 2px' }}>No programs yet</div>
        <div className="stat-sub">Track every launch as a bar on the timeline — running, halted, finished.</div>
        {canManage && (
          <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => setModal('new')}>
            <Plus size={15} /> New program
          </button>
        )}
        {modal === 'new' && <ProgramForm channel={channel} isAdmin={isAdmin} onClose={() => setModal(null)} onSaved={replace} />}
      </div>
    )
  }

  return (
    <>
      {/* the fleet at a glance — the running count in BIG type */}
      <div className="prog-summary">
        <span className="prog-big" data-tip="Programs live right now">
          <b>{counts.running}</b> running now
        </span>
        {PROGRAM_STATES.map((s) => (
          s.key !== 'running' && counts[s.key] > 0 && (
            <span key={s.key} className="prog-count" data-tip={s.hint}>
              <span className="rp-dot" style={{ background: s.color }} />
              <b>{counts[s.key]}</b> {s.label.toLowerCase()}
            </span>
          )
        ))}
        <span className="spacer" />
        {canManage && (
          <button className="btn btn-primary btn-sm" onClick={() => setModal('new')}><Plus size={15} /> New program</button>
        )}
      </div>

      <div className={'card gantt-card' + (big ? ' gantt-big' : '')}>
        <div className="gantt-scroll">
          <div style={{ minWidth: 900 }}>
            <div className="gantt-axis">
              <span className="gantt-label" />
              <div className="gantt-track">
                {months.map((m) => <span key={m.label} className="gantt-month" style={{ left: `${m.left}%` }}>{m.label}</span>)}
                {mondays.map((t, i) => <span key={i} className="gantt-tick" style={{ left: `${t.left}%` }}>{t.label}</span>)}
                {day(today) >= axis.lo && day(today) <= axis.hi && (
                  <span className="gantt-tick now" style={{ left: `${pct(today)}%` }}>{new Date(day(today)).getUTCDate()}</span>
                )}
              </div>
            </div>

            {dated.map((p) => {
              const st = stateOf(p.status)
              const open = !p.end_date
              const startsIn = day(p.start_date) > day(today) ? Math.round((day(p.start_date) - day(today)) / DAY) : null
              const dayN = Math.floor((day(today) - day(p.start_date)) / DAY) + 1
              const total = p.end_date ? Math.round((day(p.end_date) - day(p.start_date)) / DAY) + 1 : null
              const pastEnd = p.status === 'running' && p.end_date && p.end_date < today
              const sub = p.status === 'running'
                ? (pastEnd ? 'past its end date' : total ? `day ${dayN} of ${total}` : `day ${dayN} · open-ended`)
                : p.status === 'planned' && startsIn != null ? `starts in ${startsIn}d`
                : p.status === 'paused' ? 'halted'
                : `${dateLabel(p.start_date)}${p.end_date ? ` → ${dateLabel(p.end_date)}` : ''}`
              const left = pct(p.start_date)
              const right = open ? 100 : pct(p.end_date)
              return (
                <div className="gantt-row" key={p.id} onContextMenu={(e) => rowMenu(e, p)}>
                  <button className="gantt-label" onClick={() => canManage && setModal(p)}
                    data-tip={canManage ? 'Open the program' : undefined}>
                    <span className="gantt-name">
                      <span className="rp-dot" style={{ background: st.color }} />
                      {p.name}
                      {pastEnd && <AlertCircle size={13} style={{ color: '#A32D2D', marginLeft: 5, verticalAlign: -2 }} />}
                    </span>
                    <span className="gantt-sub">
                      <b className="prog-pf" style={{ color: platformOf(p.platform).color }}>{platformOf(p.platform).short}</b>
                      {branchTxt(p) && <b className="prog-br"> {branchTxt(p)}</b>}
                      {' '}{sub}{p.budget != null ? ` · ${Number(p.budget).toLocaleString()} budget` : ''}
                      {(() => {
                        let cl = []
                        try { cl = JSON.parse(p.checklist || '[]') } catch { /* old rows */ }
                        if (cl.length === 0) return null
                        const d = cl.filter((c) => c.done).length
                        return <span className={d === cl.length ? 'prog-cl done' : 'prog-cl'}> · ✓ {d}/{cl.length}</span>
                      })()}
                      <span className="prog-cl prog-cr"> · <b>{creativesN(p)}</b> creative{creativesN(p) === 1 ? '' : 's'}</span>
                    </span>
                  </button>
                  <div className="gantt-track">
                    {day(today) >= axis.lo && day(today) <= axis.hi && (
                      <span className="gantt-today" style={{ left: `${pct(today)}%` }} />
                    )}
                    <button
                      className={'gantt-bar' + (open ? ' prog-open' : '') + (p.status === 'paused' ? ' prog-halted' : '')}
                      style={{ left: `${left}%`, width: `${Math.max(3.5, right - left)}%`, background: st.color, color: '#fff' }}
                      onClick={() => canManage && setModal(p)}
                      data-tip={`${st.label}${pastEnd ? ' — past its end date: finish or extend' : ''}`}
                    >
                      {branchTxt(p) && (
                        <span className="prog-branch-txt">{branchTxt(p)}</span>
                      )}
                      <span className="gantt-bar-txt">{p.name}</span>
                    </button>
                    {/* one-click state changes right on the row */}
                    {canManage && (
                      <span className="prog-quick">
                        {p.status !== 'running' && p.status !== 'done' && (
                          <button className="icon-btn" data-tip="Start / resume" data-tip-left="" onClick={() => quickState(p, 'running')} aria-label="Run"><Play size={13} /></button>
                        )}
                        {p.status === 'running' && (
                          <button className="icon-btn" data-tip="Halt this program" data-tip-left="" onClick={() => quickState(p, 'paused')} aria-label="Halt"><Pause size={13} /></button>
                        )}
                        {p.status !== 'done' && (
                          <button className="icon-btn" data-tip="Mark as finished" data-tip-left="" onClick={() => quickState(p, 'done')} aria-label="Finish"><Flag size={13} /></button>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {undated.length > 0 && (
          <div className="gantt-undated">
            <span className="stat-sub" style={{ fontWeight: 700 }}>Without a start date:</span>
            {undated.map((p) => (
              <button key={p.id} className="chip chip-muted" onClick={() => canManage && setModal(p)}>
                <span className="rp-dot" style={{ background: stateOf(p.status).color }} />{p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <ProgramForm
          program={modal === 'new' ? null : modal}
          channel={channel}
          isAdmin={isAdmin}
          onClose={() => setModal(null)}
          onSaved={replace}
          onDeleted={(p) => setPrograms((prev) => prev.filter((x) => x.id !== p.id))}
        />
      )}
    </>
  )
}
