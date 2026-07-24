import { useEffect, useMemo, useState } from 'react'
import { UserX, CalendarX2, Clapperboard, Scissors, Palette, User } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { dateLabel, typeInfo, isDeletedLabel } from '../lib/constants.js'
import ContentModal from '../components/ContentModal.jsx'

// The planning gaps, on one page: every live task that nobody owns yet —
// no main assignee, no operator/editor on filmed work, no designer on a
// post — or that has no dates (shoot day on filmed work, release day on
// everything). A task shows up the moment it has a hole and leaves the
// moment the hole is filled; clicking a row opens the task to fix it.

// What a task is missing. Filmed types need a shoot/edit chain and a
// recording day; posts need a designer; everything needs an owner and a
// release day. Work already past the edit (ready_at) stopped needing its
// shoot-side people and date long ago.
const holesOf = (t) => {
  const filmed = t.type === 'reel' || t.type === 'video'
  const preEdit = !t.ready_at
  const people = []
  const dates = []
  if (!(t.assignees?.length ? t.assignees.length : t.assignee_id)) people.push({ key: 'owner', label: 'needs an owner', icon: User })
  if (filmed && preEdit && !t.operator_id) people.push({ key: 'operator', label: 'needs an operator', icon: Clapperboard })
  if (filmed && preEdit && !t.editor_id) people.push({ key: 'editor', label: 'needs an editor', icon: Scissors })
  if (t.type === 'post' && !t.designer_id) people.push({ key: 'designer', label: 'needs a designer', icon: Palette })
  if (filmed && preEdit && !t.recording_date) dates.push({ key: 'shoot', label: 'no shoot day', icon: CalendarX2 })
  if (!t.release_date) dates.push({ key: 'release', label: 'no release day', icon: CalendarX2 })
  return { people, dates }
}

function GapRow({ t, holes, byKey, onOpen }) {
  return (
    <button className="ov-row" onClick={() => onOpen(t)}>
      <span className={'ov-date' + (t.release_date ? '' : ' late')}>
        {t.release_date ? dateLabel(t.release_date) : 'no date'}
      </span>
      <span className="brief-main">
        <span className="ov-title">{t.title}</span>
      </span>
      <span className="ov-chips">
        {[...holes.people, ...holes.dates].map((h) => {
          const Icon = h.icon
          return <span key={h.key} className={'chip ' + (holes.people.includes(h) ? 'chip-danger' : 'chip-muted')}><Icon size={11} /> {h.label}</span>
        })}
        <span className={`chip ct-${t.type}`}>{typeInfo(t.type).label}</span>
        {t.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
      </span>
    </button>
  )
}

export default function Unassigned() {
  const { user } = useAuth()
  const { byKey } = useChannels()
  const [boot] = useState(() => cache.get(`unassigned:${user.id}`))
  const [content, setContent] = useState(boot?.content || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  const [loading, setLoading] = useState(!boot)
  const [openItem, setOpenItem] = useState(null)

  useEffect(() => {
    Promise.all([api.get('/content'), api.cached('/statuses')])
      .then(([ct, st]) => {
        setContent(ct); setStatuses(st)
        cache.set(`unassigned:${user.id}`, { content: ct.map(({ photo_thumb: _t, ...r }) => r), statuses: st })
      })
      .finally(() => setLoading(false))
  }, [user.id])
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || openItem) return
      api.poll('/content').then((f) => { if (f) setContent(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    return () => clearInterval(id)
  }, [openItem])

  const deadIds = useMemo(() => new Set(statuses.filter((s) => isDeletedLabel(s.label)).map((s) => s.id)), [statuses])

  // Published and killed work needs nobody; everything else is judged.
  // Owner-less tasks first (a date can wait, an orphan can't), soonest
  // release at the top of each list, undated work at the bottom.
  const { unowned, undated } = useMemo(() => {
    const rows = content
      .filter((t) => !t.done_at && !deadIds.has(t.status_id))
      .map((t) => ({ t, holes: holesOf(t) }))
      .filter((r) => r.holes.people.length > 0 || r.holes.dates.length > 0)
      .sort((a, b) => (a.t.release_date || '9999').localeCompare(b.t.release_date || '9999') || b.t.id - a.t.id)
    return {
      unowned: rows.filter((r) => r.holes.people.length > 0),
      undated: rows.filter((r) => r.holes.people.length === 0),
    }
  }, [content, deadIds])

  const updateContent = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    setContent((prev) => prev.map((x) => (x.id === item.id ? u : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const total = unowned.length + undated.length
  return (
    <>
      <div className="card card-pad brief-hero">
        <div className="brief-hello"><UserX size={17} /> Unassigned</div>
        <h2 className="brief-title">
          {total === 0
            ? 'Every task has its people and its dates.'
            : [
              unowned.length > 0 && `${unowned.length} waiting for a person`,
              undated.length > 0 && `${undated.length} waiting for dates`,
            ].filter(Boolean).join(' · ') + '.'}
        </h2>
      </div>

      {unowned.length > 0 && (
        <>
          <div className="section-head">
            <UserX size={17} style={{ color: '#A32D2D' }} />
            <h2>Nobody owns these</h2>
            <span className="count">· {unowned.length}</span>
          </div>
          <div className="card card-pad brief-list">
            {unowned.map((r) => <GapRow key={r.t.id} t={r.t} holes={r.holes} byKey={byKey} onOpen={setOpenItem} />)}
          </div>
        </>
      )}

      {undated.length > 0 && (
        <>
          <div className="section-head">
            <CalendarX2 size={17} style={{ color: 'var(--brand-500)' }} />
            <h2>No dates yet</h2>
            <span className="count">· {undated.length}</span>
          </div>
          <div className="card card-pad brief-list">
            {undated.map((r) => <GapRow key={r.t.id} t={r.t} holes={r.holes} byKey={byKey} onOpen={setOpenItem} />)}
          </div>
        </>
      )}

      {openItem && (
        <ContentModal item={openItem} statuses={statuses} onClose={() => setOpenItem(null)}
          onUpdate={updateContent} onDelete={deleteContent} />
      )}
    </>
  )
}
