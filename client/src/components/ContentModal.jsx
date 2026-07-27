import { useEffect, useMemo, useState } from 'react'
import {
  Trash2, Plus, Check, AlertCircle, ImagePlus, X, Clapperboard, Send, Scissors,
  AlignLeft, CheckSquare, UserRound, Palette, Link2, ExternalLink, BookOpen, RotateCcw, History,
  FileText, Layers, Hash,
} from 'lucide-react'
import Modal from './Modal.jsx'
import { can, todayISO, addDaysISO, CONTENT_TYPES, typeInfo, onColor } from '../lib/constants.js'
import { useChannels } from '../lib/channels.jsx'
import { useAuth } from '../lib/auth.jsx'
import { api } from '../lib/api.js'
import { getPicks, bumpPick } from '../lib/picks.js'
import { toast } from '../lib/toast.js'

// Defined at module level — an inline component would remount its date/time
// inputs on every keystroke elsewhere in the modal and drop their focus.
function DateRow({ icon: Icon, label, dateKey, timeKey, endKey, form, setForm, disabled }) {
  return (
    <div className="drow">
      <span className="drow-label"><Icon size={14} /> {label}</span>
      <input className="input" type="date" disabled={disabled} value={form[dateKey]}
        onChange={(e) => setForm({ ...form, [dateKey]: e.target.value })} />
      {timeKey && <input className="input" type="time" disabled={disabled} value={form[timeKey]}
        data-tip={endKey ? 'From' : undefined}
        onChange={(e) => setForm({ ...form, [timeKey]: e.target.value })} />}
      {endKey && (
        <>
          <span className="drow-dash">–</span>
          <input className="input" type="time" disabled={disabled} value={form[endKey]} data-tip="To"
            onChange={(e) => setForm({ ...form, [endKey]: e.target.value })} />
        </>
      )}
      {!disabled && (
        <span className="drow-quick">
          <button type="button" className="qbtn" onClick={() => setForm({ ...form, [dateKey]: todayISO() })}>Today</button>
          <button type="button" className="qbtn" onClick={() => setForm({ ...form, [dateKey]: addDaysISO(todayISO(), 1) })}>Tomorrow</button>
          {form[dateKey] && (
            <button type="button" className="qbtn" data-tip="Clear this date" aria-label="Clear date"
              onClick={() => setForm({ ...form, [dateKey]: '', ...(timeKey ? { [timeKey]: '' } : {}), ...(endKey ? { [endKey]: '' } : {}) })}>✕</button>
          )}
        </span>
      )}
    </div>
  )
}

// Task editor — used from the board, both calendars, the to-do list and the
// admin panel. Deliberately small: title → stage → type → platforms → dates.
export default function ContentModal({ item, statuses, defaults = {}, onClose, onCreate, onUpdate, onDelete }) {
  const { user } = useAuth()
  const { visible, byKey, reload } = useChannels()
  const creating = !item
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [subText, setSubText] = useState('')
  const [form, setForm] = useState(() => ({
    title: item?.title || '',
    channels: item?.channels?.length ? [...item.channels] : (defaults.channels || (visible[0] ? [visible[0].key] : [])),
    type: item?.type || defaults.type || 'post',
    status_id: item?.status_id || statuses[0]?.id || null,
    recording_date: item?.recording_date || defaults.recording_date || '',
    recording_time: item?.recording_time || '',
    recording_end: item?.recording_end || '',
    edit_ready_date: item?.edit_ready_date || '',
    design_ready_date: item?.design_ready_date || '',
    release_date: item?.release_date || defaults.release_date || '',
    release_time: item?.release_time || '',
    description: item?.description || '',
    photo: item?.photo ?? null,
    photo_thumb: item?.photo_thumb ?? null,
    checklist: item?.checklist ? [...item.checklist] : [],
    campaign_id: item ? (item.campaign_id ?? null) : (defaults.campaign_id ?? null),
    operator_id: item?.operator_id ?? null,
    editor_id: item?.editor_id ?? null,
    designer_id: item?.designer_id ?? null,
    ready_link: item?.ready_link || '',
    shot_link: item?.shot_link || '',
    design_link: item?.design_link || '',
    reference_text: item?.reference_text || '',
    reference_links: item?.reference_links?.length ? [...item.reference_links] : [],
    format: item?.format || '',
    rubrika: item?.rubrika || '',
    script: item?.script || '',
    // Admins choose who the task is for (any number of people); everyone
    // else creates for themselves.
    ...(user.role === 'admin' ? {
      assignee_ids: item
        ? (item.assignees?.length ? [...item.assignees] : item.assignee_id ? [item.assignee_id] : [])
        : (defaults.assignee_id ? [defaults.assignee_id] : [user.id]),
    } : {}),
  }))
  // Team list: the admin's assignee picker + the video crew pickers.
  // (cached — every modal open reuses one fetch for a while)
  const [team, setTeam] = useState([])
  useEffect(() => {
    api.cached('/users').then(setTeam).catch(() => {})
  }, [])
  // The people you pick most rise to the top of every assign list.
  const picks = useMemo(() => getPicks(), [])
  // Campaigns for the one-dropdown chip that ties cards to campaign progress.
  const [campaigns, setCampaigns] = useState([])
  useEffect(() => {
    api.cached('/campaigns').then(setCampaigns).catch(() => {})
  }, [])
  // The task-form rules the admin tuned: which brief fields exist for this
  // type, which are required, and the Format / Rubrika option lists.
  const [fieldRules, setFieldRules] = useState(null)
  useEffect(() => {
    api.cached('/fields').then(setFieldRules).catch(() => {})
  }, [])

  // Lists carry only a thumbnail and no revision history — pull the full task
  // (original photo + Pravki history) in on demand when a task is opened.
  const [initialPhoto, setInitialPhoto] = useState(item?.photo ?? null)
  const [revisions, setRevisions] = useState(() => item?.revisions || [])
  useEffect(() => {
    if (!item) return
    api.get(`/content/${item.id}`).then((full) => {
      setRevisions(full.revisions || [])
      setForm((f) => ({ ...f, photo: full.photo, photo_thumb: full.photo_thumb }))
      setInitialPhoto(full.photo)
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Extras stay hidden until asked for — the common case is a quick add.
  const [show, setShow] = useState(() => ({
    description: !!item?.description,
    photo: !!item?.photo || !!item?.has_photo,
    checklist: (item?.checklist?.length || 0) > 0,
    reference: false, // empty reference/delivery chrome hides until asked for
    delivery: false,
    script: false,
  }))

  const canEdit = can(user, 'manage_content')
  const canMove = can(user, 'move_tasks')
  const isMine = item?.assignee_id === user.id
  // The task's crew: filming, editing and designing are stage changes, so the
  // operator, editor or designer may always move their own task through the
  // pipeline.
  const isCrew = !creating && !!item &&
    (item.operator_id === user.id || item.editor_id === user.id || item.designer_id === user.id)
  // Detail fields (title, type, platforms, dates, description, photo) need
  // manage_content; the stage needs move_tasks; the assignee may always tick
  // their own checklist. The UI locks exactly what the server would reject.
  const detailsLocked = !creating && !canEdit
  const checklistLocked = detailsLocked && !isMine
  const readOnly = detailsLocked && !isMine && !canMove && !isCrew

  const plan = typeInfo(form.type).plan
  // A post is designed, not filmed: one designer hat instead of operator+editor.
  const isDesign = form.type === 'post'
  // Does a brief field apply to this task's type — and is it demanded?
  const fOn = (k) => { const r = fieldRules?.[k]; return !!r && r.state !== 'off' && r.types.includes(form.type) }
  const fReq = (k) => { const r = fieldRules?.[k]; return !!r && r.state === 'required' && r.types.includes(form.type) }
  // Crew accounts work to the shoot and maker deadlines — the release date is
  // the channel's business and is not shown to them at all. They also can't
  // move the stage freely: they see it, and mark their one milestone.
  const crewViewer = !['admin', 'member'].includes(user.role)
  const myHats = {
    operator: !creating && item?.operator_id === user.id,
    editor: !creating && item?.editor_id === user.id,
    designer: !creating && item?.designer_id === user.id,
  }
  // Where the task stands, so a tick shows already-done: the Shot stage and the
  // Ready stage (by sort order in the pipeline).
  const curSort = statuses.find((s) => s.id === form.status_id)?.sort ?? -1
  const shotSort = statuses.find((s) => /^shot$/i.test(s.label) || /\bshot\b/i.test(s.label))?.sort
  const readySort = statuses.find((s) => /^ready$/i.test(s.label) || /ready|final|approv|posted|got/i.test(s.label))?.sort
  const alreadyShot = shotSort != null && curSort >= shotSort
  const alreadyReady = readySort != null && curSort >= readySort
  // The one milestone this crew member is about to tick on save (null = none).
  const [milestone, setMilestone] = useState(null)
  // One tap does it: a crew milestone applies the moment it's ticked — no
  // separate Save click for the single most-used crew action. The modal stays
  // open (links can still be dropped in) and the footer Save keeps working.
  const tickMilestone = async (kind) => {
    if (busy || milestone === kind) return
    setBusy(true); setErr('')
    try {
      await onUpdate(item, { milestone: kind })
      setMilestone(kind)
      toast(kind === 'shot' ? 'Marked as shot — synced' : kind === 'edited' ? 'Marked as edited — synced' : 'Marked as designed — synced')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  // ---- Reference block helpers (example links live as an array) ----
  const setRefLink = (i, v) => setForm((f) => ({ ...f, reference_links: f.reference_links.map((x, j) => (j === i ? v : x)) }))
  const addRefLink = () => setForm((f) => ({ ...f, reference_links: [...f.reference_links, ''] }))
  const removeRefLink = (i) => setForm((f) => ({ ...f, reference_links: f.reference_links.filter((_, j) => j !== i) }))
  const shortUrl = (u) => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 42)

  // ---- Per-stage delivery links ----
  // Operator's raw footage (shot_link), the editor's finished cut (ready_link,
  // the "Edit ready" link), the designer's artwork (design_link, shown only
  // when a designer is on the task). Each crew member edits their own; the
  // rest stay read-only so an editor can grab the shot footage, etc.
  // Crew always see their stage's field; everyone else sees only links that
  // exist — three empty Drive inputs on every open were pure chrome. The
  // extras row reveals the empty ones when an editor wants to paste by hand.
  const deliveryFields = [
    !isDesign && { col: 'shot_link', label: 'Shot footage', icon: Clapperboard, mine: myHats.operator, present: !!item?.operator_id },
    !isDesign && { col: 'ready_link', label: 'Edit ready', icon: Scissors, mine: myHats.editor, present: !!item?.editor_id },
    { col: 'design_link', label: 'Design ready', icon: Palette, mine: myHats.designer, present: !!item?.designer_id },
  ].filter(Boolean).filter((f) => (crewViewer
    ? (f.mine || form[f.col] || f.present)
    : (form[f.col] || (canEdit && show.delivery))))
  const hasRef = !!(form.reference_text || form.reference_links.length > 0 || form.photo || form.photo_thumb)

  // ---- Review / Pravki (SMM & admin, when a task is waiting at Ready) ----
  const readyStatus = statuses.find((s) => /^ready$/i.test(s.label))
  const finalStatusObj = statuses.find((s) => s.is_final)
  const atReady = !!item && !!readyStatus && item.status_id === readyStatus.id
  const onChannel = user.role === 'admin' || (item?.channels || []).some((ch) => (user.departments || []).includes(ch))
  const canReview = (user.role === 'admin' || can(user, 'review_publish')) && onChannel && !!finalStatusObj
  const canRequest = (user.role === 'admin' || can(user, 'request_changes')) && onChannel
  const pravkiTargets = [
    item?.editor_id && { key: 'editor', label: 'Editor' },
    item?.operator_id && { key: 'operator', label: 'Operator · re-shoot' },
    item?.designer_id && { key: 'designer', label: 'Designer' },
  ].filter(Boolean)
  if (pravkiTargets.length === 0) pravkiTargets.push({ key: 'editor', label: 'Editor' })
  const [pravki, setPravki] = useState(null) // null | { note, target }

  // Admin's shortcut: a brand-new department without leaving the task.
  // The icon picks itself from the name (Instagram/Telegram/YouTube/Target…).
  const [newDept, setNewDept] = useState(null) // null | '' | typing…
  const guessIcon = (label) => {
    const l = label.toLowerCase()
    if (l.includes('insta')) return 'instagram'
    if (l.includes('telegram') || l.includes('tg')) return 'telegram'
    if (l.includes('youtube') || l.includes('yt')) return 'youtube'
    if (l.includes('tiktok') || l.includes('music')) return 'music'
    if (l.includes('video')) return 'video'
    if (l.includes('photo') || l.includes('камера')) return 'camera'
    if (l.includes('site') || l.includes('web')) return 'globe'
    if (l.includes('target') || l.includes('ads')) return 'target'
    return 'megaphone'
  }
  const createDept = async () => {
    const label = String(newDept || '').trim()
    if (!label) { setNewDept(null); return }
    try {
      const c = await api.post('/channels', { label, icon: guessIcon(label) })
      reload()
      setForm((f) => ({ ...f, channels: [...f.channels, c.key] }))
      setNewDept(null)
    } catch (e) { setErr(e.message) }
  }

  const toggleChannel = (key) =>
    setForm((f) => {
      const on = f.channels.includes(key)
      if (on && f.channels.length === 1) return f // always at least one platform
      return { ...f, channels: on ? f.channels.filter((c) => c !== key) : [...f.channels, key] }
    })

  // Photos are downscaled in the browser before upload: the original becomes a
  // ≤1600px JPEG and a ≤320px thumbnail is generated for lists and cards —
  // a 10 MB phone photo turns into a few hundred KB.
  const scaleImage = (img, maxW, quality) => {
    const ratio = Math.min(1, maxW / img.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * ratio)
    canvas.height = Math.round(img.height * ratio)
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  }
  const pickPhoto = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { setErr('Image is too large — keep it under 15 MB'); return }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        setForm((f) => ({ ...f, photo: scaleImage(img, 1600, 0.85), photo_thumb: scaleImage(img, 320, 0.75) }))
        setErr('')
      } catch { setErr('Could not read that image') } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { setErr('Could not read that image'); URL.revokeObjectURL(url) }
    img.src = url
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

  // A 409 from the server means the operator is double-booked or outside
  // their working hours — shown as a warning; only an admin can push through.
  const [conflict, setConflict] = useState(null)
  const save = async (force = false) => {
    if (busy || !form.title.trim()) return // guard against double-submit
    // The admin's required brief fields gate the save — with the section
    // opened so the cursor lands where the answer goes.
    if (creating || canEdit) {
      const missing = [
        ['format', 'Format', form.format],
        ['rubrika', 'Rubrika', form.rubrika],
        ['script', 'Script', form.script.trim()],
        ['description', 'Description', form.description.trim()],
        ['reference', 'Reference', form.reference_text || form.reference_links.length > 0 || form.photo],
      ].find(([k, , v]) => fReq(k) && !v)
      if (missing) {
        setShow((s) => ({ ...s, script: true, reference: true, description: true }))
        setErr(`«${missing[1]}» is required for this type of task`)
        return
      }
    }
    setBusy(true)
    setErr('')
    setConflict(null)
    let payload
    if (creating || canEdit) {
      payload = {
        ...form,
        title: form.title.trim(),
        format: form.format || null,
        rubrika: form.rubrika.trim() || null,
        script: form.script.trim() || null,
        recording_date: form.recording_date || null,
        recording_time: form.recording_time || null,
        recording_end: form.recording_end || null,
        edit_ready_date: form.edit_ready_date || null,
        design_ready_date: form.design_ready_date || null,
        release_date: form.release_date || null,
        release_time: form.release_time || null,
        ...(force ? { force: true } : {}),
      }
      // Don't re-upload an unchanged photo — it can be hundreds of KB.
      if (!creating && form.photo === initialPhoto) {
        delete payload.photo
        delete payload.photo_thumb
      }
    } else {
      // Limited rights: send only what this person may actually change,
      // so the server never rejects the whole save.
      payload = {}
      if (crewViewer) {
        // The crew move their work with a milestone tick and drop their own
        // stage's file link — never a raw stage change, never another's link.
        if (myHats.operator && (form.shot_link || '') !== (item.shot_link || '')) payload.shot_link = form.shot_link.trim()
        if (myHats.editor && (form.ready_link || '') !== (item.ready_link || '')) payload.ready_link = form.ready_link.trim()
        if (myHats.designer && (form.design_link || '') !== (item.design_link || '')) payload.design_link = form.design_link.trim()
      } else if (canMove && form.status_id !== item.status_id) {
        payload.status_id = form.status_id
      }
      if (isMine) payload.checklist = form.checklist
    }
    try {
      if (creating) await onCreate(payload)
      else await onUpdate(item, payload)
      // Learn from the confirmed save: these picks float up next time.
      bumpPick(payload.operator_id, payload.editor_id, payload.designer_id, ...(payload.assignee_ids || []))
      toast(creating ? 'Task added — synced' : 'Task saved — synced')
      onClose()
    } catch (e) {
      if (e.status === 409 && e.data) setConflict(e.data)
      else setErr(e.message)
    } finally { setBusy(false) }
  }
  const del = async () => {
    if (!confirm('Delete this task?')) return
    try { await onDelete(item); toast('Task deleted'); onClose() } catch (e) { setErr(e.message) }
  }
  // The reviewer's release: move Ready → Published.
  const publish = async () => {
    if (busy || !finalStatusObj) return
    setBusy(true); setErr('')
    try { await onUpdate(item, { status_id: finalStatusObj.id }); toast('Published — synced'); onClose() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  // Request changes (Pravki): one note, sent back to the chosen crew stage.
  const submitPravki = async () => {
    if (busy || !pravki?.note.trim()) return
    setBusy(true); setErr('')
    try {
      await api.post(`/content/${item.id}/revisions`, { note: pravki.note.trim(), target: pravki.target })
      await onUpdate(item, {}) // pull the moved-back row into the parent list
      toast('Sent back to the crew — synced')
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

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
          <button className="btn btn-primary" onClick={() => save()} disabled={busy || !form.title.trim()}>
            {busy ? 'Saving…' : creating ? 'Create task' : 'Save changes'}
          </button>
        )}
      </>}
    >
      {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}

      {/* Scheduling warning: the operator is double-booked or off the clock.
          Admins may push through on purpose; everyone else adjusts the plan. */}
      {conflict && (
        <div className="conflict-box">
          <div className="conflict-head"><AlertCircle size={15} /> {conflict.error}</div>
          {conflict.conflicts?.length > 0 && (
            <ul className="conflict-list">
              {conflict.conflicts.map((c) => (
                <li key={c.id}>
                  <b>{c.from}{c.to ? `–${c.to}` : ''}</b> · {c.title}
                  {c.channels?.length > 0 && <span className="stat-sub"> ({c.channels.map((ch) => byKey[ch]?.label || ch).join(', ')})</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="conflict-actions">
            {conflict.can_force ? (
              <>
                <span className="stat-sub">You’re the admin — you can book it anyway.</span>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => save(true)}>
                  Schedule anyway
                </button>
              </>
            ) : (
              <span className="stat-sub">Pick another time — only an admin can double-book an operator.</span>
            )}
          </div>
        </div>
      )}

      {/* Big, calm title — the first thing you type */}
      <input
        className="cm-title"
        autoFocus={creating}
        disabled={detailsLocked}
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
            // The crew see the stage but never set it by hand (they tick their
            // milestone instead) — only move_tasks unlocks the picker.
            const locked = !creating && !canMove
            return (
              <button
                key={s.id}
                type="button"
                className={'stage-chip' + (active ? ' on' : '')}
                disabled={locked && !active}
                style={active ? { background: s.color, borderColor: s.color, color: onColor(s.color) } : undefined}
                onClick={() => !locked && setForm({ ...form, status_id: s.id })}
              >
                <span className="status-dot" style={{ background: active ? onColor(s.color) : s.color }} />
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Reference — the brief the crew reads before working: style/mood/format
          notes, example links, and a reference photo. All optional; none of it
          blocks moving a task forward. Crew see it; only editors set it. */}
      {(hasRef || (canEdit && show.reference)) && (
        <div className="cm-row cm-ref">
          <span className="cm-key"><BookOpen size={13} style={{ verticalAlign: -2 }} /> Reference</span>
          <div className="ref-block">
            {canEdit ? (
              <textarea className="input" rows={2} value={form.reference_text}
                onChange={(e) => setForm({ ...form, reference_text: e.target.value })}
                placeholder="Style, mood, length, format… (optional)" />
            ) : form.reference_text ? <p className="ref-text">{form.reference_text}</p> : null}

            {canEdit ? (
              <div className="ref-links">
                {form.reference_links.map((url, i) => (
                  <div key={i} className="ref-link-row">
                    <input className="input" value={url} placeholder="https://… reference video or post"
                      onChange={(e) => setRefLink(i, e.target.value)} />
                    <button type="button" className="icon-btn" aria-label="Remove link" onClick={() => removeRefLink(i)}><X size={13} /></button>
                  </div>
                ))}
                <button type="button" className="extra-btn" onClick={addRefLink}><Plus size={13} /> Example link</button>
              </div>
            ) : form.reference_links.length > 0 ? (
              <div className="ref-links-view">
                {form.reference_links.map((url, i) => (
                  /^https?:\/\//i.test(url)
                    ? <a key={i} className="ref-link-chip" href={url} target="_blank" rel="noreferrer"><Link2 size={12} /> {shortUrl(url)} <ExternalLink size={11} /></a>
                    : <span key={i} className="ref-link-chip"><Link2 size={12} /> {url}</span>
                ))}
              </div>
            ) : null}

            {(form.photo || form.photo_thumb) ? (
              <div className="photo-wrap ref-photo">
                <img src={form.photo || form.photo_thumb} alt="reference" />
                {canEdit && <button className="photo-remove" data-tip="Remove the photo" data-tip-left="" onClick={() => setForm({ ...form, photo: null, photo_thumb: null })} aria-label="Remove photo"><X size={14} /></button>}
              </div>
            ) : canEdit ? (
              <label className="photo-pick ref-photo-pick">
                <ImagePlus size={15} /> Reference photo
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pickPhoto} />
              </label>
            ) : null}
          </div>
        </div>
      )}

      {/* The script — the words and shots the crew films by. Editors write it;
          the crew read it. Folds behind the extras row unless demanded. */}
      {fOn('script') && !crewViewer && canEdit && (form.script || fReq('script') || show.script) && (
        <div className="cm-row">
          <span className="cm-key"><FileText size={13} style={{ verticalAlign: -2 }} /> Script{fReq('script') && <b className="req-star" data-tip="The admin made this required"> *</b>}</span>
          <textarea className="input cm-script" rows={6} disabled={detailsLocked}
            placeholder="The script / shot plan the crew works by…"
            value={form.script} onChange={(e) => setForm({ ...form, script: e.target.value })} />
        </div>
      )}
      {(crewViewer || !canEdit) && form.script && (
        <div className="cm-row">
          <span className="cm-key"><FileText size={13} style={{ verticalAlign: -2 }} /> Script</span>
          <div className="crew-script">{form.script}</div>
        </div>
      )}

      {/* Review (SMM & admin): a Ready task waits here for release. Publish it,
          or send it back to the crew with one note (Pravki). */}
      {atReady && (canReview || canRequest) && (
        <div className="cm-row cm-review">
          <span className="cm-key">Review</span>
          <div className="review-block">
            {!pravki && (
              <div className="review-actions">
                {canReview && (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={publish}>
                    <Send size={14} /> Publish
                  </button>
                )}
                {canRequest && (
                  <button type="button" className="btn" onClick={() => setPravki({ note: '', target: pravkiTargets[0].key })}>
                    <RotateCcw size={14} /> Request changes
                  </button>
                )}
                <span className="stat-sub">Waiting for review before it goes out.</span>
              </div>
            )}
            {pravki && (
              <div className="pravki-form">
                <textarea className="input" rows={3} autoFocus value={pravki.note}
                  onChange={(e) => setPravki({ ...pravki, note: e.target.value })}
                  placeholder="Write everything that needs changing, in one go…" />
                {pravkiTargets.length > 1 && (
                  <div className="pravki-target">
                    <span className="crew-opt">Send back to:</span>
                    {pravkiTargets.map((t) => (
                      <button key={t.key} type="button" className={'tchip' + (pravki.target === t.key ? ' on' : '')}
                        onClick={() => setPravki({ ...pravki, target: t.key })}>{t.label}</button>
                    ))}
                  </div>
                )}
                <div className="pravki-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setPravki(null)}>Cancel</button>
                  <button type="button" className="btn btn-sm btn-primary" disabled={!pravki.note.trim() || busy} onClick={submitPravki}>
                    <RotateCcw size={13} /> Send back
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Revision history — a plain list: round, who asked, the note, the date. */}
      {revisions.length > 0 && (
        <div className="cm-row cm-revs">
          <span className="cm-key"><History size={13} style={{ verticalAlign: -2 }} /> Revisions</span>
          <div className="rev-list">
            {revisions.map((r) => (
              <div key={r.id} className={'rev-item' + (r.resolved_at ? ' rev-done' : '')}>
                <span className="rev-round">#{r.round}</span>
                <span className="rev-body">
                  <span className="rev-note">{r.note}</span>
                  <span className="rev-meta">
                    {r.requested_name || '—'} · {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · to {r.target}{r.resolved_at ? ' · fixed' : ''}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The crew's controls: they see the stage above (read-only), tick the
          one milestone that's theirs, and drop their stage's Google-Drive file.
          Anyone can open a link that's already there. */}
      {!creating && (deliveryFields.length > 0 || (crewViewer && (myHats.operator || myHats.editor || myHats.designer))) && (
        <div className="cm-row">
          <span className="cm-key">Your part</span>
          <div className="crew-do">
            {crewViewer && (myHats.operator || myHats.editor || myHats.designer) && (
              <div className="crew-ticks">
                {myHats.operator && (
                  <button type="button" className={'do-tick' + ((alreadyShot || milestone === 'shot') ? ' on' : '')}
                    disabled={alreadyShot} data-tip="Filming is done"
                    onClick={() => tickMilestone('shot')}>
                    <span className="do-box">{(alreadyShot || milestone === 'shot') && <Check size={12} strokeWidth={3.5} />}</span>
                    <Clapperboard size={13} /> {alreadyShot ? 'Shot' : 'Mark as shot'}
                  </button>
                )}
                {myHats.editor && (
                  <button type="button" className={'do-tick' + ((alreadyReady || milestone === 'edited') ? ' on' : '')}
                    disabled={alreadyReady} data-tip="The cut is ready"
                    onClick={() => tickMilestone('edited')}>
                    <span className="do-box">{(alreadyReady || milestone === 'edited') && <Check size={12} strokeWidth={3.5} />}</span>
                    <Scissors size={13} /> {alreadyReady ? 'Edited' : 'Mark as edited'}
                  </button>
                )}
                {myHats.designer && (
                  <button type="button" className={'do-tick' + ((alreadyReady || milestone === 'designed') ? ' on' : '')}
                    disabled={alreadyReady} data-tip="The artwork is ready"
                    onClick={() => tickMilestone('designed')}>
                    <span className="do-box">{(alreadyReady || milestone === 'designed') && <Check size={12} strokeWidth={3.5} />}</span>
                    <Palette size={13} /> {alreadyReady ? 'Designed' : 'Mark as designed'}
                  </button>
                )}
              </div>
            )}
            {deliveryFields.map((f) => {
              const Icon = f.icon
              const editable = f.mine || canEdit
              return (
                <label key={f.col} className="ready-link-field">
                  <span className="crew-label"><Icon size={12} /> {f.label} <span className="crew-opt">Google Drive</span></span>
                  <span className="ready-link-input">
                    <input className="input" placeholder="https://drive.google.com/…"
                      disabled={!editable}
                      value={form[f.col]}
                      onChange={(e) => setForm({ ...form, [f.col]: e.target.value })} />
                    {form[f.col] && /^https?:\/\//i.test(form[f.col]) && (
                      <a className="btn btn-sm" href={form[f.col]} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* Crew read, they don't configure: instead of four pickers they can't
          touch (type, platforms, crew, campaign), one compact line says what
          the piece is, where it goes and who else is on it — the modal stays
          small, especially on a phone. */}
      {crewViewer && !creating ? (
        <div className="cm-row">
          <span className="cm-key">About</span>
          <div className="crew-about">
            <span className={`chip ct-${form.type}`}>{typeInfo(form.type).label}</span>
            {form.format && <span className="chip chip-muted"><Layers size={11} /> {form.format}</span>}
            {form.rubrika && <span className="chip chip-muted"><Hash size={11} /> {form.rubrika}</span>}
            {form.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
            {[['operator_id', 'Shoots'], ['editor_id', 'Edits'], ['designer_id', 'Designs']].map(([f, verb]) => {
              const u = team.find((x) => x.id === form[f])
              return u ? (
                <span key={f} className="chip chip-muted">
                  {verb}: {u.id === user.id ? 'you' : u.name.split(' ')[0]}
                </span>
              ) : null
            })}
          </div>
        </div>
      ) : (<>
      {/* What is it? The type binds the task to each platform's plan. */}
      <div className="cm-row">
        <span className="cm-key">Type</span>
        <div className="stage-chips">
          {CONTENT_TYPES.map((t) => {
            const Icon = t.icon
            return (
              <button key={t.key} type="button" disabled={detailsLocked}
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

      {/* The brief: Format (talking head, split screen…) and Rubrika (the
          recurring column). The admin decides which types carry them and
          whether they're demanded — Admin → Pipeline → The task form. */}
      {(fOn('format') || fOn('rubrika')) && (
        <div className="cm-row">
          <span className="cm-key">Brief</span>
          {/* Own classes on purpose: these are brief fields, not crew hats —
              nothing that counts crew-fields may count these. */}
          <div className="brief-fields">
            {fOn('format') && (
              <label className="brief-field">
                <span className="brief-label"><Layers size={12} /> Format {fReq('format')
                  ? <b className="req-star" data-tip="The admin made this required">*</b>
                  : <span className="crew-opt">optional</span>}</span>
                <select className="select" disabled={detailsLocked} value={form.format}
                  onChange={(e) => setForm({ ...form, format: e.target.value })}>
                  <option value="">— pick a format —</option>
                  {[...new Set([...(fieldRules.format.options || []), ...(form.format ? [form.format] : [])])]
                    .map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            )}
            {fOn('rubrika') && (
              <label className="brief-field">
                <span className="brief-label"><Hash size={12} /> Rubrika {fReq('rubrika')
                  ? <b className="req-star" data-tip="The admin made this required">*</b>
                  : <span className="crew-opt">optional</span>}</span>
                {(fieldRules.rubrika.options || []).length > 0 ? (
                  <select className="select" disabled={detailsLocked} value={form.rubrika}
                    onChange={(e) => setForm({ ...form, rubrika: e.target.value })}>
                    <option value="">— pick a rubrika —</option>
                    {[...new Set([...(fieldRules.rubrika.options || []), ...(form.rubrika ? [form.rubrika] : [])])]
                      .map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="input" disabled={detailsLocked} placeholder="e.g. SU events"
                    value={form.rubrika} onChange={(e) => setForm({ ...form, rubrika: e.target.value })} />
                )}
              </label>
            )}
          </div>
        </div>
      )}

      {/* Platforms — a task can go out on several at once */}
      <div className="cm-row">
        <span className="cm-key">Platforms</span>
        <div className="checkbox-row">
          {visible.map((c) => (
            <label key={c.key} className={'checkbox-chip chip-sm' + (form.channels.includes(c.key) ? ' on' : '')}>
              <input type="checkbox" disabled={detailsLocked} checked={form.channels.includes(c.key)} onChange={() => toggleChannel(c.key)} />
              {c.label}
            </label>
          ))}
          {user.role === 'admin' && !detailsLocked && (
            newDept === null ? (
              <button type="button" className="checkbox-chip chip-sm chip-add" data-tip="Create a new department right here"
                onClick={() => setNewDept('')}>
                <Plus size={12} /> New
              </button>
            ) : (
              <span className="chip-add-form">
                <input className="input pc-mini" autoFocus placeholder="Department name…" value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createDept() } if (e.key === 'Escape') setNewDept(null) }} />
                <button type="button" className="btn btn-sm" onClick={createDept}>Add</button>
              </span>
            )
          )}
        </div>
      </div>

      {/* Who is it for? Admins assign any number of people; an empty list
          leaves the task to the whole channel. */}
      {user.role === 'admin' && (
        <div className="cm-row">
          <span className="cm-key"><UserRound size={13} style={{ verticalAlign: -2 }} /> Assignees</span>
          <div className="assignee-multi">
            {form.assignee_ids.length === 0 && <span className="chip chip-muted">Unassigned — whole channel</span>}
            {form.assignee_ids.map((id) => {
              const u = team.find((x) => x.id === id)
              return (
                <span key={id} className="chip assignee-chip">
                  {u?.name || '…'}
                  <button type="button" className="chip-x" aria-label="Remove"
                    onClick={() => setForm({ ...form, assignee_ids: form.assignee_ids.filter((x) => x !== id) })}>×</button>
                </span>
              )
            })}
            <select
              className="select assignee-add"
              value=""
              data-tip="Add another person to this task"
              onChange={(e) => {
                const id = Number(e.target.value)
                if (id && !form.assignee_ids.includes(id)) setForm({ ...form, assignee_ids: [...form.assignee_ids, id] })
              }}
            >
              <option value="">+ Add person…</option>
              {[...team].filter((u) => !form.assignee_ids.includes(u.id))
                .sort((a, b) => (picks[b.id] || 0) - (picks[a.id] || 0) || a.name.localeCompare(b.name)).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.role === 'admin' ? ' (admin)' : ''}</option>
                ))}
            </select>
          </div>
        </div>
      )}

      {/* The crew hats, offered by ROLE: the operator list holds operators,
          the editor list editors, the designer list designers — set the roles
          in Admin → People (they multi-select). A post is designed, not shot,
          so it carries only the designer hat; filmed types carry all three.
          Hidden hats keep their person, so flipping the type loses nothing. */}
      <div className="cm-row">
        <span className="cm-key">Crew</span>
        <div className="crew-row">
          {(isDesign ? [
            { key: 'designer_id', label: 'Designer', role: 'designer', tip: 'Who designs this post' },
          ] : [
            { key: 'operator_id', label: 'Operator', role: 'operator', tip: 'Who films / shoots this' },
            { key: 'editor_id', label: 'Editor', role: 'editor', tip: 'Who edits this' },
            { key: 'designer_id', label: 'Designer', role: 'designer', tip: 'Who designs the artwork (thumbnail, cover…)' },
          ]).map((f) => {
            const holds = (u) => (u.crew_roles || []).includes(f.role)
            const bySort = (a, b) =>
              (picks[b.id] || 0) - (picks[a.id] || 0) || a.name.localeCompare(b.name)
            // Specialists lead the list, but ANYBODY can take the hat — a
            // one-time editor, a content head doing the filming.
            const specialists = team.filter(holds).sort(bySort)
            const everyoneElse = team.filter((u) => !holds(u)).sort(bySort)
            return (
              <label key={f.key} className="crew-field">
                <span className="crew-label">{f.label} <span className="crew-opt">optional</span></span>
                <select className="select" disabled={detailsLocked} value={form[f.key] ?? ''}
                  data-tip={f.tip}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">— nobody —</option>
                  {specialists.length > 0 && (
                    <optgroup label={`${f.label}s`}>
                      {specialists.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </optgroup>
                  )}
                  {everyoneElse.length > 0 && (
                    <optgroup label="Everyone else — one-time duty">
                      {everyoneElse.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </optgroup>
                  )}
                </select>
              </label>
            )
          })}
        </div>
      </div>

      {/* Campaign — one dropdown, so campaign progress follows the kanban */}
      <div className="cm-row">
        <span className="cm-key">Campaign</span>
        <select
          className="select"
          style={{ maxWidth: 280 }}
          disabled={detailsLocked}
          value={form.campaign_id ?? ''}
          data-tip="Tags this card to a campaign — its board fills itself"
          onChange={(e) => setForm({ ...form, campaign_id: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">No campaign</option>
          {campaigns.map((cp) => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
        </select>
      </div>
      </>)}

      {/* Dates — the shoot in hours (from–to), the editor's cut deadline, the
          designer's artwork deadline, and the public release. Each maker is
          judged by their own date, never by the release. */}
      <div className="dates-block">
        {!isDesign && <DateRow icon={Clapperboard} label="Shoot" dateKey="recording_date" timeKey="recording_time" endKey="recording_end" form={form} setForm={setForm} disabled={detailsLocked} />}
        {!isDesign && <DateRow icon={Scissors} label="Edit ready" dateKey="edit_ready_date" form={form} setForm={setForm} disabled={detailsLocked} />}
        <DateRow icon={Palette} label="Design ready" dateKey="design_ready_date" form={form} setForm={setForm} disabled={detailsLocked} />
        {!crewViewer && <DateRow icon={Send} label="Release" dateKey="release_date" timeKey="release_time" form={form} setForm={setForm} disabled={detailsLocked} />}
      </div>
      {(form.edit_ready_date || form.design_ready_date) && (
        <div className="cm-hint">
          <Scissors size={11} />{' '}
          {form.edit_ready_date && form.design_ready_date
            ? 'Edit-ready is the editor’s deadline, design-ready the designer’s — each lands on their own Missed page, even if the release is later.'
            : form.design_ready_date
              ? 'The design-ready date is the designer’s deadline — missing it lands on their Missed page, even if the release date is later.'
              : 'The edit-ready date is the editor’s deadline — missing it lands on their Missed page, even if the release date is later.'}
        </div>
      )}

      {/* Extras appear only when wanted (the photo lives in Reference now). */}
      {!detailsLocked && (!show.description || !show.checklist || (!hasRef && !show.reference) || (fOn('script') && !show.script && !form.script && !fReq('script')) || (!creating && !crewViewer && canEdit && !show.delivery)) && (
        <div className="extra-btns">
          {!hasRef && !show.reference && <button type="button" className="extra-btn" onClick={() => setShow({ ...show, reference: true })}><BookOpen size={14} /> Reference</button>}
          {fOn('script') && !show.script && !form.script && !fReq('script') && <button type="button" className="extra-btn" onClick={() => setShow({ ...show, script: true })}><FileText size={14} /> Script</button>}
          {!show.description && <button type="button" className="extra-btn" onClick={() => setShow({ ...show, description: true })}><AlignLeft size={14} /> Description</button>}
          {!show.checklist && <button type="button" className="extra-btn" onClick={() => setShow({ ...show, checklist: true })}><CheckSquare size={14} /> Checklist</button>}
          {!creating && !crewViewer && canEdit && !show.delivery && (
            <button type="button" className="extra-btn" onClick={() => setShow({ ...show, delivery: true })}><Link2 size={14} /> Delivery links</button>
          )}
        </div>
      )}

      {show.description && (
        <div className="field">
          <label>Description</label>
          <textarea className="input" rows={2} disabled={detailsLocked} autoFocus={!form.description} value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="References, links, notes…" />
        </div>
      )}

      {show.checklist && (
        <div className="field">
          <label>Checklist{form.checklist.length > 0 ? ` · ${form.checklist.filter((c) => c.done).length}/${form.checklist.length}` : ''}</label>
          <div className="subtask-list">
            {form.checklist.map((c, i) => (
              <div key={i} className="subtask-row">
                <button className={`mini-check${c.done ? ' on' : ''}`} disabled={checklistLocked} data-tip={c.done ? 'Mark as not done' : 'Mark as done'} onClick={() => !checklistLocked && toggleCheck(i)}>
                  {c.done && <Check size={12} strokeWidth={3} />}
                </button>
                <span className={c.done ? 'done-txt' : ''} style={{ flex: 1 }}>{c.text}</span>
                {!checklistLocked && <button className="icon-btn" style={{ padding: 2 }} data-tip="Remove this item" data-tip-left="" onClick={() => removeCheck(i)} aria-label="Remove"><X size={13} /></button>}
              </div>
            ))}
          </div>
          {!checklistLocked && (
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
