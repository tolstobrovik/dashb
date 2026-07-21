import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { can, dateLabel } from '../lib/constants.js'
import CampaignForm from '../components/CampaignForm.jsx'
import ContentBoard from '../components/ContentBoard.jsx'
import ContentModal from '../components/ContentModal.jsx'
import { StatusBadge, PaceBar, PcChecklist, NotesBlock, PC } from '../components/ProjectBits.jsx'

// Campaign detail: header, one big number, the pre-launch checklist that
// drives Blocked, the content kanban filtered to this campaign, and notes.
export default function CampaignDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { byKey } = useChannels()
  const [c, setC] = useState(null)
  const [team, setTeam] = useState([])
  const [metrics, setMetrics] = useState([])
  const [projects, setProjects] = useState([])
  const [content, setContent] = useState([])
  const [statuses, setStatuses] = useState([])
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)
  const [openItem, setOpenItem] = useState(null)
  const [actualEdit, setActualEdit] = useState(null)

  const isAdmin = user.role === 'admin'
  const canWrite = isAdmin || (c?.owner_id && c.owner_id === user.id)

  const load = () => Promise.all([
    api.get(`/campaigns/${id}`), api.get('/users'), api.get('/projects/metrics'),
    api.get('/projects'), api.get('/content'), api.get('/statuses'),
  ]).then(([camp, us, ms, ps, ct, st]) => {
    setC(camp); setTeam(us); setMetrics(ms); setProjects(ps); setContent(ct); setStatuses(st)
  }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live sync: campaign fields and the content board follow the team.
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || editing || openItem || actualEdit !== null) return
      api.get(`/campaigns/${id}`).then(setC).catch(() => {})
      api.poll('/content').then((f) => { if (f) setContent(f) }).catch(() => {})
    }
    const t = setInterval(refresh, 10000)
    return () => clearInterval(t)
  }, [id, editing, openItem, actualEdit])

  const tagged = useMemo(() => content.filter((x) => x.campaign_id === Number(id)), [content, id])
  const campaignsById = useMemo(() => (c ? { [c.id]: c } : {}), [c])
  const teamById = useMemo(() => Object.fromEntries(team.map((u) => [u.id, u])), [team])

  if (err) return <div className="card card-pad empty">{err}</div>
  if (!c) return <div className="app-loading"><span className="spinner" /></div>

  const patch = async (body) => {
    try { setC({ ...(await api.patch(`/campaigns/${c.id}`, body)), notes: c.notes }) }
    catch (e) { alert(e.message) }
  }
  const saveActual = async () => {
    const v = Number(actualEdit)
    setActualEdit(null)
    if (!Number.isFinite(v) || v === c.actual) return
    await patch({ actual: v })
  }

  const updateContent = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    setContent((prev) => prev.map((x) => (x.id === item.id ? u : x)))
  }
  const createContent = async (payload) => {
    const u = await api.post('/content', { ...payload, campaign_id: c.id })
    setContent((prev) => [u, ...prev])
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
  }

  return (
    <>
      <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</button>

      {/* A. Header */}
      <div className="card card-pad pc-header">
        {c.photo && <img className="pc-banner" src={c.photo} alt="" />}
        <div className="pc-camp-top">
          <h2 style={{ fontSize: 22 }}>{c.name}</h2>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusBadge status={c.status} />
            {canWrite && (
              <button className="icon-btn" data-tip="Edit campaign fields" data-tip-left="" onClick={() => setEditing(true)} aria-label="Edit">
                <Pencil size={15} />
              </button>
            )}
            {isAdmin && (
              <button className="icon-btn del-btn" data-tip="Delete this campaign" data-tip-left=""
                onClick={async () => {
                  if (!confirm(`Delete the campaign “${c.name}”?\n\nIts content cards stay but lose the campaign tag.`)) return
                  try { await api.del(`/campaigns/${c.id}`); navigate('/projects') } catch (e) { alert(e.message) }
                }} aria-label="Delete campaign">
                <Trash2 size={15} />
              </button>
            )}
          </span>
        </div>
        <div className="stat-sub" style={{ marginTop: 2 }}>
          {c.project_name
            ? <a className="pc-link" onClick={() => navigate(`/projects/${c.project_id}`)}>{c.project_name}</a>
            : <span className="pc-red">no project</span>}
          {' · '}{c.owner_name || <span className="pc-red">no owner</span>}
          {c.goal ? ` · ${c.goal}` : ''}
        </div>
        <div className="pc-when-row">
          {c.start_date && c.end_date ? (
            <span className="pc-when-big">{dateLabel(c.start_date)} → {dateLabel(c.end_date)}</span>
          ) : (
            <span className="pc-when-big late">no dates yet</span>
          )}
          {c.days_left != null && c.status !== 'done' && (
            <span className="pc-days" data-tip="Days until the end date">{c.days_left >= 0 ? `${c.days_left}d left` : 'ended'}</span>
          )}
        </div>
        {c.description && <p className="pc-desc">{c.description}</p>}
      </div>

      {/* B. One big number */}
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="pc-bignum">
          {actualEdit !== null ? (
            <input className="input" type="number" autoFocus style={{ width: 130, fontSize: 20, fontWeight: 800 }}
              value={actualEdit} onChange={(e) => setActualEdit(e.target.value)}
              onBlur={saveActual} onKeyDown={(e) => { if (e.key === 'Enter') saveActual() }} />
          ) : (
            <b className={canWrite ? 'pc-actual-edit' : ''}
              data-tip={canWrite ? 'The weekly human number — click to type this week’s value' : undefined}
              onClick={() => canWrite && setActualEdit(String(c.actual))}>
              {c.actual.toLocaleString()}
            </b>
          )}
          <span> / {c.target.toLocaleString()} {c.metric}</span>
          <span style={{ flex: 1 }} />
          {c.pace && c.status !== 'done' && (
            <span style={{ color: c.pace.behind ? PC.amber : PC.green, fontWeight: 800 }}>
              {c.pace.behind ? 'behind' : 'ahead'} pace
            </span>
          )}
        </div>
        {c.status === 'blocked' && c.blocking ? (
          <div className="pc-strip">Blocked by: {c.blocking.text} — due {dateLabel(c.blocking.due)}</div>
        ) : (
          <PaceBar pace={c.pace} height={14} />
        )}
        <div className="stat-sub" style={{ marginTop: 6 }}>
          The tick marks time elapsed; the fill marks target hit. Fill behind the tick means behind pace.
        </div>
      </div>

      {/* C. Checklist — pre-launch conditions; an overdue unticked item sets Blocked */}
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <PcChecklist
          items={c.checklist}
          team={team}
          canTick={canWrite}
          canEditItems={isAdmin}
          onChange={(items) => patch({ checklist: items })}
        />
      </div>

      {/* D. Content — only cards tagged to this campaign, across all channels */}
      <div className="section-head" style={{ marginTop: 18 }}>
        <h2>Content</h2>
        <span className="count">· {tagged.length} card{tagged.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        {can(user, 'manage_content') && (
          <button className="btn btn-primary btn-sm" onClick={() => setOpenItem('new')}>New card</button>
        )}
      </div>
      {tagged.length === 0 ? (
        <div className="card card-pad" style={{ color: PC.red, fontWeight: 700 }}>
          No content tagged to this campaign yet. A campaign launching with an empty board is going to fail — tag cards on the channel kanbans, or add one here.
        </div>
      ) : (
        <ContentBoard
          items={tagged}
          statuses={statuses}
          dept={null}
          canMove={can(user, 'move_tasks')}
          onMove={(item, statusId) => updateContent(item, { status_id: statusId }).catch((e) => alert(e.message))}
          onOpen={setOpenItem}
          campaignsById={campaignsById}
          teamById={teamById}
        />
      )}

      {/* E. Notes */}
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <NotesBlock
          notes={c.notes}
          onAdd={async (text) => {
            const n = await api.post(`/campaigns/${c.id}/notes`, { text })
            setC({ ...c, notes: [n, ...c.notes] })
          }}
          onDelete={async (n) => {
            await api.del(`/campaigns/${c.id}/notes/${n.id}`)
            setC((prev) => ({ ...prev, notes: prev.notes.filter((x) => x.id !== n.id) }))
          }}
          canDelete={(n) => isAdmin || n.author_id === user.id}
        />
      </div>

      {editing && (
        <CampaignForm
          campaign={c}
          projects={projects}
          team={team}
          metrics={metrics}
          isAdmin={isAdmin}
          onClose={() => setEditing(false)}
          onSaved={(saved) => setC({ ...saved, notes: c.notes })}
          onDeleted={() => navigate('/projects')}
        />
      )}
      {openItem && (
        <ContentModal
          item={openItem === 'new' ? null : openItem}
          statuses={statuses}
          defaults={{ campaign_id: c.id }}
          onClose={() => setOpenItem(null)}
          onCreate={createContent}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
    </>
  )
}
