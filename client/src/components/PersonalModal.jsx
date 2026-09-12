import { useState } from 'react'
import { AlertCircle, Lock, Trash2 } from 'lucide-react'
import Modal from './Modal.jsx'

// Editor for a personal task: title, due date, note. Deliberately lightweight —
// personal tasks have no pipeline stage, channel, type or photo.
export default function PersonalModal({ item, onClose, onSave, onDelete }) {
  const [title, setTitle] = useState(item.title)
  const [date, setDate] = useState(item.due_date || '')
  const [note, setNote] = useState(item.note || '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (e) => {
    e?.preventDefault()
    if (busy) return
    if (!title.trim()) { setErr('Give the task a title'); return }
    setBusy(true)
    try {
      await onSave(item, { title: title.trim(), due_date: date || null, note })
      onClose()
    } catch (e2) {
      setErr(e2.message)
      setBusy(false)
    }
  }

  const del = async () => {
    if (busy || !confirm(`Delete “${item.title}”?`)) return
    setBusy(true)
    try {
      await onDelete(item)
      onClose()
    } catch (e2) {
      setErr(e2.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Personal task"
      onClose={onClose}
      footer={<>
        <button className="btn btn-danger" onClick={del} disabled={busy}><Trash2 size={15} /> Delete</button>
        <span className="foot-gap" />
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </>}
    >
      {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
      <div className="personal-hint"><Lock size={12} /> Only you can see this task.</div>
      <form onSubmit={save}>
        <div className="field">
          <label>Title</label>
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Due date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Note</label>
          <textarea className="input" rows={3} placeholder="Anything to remember…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {/* Enter in the title field saves */}
        <button type="submit" style={{ display: 'none' }} aria-hidden="true" />
      </form>
    </Modal>
  )
}
