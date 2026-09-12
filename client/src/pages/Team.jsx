import { useEffect, useMemo, useState } from 'react'
import {
  UsersRound, UserRoundPlus, Phone, Clock, Pencil, Check, Trash2, Plus, Flame, BadgeCheck, Sparkles,
  LayoutGrid, Rows3, KanbanSquare, Gauge, UserSearch, Banknote, Link as LinkIcon, ArrowRight,
} from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useChannels } from '../lib/channels.jsx'
import { scheduleLabel, WORK_DAYS, PERMISSIONS, dateLabel } from '../lib/constants.js'
import Avatar from '../components/Avatar.jsx'
import Fold from '../components/Fold.jsx'
import Modal from '../components/Modal.jsx'
import { playDone } from '../lib/sound.js'
import { useContextMenu } from '../components/ContextMenu.jsx'
import RolePicker from '../components/RolePicker.jsx'
import { toast, loadFailed } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// The team in one place: who we have, how to reach them, when they work and
// what they answer for — plus the hiring board for the roles we still need.
// Admin-only. Solid colors, big type, zero clutter. Editing a member covers
// everything the Admin panel does, except the password.

const roleWord = (u) => {
  if (u.role === 'admin') return 'Admin'
  const caps = u.crew_roles || []
  if (caps.length) return caps.map((c) => c[0].toUpperCase() + c.slice(1)).join(' & ')
  return 'Member'
}

// The candidate pipeline, plain and readable.
const STAGES = [
  { key: 'new', label: tx('Considering'), color: '#2a78d6' },
  { key: 'interview', label: tx('Interview'), color: '#BA7517' },
  { key: 'offer', label: tx('Offer'), color: '#7b5ad6' },
  { key: 'hired', label: tx('Hired'), color: '#1D9E75' },
  { key: 'declined', label: tx('Declined'), color: '#6d6a70' },
]
const stageOf = (k) => STAGES.find((x) => x.key === k) || STAGES[0]

/* A candidate: everything you need to weigh them up in one card. */
function CandidateModal({ candidate, positions, onClose, onSaved, onDeleted }) {
  const creating = !candidate
  const [form, setForm] = useState(() => ({
    name: candidate?.name || '',
    contacts: candidate?.contacts || '',
    position: candidate?.position || '',
    salary: candidate?.salary || '',
    portfolio: candidate?.portfolio || '',
    experience: candidate?.experience || '',
    notes: candidate?.notes || '',
    stage: candidate?.stage || 'new',
  }))
  const [err, setErr] = useState('')
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const save = async () => {
    if (!form.name.trim()) { setErr('Give the candidate a name'); return }
    setErr('')
    try {
      const saved = creating
        ? await api.post('/candidates', form)
        : await api.patch(`/candidates/${candidate.id}`, form)
      toast(creating ? 'Candidate added — synced' : 'Candidate saved — synced')
      onSaved(saved)
      onClose()
    } catch (e) { setErr(e.message) }
  }
  const del = async () => {
    if (!confirm(`Remove ${candidate.name} from the candidates?`)) return
    try { await api.del(`/candidates/${candidate.id}`); toast(tx('Candidate removed')); onDeleted(candidate); onClose() } catch (e) { setErr(e.message) }
  }
  return (
    <Modal title={creating ? 'New candidate' : form.name} onClose={onClose}
      footer={<>
        {!creating && <button className="btn btn-danger" onClick={del}><Trash2 size={15} />{' '}{tx("Remove")}</button>}
        <span className="foot-gap" />
        <button className="btn" onClick={onClose}>{tx("Cancel")}</button>
        <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()}><Check size={15} />{' '}{tx("Save")}</button>
      </>}>
      {err && <div className="form-error">{err}</div>}
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>{tx("Name")}</label>
          <input className="input" autoFocus value={form.name} placeholder={tx("Full name")}
            onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="field"><label>{tx("Contacts")}</label>
          <input className="input" value={form.contacts} placeholder="+998 …, @telegram, email"
            onChange={(e) => set({ contacts: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>{tx("Considering for")}</label>
          <input className="input" list="cand-positions" value={form.position} placeholder={tx("Position — e.g. YouTube manager")}
            onChange={(e) => set({ position: e.target.value })} />
          <datalist id="cand-positions">
            {positions.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="field"><label>{tx("Expected salary")}</label>
          <input className="input" value={form.salary} placeholder="e.g. $600 / 7 mln UZS"
            onChange={(e) => set({ salary: e.target.value })} />
        </div>
      </div>
      <div className="field"><label>Portfolio <span className="stat-sub">(link or where to look)</span></label>
        <input className="input" value={form.portfolio} placeholder="https://…"
          onChange={(e) => set({ portfolio: e.target.value })} />
      </div>
      <div className="field"><label>{tx("Experience")}</label>
        <textarea className="input" rows={2} value={form.experience} placeholder={tx("Years, places, what they've shipped…")}
          onChange={(e) => set({ experience: e.target.value })} />
      </div>
      <div className="field"><label>{tx("Notes")}</label>
        <textarea className="input" rows={2} value={form.notes} placeholder={tx("Impressions, next steps…")}
          onChange={(e) => set({ notes: e.target.value })} />
      </div>
      <div className="field"><label>{tx("Stage")}</label>
        <div className="prog-states">
          {STAGES.map((st) => (
            <button key={st.key} type="button"
              className={'prog-state' + (form.stage === st.key ? ' on' : '')}
              style={form.stage === st.key ? { background: st.color, borderColor: st.color, color: '#fff' } : undefined}
              onClick={() => set({ stage: st.key })}>
              {st.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

/* Full member editor: identity + role + channels + rights + card fields.
   The password stays in Admin → People on purpose. */
function MemberModal({ member, channels, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: member.name,
    username: member.username,
    email: member.email || '',
    role: member.role,
    crew_roles: [...(member.crew_roles || [])],
    departments: [...(member.departments || [])],
    permissions: { ...(member.permissions || {}) },
    position: member.position || '',
    phone: member.phone || '',
    duties: member.duties || '',
    work_start: member.work_start || '',
    work_end: member.work_end || '',
    work_days: Array.isArray(member.work_days) ? member.work_days : [],
  }))
  const [err, setErr] = useState('')
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const toggleDay = (d) => set({ work_days: form.work_days.includes(d) ? form.work_days.filter((x) => x !== d) : [...form.work_days, d].sort() })
  const toggleDept = (k) => set({ departments: form.departments.includes(k) ? form.departments.filter((x) => x !== k) : [...form.departments, k] })
  const togglePerm = (k) => set({ permissions: { ...form.permissions, [k]: !form.permissions[k] } })
  const save = async () => {
    setErr('')
    try {
      const u = await api.patch(`/users/${member.id}`, {
        name: form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim() || null,
        role: form.role,
        crew_roles: form.crew_roles,
        departments: form.departments,
        permissions: form.permissions,
        position: form.position.trim() || null,
        phone: form.phone.trim() || null,
        duties: form.duties.trim() || null,
        work_start: form.work_start || null,
        work_end: form.work_end || null,
        work_days: form.work_days.length ? form.work_days : null,
      })
      toast(tx('Member saved — synced'))
      onSaved(u)
      onClose()
    } catch (e) { setErr(e.message) }
  }
  return (
    <Modal title={member.name} wide onClose={onClose}
      footer={<>
        <span className="stat-sub">{tx("Passwords are changed in Admin → People.")}</span>
        <span className="foot-gap" />
        <button className="btn" onClick={onClose}>{tx("Cancel")}</button>
        <button className="btn btn-primary" onClick={save} disabled={!form.name.trim() || !form.username.trim()}><Check size={15} />{' '}{tx("Save")}</button>
      </>}>
      {err && <div className="form-error">{err}</div>}
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>{tx("Name")}</label>
          <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="field"><label>{tx("Username")}</label>
          <input className="input" autoCapitalize="none" autoCorrect="off" value={form.username} onChange={(e) => set({ username: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>Email <span className="stat-sub">(optional)</span></label>
          <input className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </div>
        <div className="field"><label>{tx("Role")}</label>
          <RolePicker role={form.role} crewRoles={form.crew_roles}
            onChange={(role, crew_roles) => set({ role, crew_roles })} />
        </div>
      </div>
      {form.role === 'member' && (
        <>
          <div className="field"><label>{tx("Channels")}</label>
            <div className="checkbox-row">
              {channels.map((c) => (
                <label key={c.key} className={'checkbox-chip' + (form.departments.includes(c.key) ? ' on' : '')}>
                  <input type="checkbox" checked={form.departments.includes(c.key)} onChange={() => toggleDept(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <div className="field"><label>{tx("Permissions")}</label>
            <div className="perm-list">
              {PERMISSIONS.map((p) => (
                <button key={p.key} type="button" className={'perm-row' + (form.permissions[p.key] ? ' on' : '')} onClick={() => togglePerm(p.key)}>
                  <span className={'perm-toggle' + (form.permissions[p.key] ? ' on' : '')}>{form.permissions[p.key] && <Check size={12} strokeWidth={3.5} />}</span>
                  <span>
                    <span className="perm-label">{p.label}</span>
                    <span className="perm-desc">{p.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>{tx("Position")}</label>
          <input className="input" value={form.position} placeholder={tx("Videographer, SMM manager…")} onChange={(e) => set({ position: e.target.value })} />
        </div>
        <div className="field"><label>{tx("Phone")}</label>
          <input className="input" type="tel" value={form.phone} placeholder="+998 90 123 45 67" onChange={(e) => set({ phone: e.target.value })} />
        </div>
      </div>
      <div className="field"><label>{tx("Responsibilities")}</label>
        <textarea className="input" rows={2} value={form.duties} placeholder={tx("What this person answers for…")} onChange={(e) => set({ duties: e.target.value })} />
      </div>
      <div className="field"><label>{tx("Working schedule")}</label>
        <div className="wd-row">
          {WORK_DAYS.map((d) => (
            <button key={d.n} type="button" className={'wd-chip' + (form.work_days.includes(d.n) ? ' on' : '')} onClick={() => toggleDay(d.n)}>
              {d.label}
            </button>
          ))}
        </div>
        <div className="sched-hours">
          <label className="sched-field">from
            <input className="input" type="time" value={form.work_start} onChange={(e) => set({ work_start: e.target.value })} />
          </label>
          <label className="sched-field">to
            <input className="input" type="time" value={form.work_end} onChange={(e) => set({ work_end: e.target.value })} />
          </label>
        </div>
      </div>
    </Modal>
  )
}

export default function Team() {
  const { channels, byKey } = useChannels()
  const [boot] = useState(() => cache.get('team'))
  const [users, setUsers] = useState(boot?.users || [])
  const [needs, setNeeds] = useState(boot?.needs || [])
  const [cands, setCands] = useState(boot?.cands || [])
  const [loading, setLoading] = useState(!boot)
  const [editing, setEditing] = useState(null)
  const [candModal, setCandModal] = useState(null) // null | 'new' | candidate
  const [candStage, setCandStage] = useState('all')
  const [view, setViewState] = useState(() => localStorage.getItem('satashkent_team_view') || 'cards')
  const setView = (v) => { setViewState(v); localStorage.setItem('satashkent_team_view', v) }

  // new-need form
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [priority, setPriority] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    Promise.all([api.get('/users'), api.get('/hiring'), api.get('/candidates')])
      .then(([us, hs, cs]) => {
        setUsers(us); setNeeds(hs); setCands(cs)
        cache.set('team', { users: us, needs: hs, cands: cs })
      })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [])

  const team = useMemo(() => [...users].sort((a, b) =>
    (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) || a.name.localeCompare(b.name)), [users])
  const open = needs.filter((n) => n.status === 'open')
  const hired = needs.filter((n) => n.status === 'hired').slice(0, 6)
  const crewCount = users.filter((u) => (u.crew_roles || []).length > 0).length

  // Gaps the data can see by itself → one click adds them to the board.
  const gaps = useMemo(() => {
    const out = []
    const has = (r) => users.some((u) => (u.crew_roles || []).includes(r))
    if (!has('operator')) out.push({ key: 'op', title: tx('Operator'), note: 'Nobody on the team can shoot — every video waits on this.' })
    if (!has('editor')) out.push({ key: 'ed', title: tx('Editor'), note: 'Nobody on the team edits video.' })
    if (!has('designer')) out.push({ key: 'de', title: tx('Designer'), note: 'Nobody designs posts — every artwork waits on this.' })
    for (const c of channels) {
      const covered = users.some((u) => u.role === 'admin' ? false : (u.departments || []).includes(c.key))
      if (!covered) out.push({ key: `ch-${c.key}`, title: `${c.label} lead`, note: `Nobody covers the ${c.label} channel.` })
      else if (!c.head_id) out.push({ key: `own-${c.key}`, title: `${c.label} owner`, note: `${c.label} has members but no one owns it — assign a head or hire one.` })
    }
    return out.filter((g) => !needs.some((n) => n.status === 'open' && n.title.toLowerCase() === g.title.toLowerCase()))
  }, [users, channels, needs])

  const addNeed = async (t = title, n = note, p = priority) => {
    const name = String(t).trim()
    if (!name) return
    setErr('')
    try {
      const created = await api.post('/hiring', { title: name, note: n, priority: p })
      setNeeds((prev) => [created, ...prev])
      toast(tx('Position added — synced'))
      setTitle(''); setNote(''); setPriority(false)
    } catch (e) { setErr(e.message) }
  }
  const markHired = async (need) => {
    playDone()
    const u = await api.patch(`/hiring/${need.id}`, { status: 'hired' })
    setNeeds((prev) => prev.map((x) => (x.id === need.id ? u : x)))
    toast(tx('Marked as hired — synced'))
  }
  const removeNeed = async (need) => {
    if (!confirm(`Remove “${need.title}” from the hiring board?`)) return
    await api.del(`/hiring/${need.id}`)
    setNeeds((prev) => prev.filter((x) => x.id !== need.id))
    toast(tx('Removed'))
  }

  // Right-click: cards answer directly.
  const { openMenu } = useContextMenu()
  const memberMenu = (e, u) => openMenu(e, [
    { label: 'Edit member', icon: Pencil, onClick: () => setEditing(u) },
    u.phone && { label: 'Copy phone number', icon: Phone, onClick: () => navigator.clipboard?.writeText(u.phone).catch(() => {}) },
  ])
  const needMenu = (e, n) => openMenu(e, [
    { label: 'Mark as hired', icon: BadgeCheck, onClick: () => markHired(n) },
    { sep: true },
    { label: 'Remove', icon: Trash2, danger: true, onClick: () => removeNeed(n) },
  ])

  // ---- candidates: the people we're weighing up ----
  const replaceCand = (saved) => setCands((prev) => {
    const has = prev.some((c) => c.id === saved.id)
    return has ? prev.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...prev]
  })
  const moveCand = async (c, stage) => {
    try {
      if (stage === 'hired') playDone()
      replaceCand(await api.patch(`/candidates/${c.id}`, { stage }))
      toast(`Moved to ${stageOf(stage).label} — synced`)
    } catch (e) { alert(e.message) }
  }
  const removeCand = async (c) => {
    if (!confirm(`Remove ${c.name} from the candidates?`)) return
    try { await api.del(`/candidates/${c.id}`); setCands((prev) => prev.filter((x) => x.id !== c.id)); toast(tx('Candidate removed')) }
    catch (e) { alert(e.message) }
  }
  const candMenu = (e, c) => openMenu(e, [
    { label: 'Edit', icon: Pencil, onClick: () => setCandModal(c) },
    ...STAGES.filter((st) => st.key !== c.stage).slice(0, 4).map((st) => (
      { label: `Move to ${st.label}`, icon: ArrowRight, onClick: () => moveCand(c, st.key) }
    )),
    { sep: true },
    { label: 'Remove', icon: Trash2, danger: true, onClick: () => removeCand(c) },
  ])
  const candCounts = useMemo(() => {
    const m = { all: cands.length }
    for (const st of STAGES) m[st.key] = cands.filter((c) => c.stage === st.key).length
    return m
  }, [cands])
  const candList = candStage === 'all'
    ? cands.filter((c) => c.stage !== 'hired' && c.stage !== 'declined')
    : cands.filter((c) => c.stage === candStage)
  const inPlay = cands.filter((c) => !['hired', 'declined'].includes(c.stage)).length
  const openPositions = [...new Set(open.map((n) => n.title))]

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  return (
    <>
      {/* The one-line state of the team */}
      <div className="miss-stats" style={{ marginTop: 0 }}>
        <div className="miss-stat"><b>{team.length}</b><span>{tx("on the team")}</span></div>
        <div className="miss-stat"><b>{crewCount}</b><span>{tx("video crew")}</span></div>
        <div className={'miss-stat' + (open.length ? ' miss-stat-bad' : ' miss-stat-ok')}>
          <b>{open.length}</b><span>{open.length === 1 ? tx('position to fill') : tx('positions to fill')}</span>
        </div>
        <div className="miss-stat">
          <b>{inPlay}</b><span>{inPlay === 1 ? tx('candidate in play') : tx('candidates in play')}</span>
        </div>
      </div>

      {/* ---- who we need ---- */}
      {/* Hiring and the candidate pipeline are a season's work, not a day's,
          and they sit above the team everybody actually came to look at. Both
          fold, and stay folded for whoever folds them. */}
      <Fold id="team-hiring" title={tx("Hiring — who we need")} count={open.length}
        icon={<UserRoundPlus size={17} style={{ color: 'var(--brand-500)' }} />}>
      {err && <div className="form-error">{err}</div>}
      <div className="hire-add card">
        <input className="input" value={title} placeholder={tx("Position — e.g. Mobile videographer")}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addNeed() }} />
        <input className="input" value={note} placeholder={tx("What they'll own (optional)")}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addNeed() }} />
        <button type="button" className={'wd-chip hire-flame' + (priority ? ' on' : '')}
          data-tip={tx("Urgent — mark it hot")} onClick={() => setPriority(!priority)}>
          <Flame size={14} />{' '}{tx('Urgent')}
        </button>
        <button className="btn btn-primary" onClick={() => addNeed()} disabled={!title.trim()}>
          <Plus size={15} /> Add
        </button>
      </div>

      {gaps.length > 0 && (
        <div className="hire-gaps">
          <span className="hire-gaps-label"><Sparkles size={13} />{' '}{tx("Gaps we can see:")}</span>
          {gaps.map((g) => (
            <button key={g.key} className="hire-gap" data-tip={g.note} onClick={() => addNeed(g.title, g.note, false)}>
              <Plus size={12} /> {g.title}
            </button>
          ))}
        </div>
      )}

      {open.length === 0 ? (
        <div className="card card-pad empty">{tx("No open positions — the team is complete.")}</div>
      ) : (
        <div className="hire-grid">
          {open.map((n) => (
            <div key={n.id} className={'hire-card' + (n.priority ? ' hot' : '')} onContextMenu={(e) => needMenu(e, n)}>
              <div className="hire-title">
                {n.priority ? <Flame size={15} /> : <UserRoundPlus size={15} />} {n.title}
              </div>
              {n.note && <div className="hire-note">{n.note}</div>}
              <div className="hire-foot">
                <span className="stat-sub">since {dateLabel(n.created_at.slice(0, 10))}</span>
                <span className="spacer" />
                <button className="btn btn-sm" onClick={() => markHired(n)}><BadgeCheck size={14} />{' '}{tx("Hired")}</button>
                <button className="icon-btn del-btn" data-tip={tx("Remove")} data-tip-left="" aria-label={tx("Remove")}
                  onClick={() => removeNeed(n)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {hired.length > 0 && (
        <div className="stat-sub" style={{ margin: '8px 2px 0' }}>
          Recently hired: {hired.map((n) => n.title).join(' · ')}
        </div>
      )}

      </Fold>

      {/* ---- candidates: whom we're considering ---- */}
      <Fold id="team-candidates" title={tx("Candidates")} count={`${inPlay} in play`}
        icon={<UserSearch size={17} style={{ color: 'var(--brand-500)' }} />}
        extra={<>
        <span className="spacer" />
        <div className="pill-group">
          <button className={'pill' + (candStage === 'all' ? ' active' : '')} onClick={() => setCandStage('all')}>{tx("In play")}</button>
          {STAGES.map((st) => (
            <button key={st.key} className={'pill' + (candStage === st.key ? ' active' : '') + (candCounts[st.key] ? '' : ' pill-zero')}
              onClick={() => setCandStage(candStage === st.key ? 'all' : st.key)}>
              {st.label} <b className="pill-n">{candCounts[st.key]}</b>
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setCandModal('new')}><Plus size={15} />{' '}{tx("Add candidate")}</button>
        </>}>
      {candList.length === 0 ? (
        <div className="card card-pad empty">
          {cands.length === 0 ? tx('Nobody under consideration yet — add the first candidate.') : 'Nobody in this stage.'}
        </div>
      ) : (
        <div className="cand-grid">
          {candList.map((c) => {
            const st = stageOf(c.stage)
            return (
              <button key={c.id} className="cand-card" style={{ borderLeftColor: st.color }}
                onClick={() => setCandModal(c)} onContextMenu={(e) => candMenu(e, c)}>
                <div className="cand-top">
                  <b className="cand-name">{c.name}</b>
                  <span className="cand-stage" style={{ background: st.color }}>{st.label}</span>
                </div>
                {c.position && <div className="cand-pos">for {c.position}</div>}
                <div className="cand-rows">
                  {c.contacts && <span className="team-row"><Phone size={12} /> {c.contacts}</span>}
                  {c.salary && <span className="team-row"><Banknote size={12} /> expects {c.salary}</span>}
                  {c.portfolio && (
                    /^https?:\/\//.test(c.portfolio)
                      ? <a className="team-row cand-link" href={c.portfolio} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><LinkIcon size={12} />{' '}{tx("portfolio")}</a>
                      : <span className="team-row"><LinkIcon size={12} /> {c.portfolio}</span>
                  )}
                </div>
                {c.experience && <div className="cand-exp">{c.experience}</div>}
                {c.notes && <div className="cand-notes">{c.notes}</div>}
              </button>
            )
          })}
        </div>
      )}

      </Fold>

      {/* ---- the team we have ---- */}
      <div className="section-head" style={{ marginTop: 20 }}>
        <UsersRound size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{tx("The team now")}</h2>
        <span className="count">· {team.length}</span>
        <span className="spacer" />
        <div className="pill-group">
          <button className={'pill' + (view === 'cards' ? ' active' : '')} onClick={() => setView('cards')}><LayoutGrid size={14} />{' '}{tx("Cards")}</button>
          <button className={'pill' + (view === 'table' ? ' active' : '')} onClick={() => setView('table')}><Rows3 size={14} />{' '}{tx("Table")}</button>
          <button className={'pill' + (view === 'board' ? ' active' : '')} onClick={() => setView('board')}><KanbanSquare size={14} />{' '}{tx("Board")}</button>
          <button className={'pill' + (view === 'dash' ? ' active' : '')} onClick={() => setView('dash')}><Gauge size={14} />{' '}{tx("Dashboard")}</button>
        </div>
      </div>

      {view === 'cards' && (
        <div className="team-grid">
          {team.map((u) => {
            const sched = scheduleLabel(u)
            const depts = (u.departments || []).map((d) => byKey[d]?.label || d)
            return (
              <div key={u.id} className="team-card" style={{ borderTopColor: u.color }} onContextMenu={(e) => memberMenu(e, u)}>
                <div className="team-top">
                  <Avatar name={u.name} color={u.color} src={u.avatar} />
                  <div className="team-who">
                    <b>{u.name}</b>
                    <span className="team-pos">{u.position || roleWord(u)}</span>
                  </div>
                  <span className={'role-badge rb-' + u.role}>{roleWord(u)}</span>
                  <button className="icon-btn" data-tip={tx("Edit card")} data-tip-left="" aria-label={tx("Edit")}
                    onClick={() => setEditing(u)}><Pencil size={14} /></button>
                </div>
                <div className="team-rows">
                  <span className="team-row">
                    <Phone size={13} />
                    {u.phone ? <a href={`tel:${u.phone.replace(/[^+\d]/g, '')}`}>{u.phone}</a> : <i>{tx("no phone yet")}</i>}
                  </span>
                  <span className="team-row">
                    <Clock size={13} />
                    {sched || <i>{tx("no schedule set")}</i>}
                  </span>
                </div>
                <div className="team-duty">
                  {u.duties || (u.role === 'admin' ? tx('Runs the whole marketing team.')
                    : depts.length ? `Channels: ${depts.join(', ')}`
                    : u.role !== 'member' ? 'Cross-channel video work — shoots and edits ride the task crew.' : 'No responsibilities written yet.')}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {view === 'table' && (
        <div className="card table-wrap">
          <table className="tbl">
            <thead><tr><th>{tx("Member")}</th><th>{tx("Role")}</th><th>{tx("Phone")}</th><th>{tx("Working hours")}</th><th>{tx("Responsibilities")}</th><th /></tr></thead>
            <tbody>
              {team.map((u) => {
                const sched = scheduleLabel(u)
                const depts = (u.departments || []).map((d) => byKey[d]?.label || d)
                return (
                  <tr key={u.id} onContextMenu={(e) => memberMenu(e, u)}>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
                        <span>
                          <span style={{ fontWeight: 700, display: 'block' }}>{u.name}</span>
                          <span className="stat-sub">{u.position || '@' + u.username}</span>
                        </span>
                      </span>
                    </td>
                    <td><span className={'role-badge rb-' + u.role}>{roleWord(u)}</span></td>
                    <td>{u.phone ? <a href={`tel:${u.phone.replace(/[^+\d]/g, '')}`} style={{ color: 'var(--brand-600)', fontWeight: 600 }}>{u.phone}</a> : <span className="stat-sub">—</span>}</td>
                    <td>{sched || <span className="stat-sub">—</span>}</td>
                    <td className="team-tbl-duty">{u.duties || (depts.length ? depts.join(', ') : '—')}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="icon-btn" data-tip={tx("Edit")} data-tip-left="" aria-label={tx("Edit")} onClick={() => setEditing(u)}><Pencil size={14} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === 'board' && (
        <div className="team-board">
          {[
            { label: 'Admins', match: (u) => u.role === 'admin' },
            { label: 'Members', match: (u) => u.role === 'member' },
            { label: 'Operators', match: (u) => (u.crew_roles || []).includes('operator') },
            { label: 'Editors', match: (u) => (u.crew_roles || []).includes('editor') },
            { label: tx('Designers'), match: (u) => (u.crew_roles || []).includes('designer') },
          ].map((col) => {
            const list = team.filter(col.match)
            return (
              <div key={col.label} className="team-col">
                <div className="team-col-head">{col.label} <span className="count">{list.length}</span></div>
                {list.map((u) => (
                  <button key={u.id} className="team-mini" style={{ borderLeftColor: u.color }}
                    onClick={() => setEditing(u)} onContextMenu={(e) => memberMenu(e, u)}>
                    <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
                    <span>
                      <b>{u.name}</b>
                      <small>{u.position || (u.departments || []).map((d) => byKey[d]?.label || d).join(', ') || '—'}</small>
                    </span>
                  </button>
                ))}
                {list.length === 0 && <div className="board-empty">—</div>}
              </div>
            )
          })}
        </div>
      )}

      {view === 'dash' && (() => {
        const phones = team.filter((u) => u.phone).length
        const scheds = team.filter((u) => u.work_start && u.work_end).length
        const roleRows = [
          { label: 'Admins', n: team.filter((u) => u.role === 'admin').length, color: 'var(--brand-500)' },
          { label: 'Members', n: team.filter((u) => u.role === 'member').length, color: '#5a6b7a' },
          { label: 'Operators', n: team.filter((u) => (u.crew_roles || []).includes('operator')).length, color: '#2a78d6' },
          { label: 'Editors', n: team.filter((u) => (u.crew_roles || []).includes('editor')).length, color: '#7b5ad6' },
          { label: tx('Designers'), n: team.filter((u) => (u.crew_roles || []).includes('designer')).length, color: '#0e8a6d' },
        ].filter((r) => r.n > 0)
        return (
          <div className="team-dash">
            <div className="card card-pad">
              <div className="pc-check-head"><h3>{tx("Roles")}</h3><span className="stat-sub">{team.length} people</span></div>
              <div className="ov-stages" style={{ margin: 0 }}>
                {roleRows.map((r) => (
                  <span key={r.label} className="ov-stage" style={{ background: r.color, color: '#fff' }}>{r.label} <b>{r.n}</b></span>
                ))}
              </div>
              <div className="stat-sub" style={{ marginTop: 12 }}>{tx("Profile completeness")}</div>
              <div className="crew-nums" style={{ marginTop: 6 }}>
                <span className="crew-num"><Phone size={13} /> {phones}/{team.length} phones set</span>
                <span className="crew-num"><Clock size={13} /> {scheds}/{team.length} schedules set</span>
              </div>
            </div>
            <div className="card card-pad">
              <div className="pc-check-head"><h3>{tx("Channel coverage")}</h3><span className="stat-sub">{tx("owner + people per channel")}</span></div>
              {channels.map((c) => {
                const heads = users.find((u) => u.id === c.head_id)
                const members = users.filter((u) => (u.departments || []).includes(c.key))
                return (
                  <div key={c.key} className="cover-row">
                    <span className="cover-name">{c.label}</span>
                    {heads
                      ? <span className="tt-who" style={{ gap: 6 }}><Avatar name={heads.name} color={heads.color} src={heads.avatar} size="xs" /> <b style={{ fontSize: 12.5 }}>{heads.name.split(' ')[0]}</b></span>
                      : <span className="no-owner-badge">{tx("no owner")}</span>}
                    <span className="spacer" />
                    <span className="stat-sub">{members.length} member{members.length === 1 ? '' : 's'}</span>
                  </div>
                )
              })}
            </div>
            <div className="card card-pad">
              <div className="pc-check-head"><h3>{tx("Hiring pipeline")}</h3><span className="stat-sub">{open.length} open · {inPlay} in play</span></div>
              <div className="ov-stages" style={{ margin: 0 }}>
                {STAGES.map((st) => (
                  <span key={st.key} className="ov-stage" style={{ background: st.color, color: '#fff', opacity: candCounts[st.key] ? 1 : 0.45 }}>
                    {st.label} <b>{candCounts[st.key]}</b>
                  </span>
                ))}
              </div>
              {open.length > 0 && (
                <div className="stat-sub" style={{ marginTop: 12 }}>
                  Open positions: {open.map((n) => n.title).join(' · ')}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {editing && (
        <MemberModal member={editing} channels={channels} onClose={() => setEditing(null)}
          onSaved={(u) => setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)))} />
      )}
      {candModal && (
        <CandidateModal
          candidate={candModal === 'new' ? null : candModal}
          positions={openPositions}
          onClose={() => setCandModal(null)}
          onSaved={replaceCand}
          onDeleted={(c) => setCands((prev) => prev.filter((x) => x.id !== c.id))}
        />
      )}
    </>
  )
}
