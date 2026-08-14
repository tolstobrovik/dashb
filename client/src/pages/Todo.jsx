import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Check, PartyPopper, Clapperboard, Send, GripVertical, Pin, Trash2, UserRound,
  Lock, CalendarDays, StickyNote, CalendarClock, Video, Scissors, PenLine, Palette, CopyPlus,
} from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useContextMenu } from '../components/ContextMenu.jsx'
import { getPicks, bumpPick } from '../lib/picks.js'
import { toast, loadFailed } from '../lib/toast.js'
import { api, cache } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { playDing } from '../lib/sound.js'
import { todayISO, dateLabel, addDaysISO, can, CONTENT_TYPES, typeInfo, isDeletedLabel } from '../lib/constants.js'
import ContentModal from '../components/ContentModal.jsx'
import PersonalModal from '../components/PersonalModal.jsx'

const keyOf = (it) => (it.personal ? 'p' : 'c') + it.id

// Row and Section live OUTSIDE the page component on purpose: defined inside,
// React would remount every row on each keystroke or poll — killing any drag
// mid-flight and losing hover/focus. Out here they simply re-render.
function Row({ item, ctx }) {
  const { user, byKey, teamById, toggle, togglePin, removeTask, rescheduleToday, duplicateTask, setOpenItem, dragKey, onDragOverRow, persistOrder, openMenu } = ctx
  const isDone = !!item.done_at
  const canComplete = item.personal || user.role === 'admin' || can(user, 'move_tasks') || item.assignee_id === user.id
  const canPin = canComplete
  const canDelete = item.personal || user.role === 'admin' || can(user, 'manage_content')
  const due = item.personal ? item.due_date : item.release_date || item.recording_date
  const isOverdue = !isDone && due && due < todayISO()
  return (
    <div
      className={'todo-row' + (item.pinned && !isDone ? ' pinned' : '')}
      draggable={!isDone}
      onDragStart={(e) => {
        dragKey.current = keyOf(item)
        try { e.dataTransfer.setData('text/plain', keyOf(item)); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
      }}
      onDragOver={(e) => { e.preventDefault(); onDragOverRow(item) }}
      onDrop={persistOrder}
      onDragEnd={persistOrder}
      onContextMenu={(e) => openMenu(e, [
        { label: 'Open', icon: PenLine, onClick: () => setOpenItem(item) },
        canComplete && { label: isDone ? 'Mark as not done' : 'Mark as done', icon: Check, onClick: () => toggle(item) },
        canPin && !isDone && { label: item.pinned ? 'Unpin' : 'Pin to the top', icon: Pin, onClick: () => togglePin(item) },
        !isDone && due && due !== todayISO() && { label: 'Reschedule to today', icon: CalendarDays, onClick: () => rescheduleToday(item) },
        !item.personal && can(user, 'manage_content') && { label: 'Duplicate', icon: CopyPlus, onClick: () => duplicateTask(item) },
        canDelete && { sep: true },
        canDelete && { label: 'Delete', icon: Trash2, danger: true, onClick: () => removeTask(item) },
      ])}
    >
      {!isDone && <span className="todo-grip" data-tip="Drag to reorder"><GripVertical size={14} /></span>}
      <button
        className={`todo-check${isDone ? ' on' : ''}`}
        onClick={() => canComplete && toggle(item)}
        disabled={!canComplete}
        data-tip={!canComplete ? 'Only the assignee can complete this' : isDone ? 'Mark as not done' : 'Mark as done'}
        aria-label="Complete"
      >
        {isDone && <Check size={15} strokeWidth={3.5} />}
      </button>
      <button className="todo-main" onClick={() => setOpenItem(item)} data-tip="Open the task">
        <span className={`todo-title${isDone ? ' done-txt' : ''}`}>{item.title}</span>
        <span className="todo-meta">
          {item.personal ? (
            <>
              <span className="chip chip-personal"><Lock size={10} /> Personal</span>
              {item.due_date && <span className="chip chip-muted"><CalendarDays size={10} /> {dateLabel(item.due_date)}</span>}
              {item.note && <span className="chip chip-muted"><StickyNote size={10} /> Note</span>}
            </>
          ) : (
            <>
              <span className={`chip ct-${item.type}`}>{typeInfo(item.type).label}</span>
              {item.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
              {item.recording_date && <span className="chip chip-muted"><Clapperboard size={10} /> {dateLabel(item.recording_date)}</span>}
              {item.release_date && ['admin', 'member'].includes(user.role) && (
                <span className="chip chip-muted"><Send size={10} /> {dateLabel(item.release_date)}</span>
              )}
              {(() => {
                const ids = (item.assignees?.length ? item.assignees : item.assignee_id ? [item.assignee_id] : [])
                  .filter((id) => id !== user.id && teamById[id])
                if (ids.length === 0) return null
                return (
                  <span className="chip chip-muted">
                    <UserRound size={10} /> {teamById[ids[0]].name.split(' ')[0]}{ids.length > 1 ? ` +${ids.length - 1}` : ''}
                  </span>
                )
              })()}
              {item.operator_id && teamById[item.operator_id] && (
                <span className="chip chip-muted" data-tip="Operator — films it"><Video size={10} /> {teamById[item.operator_id].name.split(' ')[0]}</span>
              )}
              {item.editor_id && teamById[item.editor_id] && (
                <span className="chip chip-muted" data-tip="Editor — cuts it"><Scissors size={10} /> {teamById[item.editor_id].name.split(' ')[0]}</span>
              )}
              {item.designer_id && teamById[item.designer_id] && (
                <span className="chip chip-muted" data-tip="Designer — designs it"><Palette size={10} /> {teamById[item.designer_id].name.split(' ')[0]}</span>
              )}
            </>
          )}
        </span>
      </button>
      <span className="todo-actions">
        {isOverdue && canComplete && (
          <button
            className="icon-btn"
            onClick={() => rescheduleToday(item)}
            aria-label="Move to today"
            data-tip="Overdue — move it to today"
            data-tip-left=""
          >
            <CalendarClock size={14} />
          </button>
        )}
        {canPin && !isDone && (
          <button
            className={'icon-btn pin-btn' + (item.pinned ? ' on' : '')}
            onClick={() => togglePin(item)}
            aria-label={item.pinned ? 'Unpin' : 'Pin'}
            data-tip={item.pinned ? 'Unpin — back to its date group' : 'Pin to the top of the list'}
            data-tip-left=""
          >
            <Pin size={14} />
          </button>
        )}
        {canDelete && (
          <button
            className="icon-btn del-btn"
            onClick={() => removeTask(item)}
            aria-label="Delete task"
            data-tip="Delete this task"
            data-tip-left=""
          >
            <Trash2 size={14} />
          </button>
        )}
      </span>
    </div>
  )
}

function Section({ label, list, tone, icon: Icon, ctx }) {
  if (list.length === 0) return null
  return (
    <div>
      <div className="section-head">
        {Icon && <Icon size={15} style={{ color: tone || 'var(--brand-500)' }} />}
        <h2 style={tone ? { color: tone } : undefined}>{label}</h2>
        <span className="count">· {list.length}</span>
      </div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {list.map((i) => <Row key={keyOf(i)} item={i} ctx={ctx} />)}
      </div>
    </div>
  )
}

// The quick-add bar is its own component so typing a title re-renders just
// this form, never the whole task list.
function QuickAdd({ visible, canTeamAdd, isAdmin, team, chan, viewUser, onAddContent, onAddPersonal }) {
  const [title, setTitle] = useState('')
  // Read fresh each render: picks made moments ago (in a modal) count too.
  const picks = getPicks()
  const [channel, setChannel] = useState('')
  const [extra, setExtra] = useState([]) // additional channels — one task, several boards
  const [type, setType] = useState('post')
  const [date, setDate] = useState(todayISO())
  const [assign, setAssign] = useState('') // '' = unassigned (whole channel)

  // Follow the filters: picking a channel/member aims the form there too.
  useEffect(() => {
    if (chan === 'personal') setChannel('__personal')
    else if (chan !== 'all' && canTeamAdd) setChannel(chan)
  }, [chan, canTeamAdd])
  useEffect(() => {
    if (!channel) {
      if (!canTeamAdd) setChannel('__personal')
      else if (visible[0]) setChannel(visible[0].key)
    }
  }, [visible, channel, canTeamAdd])
  // Self-heal: a remembered channel that no longer exists (renamed/deleted)
  // would make every add fail with "pick a platform" — snap back to a real one.
  useEffect(() => {
    if (channel && channel !== '__personal' && visible.length > 0 && !visible.some((c) => c.key === channel))
      setChannel(canTeamAdd && visible[0] ? visible[0].key : '__personal')
  }, [channel, visible, canTeamAdd])
  useEffect(() => {
    if (isAdmin) setAssign(viewUser === 'all' ? '' : viewUser)
  }, [viewUser, isAdmin])

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim() || !channel) return
    try {
      if (channel === '__personal') {
        await onAddPersonal({ title: title.trim(), due_date: date || null })
      } else {
        // A remembered assignee who has since left the team would 400 the add.
        const assignOk = isAdmin && assign && team.some((u) => u.id === Number(assign))
        await onAddContent({
          title: title.trim(), channels: [channel, ...extra.filter((k) => k !== channel)], type, release_date: date,
          ...(assignOk ? { assignee_id: Number(assign) } : {}),
        })
        if (assignOk) bumpPick(Number(assign))
      }
      setTitle('')
    } catch (e2) { alert(e2.message) }
  }

  return (
    <form className="card card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }} onSubmit={submit}>
      <input className="input" style={{ flex: '2 1 200px' }} placeholder={channel === '__personal' ? 'Add a personal task…' : 'Add a task…'} value={title} onChange={(e) => setTitle(e.target.value)} />
      {channel !== '__personal' && (
        <select className="select" style={{ flex: '0 1 110px' }} value={type} onChange={(e) => setType(e.target.value)} data-tip="Task type — counts toward that plan">
          {CONTENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      )}
      <select className="select" style={{ flex: '1 1 140px' }} value={channel} onChange={(e) => setChannel(e.target.value)} data-tip="Where the task goes — a channel, or your private list">
        {canTeamAdd && visible.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        <option value="__personal">Personal — only me</option>
      </select>
      {isAdmin && channel !== '__personal' && (
        <select className="select" style={{ flex: '1 1 130px' }} value={assign} onChange={(e) => setAssign(e.target.value)} data-tip="Who this task is for">
          <option value="">For: whole channel</option>
          {[...team].sort((a, b) => (picks[b.id] || 0) - (picks[a.id] || 0) || a.name.localeCompare(b.name))
            .map((u) => <option key={u.id} value={u.id}>For: {u.name}</option>)}
        </select>
      )}
      <input className="input" type="date" style={{ flex: '0 1 150px' }} value={date} onChange={(e) => setDate(e.target.value)} data-tip={channel === '__personal' ? 'Due date (optional)' : 'Release date'} />
      <button className="btn btn-primary" type="submit" data-tip="Add the task" data-tip-left=""><Plus size={16} /> Add</button>
      {/* One task can land on several boards at once */}
      {canTeamAdd && channel !== '__personal' && visible.length > 1 && (
        <div className="qa-extras">
          <span className="stat-sub">also on:</span>
          {visible.filter((c) => c.key !== channel).map((c) => (
            <label key={c.key} className={'checkbox-chip' + (extra.includes(c.key) ? ' on' : '')}>
              <input type="checkbox" checked={extra.includes(c.key)}
                onChange={() => setExtra((prev) => prev.includes(c.key) ? prev.filter((k) => k !== c.key) : [...prev, c.key])} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </form>
  )
}

// To-Do: every channel has its own list — you see the channels you belong to —
// plus your own personal tasks, visible to nobody but you. Admins can focus on
// one member's workload and hand out the day's tasks per person.
export default function Todo() {
  const location = useLocation()
  const { user } = useAuth()
  const { visible, byKey } = useChannels()
  const canTeamAdd = can(user, 'manage_content')
  const isAdmin = user.role === 'admin'
  // Instant boot: render the last known lists right away, refresh in background.
  const [boot] = useState(() => cache.get('todo'))
  const [items, setItems] = useState(boot?.items || [])
  const [personal, setPersonal] = useState(boot?.personal || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  const [loading, setLoading] = useState(!boot)
  const [openItem, setOpenItem] = useState(null)
  const [celebrate, setCelebrate] = useState(false)
  // Filters survive reloads: channel, "only mine", and the admin's member view.
  const [chan, setChanState] = useState(() => localStorage.getItem('satashkent_todo_chan') || 'all')
  const setChan = (c) => { setChanState(c); localStorage.setItem('satashkent_todo_chan', c) }
  const [mineOnly, setMineOnlyState] = useState(() => localStorage.getItem('satashkent_todo_mine') === '1')
  const setMineOnly = (v) => { setMineOnlyState(v); localStorage.setItem('satashkent_todo_mine', v ? '1' : '0') }
  const [viewUser, setViewUserState] = useState(() => localStorage.getItem('satashkent_todo_member') || 'all')
  const setViewUser = (v) => { setViewUserState(v); localStorage.setItem('satashkent_todo_member', v) }
  const [team, setTeam] = useState(boot?.team || [])
  const dragKey = useRef(null) // 'c12' = content 12, 'p3' = personal 3

  useEffect(() => {
    Promise.all([api.get('/content'), api.get('/personal'), api.get('/statuses'), api.get('/users')])
      .then(([ct, ps, st, us]) => {
        setItems(ct); setPersonal(ps); setStatuses(st); setTeam(us)
        // Keep the boot cache slim: drop thumbnails and avatars (the modal
        // lazy-loads photos itself; the rows only need names).
        cache.set('todo', {
          items: ct.map(({ photo_thumb: _t, ...rest }) => rest),
          personal: ps,
          statuses: st,
          team: us.map(({ avatar: _a, ...rest }) => rest),
        })
      })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [])

  // Live sync: pick up teammates' and the admin's changes every few seconds
  // (paused while the tab is hidden, a row is being dragged, or a task is open).
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || dragKey.current !== null || openItem) return
      api.poll('/content').then((fresh) => { if (fresh) setItems(fresh) }).catch(() => {})
      api.poll('/personal').then((fresh) => { if (fresh) setPersonal(fresh) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [openItem])

  // Self-heal remembered filters: a deleted channel or a member who left
  // must never leave the page silently empty (and every add failing).
  useEffect(() => {
    if (chan !== 'all' && chan !== 'personal' && visible.length > 0 && !visible.some((c) => c.key === chan))
      setChan('all')
  }, [chan, visible]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isAdmin && viewUser !== 'all' && team.length > 0 && !team.some((u) => u.id === Number(viewUser)))
      setViewUser('all')
  }, [viewUser, team, isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let cont = chan === 'personal' ? [] : chan === 'all' ? items : items.filter((i) => i.channels.includes(chan))
    if (mineOnly) cont = cont.filter((i) => i.assignee_id === user.id)
    if (isAdmin && viewUser !== 'all') cont = cont.filter((i) => i.assignee_id === Number(viewUser))
    // Personal tasks are always "mine"; hidden while inspecting a member's work.
    const pers = (chan === 'all' || chan === 'personal') && !(isAdmin && viewUser !== 'all')
      ? personal.map((p) => ({ ...p, personal: true }))
      : []
    return [...cont, ...pers]
  }, [items, personal, chan, mineOnly, user.id, isAdmin, viewUser])
  const teamById = useMemo(() => Object.fromEntries(team.map((u) => [u.id, u])), [team])

  const dateOf = (it) => (it.personal ? it.due_date : it.release_date || it.recording_date) || null
  const groups = useMemo(() => {
    const t = todayISO()
    const week = addDaysISO(t, 7)
    // Killed content (Deleted stage) has no to-do left for anyone — it lives
    // on the board's graveyard column only, never in these lists.
    const deadIds = new Set(statuses.filter((s) => isDeletedLabel(s.label)).map((s) => s.id))
    const open = filtered.filter((i) => !i.done_at && !deadIds.has(i.status_id))
    const rest = open.filter((i) => !i.pinned) // pinned tasks live in their own section on top
    return {
      pinned: open.filter((i) => i.pinned),
      overdue: rest.filter((i) => dateOf(i) && dateOf(i) < t),
      today: rest.filter((i) => dateOf(i) === t),
      week: rest.filter((i) => dateOf(i) > t && dateOf(i) <= week),
      later: rest.filter((i) => !dateOf(i) || dateOf(i) > week),
      done: filtered.filter((i) => i.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 8),
    }
  }, [filtered, statuses])

  // Route an update to the list the row lives in.
  const apiBase = (it) => (it.personal ? '/personal' : '/content')
  const setList = (it) => (it.personal ? setPersonal : setItems)

  const toggle = async (item) => {
    const marking = !item.done_at
    try {
      const updated = await api.patch(`${apiBase(item)}/${item.id}`, { done: marking })
      setList(item)((prev) => prev.map((x) => (x.id === item.id ? updated : x)))
      if (marking) {
        playDing()
        setCelebrate(true)
        setTimeout(() => setCelebrate(false), 1200)
      }
    } catch (e) { alert(e.message) }
  }

  // ---- drag to reorder (within each list — channel and personal orders are
  // separate on the server, so cross-type drags simply don't reorder) ----
  const onDragOverRow = (overItem) => {
    const from = dragKey.current
    if (!from || from === keyOf(overItem)) return
    const fromPersonal = from[0] === 'p'
    if (fromPersonal !== !!overItem.personal) return
    const fromId = Number(from.slice(1))
    ;(fromPersonal ? setPersonal : setItems)((prev) => {
      const i = prev.findIndex((x) => x.id === fromId)
      const j = prev.findIndex((x) => x.id === overItem.id)
      if (i < 0 || j < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(i, 1)
      next.splice(j, 0, moved)
      return next
    })
  }
  const persistOrder = () => {
    if (dragKey.current === null) return // drop + dragend both land here — run once
    const wasPersonal = dragKey.current[0] === 'p'
    dragKey.current = null
    if (wasPersonal) api.post('/personal/reorder', { ids: personal.map((p) => p.id) }).catch(() => {})
    else api.post('/content/todo-reorder', { ids: items.map((i) => i.id) }).catch(() => {})
  }

  const addContent = async (payload) => {
    const c = await api.post('/content', payload)
    setItems((prev) => [c, ...prev])
    toast('Task added — synced')
  }
  const addPersonal = async (payload) => {
    const p = await api.post('/personal', payload)
    setPersonal((prev) => [p, ...prev])
    toast('Personal task added — synced')
  }

  const updateContent = async (item, payload) => {
    const c = await api.patch(`/content/${item.id}`, payload)
    setItems((prev) => prev.map((x) => (x.id === item.id ? c : x)))
  }
  const updatePersonal = async (item, payload) => {
    const p = await api.patch(`/personal/${item.id}`, payload)
    setPersonal((prev) => prev.map((x) => (x.id === item.id ? p : x)))
  }
  const deletePersonal = async (item) => {
    await api.del(`/personal/${item.id}`)
    setPersonal((prev) => prev.filter((x) => x.id !== item.id))
  }
  const togglePin = async (item) => {
    try {
      const u = await api.patch(`${apiBase(item)}/${item.id}`, { pinned: !item.pinned })
      setList(item)((prev) => prev.map((x) => (x.id === item.id ? u : x)))
    } catch (e) { alert(e.message) }
  }
  // One click pulls an overdue task to today (the date that made it late).
  const rescheduleToday = async (item) => {
    const t = todayISO()
    const payload = item.personal
      ? { due_date: t }
      : item.release_date && item.release_date < t ? { release_date: t } : { recording_date: t }
    try {
      const u = await api.patch(`${apiBase(item)}/${item.id}`, payload)
      setList(item)((prev) => prev.map((x) => (x.id === item.id ? u : x)))
    } catch (e) { alert(e.message) }
  }
  const removeTask = async (item) => {
    if (!confirm(`Delete “${item.title}”?`)) return
    try {
      await api.del(`${apiBase(item)}/${item.id}`)
      setList(item)((prev) => prev.filter((x) => x.id !== item.id))
      toast('Task deleted')
    } catch (e) { alert(e.message) }
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setItems((prev) => prev.filter((x) => x.id !== item.id))
  }
  // One press spawns the recurring piece: brief, crew and platforms ride
  // along; dates, stage and delivery start clean.
  const duplicateTask = async (t) => {
    try {
      const u = await api.post('/content', {
        title: `${t.title} (copy)`,
        channels: t.channels, type: t.type,
        description: t.description || '',
        checklist: (t.checklist || []).map((c) => (typeof c === 'object' ? { ...c, done: false } : c)),
        reference_text: t.reference_text || null, reference_links: t.reference_links || [],
        format: t.format || null, rubrika: t.rubrika || null, script: t.script || null,
        operator_id: t.operator_id, editor_id: t.editor_id, designer_id: t.designer_id,
        campaign_id: t.campaign_id,
        ...(user.role === 'admin' ? { assignee_ids: t.assignees?.length ? t.assignees : t.assignee_id ? [t.assignee_id] : [] } : {}),
      })
      setItems((prev) => [u, ...prev])
      toast('Duplicated — brief kept, dates cleared')
    } catch (e) { alert(e.message) }
  }

  // Hooks stay above the loading gate — a context read after an early return
  // shifts the hook order on the loading→loaded flip.
  const { openMenu } = useContextMenu()

  // A task link (…/todo?task=123) opens that task once the list is in —
  // whether pasted into the address bar or reached from the bell while
  // already on this page (the search string keys the reaction).
  const linkOpened = useRef('')
  useEffect(() => {
    if (loading) return
    const id = Number(new URLSearchParams(location.search).get('task'))
    if (!id || linkOpened.current === location.search) return
    linkOpened.current = location.search
    const t = items.find((x) => x.id === id)
    if (t) setOpenItem(t)
    else toast('That task isn’t in your list — it may be deleted or off your channels', 'err')
  }, [loading, items, location.search]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const ctx = { user, byKey, teamById, toggle, togglePin, removeTask, rescheduleToday, duplicateTask, setOpenItem, dragKey, onDragOverRow, persistOrder, openMenu }
  const viewingMember = isAdmin && viewUser !== 'all' ? teamById[Number(viewUser)] : null

  return (
    <>
      {celebrate && <div className="celebrate"><PartyPopper size={18} /> Nice work!</div>}

      {/* One list per channel, plus your private Personal list */}
      <div className="pill-group" style={{ marginBottom: 14, alignItems: 'center' }}>
        <button className={'pill' + (chan === 'all' ? ' active' : '')} onClick={() => setChan('all')} data-tip="Every task you can see">All</button>
        {visible.length > 1 && visible.map((c) => (
          <button key={c.key} className={'pill' + (chan === c.key ? ' active' : '')} onClick={() => setChan(c.key)} data-tip={`Only ${c.label} tasks`}>{c.label}</button>
        ))}
        <button className={'pill' + (chan === 'personal' ? ' active' : '')} onClick={() => setChan('personal')} data-tip="Your private tasks — only you can see them">
          <Lock size={13} /> Personal
        </button>
        <span style={{ flex: 1 }} />
        {isAdmin && team.length > 1 && (
          <select
            className="select member-view"
            value={viewUser}
            onChange={(e) => setViewUser(e.target.value)}
            data-tip="Focus on one member's work tasks — new tasks go to them"
          >
            <option value="all">Everyone</option>
            {team.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === user.id ? ' (me)' : ''}</option>)}
          </select>
        )}
        <button className={'pill' + (mineOnly ? ' active' : '')} onClick={() => setMineOnly(!mineOnly)} data-tip="Show only tasks assigned to me" data-tip-left="">
          <UserRound size={13} /> Only mine
        </button>
      </div>

      {viewingMember && (
        <div className="member-banner">
          <UserRound size={13} /> Viewing {viewingMember.name}’s work tasks — anything you add below is assigned to them.
        </div>
      )}

      <QuickAdd
        visible={visible}
        canTeamAdd={canTeamAdd}
        isAdmin={isAdmin}
        team={team}
        chan={chan}
        viewUser={viewUser}
        onAddContent={addContent}
        onAddPersonal={addPersonal}
      />

      <Section label="Pinned" list={groups.pinned} icon={Pin} ctx={ctx} />
      <Section label="Overdue" list={groups.overdue} tone="var(--critical)" ctx={ctx} />
      <Section label="Today" list={groups.today} ctx={ctx} />
      <Section label="Next 7 days" list={groups.week} ctx={ctx} />
      <Section label="Later" list={groups.later} ctx={ctx} />
      <Section label="Done" list={groups.done} ctx={ctx} />

      {filtered.length === 0 && (
        <div className="card card-pad empty">
          {chan === 'personal'
            ? 'Your personal tasks live here — only you can see them.'
            : viewingMember
              ? `${viewingMember.name} has no assigned tasks yet — add the day's tasks above.`
              : `Tasks for ${chan === 'all' ? 'your channels' : byKey[chan]?.label || 'this channel'} will appear here.`}
        </div>
      )}

      {openItem && (openItem.personal ? (
        <PersonalModal
          item={openItem}
          onClose={() => setOpenItem(null)}
          onSave={updatePersonal}
          onDelete={deletePersonal}
        />
      ) : (
        <ContentModal
          item={openItem}
          statuses={statuses}
          onClose={() => setOpenItem(null)}
          onCreate={addContent}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      ))}
    </>
  )
}
