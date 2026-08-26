import { useState } from 'react'
import { playTick } from '../lib/sound.js'
import { Check, X, Plus, ImagePlus } from 'lucide-react'
import { dateLabel, todayISO } from '../lib/constants.js'
import Zoom from './Zoom.jsx'

// Browser-side downscale for cover photos: main ≤1000px, thumbnail ≤160px.
export function scalePhoto(file, maxW, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxW / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * ratio)
        canvas.height = Math.round(img.height * ratio)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      } catch (e) { reject(e) } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })
}

// Cover-photo field for project & campaign forms.
export function PhotoField({ photo, onChange }) {
  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { alert('Image is too large — keep it under 15 MB'); return }
    try {
      const [main, thumb] = await Promise.all([scalePhoto(file, 1000, 0.82), scalePhoto(file, 160, 0.72)])
      onChange({ photo: main, photo_thumb: thumb })
    } catch (err) { alert(err.message) }
  }
  return (
    <div className="field">
      <label>Cover photo <span className="stat-sub">(optional)</span></label>
      {photo ? (
        <div className="photo-wrap">
          <img src={photo} alt="cover" />
          <button type="button" className="photo-remove" data-tip="Remove the photo" data-tip-left=""
            onClick={() => onChange({ photo: null, photo_thumb: null })} aria-label="Remove photo"><X size={14} /></button>
        </div>
      ) : (
        <label className="photo-pick">
          <ImagePlus size={16} /> Attach an image
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
        </label>
      )}
    </div>
  )
}

// Shared pieces for Projects & Campaigns. Spec colors, solid fills only:
// green #1D9E75, amber #BA7517, red #A32D2D, track #F1EFE8.
export const PC = { green: '#1D9E75', amber: '#BA7517', red: '#A32D2D', blue: '#2a78d6', track: '#F1EFE8', ink: '#26222b' }

const STATUS_COLORS = {
  // done/closed wear a readable slate, not near-black ink — it must survive dark mode
  idea: '#6d6a70', incoming: '#2a78d6', live: PC.green, blocked: PC.red, done: '#5a5560',
  active: PC.green, paused: PC.amber, closed: '#5a5560',
}
const STATUS_LABELS = {
  idea: 'Idea', incoming: 'Incoming', live: 'Live', blocked: 'Blocked', done: 'Done',
  active: 'Active', paused: 'Paused', closed: 'Closed',
}

export function StatusBadge({ status }) {
  return (
    <span className="pc-badge" style={{ background: STATUS_COLORS[status] || '#6d6a70' }}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

// A colour on its own makes you hover to find out what is wrong, and a word
// like "red" only names the colour again. The state is said in words, and the
// reason stands next to it — that sentence is the entire point of the column.
const HEALTH_WORD = {
  red: 'Needs you', amber: 'Slipping', green: 'On track', done: 'Done', idle: 'Not started',
}
export function HealthPill({ health, reason, withReason = false }) {
  const word = HEALTH_WORD[health] || health
  const pill = (
    <span className={`pc-badge pc-badge-${health}`} style={{ background: PC[health] || PC.red }}
      {...(reason && !withReason ? { 'data-tip': reason, 'data-tip-left': '' } : {})}>
      {word}
    </span>
  )
  if (!withReason) return pill
  return (
    <span className="pc-health">
      {pill}
      {reason && <span className="pc-health-why">{reason}</span>}
    </span>
  )
}

// Progress track with a time tick: fill = share of target hit, tick = share
// of time elapsed. Fill behind the tick means behind pace.
export function PaceBar({ pace, height = 10 }) {
  if (!pace) return null
  return (
    <div className="pace-track" style={{ height }}>
      <div className="pace-fill" style={{ width: `${pace.fill_pct}%`, background: pace.behind ? PC.amber : PC.green }} />
      <div className="pace-tick" style={{ left: `${pace.time_pct}%` }} />
    </div>
  )
}

// Plain progress bar (projects: actual vs target, checklists: done vs total).
export function PlainBar({ pct, color = PC.green, height = 10 }) {
  return (
    <div className="pace-track" style={{ height }}>
      <div className="pace-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  )
}

// The checklist: text, owner, due date, done. Click an item's text to edit
// it in place; the × removes it — a to-do list in miniature. `canTick` and
// `canEditItems` split rights: owners tick their steps, admins shape the
// list. Overdue dates show red; unowned items a red dash.
export function PcChecklist({ items, team = [], canEdit, canTick, canEditItems, onChange, compact = false }) {
  // Back-compat: old callers pass a single canEdit meaning "everything".
  const tick = canTick ?? canEdit ?? false
  const editItems = canEditItems ?? canEdit ?? false
  const [text, setText] = useState('')
  const [editIdx, setEditIdx] = useState(null)
  const [editText, setEditText] = useState('')
  const today = todayISO()
  const done = items.filter((c) => c.done).length
  const add = () => {
    if (!text.trim()) return
    onChange([...items, { text: text.trim(), owner_id: null, due: null, done: false }])
    setText('')
  }
  const set = (i, patch) => onChange(items.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const commitEdit = () => {
    if (editIdx === null) return
    const t = editText.trim()
    if (t) set(editIdx, { text: t.slice(0, 300) })
    setEditIdx(null)
  }
  return (
    <div>
      <div className="pc-check-head">
        <h3>Checklist</h3>
        <span className="stat-sub">{done} / {items.length} done</span>
      </div>
      {items.length > 0 && <PlainBar pct={(done / Math.max(1, items.length)) * 100} height={8} />}
      <div className="subtask-list" style={{ marginTop: 8 }}>
        {items.map((c, i) => {
          const overdue = !c.done && c.due && c.due < today
          return (
            <div key={i} className="subtask-row pc-check-row">
              <button
                type="button"
                className={`mini-check${c.done ? ' on' : ''}`}
                disabled={!tick}
                data-tip={c.done ? 'Mark as not done' : 'Mark as done'}
                onClick={() => { if (!tick) return; if (!c.done) playTick(); set(i, { done: !c.done, done_at: c.done ? null : today }) }}
              >
                {c.done && <Check size={12} strokeWidth={3} />}
              </button>
              {editIdx === i ? (
                <input
                  className="input pc-mini" autoFocus value={editText} style={{ flex: 1, minWidth: 140 }}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit() } if (e.key === 'Escape') setEditIdx(null) }}
                />
              ) : (
                <span
                  className={(c.done ? 'done-txt' : '') + (editItems ? ' pc-check-txt' : '')}
                  style={{ flex: 1, minWidth: 140 }}
                  data-tip={editItems ? 'Click to edit this step' : undefined}
                  onClick={() => { if (editItems) { setEditIdx(i); setEditText(c.text) } }}
                >{c.text}</span>
              )}
              {!compact && (editItems && team.length > 0 ? (
                <select
                  className="select pc-mini"
                  value={c.owner_id ?? ''}
                  data-tip="Who does this step"
                  onChange={(e) => set(i, { owner_id: e.target.value === '' ? null : Number(e.target.value) })}
                >
                  <option value="">— no owner —</option>
                  {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : team.length > 0 ? (
                <span className={c.owner_id ? 'stat-sub' : 'pc-red'}>
                  {c.owner_id ? (team.find((u) => u.id === c.owner_id)?.name || '—') : '—'}
                </span>
              ) : null)}
              {c.done ? (
                <span className="stat-sub">done {c.done_at ? dateLabel(c.done_at) : ''}</span>
              ) : editItems ? (
                <input className="input pc-mini" type="date" value={c.due || ''} data-tip="Due date"
                  style={overdue ? { color: PC.red, fontWeight: 700 } : undefined}
                  onChange={(e) => set(i, { due: e.target.value || null })} />
              ) : (
                <span className={overdue ? 'pc-red' : 'stat-sub'}>{c.due ? `due ${dateLabel(c.due)}` : '—'}</span>
              )}
              {editItems && (
                <button type="button" className="icon-btn" style={{ padding: 2 }} data-tip="Remove this step" data-tip-left=""
                  onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove">
                  <X size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      {editItems && (
        <div className="add-inline" style={{ padding: '6px 0 0' }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Add a step…"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
          <button type="button" className="btn btn-sm" onClick={add} data-tip="Add this step"><Plus size={14} /></button>
        </div>
      )}
    </div>
  )
}

// Dated notes, newest first. Author and date are automatic. When onDelete is
// given, canDelete(note) decides which notes show the remove button — the
// server enforces author-or-admin regardless.
export function NotesBlock({ notes, onAdd, onDelete, canDelete = () => true }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try { await onAdd(text.trim()); setText('') } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  return (
    <div>
      <div className="pc-check-head">
        <h3>Notes</h3>
      </div>
      <div className="add-inline" style={{ paddingBottom: 8 }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note — prose lives here…"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} />
        <button className="btn btn-sm" onClick={submit} disabled={busy} data-tip="Add note"><Plus size={14} /> Add note</button>
      </div>
      {notes.length === 0 && <div className="stat-sub">No notes yet.</div>}
      {notes.map((n) => (
        <div key={n.id} className="pc-note">
          <span className="stat-sub" style={{ whiteSpace: 'nowrap' }}>{n.created_at.slice(0, 10)}</span>
          <span className="pc-note-author">{n.author_name || 'system'}</span>
          <span style={{ flex: 1 }}>{n.text}</span>
          {onDelete && canDelete(n) && (
            <button type="button" className="icon-btn" style={{ padding: 2 }} data-tip="Delete this note" data-tip-left=""
              onClick={async () => {
                if (!confirm('Delete this note?')) return
                try { await onDelete(n) } catch (e) { alert(e.message) }
              }} aria-label="Delete note">
              <X size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// Days from today until an ISO date (negative = already passed).
export const daysUntil = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 864e5)

// One campaign row — used by the campaign list and inside project detail.
export function CampaignRow({ c, byKey, onOpen }) {
  const startsIn = c.status === 'incoming' && c.start_date ? daysUntil(c.start_date) : null
  return (
    <button className="pc-camp-row" onClick={() => onOpen(c)}>
      {c.photo_thumb && <Zoom className="pc-row-thumb" src={c.photo_thumb} full={c.photo || c.photo_thumb} alt={c.title || ''} />}
      <div className="pc-row-body">
      <div className="pc-camp-top">
        <span className="pc-camp-name">{c.name}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {startsIn != null && startsIn >= 0 ? (
            <span className="pc-days" data-tip="Days until the start date">starts in {startsIn}d</span>
          ) : c.days_left != null && c.status !== 'done' && c.days_left >= 0 ? (
            <span className="pc-days" data-tip="Days until the end date">{c.days_left}d left</span>
          ) : null}
          <StatusBadge status={c.status} />
        </span>
      </div>
      {/* On drafts the strip below itemizes every gap — repeating it in red
          here would just be noise, so placeholders go muted. */}
      <div className="pc-camp-when">
        {c.start_date && c.end_date
          ? <span>{dateLabel(c.start_date)} → {dateLabel(c.end_date)}</span>
          : <span className={c.status === 'idea' ? 'stat-sub' : 'pc-red'}>no dates yet</span>}
      </div>
      <div className="pc-camp-sub">
        {c.project_name ? <span>{c.project_name}</span> : <span className={c.status === 'idea' ? 'stat-sub' : 'pc-red'}>no project</span>}
        <span>·</span>
        {c.owner_name ? <span>{c.owner_name}</span> : <span className={c.status === 'idea' ? 'stat-sub' : 'pc-red'}>no owner</span>}
      </div>
      {c.description && <div className="pc-desc-clamp">{c.description}</div>}
      {c.channels.length > 0 && (
        <div className="pc-camp-chips">
          {c.channels.map((ch) => <span key={ch} className="chip chip-muted">{byKey[ch]?.label || ch}</span>)}
        </div>
      )}
      {c.status === 'blocked' && c.blocking ? (
        <div className="pc-strip">Blocked by: {c.blocking.text} — due {dateLabel(c.blocking.due)}</div>
      ) : c.status === 'idea' && c.missing.length > 0 ? (
        <div className="pc-strip-soft">Draft — still needs: {c.missing.join(', ')}</div>
      ) : (
        <>
          <PaceBar pace={c.pace} />
          <div className="pc-camp-foot">
            <span><b>{c.actual.toLocaleString()}</b> / {c.target.toLocaleString()} {c.metric}</span>
            {c.status === 'live' && c.pace && (
              <span style={{ color: c.pace.behind ? PC.amber : PC.green, fontWeight: 700 }}>
                · {c.pace.behind ? 'behind' : 'ahead'} pace
              </span>
            )}
            {c.status === 'incoming' && c.start_date && (
              <span style={{ color: '#2a78d6', fontWeight: 700 }}>· starts {dateLabel(c.start_date)}</span>
            )}
          </div>
        </>
      )}
      </div>
    </button>
  )
}
