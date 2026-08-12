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

  const pct = p.target > 0 ? Math.min(100, Math.round((p.actual / p.target) * 100)) : 0

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
          <span className="pc-pct">{pct}%</span>
          <span style={{ flex: 1 }} />
          {p.deadline && (() => {
            const days = Math.ceil((Date.parse(`${p.deadline}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86400000)
            const late = days < 0 && p.actual < p.target
            return (
              <span className={'pc-when-big' + (late ? ' late' : '')} data-tip="The project's target deadline">
                Deadline {dateLabel(p.deadline)}{days >= 0 ? ` · ${days}d left` : ' · passed'}
              </span>
            )
          })()}
        </div>
        <PlainBar pct={pct} color={pct >= 100 ? PC.green : p.health === 'amber' ? PC.amber : PC.green} height={12} />

        {/* Progress is earned: checklist steps + finished campaigns */}
        <div className="pc-progress-row">
          <span className="pc-progress-label">Progress</span>
          <div className="pace-track" style={{ height: 10, flex: 1 }}>
            <div className="pace-fill" style={{ width: `${p.progress?.pct || 0}%`, background: (p.progress?.pct || 0) >= 100 ? PC.green : PC.blue }} />
          </div>
          <b style={{ fontSize: 13 }}>{p.progress?.pct || 0}%</b>
          <span className="stat-sub">
            {p.progress?.steps_total > 0
              ? `${p.progress.checklist_done}/${p.progress.checklist_total} checklist · ${p.progress.campaigns_done}/${p.progress.campaigns_total} campaigns done`
              : 'add checklist steps or campaigns to earn progress'}
          </span>
        </div>
      </div>

      {/* B. Campaigns in this project */}
      <div className="section-head" style={{ marginTop: 18 }}>
        <h2>Campaigns in this project</h2>
        <span className="count">· {p.campaigns.length}</span>
        <span className="spacer" />
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setCampModal('new')}><Plus size={15} /> New campaign</button>}
      </div>
      {p.campaigns.length === 0 ? (
        <div className="card card-pad" style={{ color: PC.red, fontWeight: 700 }}>
          No campaigns running. This project is not moving.
        </div>
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
