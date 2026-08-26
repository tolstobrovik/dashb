import { useCallback, useEffect, useState } from 'react'
import { Plus, ArrowUpRight, Lightbulb } from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import Avatar from '../components/Avatar.jsx'
import { tr as tx, locale } from '../lib/i18n.jsx'
import { SprintTabs, TaskModal } from './Sprints.jsx'

// The backlog — the second of the module's two screens.
//
// An idea is a task with no week. It has no assignee, no deadline and no
// checklist, and it counts towards nothing until an owner promotes it. That is
// deliberate: the point of the backlog is that writing something down costs
// nothing, so nobody keeps a private list of things the board never hears about.
//
// Promotion is the one owner-only act here. It gives the idea this week and
// opens the task window straight afterwards, because an idea that lands on the
// board with no assignee is exactly the card everybody scrolls past.

const dateAdded = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function SprintBacklog() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(0)
  const [open, setOpen] = useState(null)
  const [people, setPeople] = useState([])

  const load = useCallback(() => api.get('/sprints/backlog')
    .then((d) => { setData(d); setErr('') })
    .catch((e) => setErr(e.message)), [])
  useEffect(() => { load() }, [load])
  // The picker the task window needs the moment a promotion opens it.
  useEffect(() => { api.get('/sprints/people').then(setPeople).catch(() => setPeople([])) }, [])

  const add = async (e) => {
    e.preventDefault()
    const title = adding.trim()
    if (!title) return
    setAdding('')
    try { setData(await api.post('/sprints/backlog', { title })) }
    catch (e2) { toast(e2.message, 'err') }
  }

  // One round trip: the idea joins the week, the list comes back without it,
  // and the task itself comes back in the board's shape for the window.
  const promote = async (item) => {
    setBusy(item.id)
    try {
      const res = await api.post(`/sprints/backlog/${item.id}/promote`)
      setData({ items: res.items, owner: res.owner })
      if (res.task) setOpen(res.task)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(0) }
  }

  if (err) return <div className="card card-pad empty">{err}</div>
  if (!data) return <div className="app-loading"><span className="spinner" /></div>

  return (
    <>
      <SprintTabs />

      <form className="sp-idea-add" onSubmit={add}>
        <Plus size={15} />
        <input
          className="input" value={adding} onChange={(e) => setAdding(e.target.value)}
          placeholder={tx('Write down an idea, press Enter')}
        />
      </form>

      <div className="card table-wrap">
        <table className="tbl sp-table sp-backlog">
          <thead>
            <tr>
              <th>{tx('Idea')}</th>
              <th>{tx('Added by')}</th>
              <th>{tx('Added')}</th>
              {data.owner && <th />}
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id}>
                <td className="sp-idea-cell"><b>{it.title}</b></td>
                <td className="sp-by-cell">
                  {it.added_by
                    ? (
                      <span className="sp-added-by">
                        <Avatar name={it.added_by} color={it.added_color} src={it.added_avatar} size="xs" />
                        {it.added_by}
                      </span>
                    )
                    : <span className="stat-sub">—</span>}
                </td>
                <td className="sp-added-cell stat-sub">{dateAdded(it.created_at)}</td>
                {data.owner && (
                  <td className="sp-promote-cell">
                    <button className="btn btn-sm" disabled={busy === it.id}
                      onClick={() => promote(it)}>
                      {tx('Promote to sprint')} <ArrowUpRight size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td colSpan={data.owner ? 4 : 3} className="empty">
                  <Lightbulb size={16} /> {tx('No ideas yet. Anything anybody writes here waits until an owner picks it up.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Promotion opens the window so the assignee and the checklist get set
          while the owner is still thinking about the idea. */}
      {open && (
        <TaskModal
          task={open} people={people} locked={false}
          onClose={() => { setOpen(null); load() }}
          onSaved={() => load()}
        />
      )}
    </>
  )
}
