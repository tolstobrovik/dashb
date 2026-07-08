import { useState } from 'react'
import {
  Trash2, Plus, Check, AlertCircle, ImagePlus, X, Clapperboard, Send,
  AlignLeft, CheckSquare,
} from 'lucide-react'
import Modal from './Modal.jsx'
import { can, todayISO, addDaysISO, CONTENT_TYPES, typeInfo } from '../lib/constants.js'
import { useChannels } from '../lib/channels.jsx'
import { useAuth } from '../lib/auth.jsx'

// Task editor — used from the board, both calendars, the to-do list and the
// admin panel. Deliberately small: title → stage → type → platforms → dates.
export default function ContentModal({ item, statuses, defaults = {}, onClose, onCreate, onUpdate, onDelete }) {
  const { user } = useAuth()
  const { visible } = useChannels()
  const creating = !item
  const [err, setErr] = useState('')
  const [subText, setSubText] = useState('')
  const [form, setForm] = useState(() => ({
    title: item?.title || '',
    channels: item?.channels?.length ? [...item.channels] : (defaults.channels || (visible[0] ? [visible[0].key] : [])),
    type: item?.type || defaults.type || 'post',
    status_id: item?.status_id || statuses[0]?.id || null,
    recording_date: item?.recording_date || defaults.recording_date || '',
    recording_time: item?.recording_time || '',
    release_date: item?.release_date || defaults.release_date || '',
    release_time: item?.release_time || '',
    description: item?.description || '',
    photo: item?.photo || null,
    checklist: item?.checklist ? [...item.checklist] : [],
  }))
  // Extras stay hidden until asked for — the common case is a quick add.
  const [show, setShow] = useState(() => ({
    description: !!item?.description,
    photo: !!item?.photo,
    checklist: (item?.checklist?.length || 0) > 0,
  }))

  const canEdit = can(user, 'manage_content')
  const canMove = can(user, 'move_tasks')
  const isMine = item?.assignee_id === user.id
  const readOnly = !creating && !canEdit && !isMine

  const plan = typeInfo(form.type).plan

  const toggleChannel = (key) =>
    setForm((f) => {
      const on = f.channels.includes(key)
      if (on && f.channels.length === 1) return f // always at least one platform
      return { ...f, channels: on ? f.channels.filter((c) => c !== key) : [...f.channels, key] }
    })

  const pickPhoto = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 3 * 1024 * 1024) { setErr('Image is too large — keep it under 3 MB'); return }
    const reader = new FileReader()
    reader.onload = () => setForm((f) => ({ ...f, photo: reader.result }))
    reader.readAsDataURL(file)
  }

  const addCheck = () => {
    if (!subText.trim()) return
    setForm((f) => ({ ...f, checklist: [...f.checklist, { text: subText.trim(), done: false }] }))
    setSubText('')
  }
  const toggleCheck = (i) =>
    setForm((f) => ({ ...f, checklist: f.checklist.map((c, j) => (j === i ? { ...c, done: !c.done } : c)) }))
  const removeCheck = (i) =>
    setForm((f) => ({ ...f, checklist: f.checklist.filter((_, j) => j !== i) }))

  const save = async () => {
    if (!form.title.trim()) return
    setErr('')
    const payload = {
      ...form,
      title: form.title.trim(),
      recording_date: form.recording_date || null,
      recording_time: form.recording_time || null,
      release_date: form.release_date || null,
      release_time: form.release_time || null,
    }
    try {
      if (creating) await onCreate(payload)
      else await onUpdate(item, payload)
      onClose()
    } catch (e) { setErr(e.message) }
  }
  const del = async () => {
    if (!confirm('Delete this task?')) return
    try { await onDelete(item); onClose() } catch (e) { setErr(e.message) }
  }

  const DateRow = ({ icon: Icon, label, dateKey, timeKey }) => (
    <div className="drow">
      <span className="drow-label"><Icon size={14} /> {label}</span>
      <input className="input" type="date" disabled={readOnly} value={form[dateKey]}
        onChange={(e) => setForm({ ...form, [dateKey]: e.target.value })} />
      <input className="input" type="time" disabled={readOnly} value={form[timeKey]}
        onChange={(e) => setForm({ ...form, [timeKey]: e.target.value })} />
      {!readOnly && (
        <span className="drow-quick">
          <button type="button" className="qbtn" onClick={() => setForm({ ...form, [dateKey]: todayISO() })}>Today</button>
          <button type="button" className="qbtn" onClick={() => setForm({ ...form, [dateKey]: addDaysISO(todayISO(), 1) })}>Tomorrow</button>
          {form[dateKey] && <button type="button" className="qbtn" onClick={() => setForm({ ...form, [dateKey]: '', [timeKey]: '' })} aria-label="Clear date">✕</button>}
        </span>
      )}
    </div>
  )

  return (
    <Modal
      wide
      title={creating ? 'New task' : 'Task'}
      onClose={onClose}
      footer={<>
        {!creating && canEdit && <button className="btn btn-danger" onClick={del}><Trash2 size={15} /> Delete</button>}
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Cancel</button>
        {!readOnly && (
          <button className="btn btn-primary" onClick={save} disabled={!form.title.trim()}>
            {creating ? 'Create task' : 'Save changes'}
          </button>
        )}
      </>}
    >
      {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}

      {/* Big, calm title — the first thing you type */}
      <input
        className="cm-title"
        autoFocus={creating}
        disabled={readOnly}
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') save() }}
        placeholder="Task title"
      />

      {/* Stage — the pipeline, in its own colours */}
      <div className="cm-row">
        <span className="cm-key">Stage</span>
        <div className="stage-chips">
          {statuses.map((s) => {
            const active = form.status_id === s.id
            const locked = !creating && !canMove
            return (
              <button
                key={s.id}
                type="button"
                className={'stage-chip' + (active ? ' on' : '')}
                disabled={locked && !active}
                style={active ? { background: `${s.color}1f`, borderColor: s.color, color: s.color } : undefined}
                onClick={() => !locked && setForm({ ...form, status_id: s.id })}
              >
                <span className="status-dot" style={{ background: s.color }} />
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* What is it? The type binds the task to each platform's plan. */}
      <div className="cm-row">
        <span className="cm-key">Type</span>
        <div className="stage-chips">
          {CONTENT_TYPES.map((t) => {
            const Icon = t.icon
            return (
              <button key={t.key} type="button" disabled={readOnly}
                className={`tchip ct-${t.key}` + (form.type === t.key ? ' on' : '')}
                onClick={() => setForm({ ...form, type: t.key })}>
                <Icon size={13} /> {t.label}
              </button>
            )
          })}
        </div>
      </div>
      {creating && plan && (
        <div className="cm-hint">Raises the {plan} plan by one — completing the task fills it.</div>
      )}

      {/* Platforms — a task can go out on several at once */}
      <div className="cm-row">
        <span className="cm-key">Platforms</span>
        <div className="checkbox-row">
          {visible.map((c) => (
            <label key={c.key} className={'checkbox-chip chip-sm' + (form.channels.includes(c.key) ? ' on' : '')}>
              <input type="checkbox" disabled={readOnly} checked={form.channels.includes(c.key)} onChange={() => toggleChannel(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      {/* Dates */}
      <div className="dates-block">
        <DateRow icon={Clapperboard} label="Shoot" dateKey="recording_date" timeKey="recording_time" />
        <DateRow icon={Send} label="Release" dateKey="release_date" timeKey="release_time" />
      </div>

      {/* Extras appear only when wanted */}
      {!readOnly && (!show.description || !show.photo || !show.checklist) && (
        <div className="extra-btns">
          {!show.description && <button type="button" className="extra-btn" onClick={() => setShow({ ...show, description: true })}><AlignLeft size={14} /> Description</button>}
          {!show.photo && <button type="button" className="extra-btn" onClick={() => setShow({ ...show, photo: true })}><ImagePlus size={14} /> Photo</button>}
          {!show.checklist && <button type="button" className="extra-btn" onClick={() => setShow({ ...show, checklist: true })}><CheckSquare size={14} /> Checklist</button>}
        </div>
      )}

      {show.description && (
        <div className="field">
          <label>Description</label>
          <textarea className="input" rows={2} disabled={readOnly} autoFocus={!form.description} value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="References, links, notes…" />
        </div>
      )}

      {show.photo && (
        <div className="field">
          <label>Photo</label>
          {form.photo ? (
            <div className="photo-wrap">
              <img src={form.photo} alt="attachment" />
              {!readOnly && <button className="photo-remove" onClick={() => setForm({ ...form, photo: null })} aria-label="Remove photo"><X size={14} /></button>}
            </div>
          ) : (
            <label className="photo-pick">
              <ImagePlus size={16} /> Attach an image
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pickPhoto} />
            </label>
          )}
        </div>
      )}

      {show.checklist && (
        <div className="field">
          <label>Checklist{form.checklist.length > 0 ? ` · ${form.checklist.filter((c) => c.done).length}/${form.checklist.length}` : ''}</label>
          <div className="subtask-list">
            {form.checklist.map((c, i) => (
              <div key={i} className="subtask-row">
                <button className={`mini-check${c.done ? ' on' : ''}`} onClick={() => toggleCheck(i)}>
                  {c.done && <Check size={12} strokeWidth={3} />}
                </button>
                <span className={c.done ? 'done-txt' : ''} style={{ flex: 1 }}>{c.text}</span>
                {!readOnly && <button className="icon-btn" style={{ padding: 2 }} onClick={() => removeCheck(i)} aria-label="Remove"><X size={13} /></button>}
              </div>
            ))}
          </div>
          {!readOnly && (
            <div className="add-inline" style={{ padding: '6px 0 0' }}>
              <input className="input" value={subText} onChange={(e) => setSubText(e.target.value)}
                placeholder="Add an item, press Enter…" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCheck() } }} />
              <button className="btn btn-sm" onClick={addCheck}><Plus size={14} /></button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
