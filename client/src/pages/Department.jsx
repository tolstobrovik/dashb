import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Lock, Plus, Pencil, Trash2, Gauge, CalendarRange, AlertCircle, Pin, PinOff, GripVertical, Minus,
  KanbanSquare, Send, Clapperboard, LineChart,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { CADENCES, can } from '../lib/constants.js'
import Meter from '../components/Meter.jsx'
import Modal from '../components/Modal.jsx'
import ContentBoard from '../components/ContentBoard.jsx'
import ContentCalendar from '../components/ContentCalendar.jsx'
import ContentModal from '../components/ContentModal.jsx'
import DayAgenda from '../components/DayAgenda.jsx'
import CompareCard from '../components/CompareCard.jsx'

const BLANK_METRIC = { label: '', current: 0, target: 100, unit: '', period: 'monthly', content_type: '' }
const FILL_MODES = [
  { key: '', label: 'Manually (+/−)' },
  { key: 'post', label: 'From Post tasks' },
  { key: 'reel', label: 'From Reel tasks' },
  { key: 'story', label: 'From Story tasks' },
  { key: 'video', label: 'From Video tasks' },
]

export default function Department() {
  const { key } = useParams()
  const { user } = useAuth()
  const { byKey, channels } = useChannels()
  const dept = byKey[key]
  const hasAccess = user.role === 'admin' || user.departments.includes(key)

  const editValues = can(user, 'edit_metrics')
  const manageMetrics = can(user, 'manage_metrics')
  const manageLayout = can(user, 'manage_layout')
  const manageContent = can(user, 'manage_content')
  const moveTasks = can(user, 'move_tasks')

  const [trackers, setTrackers] = useState([])
  const [history, setHistory] = useState([])
  const [content, setContent] = useState([])
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)

  const [metric, setMetric] = useState(null)
  const [err, setErr] = useState('')
  const [dragIdx, setDragIdx] = useState(null)
  const [view, setView] = useState('board') // board | release | recording
  const [selectedDate, setSelectedDate] = useState(null)
  const [openItem, setOpenItem] = useState(null) // content item or 'new'
  const [newDefaults, setNewDefaults] = useState({})

  useEffect(() => {
    if (!dept || !hasAccess) { setLoading(false); return }
    setLoading(true)
    setSelectedDate(null)
    Promise.all([
      api.get(`/trackers?department=${key}`),
      api.get(`/trackers/history?department=${key}`),
      api.get(`/content?department=${key}`),
      api.get('/statuses'),
    ])
      .then(([tr, hist, ct, st]) => {
        setTrackers(tr); setHistory(hist); setContent(ct); setStatuses(st)
      })
      .finally(() => setLoading(false))
  }, [key, dept, hasAccess])

  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  const pinned = trackers.filter((t) => t.is_primary)
  const gridMetrics = trackers.filter((t) => !t.is_primary)

  // ---- metrics ----
  const step = async (t, delta) => {
    try {
      const u = await api.patch(`/trackers/${t.id}`, { current: Math.max(0, t.current + delta) })
      setTrackers((prev) => prev.map((x) => (x.id === t.id ? u : x)))
      api.get(`/trackers/history?department=${key}`).then(setHistory).catch(() => {})
    } catch (e) { alert(e.message) }
  }
  const setPin = async (t, on) => {
    try {
      const u = await api.patch(`/trackers/${t.id}`, { is_primary: on ? 1 : 0 })
      setTrackers((prev) => prev.map((x) => (x.id === t.id ? u : x)))
    } catch (e) { alert(e.message) }
  }
  const onDragOver = (overIdx) => {
    if (dragIdx === null || dragIdx === overIdx) return
    const grid = trackers.filter((t) => !t.is_primary)
    const [moved] = grid.splice(dragIdx, 1)
    grid.splice(overIdx, 0, moved)
    setTrackers([...trackers.filter((t) => t.is_primary), ...grid])
    setDragIdx(overIdx)
  }
  const persistOrder = async () => {
    setDragIdx(null)
    try { await api.post('/trackers/reorder', { department: key, ids: trackers.map((t) => t.id) }) } catch { /* ignore */ }
  }
  const openMetric = (t) => {
    setMetric(t
      ? { id: t.id, label: t.label, current: t.current, target: t.target, unit: t.unit, period: t.period, content_type: t.content_type || '' }
      : { ...BLANK_METRIC })
    setErr('')
  }
  const saveMetric = async () => {
    setErr('')
    try {
      if (metric.id) {
        const body = manageMetrics
          ? { label: metric.label.trim(), current: Number(metric.current), target: Number(metric.target), unit: metric.unit, period: metric.period, content_type: metric.content_type || null }
          : { current: Number(metric.current) }
        const u = await api.patch(`/trackers/${metric.id}`, body)
        setTrackers((prev) => prev.map((x) => (x.id === metric.id ? u : x)))
      } else {
        if (!metric.label.trim()) return
        const u = await api.post('/trackers', { department: key, label: metric.label.trim(), current: Number(metric.current), target: Number(metric.target), unit: metric.unit, period: metric.period, content_type: metric.content_type || null })
        setTrackers((prev) => [...prev, u])
      }
      setMetric(null)
    } catch (e) { setErr(e.message) }
  }
  const delMetric = async () => {
    try { await api.del(`/trackers/${metric.id}`); setTrackers((prev) => prev.filter((x) => x.id !== metric.id)); setMetric(null) }
    catch (e) { setErr(e.message) }
  }

  // ---- content ----
  const refreshTrackers = () => {
    api.get(`/trackers?department=${key}`).then(setTrackers).catch(() => {})
    api.get(`/trackers/history?department=${key}`).then(setHistory).catch(() => {})
  }
  const createContent = async (payload) => {
    const c = await api.post('/content', payload)
    setContent((prev) => [c, ...prev].filter((x) => x.channels.includes(key)))
    refreshTrackers() // a new task raises this channel's plan
  }
  const updateContent = async (item, payload) => {
    const c = await api.patch(`/content/${item.id}`, payload)
    setContent((prev) => prev.map((x) => (x.id === item.id ? c : x)).filter((x) => x.channels.includes(key)))
    refreshTrackers() // completing / moving a task changes the plan numbers
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
    refreshTrackers() // deleting a task lowers the plan again
  }
  const moveStatus = (item, statusId) => updateContent(item, { status_id: statusId }).catch((e) => alert(e.message))
  const moveDate = (item, field, iso) => updateContent(item, { [field]: iso }).catch((e) => alert(e.message))

  if (channels.length === 0 || loading) return <div className="app-loading"><span className="spinner" /></div>
  if (!dept) return <div className="empty">Unknown channel.</div>
  if (!hasAccess)
    return (
      <div className="card card-pad empty">
        <Lock size={30} />
        <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>You don&apos;t have access to this channel.</div>
      </div>
    )

  const VIEWS = [
    { key: 'board', label: 'Board', icon: KanbanSquare },
    { key: 'release', label: 'Releases', icon: Send },
    { key: 'recording', label: 'Recording', icon: Clapperboard },
  ]

  return (
    <>
      {/* Pinned metrics — the channel's headline numbers */}
      {pinned.length > 0 && (
        <div className="pinned-grid">
          {pinned.map((t) => {
            const pct = Math.min(100, Math.round((t.current / Math.max(1, t.target)) * 100))
            return (
              <div className="card hero-metric card-pad" key={t.id}>
                <div className="hm-top">
                  <span className="hm-label"><Pin size={13} /> {t.label}</span>
                  {manageLayout && (
                    <button className="icon-btn hm-unpin" title="Unpin" onClick={() => setPin(t, false)} aria-label="Unpin">
                      <PinOff size={15} />
                    </button>
                  )}
                </div>
                <div className="hm-value">
                  {t.current.toLocaleString()}
                  <span className="hm-target"> / {t.target.toLocaleString()}{t.unit ? ` ${t.unit}` : ''}</span>
                </div>
                <div className="meter-track" style={{ height: 12 }}>
                  <div className="meter-fill" style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--good)' : 'var(--brand-500)' }} />
                </div>
                <div className="hm-foot">
                  <span className={`hm-pct${pct >= 100 ? ' done' : ''}`}>{pct}% of {t.content_type ? 'plan' : 'target'}</span>
                  {t.content_type ? (
                    <span className="hm-auto" title="Fills when tasks reach the final stage">from tasks</span>
                  ) : editValues && (
                    <div className="meter-adjust">
                      <button className="step-btn" onClick={() => step(t, -1)} disabled={t.current <= 0} aria-label="Decrease"><Minus size={15} /></button>
                      <button className="step-btn" onClick={() => step(t, 1)} aria-label="Increase"><Plus size={15} /></button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Metrics grid */}
      <div className="section-head">
        <Gauge size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>Metrics</h2>
        <span className="spacer" />
        {manageMetrics && <button className="btn btn-primary btn-sm" onClick={() => openMetric(null)}><Plus size={15} /> Add metric</button>}
      </div>
      {gridMetrics.length === 0 ? (
        <div className="card card-pad empty">{pinned.length > 0 ? 'All metrics are pinned above.' : 'No metrics yet.'}</div>
      ) : (
        <div className="grid grid-auto">
          {gridMetrics.map((t, i) => (
            <div
              className={`card card-pad metric-card${dragIdx === i ? ' dragging' : ''}`}
              key={t.id}
              draggable={manageLayout}
              onDragStart={() => manageLayout && setDragIdx(i)}
              onDragOver={(e) => { if (manageLayout) { e.preventDefault(); onDragOver(i) } }}
              onDragEnd={persistOrder}
            >
              {(manageLayout || manageMetrics || editValues) && (
                <div className="metric-top">
                  {manageLayout && <span className="drag-handle" title="Drag to reorder"><GripVertical size={15} /></span>}
                  <span className="spacer" />
                  {manageLayout && (
                    <button className="icon-btn" title="Pin to the top" onClick={() => setPin(t, true)} aria-label="Pin"><Pin size={14} /></button>
                  )}
                  {(editValues || manageMetrics) && (
                    <button className="icon-btn" title={manageMetrics ? 'Edit metric' : 'Update value'} onClick={() => openMetric(t)} aria-label="Edit"><Pencil size={14} /></button>
                  )}
                </div>
              )}
              <Meter label={t.label} current={t.current} target={t.target} unit={t.unit} period={t.period}
                auto={!!t.content_type} canEdit={editValues && !t.content_type} onStep={(d) => step(t, d)} />
            </div>
          ))}
        </div>
      )}

      {/* Growth comparison */}
      <div className="section-head">
        <LineChart size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>Growth</h2>
      </div>
      <CompareCard trackers={trackers} history={history} />

      {/* Content workspace */}
      <div className="section-head">
        <CalendarRange size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>Content</h2>
        <span className="spacer" />
        <div className="pill-group">
          {VIEWS.map((v) => {
            const Icon = v.icon
            return (
              <button key={v.key} className={'pill' + (view === v.key && !selectedDate ? ' active' : '')}
                onClick={() => { setView(v.key); setSelectedDate(null) }}>
                <Icon size={14} /> {v.label}
              </button>
            )
          })}
        </div>
        {manageContent && (
          <button className="btn btn-primary btn-sm" onClick={() => { setNewDefaults({ channels: [key] }); setOpenItem('new') }}>
            <Plus size={15} /> New task
          </button>
        )}
      </div>

      {selectedDate ? (
        <DayAgenda
          date={selectedDate}
          items={content}
          statusesById={statusesById}
          canEdit={manageContent}
          onOpen={setOpenItem}
          onAdd={(iso) => {
            setNewDefaults({ channels: [key], [view === 'recording' ? 'recording_date' : 'release_date']: iso })
            setOpenItem('new')
          }}
          onBack={() => setSelectedDate(null)}
        />
      ) : view === 'board' ? (
        <ContentBoard items={content} statuses={statuses} dept={key} canMove={moveTasks} onMove={moveStatus} onOpen={setOpenItem} />
      ) : (
        <ContentCalendar items={content} mode={view} canMove={moveTasks} onMoveDate={moveDate} onDayClick={setSelectedDate} />
      )}

      {/* Metric modal */}
      {metric && (
        <Modal
          title={metric.id ? (manageMetrics ? 'Edit metric' : 'Update value') : 'Add metric'}
          onClose={() => setMetric(null)}
          footer={<>
            {metric.id && manageMetrics && <button className="btn btn-danger" onClick={delMetric}><Trash2 size={15} /> Delete</button>}
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={() => setMetric(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveMetric}>{metric.id ? 'Save' : 'Add'}</button>
          </>}
        >
          {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
          {manageMetrics ? (
            <>
              <div className="field"><label>Name</label><input className="input" autoFocus value={metric.label} onChange={(e) => setMetric({ ...metric, label: e.target.value })} placeholder="e.g. Reels" /></div>
              <div className="field"><label>How it fills</label>
                <select className="select" value={metric.content_type} onChange={(e) => setMetric({ ...metric, content_type: e.target.value })}>
                  {FILL_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
                {metric.content_type && <span className="field-hint">New tasks raise the plan; completed tasks fill it.</span>}
              </div>
              <div className="grid grid-3" style={{ gap: 12 }}>
                <div className="field"><label>Current</label>
                  <input className="input" type="number" min="0" disabled={!!metric.content_type && user.role !== 'admin'}
                    value={metric.current} onChange={(e) => setMetric({ ...metric, current: e.target.value })} />
                </div>
                <div className="field"><label>{metric.content_type ? 'Plan' : 'Target'}</label><input className="input" type="number" min="1" value={metric.target} onChange={(e) => setMetric({ ...metric, target: e.target.value })} /></div>
                <div className="field"><label>Unit</label><input className="input" value={metric.unit} onChange={(e) => setMetric({ ...metric, unit: e.target.value })} placeholder="reels" /></div>
              </div>
              <div className="field"><label>Period</label>
                <select className="select" value={metric.period} onChange={(e) => setMetric({ ...metric, period: e.target.value })}>
                  {CADENCES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
            </>
          ) : (
            <div className="field"><label>{metric.label} — current value</label><input className="input" type="number" min="0" autoFocus value={metric.current} onChange={(e) => setMetric({ ...metric, current: e.target.value })} /></div>
          )}
        </Modal>
      )}

      {/* Content modal */}
      {openItem && (
        <ContentModal
          item={openItem === 'new' ? null : openItem}
          statuses={statuses}
          defaults={newDefaults}
          onClose={() => setOpenItem(null)}
          onCreate={createContent}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
    </>
  )
}
