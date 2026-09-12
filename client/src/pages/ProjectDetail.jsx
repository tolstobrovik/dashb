import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Trash2, Target } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import CampaignForm from '../components/CampaignForm.jsx'
import { ProjectForm } from './Projects.jsx'
import { StatusBadge, HealthPill, PlainBar, PcChecklist, NotesBlock, CampaignRow, PC } from '../components/ProjectBits.jsx'
import { dateLabel, todayISO } from '../lib/constants.js'

// Project detail — four sections, nothing else: header, campaigns in this
// project, checklist, notes.
export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { byKey } = useChannels()
  const [p, setP] = useState(null)
  const [team, setTeam] = useState([])
  const [metrics, setMetrics] = useState([])
  const [projects, setProjects] = useState([])
  const [err, setErr] = useState('')
  const [campModal, setCampModal] = useState(null)
  const [projModal, setProjModal] = useState(false)
  const [actualEdit, setActualEdit] = useState(null) // string while editing

  const canWrite = user.role === 'admin' || (p?.owner_id && p.owner_id === user.id)
  const isAdmin = user.role === 'admin'

  const load = () => Promise.all([
    api.get(`/projects/${id}`), api.get('/users'), api.get('/projects/metrics'), api.get('/projects'),
  ]).then(([proj, us, ms, ps]) => { setP(proj); setTeam(us); setMetrics(ms); setProjects(ps) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live sync: everything on this page follows the rest of the app.
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || campModal || projModal || actualEdit !== null) return
      api.pollView(`/projects/${id}`).then((f) => { if (f) setP(f) }).catch(() => {})
    }
    const t = setInterval(refresh, 10000)
    return () => clearInterval(t)
  }, [id, campModal, projModal, actualEdit])

  if (err) return <div className="card card-pad empty">{err}</div>
  if (!p) return <div className="app-loading"><span className="spinner" /></div>

  // Not clamped. 11,400 enrolments against a target of 10,000 was showing as
  // "100%", which reads as "just made it" — the one reading the number rules
  // out. Beating a target is the good news on the page and it was the thing
  // being hidden. The BAR still stops at its end, because a bar longer than
  // its track is a broken bar; the figure beside it says 114%.
  const pct = p.target > 0 ? Math.round((p.actual / p.target) * 100) : 0
  const beat = pct > 100

  const patch = async (body) => {
    try { setP({ ...p, ...(await api.patch(`/projects/${p.id}`, body)), campaigns: p.campaigns, notes: p.notes }) }
    catch (e) { alert(e.message) }
  }

  const saveActual = async () => {
    const v = Number(actualEdit)
    setActualEdit(null)
    if (!Number.isFinite(v) || v === p.actual) return
    await patch({ actual: v })
  }

  return (
    <>
      <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => navigate('/projects')}><ArrowLeft size={14} /> Projects</button>

      {/* A. Header — one number, one bar, nothing competes with it */}
      <div className="card card-pad pc-header">
        {p.photo && <img className="pc-banner" src={p.photo} alt="" />}
        <div className="pc-camp-top">
          <h2 style={{ fontSize: 22 }}>{p.name}</h2>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {p.health && <HealthPill health={p.health} reason={p.health_reason} />}
            {canWrite ? (
              <select className="select pc-mini" value={p.status} data-tip="Project status"
                onChange={(e) => patch({ status: e.target.value })}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="closed">Closed</option>
              </select>
            ) : (
              <StatusBadge status={p.status} />
            )}
            {isAdmin && (
              <button className="icon-btn" data-tip="Edit project fields" data-tip-left="" onClick={() => setProjModal(true)} aria-label="Edit">
                <Pencil size={15} />
              </button>
            )}
            {isAdmin && (
              <button className="icon-btn del-btn" data-tip="Delete this project" data-tip-left=""
                onClick={async () => {
                  if (!confirm(`Delete the project “${p.name}”?\n\nIts campaigns stay but lose the project link; project notes are removed.`)) return
                  try { await api.del(`/projects/${p.id}`); navigate('/projects') } catch (e) { alert(e.message) }
                }} aria-label="Delete project">
                <Trash2 size={15} />
              </button>
            )}
          </span>
        </div>
        <div className="stat-sub" style={{ margin: '2px 0 4px' }}>
          Owner: {p.owner_name || <span className="pc-red">nobody — assign one</span>}
        </div>
        {p.description && <p className="pc-desc">{p.description}</p>}
        {(p.success || canWrite) && (
          <div className="pc-success">
            <span className="pc-success-label"><Target size={13} /> Success criteria</span>
            {p.success
              ? <span className="pc-success-text">{p.success}</span>
              : <button className="lnk" onClick={() => setProjModal(true)}>write what “done well” means →</button>}
          </div>
        )}
        <div className="pc-bignum">
          {actualEdit !== null ? (
            <input
              className="input" type="number" autoFocus style={{ width: 130, fontSize: 20, fontWeight: 800 }}
              value={actualEdit} onChange={(e) => setActualEdit(e.target.value)}
              onBlur={saveActual} onKeyDown={(e) => { if (e.key === 'Enter') saveActual() }}
            />
          ) : (
            <b
              className={canWrite ? 'pc-actual-edit' : ''}
              data-tip={canWrite ? 'The weekly human number — click to type this week’s value' : undefined}
              onClick={() => canWrite && setActualEdit(String(p.actual))}
            >{p.actual.toLocaleString()}</b>
          )}
          <span> / {p.target.toLocaleString()} {p.metric}</span>
          <span className={'pc-pct' + (beat ? ' pc-pct-beat' : '')}>{pct}%</span>
        </div>
        <PlainBar pct={pct} color={pct >= 100 ? PC.green : p.health === 'amber' ? PC.amber : PC.green} height={12} />

        {/* The deadline, on its own line under the bar it belongs to. It was
            sitting at the far right of the number row, where the eye that has
            just read "11 400 / 10 000" never travels. */}
        {p.deadline && (() => {
          const days = Math.ceil((Date.parse(`${p.deadline}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86400000)
          const late = days < 0 && p.actual < p.target
          return (
            <div className={'pc-deadline' + (late ? ' late' : '')}>
              {late ? 'Was due ' : 'Due '}{dateLabel(p.deadline)}
              {days > 0 ? ` · ${days} days left` : days === 0 ? ' · today' : p.actual >= p.target ? ' · and met' : ' · and still short'}
            </div>
          )
        })()}
      </div>

      {/* B. Campaigns in this project */}
      <div className="section-head" style={{ marginTop: 18 }}>
        <h2>Campaigns in this project</h2>
        <span className="count">· {p.campaigns.length}</span>
        <span className="spacer" />
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setCampModal('new')}><Plus size={15} /> New campaign</button>}
      </div>
      {p.campaigns.length === 0 ? (
        /* "This project is not moving" was printed in red on a project that
           had met its target and ticked its last box. A project with nothing
           running is only a problem when it is supposed to be running: open,
           started, and not yet where it was going. Anything else — paused,
           closed, finished, not begun — gets the plain sentence. */
        (() => {
          const started = !p.start_date || p.start_date <= todayISO()
          const stalled = p.status === 'active' && started && p.target > 0 && p.actual < p.target
          return stalled
            ? <div className="card card-pad pc-stalled">Nothing is running on this project, and it has not reached its number yet.</div>
            : <div className="card card-pad empty">No campaigns on this project.</div>
        })()
      ) : (
        <div className="pc-camp-list">
          {p.campaigns.map((c) => <CampaignRow key={c.id} c={c} byKey={byKey} onOpen={(x) => navigate(`/campaigns/${x.id}`)} />)}
        </div>
      )}

      {/* C. Checklist */}
      <div className="card card-pad" style={{ marginTop: 18 }}>
        <PcChecklist
          items={p.checklist}
          team={team}
          canTick={canWrite}
          canEditItems={isAdmin}
          onChange={(items) => patch({ checklist: items })}
        />
      </div>

      {/* D. Notes */}
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <NotesBlock
          notes={p.notes}
          onAdd={async (text) => {
            const n = await api.post(`/projects/${p.id}/notes`, { text })
            setP({ ...p, notes: [n, ...p.notes] })
          }}
          onDelete={async (n) => {
            await api.del(`/projects/${p.id}/notes/${n.id}`)
            setP((prev) => ({ ...prev, notes: prev.notes.filter((x) => x.id !== n.id) }))
          }}
          canDelete={(n) => isAdmin || n.author_id === user.id}
        />
      </div>

      {campModal && (
        <CampaignForm
          campaign={campModal === 'new' ? null : campModal}
          projects={projects}
          team={team}
          metrics={metrics}
          isAdmin={isAdmin}
          defaults={{ project_id: p.id }}
          onClose={() => setCampModal(null)}
          onSaved={() => load()}
          onDeleted={() => load()}
        />
      )}
      {projModal && (
        <ProjectForm
          project={p}
          team={team}
          metrics={metrics}
          isAdmin={isAdmin}
          onClose={() => setProjModal(false)}
          onSaved={() => load()}
          onDeleted={() => navigate('/projects')}
        />
      )}
    </>
  )
}
