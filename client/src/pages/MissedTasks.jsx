import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Video, Scissors, Eye, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { typeInfo } from '../lib/constants.js'

// Every missed deadline on the team, one row per person who owes it.
//
// A task can appear more than once on purpose: if the shoot ran late AND the
// edit ran late, that is two misses with two different names on them, and
// flattening them into one row would quietly forgive somebody. Each row says
// which stage was missed and who was holding it at the time.
//
// Admins see the whole team; everybody else sees their own name only.
const ROLE = {
  operator: { label: 'Shooter', icon: Video, cls: 'rl-shoot' },
  editor: { label: 'Editor', icon: Scissors, cls: 'rl-edit' },
  reviewer: { label: 'Review', icon: Eye, cls: 'rl-review' },
}

export default function MissedTasks() {
  const { user } = useAuth()
  const { byKey, channels } = useChannels()
  const isAdmin = user.role === 'admin'
  const [rows, setRows] = useState(null)
  const [team, setTeam] = useState([])
  const [ch, setCh] = useState('')
  const [who, setWho] = useState('')
  const [role, setRole] = useState('')
  const [type, setType] = useState('')

  useEffect(() => {
    let alive = true
    const url = isAdmin ? '/warnings' : '/warnings/me'
    api.get(url).then((d) => {
      if (!alive) return
      setRows(d.warnings || [])
      setTeam(d.team || [{ id: user.id, name: user.name }])
    }).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [isAdmin, user.id, user.name])

  const shown = useMemo(() => (rows || []).filter((w) =>
    (!ch || (w.channels || []).includes(ch)) &&
    (!who || w.owner_id === Number(who)) &&
    (!role || w.role === role) &&
    (!type || w.type === type)), [rows, ch, who, role, type])

  // Two people answering for the same task is the case worth seeing, so it is
  // counted rather than left for the reader to notice.
  const doubles = useMemo(() => {
    const seen = new Map()
    for (const w of shown) seen.set(w.content_id, (seen.get(w.content_id) || 0) + 1)
    return [...seen.values()].filter((n) => n > 1).length
  }, [shown])

  const totalDays = shown.reduce((n, w) => n + w.days_late, 0)
  const anyFilter = ch || who || role || type
  const nameOf = (id) => team.find((u) => u.id === id)?.name || (id ? `#${id}` : 'nobody')

  if (!rows) return <div className="card card-pad empty">Loading…</div>

  return (
    <div>
      <div className="section-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={17} /> Missed tasks
        </h2>
      </div>

      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div className="mt-filters">
          <select className="select" value={ch} onChange={(e) => setCh(e.target.value)}>
            <option value="">Every page</option>
            {channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>

          {isAdmin && (
            <select className="select" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Anyone</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}

          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Any stage</option>
            <option value="operator">Shooting</option>
            <option value="editor">Editing</option>
            <option value="reviewer">Review &amp; publish</option>
          </select>

          <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Any type</option>
            {['post', 'reel', 'story', 'video', 'other'].map((t) =>
              <option key={t} value={t}>{typeInfo(t).label}</option>)}
          </select>

          {anyFilter && (
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => { setCh(''); setWho(''); setRole(''); setType('') }}>
              <X size={13} /> Clear
            </button>
          )}
        </div>

        <div className="mt-summary">
          <b>{shown.length}</b> missed {shown.length === 1 ? 'deadline' : 'deadlines'}
          {' · '}<b>{totalDays}</b> {totalDays === 1 ? 'day' : 'days'} lost
          {doubles > 0 && <> · <b>{doubles}</b> {doubles === 1 ? 'task' : 'tasks'} missed at more than one stage</>}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card card-pad empty">
          {anyFilter ? 'Nothing missed that matches those filters.' : 'Nothing missed. Every deadline met so far.'}
        </div>
      ) : (
        <div className="card card-pad" style={{ paddingTop: 8, paddingBottom: 8 }}>
          {shown.map((w) => {
            const r = ROLE[w.role] || ROLE.operator
            const Icon = r.icon
            const twice = shown.filter((x) => x.content_id === w.content_id).length > 1
            return (
              <div className="mt-row" key={`${w.content_id}-${w.phase}-${w.owner_id}`}>
                <span className={`mt-role ${r.cls}`}><Icon size={11} /> {r.label}</span>
                <span className="mt-title">
                  {w.title}
                  {twice && <span className="mt-twice" data-tip="This task was missed at more than one stage">also missed elsewhere</span>}
                </span>
                <span className="mt-who">{nameOf(w.owner_id)}</span>
                <span className="mt-meta">
                  <span className={`chip ct-${w.type}`}>{typeInfo(w.type).label}</span>
                  {(w.channels || []).map((c) => (
                    <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>
                  ))}
                </span>
                <span className="mt-when">
                  due {w.due}
                  {w.revised && <span className="muted"> (was {w.promised})</span>}
                  {w.delivered_day ? <span className="muted"> · delivered {w.delivered_day}</span>
                    : <span className="muted"> · still open</span>}
                </span>
                <span className="mt-days">{w.days_late}d</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
