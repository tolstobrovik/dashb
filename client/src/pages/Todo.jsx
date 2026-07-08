import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Check, PartyPopper, Clapperboard, Send, GripVertical } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { playDing } from '../lib/sound.js'
import { todayISO, dateLabel, addDaysISO, can, CONTENT_TYPES, typeInfo } from '../lib/constants.js'
import ContentModal from '../components/ContentModal.jsx'

// To-Do: every channel has its own list — you see the channels you belong to.
// Checking a task off completes it (same as dragging to the final stage) and
// fills the channel plan; drag rows to put them in your own order.
export default function Todo() {
  const { user } = useAuth()
  const { visible, byKey } = useChannels()
  const [items, setItems] = useState([])
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [openItem, setOpenItem] = useState(null)
  const [celebrate, setCelebrate] = useState(false)
  const [chan, setChan] = useState('all')
  const dragId = useRef(null)

  // quick add
  const [title, setTitle] = useState('')
  const [channel, setChannel] = useState('')
  const [type, setType] = useState('post')
  const [date, setDate] = useState(todayISO())

  useEffect(() => {
    Promise.all([api.get('/content'), api.get('/statuses')])
      .then(([ct, st]) => { setItems(ct); setStatuses(st) })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { if (!channel && visible[0]) setChannel(visible[0].key) }, [visible, channel])

  const filtered = useMemo(
    () => (chan === 'all' ? items : items.filter((i) => i.channels.includes(chan))),
    [items, chan],
  )

  const dateOf = (it) => it.release_date || it.recording_date || null
  const groups = useMemo(() => {
    const t = todayISO()
    const week = addDaysISO(t, 7)
    const open = filtered.filter((i) => !i.done_at)
    return {
      overdue: open.filter((i) => dateOf(i) && dateOf(i) < t),
      today: open.filter((i) => dateOf(i) === t),
      week: open.filter((i) => dateOf(i) > t && dateOf(i) <= week),
      later: open.filter((i) => !dateOf(i) || dateOf(i) > week),
      done: filtered.filter((i) => i.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 8),
    }
  }, [filtered])

  const toggle = async (item) => {
    const marking = !item.done_at
    try {
      const updated = await api.patch(`/content/${item.id}`, { done: marking })
      setItems((prev) => prev.map((x) => (x.id === item.id ? updated : x)))
      if (marking) {
        playDing()
        setCelebrate(true)
        setTimeout(() => setCelebrate(false), 1200)
      }
    } catch (e) { alert(e.message) }
  }

  // ---- drag to reorder ----
  const onDragOverRow = (overId) => {
    const from = dragId.current
    if (from === null || from === overId) return
    setItems((prev) => {
      const i = prev.findIndex((x) => x.id === from)
      const j = prev.findIndex((x) => x.id === overId)
      if (i < 0 || j < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(i, 1)
      next.splice(j, 0, moved)
      return next
    })
  }
  const persistOrder = () => {
    dragId.current = null
    api.post('/content/todo-reorder', { ids: items.map((i) => i.id) }).catch(() => {})
  }

  const quickAdd = async (e) => {
    e.preventDefault()
    if (!title.trim() || !channel) return
    try {
      const c = await api.post('/content', { title: title.trim(), channels: [channel], type, release_date: date })
      setItems((prev) => [c, ...prev])
      setTitle('')
    } catch (e2) { alert(e2.message) }
  }

  const updateContent = async (item, payload) => {
    const c = await api.patch(`/content/${item.id}`, payload)
    setItems((prev) => prev.map((x) => (x.id === item.id ? c : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setItems((prev) => prev.filter((x) => x.id !== item.id))
  }
  const createContent = async (payload) => {
    const c = await api.post('/content', payload)
    setItems((prev) => [c, ...prev])
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const Row = ({ item }) => {
    const isDone = !!item.done_at
    return (
      <div
        className="todo-row"
        draggable={!isDone}
        onDragStart={() => { dragId.current = item.id }}
        onDragOver={(e) => { e.preventDefault(); onDragOverRow(item.id) }}
        onDragEnd={persistOrder}
      >
        {!isDone && <span className="todo-grip" title="Drag to reorder"><GripVertical size={14} /></span>}
        <button className={`todo-check${isDone ? ' on' : ''}`} onClick={() => toggle(item)} aria-label="Complete">
          {isDone && <Check size={15} strokeWidth={3.5} />}
        </button>
        <button className="todo-main" onClick={() => setOpenItem(item)}>
          <span className={`todo-title${isDone ? ' done-txt' : ''}`}>{item.title}</span>
          <span className="todo-meta">
            <span className={`chip ct-${item.type}`}>{typeInfo(item.type).label}</span>
            {item.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
            {item.recording_date && <span className="chip chip-muted"><Clapperboard size={10} /> {dateLabel(item.recording_date)}</span>}
            {item.release_date && <span className="chip chip-muted"><Send size={10} /> {dateLabel(item.release_date)}</span>}
          </span>
        </button>
      </div>
    )
  }

  const Section = ({ label, list, tone }) => (
    list.length > 0 && (
      <div>
        <div className="section-head"><h2 style={tone ? { color: tone } : undefined}>{label}</h2><span className="count">· {list.length}</span></div>
        <div className="card" style={{ padding: '4px 14px' }}>
          {list.map((i) => <Row key={i.id} item={i} />)}
        </div>
      </div>
    )
  )

  return (
    <>
      {celebrate && <div className="celebrate"><PartyPopper size={18} /> Nice work!</div>}

      {/* One list per channel */}
      {visible.length > 1 && (
        <div className="pill-group" style={{ marginBottom: 14 }}>
          <button className={'pill' + (chan === 'all' ? ' active' : '')} onClick={() => setChan('all')}>All</button>
          {visible.map((c) => (
            <button key={c.key} className={'pill' + (chan === c.key ? ' active' : '')} onClick={() => setChan(c.key)}>{c.label}</button>
          ))}
        </div>
      )}

      {can(user, 'manage_content') && (
        <form className="card card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }} onSubmit={quickAdd}>
          <input className="input" style={{ flex: '2 1 200px' }} placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className="select" style={{ flex: '0 1 110px' }} value={type} onChange={(e) => setType(e.target.value)}>
            {CONTENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <select className="select" style={{ flex: '1 1 140px' }} value={channel} onChange={(e) => setChannel(e.target.value)}>
            {visible.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <input className="input" type="date" style={{ flex: '0 1 150px' }} value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn btn-primary" type="submit"><Plus size={16} /> Add</button>
        </form>
      )}

      <Section label="Overdue" list={groups.overdue} tone="var(--critical)" />
      <Section label="Today" list={groups.today} />
      <Section label="Next 7 days" list={groups.week} />
      <Section label="Later" list={groups.later} />
      <Section label="Done" list={groups.done} />

      {filtered.length === 0 && <div className="card card-pad empty">Tasks for {chan === 'all' ? 'your channels' : byKey[chan]?.label || 'this channel'} will appear here.</div>}

      {openItem && (
        <ContentModal
          item={openItem}
          statuses={statuses}
          onClose={() => setOpenItem(null)}
          onCreate={createContent}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
    </>
  )
}
