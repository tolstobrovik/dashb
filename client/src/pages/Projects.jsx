import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Briefcase, Megaphone, KanbanSquare, GanttChartSquare } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import Modal from '../components/Modal.jsx'
import CampaignForm from '../components/CampaignForm.jsx'
import CampaignGantt from '../components/CampaignGantt.jsx'
import { HealthPill, StatusBadge, CampaignRow, PC, PhotoField } from '../components/ProjectBits.jsx'
import { dateLabel, todayISO } from '../lib/constants.js'
import { loadFailed } from '../lib/toast.js'

const CAMP_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'idea', label: 'Not ready' },
  { key: 'done', label: 'Done' },
]
const BOARD_COLS = [
  { key: 'idea', label: 'Idea', statuses: ['idea'] },
  { key: 'incoming', label: 'Incoming', statuses: ['incoming', 'live'] },
  { key: 'blocked', label: 'Blocked', statuses: ['blocked'] }, // third on purpose — empty this column
  { key: 'done', label: 'Completed', statuses: ['done'] },
]

// Admin's project editor (create + the fields the table needs).
export function ProjectForm({ project, team, metrics, onClose, onSaved, onDeleted, isAdmin = false }) {
  const creating = !project
  const [err, setErr] = useState('')
  const [form, setForm] = useState(() => ({
    name: project?.name || '',
    owner_id: project?.owner_id ?? '',
    metric: project?.metric || '',
    target: project?.target || '',
    deadline: project?.deadline || '',
    status: project?.status || 'active',
    description: project?.description || '',
    success: project?.success || '',
    budget: project?.budget ?? '',
  }))
  const [photo, setPhoto] = useState({ changed: false, photo: project?.photo ?? project?.photo_thumb ?? null, photo_thumb: project?.photo_thumb ?? null })
  const save = async () => {
    if (!form.name.trim()) { setErr('Give the project a name'); return }
    setErr('')
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        owner_id: form.owner_id || null,
        target: Number(form.target) || 0,
        deadline: form.deadline || null,
        budget: form.budget === '' ? null : Number(form.budget),
        ...(photo.changed ? { photo: photo.photo, photo_thumb: photo.photo_thumb } : {}),
      }
      const saved = creating ? await api.post('/projects', payload) : await api.patch(`/projects/${project.id}`, payload)
      onSaved(saved)
      onClose()
    } catch (e) { setErr(e.message) }
  }
  const del = async () => {
    if (!confirm(`Delete the project “${project.name}”?\n\nIts campaigns stay but lose the project link; project notes are removed.`)) return
    try { await api.del(`/projects/${project.id}`); onDeleted?.(project); onClose() } catch (e) { setErr(e.message) }
  }
  return (
    <Modal
      title={creating ? 'New project' : 'Project'}
      onClose={onClose}
      footer={<>
        {!creating && isAdmin && <button className="btn btn-danger" onClick={del}><Trash2 size={15} /> Delete</button>}
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{creating ? 'Create project' : 'Save'}</button>
      </>}
    >
      {err && <div className="pc-strip" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="field"><label>Name</label>
        <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. YouTube growth" />
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>Owner <span className="stat-sub">— one person</span></label>
          <select className="select" value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value === '' ? '' : Number(e.target.value) })}>
            <option value="">— no owner yet (renders red) —</option>
            {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Status</label>
          <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>
      <div className="grid grid-3" style={{ gap: 12 }}>
        <div className="field"><label>Primary metric</label>
          <select className="select" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}>
            <option value="">— pick one —</option>
            {metrics.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="field"><label>Target</label>
          <input className="input" type="number" min="0" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
        </div>
        <div className="field"><label>Deadline</label>
          <input className="input" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
        </div>
      </div>
      <div className="field"><label>Description <span className="stat-sub">(optional)</span></label>
        <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What this area of the business is…" />
      </div>
      <div className="field"><label>Success criteria <span className="stat-sub">— what “done well” looks like</span></label>
        <textarea className="input" rows={2} value={form.success} onChange={(e) => setForm({ ...form, success: e.target.value })}
          placeholder="e.g. 400 signed applications from Kazakhstan before August 15, CAC under $12" />
      </div>
      <div className="field"><label>Budget <span className="stat-sub">(optional)</span></label>
        <input className="input" type="number" min="0" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
      </div>
      <PhotoField
        photo={photo.photo}
        onChange={({ photo: ph, photo_thumb: th }) => setPhoto({ changed: true, photo: ph, photo_thumb: th })}
      />
    </Modal>
  )
}

// Projects — the missing layer. Landing table sorted red-first, the campaign
// list, and the four-column campaign board with the form gate on drag.
export default function Projects() {
  const { user } = useAuth()
  const { byKey } = useChannels()
  const navigate = useNavigate()
  const isAdmin = user.role === 'admin'
  const [view, setViewState] = useState(() => localStorage.getItem('satashkent_pc_view') || 'projects')
  const setView = (v) => { setViewState(v); localStorage.setItem('satashkent_pc_view', v) }
  const [projects, setProjects] = useState([])
  const [camps, setCamps] = useState([])
  const [team, setTeam] = useState([])
  const [metrics, setMetrics] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [projSort, setProjSort] = useState('health')   // health | deadline | activity | name
  const [campSort, setCampSort] = useState('start')    // start | end | daysleft
  const [projectModal, setProjectModal] = useState(null) // null | 'new' | project
  const [campModal, setCampModal] = useState(null)       // null | 'new' | campaign
  const dragRef = useRef(null)
  const [overCol, setOverCol] = useState(null)

  const load = () => Promise.all([
    api.get('/projects'), api.get('/campaigns'), api.get('/users'), api.get('/projects/metrics'),
  ]).then(([ps, cs, us, ms]) => { setProjects(ps); setCamps(cs); setTeam(us); setMetrics(ms) })
  useEffect(() => { load().catch(loadFailed).finally(() => setLoading(false)) }, [])

  // Live refresh, same rhythm as the rest of the app.
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || projectModal || campModal || dragRef.current !== null) return
      api.poll('/projects').then((f) => { if (f) setProjects(f) }).catch(() => {})
      api.poll('/campaigns').then((f) => { if (f) setCamps(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [projectModal, campModal])

  const filtered = useMemo(() => {
    const list = filter === 'all' ? [...camps] : camps.filter((c) => c.status === filter)
    const key = { start: 'start_date', end: 'end_date' }[campSort]
    if (key) list.sort((a, b) => (a[key] ? (b[key] ? a[key].localeCompare(b[key]) : -1) : 1))
    else list.sort((a, b) => (a.days_left ?? 9e9) - (b.days_left ?? 9e9))
    return list
  }, [camps, filter, campSort])

  const HEALTH_RANK = { red: 0, amber: 1, green: 2 }
  const sortedProjects = useMemo(() => {
    const list = [...projects]
    if (projSort === 'deadline') list.sort((a, b) => (a.deadline ? (b.deadline ? a.deadline.localeCompare(b.deadline) : -1) : 1))
    else if (projSort === 'activity') list.sort((a, b) => (b.last_activity || '').localeCompare(a.last_activity || ''))
    else if (projSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    else list.sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.name.localeCompare(b.name))
    return list
  }, [projects, projSort])

  const replaceCamp = (saved) => setCamps((prev) => {
    const has = prev.some((c) => c.id === saved.id)
    const next = has ? prev.map((c) => (c.id === saved.id ? saved : c)) : [...prev, saved]
    return next
  })

  // Board drag: moving into Incoming runs the gate; Completed closes;
  // Idea demotes. Blocked is never a drop target — it derives.
  const dropTo = async (colKey) => {
    const id = dragRef.current
    dragRef.current = null
    setOverCol(null)
    const c = camps.find((x) => x.id === id)
    if (!c) return
    const stage = colKey === 'idea' ? 'idea' : colKey === 'incoming' ? 'accepted' : colKey === 'done' ? 'closed' : null
    if (!stage) { alert('Blocked is not set by hand — it derives from overdue checklist items.'); return }
    try {
      replaceCamp(await api.patch(`/campaigns/${c.id}`, { stage }))
    } catch (e) { alert(e.message) }
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const VIEWS = [
    { key: 'projects', label: 'Projects', icon: Briefcase },
    { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
    { key: 'board', label: 'Board', icon: KanbanSquare },
    { key: 'gantt', label: 'Gantt', icon: GanttChartSquare },
  ]

  return (
    <>
      <div className="pill-group" style={{ marginBottom: 14, alignItems: 'center' }}>
        {VIEWS.map((v) => {
          const Icon = v.icon
          return (
            <button key={v.key} className={'pill' + (view === v.key ? ' active' : '')} onClick={() => setView(v.key)}>
              <Icon size={14} /> {v.label}
            </button>
          )
        })}
        <span style={{ flex: 1 }} />
        {isAdmin && view === 'projects' && (
          <button className="btn btn-primary btn-sm" onClick={() => setProjectModal('new')}><Plus size={15} /> New project</button>
        )}
        {isAdmin && view !== 'projects' && (
          <button className="btn btn-primary btn-sm" onClick={() => setCampModal('new')}><Plus size={15} /> New campaign</button>
        )}
      </div>

      {view === 'projects' && (
        <>
          <div className="pill-group" style={{ marginBottom: 10 }}>
            <span className="stat-sub" style={{ alignSelf: 'center', fontWeight: 700 }}>Sort:</span>
            <button className={'pill' + (projSort === 'health' ? ' active' : '')} onClick={() => setProjSort('health')} data-tip="Red first — what needs attention">Health</button>
            <button className={'pill' + (projSort === 'deadline' ? ' active' : '')} onClick={() => setProjSort('deadline')} data-tip="Closest deadline on top">Deadline ↑</button>
            <button className={'pill' + (projSort === 'activity' ? ' active' : '')} onClick={() => setProjSort('activity')} data-tip="Most recently active first">Activity</button>
            <button className={'pill' + (projSort === 'name' ? ' active' : '')} onClick={() => setProjSort('name')} data-tip="Alphabetical">Name</button>
          </div>
          <div className="card table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Project</th><th>Owner</th><th>Live campaigns</th><th>Progress</th><th>Deadline</th><th>Last activity</th><th>Health</th></tr>
              </thead>
              <tbody>
                {sortedProjects.map((p) => {
                  const overdueDl = p.deadline && p.deadline < todayISO() && p.actual < p.target
                  return (
                    <tr key={p.id} className="row-click" onClick={() => navigate(`/projects/${p.id}`)}>
                      <td style={{ fontWeight: 700 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {p.photo_thumb && <img className="pc-thumb" src={p.photo_thumb} alt="" />}
                          {p.name}
                        </span>
                      </td>
                      <td>{p.owner_name || <span className="pc-red">—</span>}</td>
                      <td style={p.live_campaigns === 0 ? { color: PC.red, fontWeight: 700 } : undefined}>{p.live_campaigns}</td>
                      <td>
                        {p.progress?.steps_total > 0 ? (
                          <span className="proj-progress" data-tip={`${p.progress.checklist_done}/${p.progress.checklist_total} checklist · ${p.progress.campaigns_done}/${p.progress.campaigns_total} campaigns done`}>
                            <span className="pace-track" style={{ height: 8, width: 90 }}>
                              <span className="pace-fill" style={{ width: `${p.progress.pct}%`, background: p.progress.pct >= 100 ? PC.green : PC.blue }} />
                            </span>
                            <b>{p.progress.pct}%</b>
                          </span>
                        ) : <span className="stat-sub">no steps yet</span>}
                      </td>
                      <td className={'pc-when' + (overdueDl ? ' late' : '')}>{p.deadline ? dateLabel(p.deadline) : '—'}</td>
                      <td className="pc-when">{p.last_activity ? dateLabel(p.last_activity.slice(0, 10)) : '—'}</td>
                      <td><HealthPill health={p.health} reason={p.health_reason} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {projects.length === 0 && <div className="empty">No projects yet{isAdmin ? ' — create the first one.' : '.'}</div>}
          </div>
        </>
      )}

      {view === 'campaigns' && (
        <>
          <div className="pill-group" style={{ marginBottom: 10, alignItems: 'center' }}>
            {CAMP_FILTERS.map((f) => (
              <button key={f.key} className={'pill' + (filter === f.key ? ' active' : '')} onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
            <span style={{ flex: 1 }} />
            <span className="stat-sub" style={{ fontWeight: 700 }}>Sort:</span>
            <button className={'pill' + (campSort === 'start' ? ' active' : '')} onClick={() => setCampSort('start')} data-tip="Earliest start on top">Start ↑</button>
            <button className={'pill' + (campSort === 'end' ? ' active' : '')} onClick={() => setCampSort('end')} data-tip="Earliest end on top">End ↑</button>
            <button className={'pill' + (campSort === 'daysleft' ? ' active' : '')} onClick={() => setCampSort('daysleft')} data-tip="Fewest days left on top" data-tip-left="">Days left ↑</button>
          </div>
          <div className="pc-camp-list">
            {filtered.map((c) => <CampaignRow key={c.id} c={c} byKey={byKey} onOpen={(x) => navigate(`/campaigns/${x.id}`)} />)}
            {filtered.length === 0 && <div className="card card-pad empty">Nothing here.</div>}
          </div>
        </>
      )}

      {view === 'board' && (
        <div className="pc-board">
          {BOARD_COLS.map((col) => {
            const list = camps.filter((c) => col.statuses.includes(c.status))
            return (
              <div
                key={col.key}
                className={`pcb-col${overCol === col.key ? ' over' : ''}${col.key === 'blocked' ? ' danger' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOverCol(col.key) }}
                onDrop={() => dropTo(col.key)}
              >
                <div className="pcb-head">{col.label} <span className="count">{list.length}</span></div>
                {list.map((c) => (
                  <div
                    key={c.id}
                    className="pcb-card"
                    draggable
                    onDragStart={(e) => {
                      dragRef.current = c.id
                      try { e.dataTransfer.setData('text/plain', String(c.id)); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
                    }}
                    onDragEnd={() => { dragRef.current = null; setOverCol(null) }}
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                  >
                    <div className="pc-camp-top">
                      <span className="pc-camp-name" style={{ fontSize: 13 }}>{c.name}</span>
                      {c.status === 'live' && <StatusBadge status="live" />}
                    </div>
                    <div className="pc-camp-sub">
                      {c.project_name ? <span>{c.project_name}</span> : <span className="pc-red">no project</span>}
                      {c.owner_name ? <span>· {c.owner_name}</span> : <span className="pc-red">· no owner</span>}
                    </div>
                    {c.start_date && c.end_date && <div className="pc-camp-sub">{c.start_date} – {c.end_date}</div>}
                    {c.channels.length > 0 && (
                      <div className="pc-camp-chips">
                        {c.channels.map((ch) => <span key={ch} className="chip chip-muted">{byKey[ch]?.label || ch}</span>)}
                      </div>
                    )}
                    {c.status === 'blocked' && c.blocking
                      ? <div className="pc-strip">Blocked: {c.blocking.text}</div>
                      : c.status === 'idea' && c.missing.length > 0
                        ? <div className="pc-strip-soft">Draft — needs: {c.missing.join(', ')}</div>
                        : <div style={{ marginTop: 6 }}><PaceBarSafe c={c} /></div>}
                  </div>
                ))}
                {list.length === 0 && <div className="board-empty">{col.key === 'blocked' ? 'Empty — keep it that way' : '—'}</div>}
              </div>
            )
          })}
        </div>
      )}

      {view === 'gantt' && (
        <CampaignGantt camps={camps} onOpen={(c) => navigate(`/campaigns/${c.id}`)} />
      )}

      {projectModal && (
        <ProjectForm
          project={projectModal === 'new' ? null : projectModal}
          team={team}
          metrics={metrics}
          isAdmin={isAdmin}
          onClose={() => setProjectModal(null)}
          onSaved={() => load()}
          onDeleted={() => load()}
        />
      )}
      {campModal && (
        <CampaignForm
          campaign={campModal === 'new' ? null : campModal}
          projects={projects}
          team={team}
          metrics={metrics}
          isAdmin={isAdmin}
          onClose={() => setCampModal(null)}
          onSaved={replaceCamp}
          onDeleted={(c) => setCamps((prev) => prev.filter((x) => x.id !== c.id))}
        />
      )}
    </>
  )
}

function PaceBarSafe({ c }) {
  if (!c.pace) return null
  return (
    <div className="pace-track" style={{ height: 8 }}>
      <div className="pace-fill" style={{ width: `${c.pace.fill_pct}%`, background: c.pace.behind ? PC.amber : PC.green }} />
      <div className="pace-tick" style={{ left: `${c.pace.time_pct}%` }} />
    </div>
  )
}
