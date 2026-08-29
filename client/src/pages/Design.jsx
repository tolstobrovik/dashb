import { useEffect, useMemo, useState } from 'react'
import {
  Palette, FolderOpen, ExternalLink, CalendarRange, AlertTriangle, Check,
  ChevronLeft, ChevronRight, Link2, ChevronDown,
} from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, dateLabel, typeInfo, isDeletedLabel, tashkentDay } from '../lib/constants.js'
import { deliveryHref } from '../lib/text.js'
import ContentModal from '../components/ContentModal.jsx'
import Avatar from '../components/Avatar.jsx'
import { toast, loadFailed } from '../lib/toast.js'
import { tr as tx, locale } from '../lib/i18n.jsx'

// ---- the designer's own board ----
//
// A designer's work was scattered across channel boards built for filmed
// content: their piece sat in a column called Editing between two videos they
// had nothing to do with, their deadline was a field three sections down, and
// the folder their files actually live in was on a different page entirely.
//
// This is the same work, arranged the way the job is actually done: what is
// waiting on ME, what is waiting on somebody else, and what is finished —
// each piece carrying its Drive folder, its brief and its deadline, with the
// finished artwork handed back in place.
//
// Drive is the workspace, and the board admits it. Every row opens the
// channel's shared folder in one press; the artwork comes back as a Drive
// link on the task. Nothing is uploaded here — the files were never going to
// live in a dashboard.

const monthOf = (iso) => iso.slice(0, 7)
const shiftMonth = (ym, by) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const monthWords = (ym) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })

// The day the artwork is owed. Its own deadline if it has one, otherwise the
// release it is blocking — a designer with no design deadline is not free,
// they are working to the release.
const dueOf = (t) => t.design_ready_date || t.release_date || null

// Four buckets, in the order a designer meets them. "Waiting on the brief" is
// deliberately its own state rather than being folded into To do: a piece with
// no reference and no ТЗ cannot be started, and calling that "your turn" is
// how a board earns being ignored.
const LANES = [
  { key: 'brief', label: 'Waiting on the brief', hint: 'No reference and no ТЗ yet — there is nothing to design from' },
  { key: 'todo', label: 'To design', hint: 'Briefed and yours — this is the queue' },
  { key: 'review', label: 'Handed back', hint: 'The artwork is in; it is being looked at' },
  { key: 'done', label: 'Published', hint: 'Out the door' },
]

const laneOf = (t) => {
  if (t.done_at) return 'done'
  if (t.design_link || t.ready_at) return 'review'
  const briefed = !!(t.reference_text || (t.reference_links || []).length || t.tz || t.has_photo)
  return briefed ? 'todo' : 'brief'
}

export default function Design() {
  const { user } = useAuth()
  const { visible: channels, byKey } = useChannels()
  const isAdmin = user.role === 'admin'
  const today = todayISO()

  const [boot] = useState(() => cache.get('design'))
  const [content, setContent] = useState(boot?.content || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  const [team, setTeam] = useState(boot?.team || [])
  const [loading, setLoading] = useState(!boot)
  const [openItem, setOpenItem] = useState(null)

  // A month, as everywhere else on the board.
  const [month, setMonth] = useState(() => monthOf(today))
  const [who, setWho] = useState(isAdmin ? 'all' : String(user.id))
  const [chan, setChan] = useState('all')
  // Dense by default was the complaint. Each lane remembers whether it is open.
  const [shut, setShut] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('satashkent_design_shut') || '[]')) } catch { return new Set() }
  })
  const toggleLane = (k) => setShut((prev) => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    localStorage.setItem('satashkent_design_shut', JSON.stringify([...next]))
    return next
  })

  useEffect(() => {
    Promise.all([api.get('/content'), api.cached('/statuses'), api.cached('/users')])
      .then(([c, s, u]) => {
        setContent(c); setStatuses(s); setTeam(u)
        cache.set('design', { content: c, statuses: s, team: u })
      })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [])

  const teamById = useMemo(() => Object.fromEntries(team.map((u) => [u.id, u])), [team])
  const designers = useMemo(
    () => team.filter((u) => (u.crew_roles || []).includes('designer') || u.role === 'designer'),
    [team])

  // What counts as design work: a piece somebody has handed to a designer, or
  // one carrying an artwork deadline, or a post — the type that is artwork by
  // definition. A video nobody has asked for artwork on is not on this board.
  const mine = useMemo(() => {
    const dead = new Set(statuses.filter((s) => isDeletedLabel(s.label)).map((s) => s.id))
    return content.filter((t) => {
      if (dead.has(t.status_id)) return false
      if (!(t.designer_id || t.design_ready_date || t.type === 'post')) return false
      if (who !== 'all' && t.designer_id !== Number(who)) return false
      if (chan !== 'all' && !(t.channels || []).includes(chan)) return false
      const day = t.done_at ? tashkentDay(t.done_at) : dueOf(t)
      // Undated work is always visible: it is the work most likely to be lost.
      return !day || monthOf(day) === month
    })
  }, [content, statuses, who, chan, month])

  const lanes = useMemo(() => {
    const out = Object.fromEntries(LANES.map((l) => [l.key, []]))
    for (const t of mine) out[laneOf(t)].push(t)
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => (dueOf(a) || '9999').localeCompare(dueOf(b) || '9999'))
    }
    return out
  }, [mine])

  const lateCount = useMemo(
    () => lanes.brief.concat(lanes.todo).filter((t) => dueOf(t) && dueOf(t) < today).length,
    [lanes, today])

  const updateContent = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    setContent((prev) => prev.map((x) => (x.id === item.id ? u : x)))
    return u
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
  }

  // The folder this piece's files live in — the channel's shared Drive folder.
  const folderOf = (t) => {
    for (const k of t.channels || []) {
      const url = (byKey[k]?.drive_url || '').trim()
      if (url) return url
    }
    return ''
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  return (
    <>
      <div className="section-head">
        <Palette size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{tx('Design')}</h2>
        {lateCount > 0 && (
          <span className="chip chip-danger"><AlertTriangle size={12} /> {lateCount} {tx('past their day')}</span>
        )}
        <span className="spacer" />
        <div className="at-month">
          <button className="icon-btn" onClick={() => setMonth((m) => shiftMonth(m, -1))}
            aria-label={tx('Previous month')} data-tip={tx('Previous month')}><ChevronLeft size={18} /></button>
          <b>{monthWords(month)}</b>
          <button className="icon-btn" onClick={() => setMonth((m) => shiftMonth(m, 1))}
            aria-label={tx('Next month')} data-tip={tx('Next month')}><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="dz-filters">
        {isAdmin && (
          <div className="pill-group">
            <button className={'pill' + (who === 'all' ? ' active' : '')} onClick={() => setWho('all')}>{tx('Everyone')}</button>
            {designers.map((u) => (
              <button key={u.id} className={'pill' + (who === String(u.id) ? ' active' : '')}
                onClick={() => setWho(String(u.id))}>{u.name.split(' ')[0]}</button>
            ))}
          </div>
        )}
        <div className="pill-group">
          <button className={'pill' + (chan === 'all' ? ' active' : '')} onClick={() => setChan('all')}>{tx('All channels')}</button>
          {channels.map((c) => (
            <button key={c.key} className={'pill' + (chan === c.key ? ' active' : '')}
              onClick={() => setChan(chan === c.key ? 'all' : c.key)}>{c.label}</button>
          ))}
        </div>
      </div>

      {LANES.map((lane) => {
        const rows = lanes[lane.key]
        const open = !shut.has(lane.key)
        return (
          <div key={lane.key} className="card dz-lane">
            <button type="button" className="dz-lane-head" onClick={() => toggleLane(lane.key)} aria-expanded={open}>
              <b>{tx(lane.label)}</b>
              <span className="count">{rows.length}</span>
              <span className="stat-sub dz-hint">{tx(lane.hint)}</span>
              <span className="spacer" />
              <ChevronDown size={16} className={'dz-caret' + (open ? ' open' : '')} />
            </button>
            {open && (rows.length === 0 ? (
              <div className="empty">{tx('Nothing here this month.')}</div>
            ) : (
              <div className="dz-rows">
                {rows.map((t) => {
                  const due = dueOf(t)
                  const late = due && due < today && !t.done_at
                  const folder = folderOf(t)
                  const art = deliveryHref(t.design_link)
                  const d = teamById[t.designer_id]
                  return (
                    <div key={t.id} className={'dz-row' + (late ? ' dz-late' : '')}>
                      <button className="dz-main" onClick={() => setOpenItem(t)}>
                        <span className={`chip ct-${t.type}`}>{typeInfo(t.type).label}</span>
                        <span className="dz-title">{t.title}</span>
                        <span className="dz-chans">
                          {(t.channels || []).map((k) => byKey[k]?.label || k).join(' · ')}
                        </span>
                      </button>
                      <span className="dz-due">
                        {due
                          ? <span className={late ? 'pay-bad' : ''}><CalendarRange size={12} /> {dateLabel(due)}</span>
                          : <span className="stat-sub">{tx('no day set')}</span>}
                      </span>
                      <span className="dz-who">
                        {d
                          ? <><Avatar name={d.name} color={d.color} src={d.avatar} size="xs" /> {d.name.split(' ')[0]}</>
                          : <span className="stat-sub">{tx('nobody yet')}</span>}
                      </span>
                      <span className="dz-links">
                        {folder && (
                          <a className="btn btn-sm" href={folder} target="_blank" rel="noreferrer"
                            data-tip={tx('The channel’s shared Drive folder')}>
                            <FolderOpen size={13} /> {tx('Folder')}
                          </a>
                        )}
                        {art
                          ? (
                            <a className="btn btn-sm btn-ok" href={art} target="_blank" rel="noreferrer">
                              <Check size={13} /> {tx('The artwork')}
                            </a>
                          )
                          : (
                            <button className="btn btn-sm btn-primary" onClick={() => setOpenItem(t)}>
                              <Link2 size={13} /> {tx('Hand it back')}
                            </button>
                          )}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )
      })}

      {openItem && (
        <ContentModal key={openItem.id} item={openItem} statuses={statuses}
          onClose={(next) => setOpenItem(next?.id ? next : null)}
          onCreate={() => {}}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
    </>
  )
}
