import { useEffect, useMemo, useState } from 'react'
import {
  Trash2, Plus, Check, AlertCircle, ImagePlus, X, Clapperboard, Send, Scissors,
  AlignLeft, CheckSquare, UserRound, Palette, Link2, ExternalLink, BookOpen, RotateCcw, History,
  FileText, Layers, Hash, CopyPlus, MessageSquare, Paperclip, Download, FileType2, CalendarClock, Hand, Eye,
} from 'lucide-react'
import Modal from './Modal.jsx'
import { can, todayISO, addDaysISO, CONTENT_TYPES, typeInfo, onColor } from '../lib/constants.js'
import { readText, hasSubstance, hasLink, isSentence, splitDelivery, deliveryHref } from '../lib/text.js'
import { useT, tr as tx } from '../lib/i18n.jsx'
import { useChannels } from '../lib/channels.jsx'
import { useAuth } from '../lib/auth.jsx'
import { api } from '../lib/api.js'
import { getPicks, bumpPick } from '../lib/picks.js'
import { toast } from '../lib/toast.js'
import { activityLine } from '../lib/activity.js'
import { rewardFinish } from '../lib/reward.js'
import { VoiceRecorder, VoicePlayer, canRecord } from './VoiceNote.jsx'

// Documents a task can carry. The cap is deliberate and low: every byte is
// stored, synced and paid for on the team's storage, so a 4 MB brief is a
// brief, not a raw export.
// How each phase state reads to the person looking at it. "Excused" is the
// important one: it says the delay belongs upstream, not to this owner.
const PHASE_WORDS = {
  ok: 'on time', late: 'late', excused: 'excused — handed over late',
  pending: 'in hand', waiting: 'not started',
}

const DOC_MAX = 4 * 1024 * 1024
const DOC_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.csv'
const docSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const docKind = (name) => {
  const e = String(name || '').split('.').pop().toLowerCase()
  if (e === 'pdf') return 'pdf'
  if (e === 'doc' || e === 'docx' || e === 'rtf') return 'doc'
  if (e === 'xls' || e === 'xlsx' || e === 'csv') return 'xls'
  if (e === 'ppt' || e === 'pptx') return 'ppt'
  return 'txt'
}

// Which deadlines are promises. Once one of these holds a day, only an admin
// moves it — everyone else asks, in writing. Naming them here keeps the form's
// warning and the server's refusal talking about the same four fields.
const PROMISED = {
  recording_date: 'the shoot day', edit_ready_date: 'the day the cut is due',
  design_ready_date: 'the day the artwork is due', release_date: 'the release day',
}

// Defined at module level — an inline component would remount its date/time
// inputs on every keystroke elsewhere in the modal and drop their focus.
function DateRow({ icon: Icon, label, dateKey, timeKey, endKey, form, setForm, disabled, locked, onAskMove, confirmSet, bad }) {
  // A day that is already promised is read-only here: the picker would let
  // somebody change it and only find out on save that they could not, having
  // already lost the day they were looking at.
  const promised = locked && !!form[dateKey]
  const setDate = (v) => {
    // Promising a day is the moment worth pausing on — afterwards it takes an
    // admin to undo. So the form says so once, plainly, before it happens
    // rather than after.
    if (v && !form[dateKey] && PROMISED[dateKey] && !confirmSet(dateKey, v)) return
    setForm({ ...form, [dateKey]: v })
  }
  return (
    <div className={'drow' + (promised ? ' drow-locked' : '') + (bad ? ' field-bad' : '')} data-field={dateKey}>
      <span className="drow-label"><Icon size={14} /> {label}</span>
      <input className="input" type="date" disabled={disabled || promised} value={form[dateKey]}
        data-tip={promised ? 'This day is promised — ask an admin to move it' : undefined}
        onChange={(e) => setDate(e.target.value)} />
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
      {!disabled && !promised && (
        <span className="drow-quick">
          <button type="button" className="qbtn" onClick={() => setDate(todayISO())}>{tx("Today")}</button>
          <button type="button" className="qbtn" onClick={() => setDate(addDaysISO(todayISO(), 1))}>{tx("Tomorrow")}</button>
          {form[dateKey] && (
            <button type="button" className="qbtn" data-tip={tx("Clear this date")} aria-label={tx("Clear date")}
              onClick={() => setForm({ ...form, [dateKey]: '', ...(timeKey ? { [timeKey]: '' } : {}), ...(endKey ? { [endKey]: '' } : {}) })}>✕</button>
          )}
        </span>
      )}
      {promised && (
        // Its own line across the row: the grid's last column is a narrow
        // slot for quick buttons, and a sentence wrapped into it a word at a
        // time is how "Ask to move" became four lines tall.
        <span className="drow-ask">
          {onAskMove && (
            <button type="button" className="qbtn qbtn-ask" onClick={() => onAskMove(dateKey)}>{tx("Ask to move")}</button>
          )}
          <span className="drow-promised">
            This day is promised — only an admin moves it{onAskMove ? ', and only on a reason.' : '.'}
          </span>
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
  const { t } = useT()
  const creating = !item
  const [err, setErr] = useState('')
  // Which field the refusal is ABOUT. A red banner at the top of a long form
  // tells you something is wrong; it does not tell you where, and the answer
  // is usually three screens down. Naming the field lets the form ring it and
  // scroll to it, so "«Script» needs a real answer" lands next to the script.
  const [badField, setBadField] = useState('')
  const refuse = (field, message) => { setBadField(field); setErr(message) }
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
    reviewer_ids: (() => {
      try {
        const l = Array.isArray(item?.reviewers) ? item.reviewers : JSON.parse(item?.reviewers || '[]')
        return l.length ? l : (item?.reviewer_id ? [item.reviewer_id] : [])
      } catch { return item?.reviewer_id ? [item.reviewer_id] : [] }
    })(),
    ready_link: item?.ready_link || '',
    shot_link: item?.shot_link || '',
    design_link: item?.design_link || '',
    // What the person typed into the "which file?" box. Kept apart from the
    // stored link so switching a channel's folder on or off never silently
    // rewrites a delivery that already exists.
    ready_file: '', shot_file: '', design_file: '',
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
  // The task's thread — pulled with the full record, appended on send.
  const [comments, setComments] = useState(() => item?.comments || [])
  const [cmtDraft, setCmtDraft] = useState('')
  const [cmtBusy, setCmtBusy] = useState(false)
  // The paper trail — who changed what, newest first; folded to three lines.
  const [activity, setActivity] = useState(() => item?.activity || [])
  const [allLog, setAllLog] = useState(false)
  const cmtWhen = (ts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
  // A named person is lit up, and lit up ONLY when the name is a real one —
  // matched against the roster the same way the server matches it, so what
  // the thread shows in bold is exactly who the bell woke. "@2pm" stays text.
  const withMentions = (text) => {
    if (!text.includes('@') || team.length === 0) return text
    const labels = [...new Set(team.flatMap((u) => {
      const full = String(u.name || '').trim()
      return full ? [full, full.split(/\s+/)[0]] : []
    }))].filter((l) => l.length >= 2).sort((a, b) => b.length - a.length)
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`@(?:${labels.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
    const out = []
    let last = 0
    for (const m of text.matchAll(re)) {
      if (m.index > last) out.push(text.slice(last, m.index))
      out.push(<b key={m.index} className="cmt-at">{m[0]}</b>)
      last = m.index + m[0].length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
  }
  // A line, a clip, or both. A voice note IS the message when there is one.
  const [cmtClip, setCmtClip] = useState(null)
  const [clipNonce, setClipNonce] = useState(0)   // remounts the recorder to clear it
  const sendComment = async () => {
    const text = cmtDraft.trim()
    if ((!text && !cmtClip) || cmtBusy) return
    setCmtBusy(true)
    try {
      const c = await api.post(`/content/${item.id}/comments`, {
        text, ...(cmtClip ? { voice: cmtClip.data, voice_secs: cmtClip.secs } : {}),
      })
      setComments((prev) => [...prev, c])
      setCmtDraft('')
      setCmtClip(null)
      setClipNonce((n) => n + 1)
    } catch (e) { setErr(e.message) } finally { setCmtBusy(false) }
  }
  // The task's paperwork — a ТЗ in Word, a reference deck as PDF. Only names
  // and sizes travel with the task; the bytes are fetched when one is opened.
  const [docs, setDocs] = useState(() => item?.documents || [])
  const [docBusy, setDocBusy] = useState(false)
  // Who owes what, by when — derived by the server from the task's own clocks.
  const [phases, setPhases] = useState(() => item?.phases || [])
  useEffect(() => {
    if (!item) return
    api.get(`/content/${item.id}`).then((full) => {
      setRevisions(full.revisions || [])
      setComments(full.comments || [])
      setActivity(full.activity || [])
      setPhases(full.phases || [])
      setDocs(full.documents || [])
      setDateReqs(full.date_requests || [])
      setFlags(full.flags || [])
      setForm((f) => ({ ...f, photo: full.photo, photo_thumb: full.photo_thumb }))
      setInitialPhoto(full.photo)
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pickDoc = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // so the same file can be picked again after a failure
    if (!file || !item) return
    if (file.size > DOC_MAX) {
      setErr(`“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB — documents are capped at 4 MB`)
      return
    }
    setDocBusy(true); setErr('')
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(new Error('That file could not be read'))
        r.readAsDataURL(file)
      })
      const doc = await api.post(`/content/${item.id}/files`, { name: file.name, data })
      setDocs((prev) => [...prev, doc])
      toast(tx('Document attached — synced'))
    } catch (e2) { setErr(e2.message) } finally { setDocBusy(false) }
  }
  // Asking to open one gets a short-lived link back; the browser then fetches
  // the bytes itself and saves them under the name the SERVER states. Doing it
  // in JS instead would lose a Russian name — the browser drops non-ASCII from
  // an <a download> attribute and the brief arrives as "download".
  const openDoc = async (doc) => {
    setErr('')
    try {
      const { url } = await api.get(`/content/files/${doc.id}`)
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e2) { setErr(e2.message) }
  }
  const removeDoc = async (doc) => {
    if (!confirm(`Remove “${doc.name}” from this task?`)) return
    try {
      await api.del(`/content/files/${doc.id}`)
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    } catch (e2) { setErr(e2.message) }
  }
  // The brief is the point of the form, not an extra: Reference and
  // Description are open from the start, so the boxes the crew actually work
  // from are in front of whoever is filling the task in rather than folded
  // behind a row of buttons at the very bottom. Chrome that is only useful
  // once there is something in it (checklist, documents, the other people's
  // delivery links) still waits to be asked for.
  const [show, setShow] = useState(() => ({
    description: true,
    photo: !!item?.photo || !!item?.has_photo,
    checklist: (item?.checklist?.length || 0) > 0,
    reference: true,
    delivery: false,
    script: false,
    docs: (item?.documents?.length || 0) > 0,
  }))

  // Admins and SMMs run the board from the full form; the crew get a compact
  // one. Which meant nobody planning the work could see what the person doing
  // it actually sees — including where their delivery box is. `asCrew` puts
  // an admin in that seat for a moment, on any hat the task carries.
  const [asCrew, setAsCrew] = useState(null)   // null | operator | editor | designer
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
  const detailsLocked = !creating && (!canEdit || !!asCrew)
  // What the person whose seat this is could actually change about the brief.
  const briefEditable = canEdit && !asCrew
  const checklistLocked = detailsLocked && !isMine
  const readOnly = detailsLocked && !isMine && !canMove && !isCrew

  // The hats this task actually carries, for the "see it as…" switch. Only
  // hats somebody holds: previewing an empty seat shows nothing worth seeing.
  const crewHats = creating ? [] : [
    { key: 'operator', label: 'the operator', id: item?.operator_id },
    { key: 'editor', label: 'the editor', id: item?.editor_id },
    { key: 'designer', label: 'the designer', id: item?.designer_id },
  ].filter((h) => h.id).map((h) => ({ ...h, name: team.find((u) => u.id === h.id)?.name || '' }))

  // The shared Drive folder, if this task's channels agree on one. Two
  // channels with two different folders have no single answer, so the box
  // goes back to asking for the whole address.
  const sharedFolder = (() => {
    const set = [...new Set(form.channels.map((k) => (byKey[k]?.drive_url || '').trim()).filter(Boolean))]
    return set.length === 1 ? set[0] : ''
  })()

  const plan = typeInfo(form.type).plan
  // A post is designed, not filmed: one designer hat instead of operator+editor.
  const isDesign = form.type === 'post'
  // Does a brief field apply to this task's type — and is it demanded?
  const fOn = (k) => { const r = fieldRules?.[k]; return !!r && r.state !== 'off' && r.types.includes(form.type) }
  const fReq = (k) => { const r = fieldRules?.[k]; return !!r && r.state === 'required' && r.types.includes(form.type) }
  // Does this type of task need somebody holding the camera? The admin's crew
  // rule (Admin → Pipeline) decides, and /fields serves it beside the brief
  // rules — so a text post is never asked, and a type added there starts being
  // asked with nothing further to wire up.
  const isFilmedType = !!fieldRules?.crew?.operator?.includes(form.type)
  // WHERE the task sits decides what it owes. Before the shooting stage it is
  // an idea — a title and a maybe — and owes nobody a crew, a date or a brief.
  // From the shooting stage on it is a BOOKED shoot and owes all three; one
  // stage further, with footage in hand, it owes an editor as well.
  const liveStages = useMemo(() => statuses.filter((s) => !/^deleted$/i.test(s.label)), [statuses])
  const shootAt = liveStages.findIndex((s) => /to\s*shoot|shooting|s[yj]omka/i.test(s.label || ''))
  const stageAt = liveStages.findIndex((s) => s.id === form.status_id)
  // Each demand stands at the stage it is about and lands on a save that puts
  // the card THERE. A card parked further along is not making either promise —
  // it is a record of work that happened elsewhere, and a shoot day in its
  // future would be a day that has been and gone.
  const needsOperator = isFilmedType && shootAt >= 0 && stageAt === shootAt
  const needsEditor = isFilmedType && shootAt >= 0 && stageAt === shootAt + 1
  // Crew accounts work to the shoot and maker deadlines — the release date is
  // the channel's business and is not shown to them at all. They also can't
  // move the stage freely: they see it, and mark their one milestone.
  const crewViewer = !['admin', 'member'].includes(user.role) || !!asCrew
  const myHats = asCrew
    // Standing in their shoes: the hat being previewed is "mine", the others
    // are not — which is exactly the shape the real holder sees.
    ? { operator: asCrew === 'operator', editor: asCrew === 'editor', designer: asCrew === 'designer' }
    : {
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
    // The two stages that produce a FILE have to produce it. Asked here so
    // the person is standing next to the box they need to fill, rather than
    // being refused after the fact. The shoot is exempt on purpose: footage
    // goes over on a hard drive as often as not.
    const NEEDS = { edited: ['ready_link', 'the cut', 'ready_file'], designed: ['design_link', 'the artwork', 'design_file'] }
    const need = NEEDS[kind]
    if (need && !form[need[0]] && !form[need[2]] && docs.length === 0) {
      setShow((sh) => ({ ...sh, delivery: true }))
      refuse(need[0], `Paste ${need[1]} before marking it done — a stage that says finished with nothing attached is one the reviewer has to chase`)
      return
    }
    setBusy(true); setErr('')
    try {
      // The link rides along with the tick, so one press does both.
      await onUpdate(item, {
        milestone: kind,
        ...(need && form[need[2]] ? { [need[2]]: form[need[2]] }
          : need && form[need[0]] ? { [need[0]]: form[need[0]] } : {}),
      })
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
  // A link that EXISTS is always shown, whatever the task's type — a post
  // that was filmed still has footage, and hiding it left admins hunting for
  // a link they could see was there. The type only decides which EMPTY
  // fields are worth offering.
  const DELIVERY = [
    { col: 'shot_link', file: 'shot_file', label: 'Recording', sub: 'the operator’s raw material — the editor’s source', icon: Clapperboard, kind: 'shot', mine: myHats.operator, present: !!item?.operator_id, offer: !isDesign },
    { col: 'ready_link', file: 'ready_file', label: 'Edit ready', sub: 'the editor’s finished cut', icon: Scissors, kind: 'edit', mine: myHats.editor, present: !!item?.editor_id, offer: !isDesign },
    { col: 'design_link', file: 'design_file', label: 'Design ready', sub: 'the designer’s finished artwork', icon: Palette, kind: 'design', mine: myHats.designer, present: !!item?.designer_id, offer: true },
  ]
  const deliveryFields = DELIVERY.filter((f) => (form[f.col] ? true : (crewViewer
    ? (f.offer && (f.mine || f.present))
    : (f.offer && canEdit && show.delivery))))
  // The files themselves, one press away for anyone who can open the task.
  // A delivery made through a channel's shared folder is stored as the folder,
  // a separator and the file the person named — "…/folders/ABC · 1-3". It is
  // one fact and reads as one, but pasted whole into an href it 404s, so the
  // address is taken from it rather than assumed to BE it.
  const deliveryLinks = DELIVERY.map((f) => ({ ...f, href: deliveryHref(form[f.col]), note: splitDelivery(form[f.col]).note }))
    .filter((f) => f.href)
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
  // ---- promised days: asking, and answering ----
  // Every ask ever made on this task, newest first — open ones waiting on an
  // admin, and answered ones kept as the record of why a day moved.
  const [dateReqs, setDateReqs] = useState(() => item?.date_requests || [])
  const [asking, setAsking] = useState(null)  // null | { field, to, reason }
  const isAdmin = user.role === 'admin'
  // Promised days are the admin's to move. For everyone else the picker is
  // read-only and the ask is the way through.
  const datesLocked = !isAdmin
  // Only the people who could actually make the ask are offered it. A crew
  // account has neither right, and a button that answers 403 is worse than no
  // button — it reads as the app being broken rather than as "not your call".
  const canAsk = !isAdmin && (can(user, 'manage_content') || can(user, 'move_tasks'))
  const confirmSet = (field, day) => window.confirm(
    `Promise ${PROMISED[field]} for ${day}?\n\n`
    + 'Everything on the board measures itself against this day, so once it is '
    + 'set only an admin can move it — and only when somebody says why.\n\n'
    + 'Set it?')
  const askToMove = (field) => {
    setErr('')
    setAsking({ field, to: form[field] || '', reason: '' })
  }
  const sendAsk = async () => {
    if (!asking || busy) return
    setBusy(true); setErr('')
    try {
      const made = await api.post(`/content/${item.id}/date-requests`, {
        field: asking.field, to_date: asking.to || null, reason: asking.reason.trim(),
      })
      setDateReqs((prev) => [made, ...prev])
      setAsking(null)
      toast(tx('Asked — the admins have it'))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const decide = async (reqId, approve) => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const out = await api.post(`/content/date-requests/${reqId}/decide`, { approve })
      setDateReqs((prev) => prev.map((r) => (r.id === reqId ? out.request : r)))
      if (approve && out.task) setForm((f) => ({ ...f, [out.request.field]: out.task[out.request.field] || '' }))
      toast(approve ? 'Moved — everyone on the task hears it' : 'Kept where it was — they hear why')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  // Take the person to the field the refusal is about. The show-flags are set
  // in the same breath, so the section is open by the time this runs.
  useEffect(() => {
    if (!badField) return
    const el = document.querySelector(`[data-field="${badField}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const focusable = el.querySelector('input, textarea, select')
      if (focusable) focusable.focus({ preventScroll: true })
    }
  }, [badField])

  // Raising a hand. The crew could always deliver late; they had no way to say
  // so in advance, so the first anybody knew was the deadline passing.
  const [flags, setFlags] = useState(() => item?.flags || [])
  const [raising, setRaising] = useState(null)  // null | { kind, reason }
  const openFlags = flags.filter((f) => !f.cleared_at)
  const onThisTask = !creating && !!item && (
    [item.operator_id, item.editor_id, item.designer_id, item.assignee_id].includes(user.id) ||
    (item.assignees || []).includes(user.id))
  const canRaise = !creating && (onThisTask || canEdit || canMove)
  const raiseHand = async () => {
    if (!raising || busy) return
    setBusy(true); setErr('')
    try {
      const made = await api.post(`/content/${item.id}/flags`, { kind: raising.kind, reason: raising.reason.trim() })
      setFlags((prev) => [made, ...prev])
      setRaising(null)
      toast(tx('Said early — the people who plan have it'))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const lowerHand = async (id) => {
    setBusy(true); setErr('')
    try {
      const out = await api.post(`/content/flags/${id}/clear`, {})
      setFlags((prev) => prev.map((f) => (f.id === id ? out : f)))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const [pravki, setPravki] = useState(null) // null | { note, target, photo, photo_thumb }
  // The screenshot that shows what is wrong, pasted into the note itself.
  const pravkiPaste = (e) => {
    const shot = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))
    if (!shot) return
    e.preventDefault()
    e.stopPropagation()
    const file = shot.getAsFile()
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { setErr('Image is too large — keep it under 15 MB'); return }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        setPravki((p) => (p ? { ...p, photo: scaleImage(img, 1600, 0.85), photo_thumb: scaleImage(img, 320, 0.75) } : p))
        setErr('')
      } catch { setErr('Could not read that image') } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { setErr('Could not read that image'); URL.revokeObjectURL(url) }
    img.src = url
  }
  // The finished files, ready to open right in the Review row — reviewing
  // means watching the work, not hunting for its link further down the modal.
  const reviewLinks = [
    { value: form.ready_link, label: '▶ Watch the cut' },
    { value: form.design_link, label: '🎨 See the design' },
    { value: form.shot_link, label: '🎬 Raw footage' },
  ].map((l) => ({ ...l, url: deliveryHref(l.value), note: splitDelivery(l.value).note })).filter((l) => l.url)

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
  const takePhoto = (file, how = 'pasted') => {
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { setErr('Image is too large — keep it under 15 MB'); return }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        setForm((f) => ({ ...f, photo: scaleImage(img, 1600, 0.85), photo_thumb: scaleImage(img, 320, 0.75) }))
        setErr('')
        toast(how === 'pasted' ? 'Screenshot pasted in' : 'Photo attached')
      } catch { setErr('Could not read that image') } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { setErr('Could not read that image'); URL.revokeObjectURL(url) }
    img.src = url
  }
  const pickPhoto = (e) => takePhoto(e.target.files?.[0], 'picked')
  // A reference is almost always a screenshot that is already on the
  // clipboard — Ctrl+V drops it straight in, so nobody has to save it to disk
  // first just to pick it back out of a file dialog. Anywhere in the task
  // (or in a Pravki note) counts, as long as the cursor is not in a field
  // where a paste means text.
  const pasteImageFrom = (e) => {
    const items = [...(e.clipboardData?.items || [])]
    const shot = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'))
    if (!shot) return false
    e.preventDefault()
    takePhoto(shot.getAsFile())
    return true
  }
  useEffect(() => {
    if (!canEdit) return undefined
    const onPaste = (e) => {
      const el = e.target
      // A paste into a text box is a paste of text — unless what is on the
      // clipboard is an image, which no text box can hold anyway.
      if (!e.clipboardData?.items) return
      const hasImage = [...e.clipboardData.items].some((i) => i.kind === 'file' && i.type.startsWith('image/'))
      if (!hasImage) return
      if (el?.tagName === 'INPUT' && el.type !== 'text') return
      pasteImageFrom(e)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [canEdit]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // Booking a shoot is a promise about a day that passes whether or not a
      // camera, a crew and a brief turn up — so the whole booking is asked at
      // the stage where the booking happens, and nothing is asked of an idea.
      if (needsOperator) {
        const refReady = form.reference_links.length > 0 || !!form.photo || docs.length > 0
          || !!form.shot_link || hasLink(form.reference_text) || isSentence(form.script)
        const gap = [
          [!form.operator_id, 'Pick who is filming this — a shoot nobody is holding is nobody’s job', 'operator_id'],
          [!form.recording_date, 'Filmed work is booked with all three dates — the shoot day is missing', 'recording_date'],
          [!form.edit_ready_date, 'Filmed work is booked with all three dates — the day the cut is due is missing', 'edit_ready_date'],
          [!form.release_date, 'Filmed work is booked with all three dates — the release day is missing', 'release_date'],
          [!refReady, 'Booking the shoot needs a brief ready — paste a reference link or TZ, or attach the photo it refers to', 'reference'],
        ].find(([bad]) => bad)
        if (gap) { setShow((s) => ({ ...s, reference: true, script: true })); refuse(gap[2], gap[1]); return }
      }
      if (needsEditor && !form.editor_id) {
        refuse('editor_id', 'Name who cuts this — footage with no editor waiting is footage nobody is cutting')
        return
      }
      const missing = [
        ['format', 'Format', form.format],
        ['rubrika', 'Rubrika', form.rubrika],
        ['script', 'Script', form.script.trim()],
        ['description', 'Description', form.description.trim()],
        ['reference', 'Reference', form.reference_text || form.reference_links.length > 0 || form.photo],
      ].find(([k, , v]) => fReq(k) && !v)
      if (missing) {
        setShow((s) => ({ ...s, script: true, reference: true, description: true }))
        refuse(missing[0], `«${missing[1]}» is required for this type of task`)
        return
      }
      // Filled is not answered. A demanded field holding "." or "N/A" is
      // caught here so the message arrives beside the field, rather than as a
      // refusal after the save has apparently been accepted.
      const thin = [
        ['format', 'Format', form.format, hasSubstance],
        ['rubrika', 'Rubrika', form.rubrika, hasSubstance],
        ['script', 'Script', form.script.trim(), isSentence],
        ['description', 'Description', form.description.trim(), hasSubstance],
      ].find(([k, , v, real]) => fReq(k) && v && !real(v))
      if (thin) {
        setShow((s) => ({ ...s, script: true, description: true }))
        refuse(thin[0], `«${thin[1]}» needs a real answer — “${thin[2]}” is a placeholder, not a brief`)
        return
      }
      // A reference points somewhere. Text on its own has to carry a link;
      // links, a photo or an attached document already do.
      const refCarried = form.reference_links.length > 0 || !!form.photo
      if (form.reference_text && !refCarried) {
        if (!hasSubstance(form.reference_text)) {
          setShow((s) => ({ ...s, reference: true }))
          refuse('reference', `«Reference» needs a real answer — “${form.reference_text.trim()}” is a placeholder, not a reference`)
          return
        }
        if (!hasLink(form.reference_text)) {
          setShow((s) => ({ ...s, reference: true }))
          refuse('reference', '«Reference» has to point somewhere — paste a link, or attach the photo or document it refers to')
          return
        }
      }
    }
    setBusy(true)
    setErr('')
    setBadField('')
    setConflict(null)
    let payload
    if (creating || canEdit) {
      payload = {
        ...form,
        title: form.title.trim(),
        // A named file wins over the stored link: it is what was just typed.
        ...(form.ready_file ? { ready_file: form.ready_file.trim() } : {}),
        ...(form.shot_file ? { shot_file: form.shot_file.trim() } : {}),
        ...(form.design_file ? { design_file: form.design_file.trim() } : {}),
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
        for (const [hat, col, file] of [
          [myHats.operator, 'shot_link', 'shot_file'],
          [myHats.editor, 'ready_link', 'ready_file'],
          [myHats.designer, 'design_link', 'design_file'],
        ]) {
          if (!hat) continue
          if (form[file]) payload[file] = form[file].trim()
          else if ((form[col] || '') !== (item[col] || '')) payload[col] = form[col].trim()
        }
      } else if (canMove && form.status_id !== item.status_id) {
        payload.status_id = form.status_id
      }
      if (isMine) payload.checklist = form.checklist
    }
    try {
      if (creating) await onCreate(payload)
      else await onUpdate(item, payload)
      // Reaching the last stage is the moment a piece is FINISHED, however it
      // was reached — the stage chips, the done tick, or the Publish button.
      if (!creating && finalStatusObj && payload.status_id === finalStatusObj.id
          && item.status_id !== finalStatusObj.id) rewardFinish()
      // Learn from the confirmed save: these picks float up next time.
      bumpPick(payload.operator_id, payload.editor_id, payload.designer_id, ...(payload.assignee_ids || []))
      toast(creating ? 'Task added — synced' : 'Task saved — synced')
      onClose()
    } catch (e) {
      if (e.status === 409 && e.data) setConflict(e.data)
      // A promised day was refused. Rather than leave the person staring at
      // "only an admin can move it", the ask opens right here with the day
      // they wanted already in it — the refusal and the way through are the
      // same gesture.
      else if (e.status === 403 && e.data?.ask_to_move) {
        const { field, to } = e.data.ask_to_move
        setAsking({ field, to: to || '', reason: '' })
        setErr(`${e.message} The ask is below — say what happened and it goes to them.`)
      } else setErr(e.message)
    } finally { setBusy(false) }
  }
  const del = async () => {
    if (!confirm('Delete this task?')) return
    try { await onDelete(item); toast(tx('Task deleted')); onClose() } catch (e) { setErr(e.message) }
  }
  // One press spawns the recurring piece: brief, crew and platforms ride
  // along; dates, stage and delivery start clean.
  const duplicate = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      await api.post('/content', {
        title: `${form.title.trim()} (copy)`,
        channels: form.channels, type: form.type,
        description: form.description,
        checklist: form.checklist.map((c) => (typeof c === 'object' ? { ...c, done: false } : c)),
        reference_text: form.reference_text || null, reference_links: form.reference_links,
        format: form.format || null, rubrika: form.rubrika.trim() || null, script: form.script.trim() || null,
        // Carrying the brief across is the whole point of this button, so the
        // repeat-script filter is told this one is deliberate.
        allow_duplicate_script: true,
        operator_id: form.operator_id, editor_id: form.editor_id, designer_id: form.designer_id,
        reviewer_ids: form.reviewer_ids,
        campaign_id: form.campaign_id,
        ...(user.role === 'admin' && form.assignee_ids ? { assignee_ids: form.assignee_ids } : {}),
      })
      toast(tx('Duplicated — brief kept, dates cleared'))
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  // A task URL anyone on the team can open — pasteable into any chat.
  const copyLink = () => {
    const url = `${window.location.origin}/todo?task=${item.id}`
    navigator.clipboard?.writeText(url)
      .then(() => toast(tx('Link copied — paste it anywhere')))
      .catch(() => toast(url, 'err'))
  }
  // The reviewer's release: move Ready → Published.
  const publish = async () => {
    if (busy || !finalStatusObj) return
    setBusy(true); setErr('')
    try { await onUpdate(item, { status_id: finalStatusObj.id }); rewardFinish(); toast(tx('Published — synced')); onClose() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  // Request changes (Pravki): one note, sent back to the chosen crew stage.
  const submitPravki = async () => {
    if (busy || !pravki?.note.trim()) return
    setBusy(true); setErr('')
    try {
      await api.post(`/content/${item.id}/revisions`, {
        note: pravki.note.trim(), target: pravki.target,
        photo: pravki.photo || null, photo_thumb: pravki.photo_thumb || null,
        ...(pravki.clip ? { voice: pravki.clip.data, voice_secs: pravki.clip.secs } : {}),
      })
      await onUpdate(item, {}) // pull the moved-back row into the parent list
      toast(tx('Sent back to the crew — synced'))
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <Modal
      wide
      title={creating ? 'New task' : 'Task'}
      onClose={onClose}
      footer={<>
        {!creating && canEdit && <button className="btn btn-danger" onClick={del}><Trash2 size={15} />{' '}{tx("Delete")}</button>}
        {!creating && canEdit && !crewViewer && (
          <button className="btn btn-ghost" onClick={duplicate} disabled={busy}
            data-tip={tx("A fresh copy: brief, crew and platforms kept — dates and stage cleared")}>
            <CopyPlus size={15} /> {t('task.duplicate')}
          </button>
        )}
        {!creating && (
          <button className="btn btn-ghost btn-icon" onClick={copyLink} data-tip={tx("Copy a link to this task")} aria-label={tx("Copy link")}>
            <Link2 size={15} />
          </button>
        )}
        {/* Standing where the crew stand. The people who plan the work ran the
            board from a form the people doing it never see — including where
            their delivery box is and what their tick actually asks for. */}
        {!creating && ['admin', 'member'].includes(user.role) && crewHats.length > 0 && (
          asCrew ? (
            <button className="btn btn-ghost" onClick={() => setAsCrew(null)}>
              <Eye size={15} /> Back to the full task
            </button>
          ) : (
            <span className="crew-peek">
              <Eye size={15} />
              <select className="select" value="" data-tip={tx("See this task the way the person doing it sees it")}
                onChange={(e) => e.target.value && setAsCrew(e.target.value)}>
                <option value="">{tx("See it as…")}</option>
                {crewHats.map((h) => (
                  <option key={h.key} value={h.key}>{h.label}{h.name ? ` · ${h.name.split(' ')[0]}` : ''}</option>
                ))}
              </select>
            </span>
          )
        )}
        {canRaise && !raising && openFlags.length === 0 && (
          <button className="btn btn-ghost" onClick={() => setRaising({ kind: 'at_risk', reason: '' })}
            data-tip={tx("Say early that this is in trouble")}>
            <Hand size={15} /> Raise a hand
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>{tx("Cancel")}</button>
        {!readOnly && (
          <button className="btn btn-primary" onClick={() => save()} disabled={busy || !form.title.trim()}>
            {busy ? t('task.saving') : creating ? t('task.create') : t('task.savechanges')}
          </button>
        )}
      </>}
    >
      {asCrew && (
        <div className="as-crew-note">
          <Eye size={14} />
          You are looking at this the way {crewHats.find((h) => h.key === asCrew)?.name || asCrew} sees it.
          Their ticks and their box, nobody else’s.
        </div>
      )}
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
                <span className="stat-sub">{tx("You’re the admin — you can book it anyway.")}</span>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => save(true)}>
                  Schedule anyway
                </button>
              </>
            ) : (
              <span className="stat-sub">{tx("Pick another time — only an admin can double-book an operator.")}</span>
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
        placeholder={tx("Task title")}
      />

      {/* Stage — the pipeline, in its own colours */}
      <div className="cm-row">
        <span className="cm-key">{t('task.stage')}</span>
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

      {/* A hand up: somebody on this piece saying early that it is in trouble.
          Sits directly under the stage, because it is about to change it. */}
      {(openFlags.length > 0 || raising) && (
        <div className="cm-row cm-flags">
          <span className="cm-key"><Hand size={13} style={{ verticalAlign: -2 }} /> {t('task.trouble')}</span>
          <div className="flag-block">
            {openFlags.map((f) => (
              <div key={f.id} className={`flag-item flag-${f.kind}`}>
                <span className="flag-line">
                  <b>{f.raised_name}</b> {f.kind === 'cant_take' ? 'cannot take this on' : 'says this will be late'}
                </span>
                <span className="flag-why">“{f.reason}”</span>
                {(canEdit || f.raised_by === user.id) && (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => lowerHand(f.id)}>
                    Sorted — hand down
                  </button>
                )}
              </div>
            ))}
            {raising && (
              <div className="flag-form">
                <div className="pravki-target">
                  {[['at_risk', 'This will be late'], ['cant_take', 'I can’t take this on']].map(([k, label]) => (
                    <button key={k} type="button" className={'tchip' + (raising.kind === k ? ' on' : '')}
                      onClick={() => setRaising({ ...raising, kind: k })}>{label}</button>
                  ))}
                </div>
                <textarea className="input" rows={2} autoFocus value={raising.reason}
                  onChange={(e) => setRaising({ ...raising, reason: e.target.value })}
                  placeholder={tx("What is in the way? The other shoot overran, the location fell through…")} />
                <div className="pravki-actions">
                  <span className="stat-sub">{tx("Said now, it can still be planned around.")}</span>
                  <button type="button" className="btn btn-sm" onClick={() => setRaising(null)}>{tx("Cancel")}</button>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy || !raising.reason.trim()} onClick={raiseHand}>
                    <Hand size={13} /> Say it now
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reference — the brief the crew reads before working: style/mood/format
          notes, example links, and a reference photo. All optional; none of it
          blocks moving a task forward. Crew see it; only editors set it. */}
      {(hasRef || (canEdit && show.reference)) && (
        <div className={'cm-row cm-ref' + (badField === 'reference' ? ' field-bad' : '')} data-field="reference">
          <span className="cm-key"><BookOpen size={13} style={{ verticalAlign: -2 }} /> {t('task.reference')}</span>
          <div className="ref-block">
            {briefEditable ? (
              <textarea className="input" rows={2} value={form.reference_text}
                onChange={(e) => setForm({ ...form, reference_text: e.target.value })}
                placeholder={tx("Style, mood, length, format… (optional)")} />
            ) : form.reference_text ? <p className="ref-text">{form.reference_text}</p> : null}

            {briefEditable ? (
              <div className="ref-links">
                {form.reference_links.map((url, i) => (
                  <div key={i} className="ref-link-row">
                    <input className="input" value={url} placeholder="https://… reference video or post"
                      onChange={(e) => setRefLink(i, e.target.value)} />
                    <button type="button" className="icon-btn" aria-label={tx("Remove link")} onClick={() => removeRefLink(i)}><X size={13} /></button>
                  </div>
                ))}
                <button type="button" className="extra-btn" onClick={addRefLink}><Plus size={13} />{' '}{tx("Example link")}</button>
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
                {briefEditable && <button className="photo-remove" data-tip={tx("Remove the photo")} data-tip-left="" onClick={() => setForm({ ...form, photo: null, photo_thumb: null })} aria-label={tx("Remove photo")}><X size={14} /></button>}
              </div>
            ) : briefEditable ? (
              <label className="photo-pick ref-photo-pick" data-tip={tx("Pick a file — or just press Ctrl+V with a screenshot on the clipboard")}>
                <ImagePlus size={15} /> Reference photo <span className="crew-opt">{tx("or paste it — Ctrl+V")}</span>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pickPhoto} />
              </label>
            ) : null}
          </div>
        </div>
      )}

      {/* Documents — the ТЗ as a Word file, the reference deck as a PDF, the
          slot plan as a spreadsheet. Anyone who can open the task can read
          them and add one; only whoever attached a document (or an admin)
          takes it away. Names and sizes are all that travel with the task —
          the bytes are fetched on the click that opens one. */}
      {!creating && (docs.length > 0 || show.docs) && (
        <div className="cm-row">
          <span className="cm-key"><Paperclip size={13} style={{ verticalAlign: -2 }} /> {t('task.documents')}</span>
          <div className="doc-block">
            {docs.map((d) => (
              <div key={d.id} className={`doc-row dk-${docKind(d.name)}`}>
                <FileType2 size={15} className="doc-ico" />
                <button type="button" className="doc-name" onClick={() => openDoc(d)}
                  data-tip={tx("Download this document")}>{d.name}</button>
                <span className="doc-meta">
                  {docSize(d.size)}
                  {d.uploader && <span className="doc-who"> · {d.uploader.split(' ')[0]}</span>}
                </span>
                <button type="button" className="icon-btn doc-get" onClick={() => openDoc(d)} aria-label={tx("Download")}
                  data-tip={tx("Download")}><Download size={14} /></button>
                {(user.role === 'admin' || d.uploaded_by === user.id) && (
                  <button type="button" className="icon-btn" onClick={() => removeDoc(d)} aria-label={tx("Remove")}
                    data-tip={tx("Remove this document")} data-tip-left=""><X size={14} /></button>
                )}
              </div>
            ))}
            <label className={'doc-pick' + (docBusy ? ' busy' : '')}>
              <Paperclip size={14} /> {docBusy ? 'Uploading…' : 'Attach a document'}
              <input type="file" accept={DOC_ACCEPT} style={{ display: 'none' }} disabled={docBusy} onChange={pickDoc} />
            </label>
            <span className="doc-hint">{tx("Word, PDF, Excel, PowerPoint or text — up to 4 MB each.")}</span>
          </div>
        </div>
      )}

      {/* The script — the words and shots the crew films by. Editors write it;
          the crew read it. Folds behind the extras row unless demanded. */}
      {fOn('script') && !crewViewer && canEdit && (form.script || fReq('script') || show.script) && (
        <div className={'cm-row' + (badField === 'script' ? ' field-bad' : '')} data-field="script">
          <span className="cm-key"><FileText size={13} style={{ verticalAlign: -2 }} /> {t('task.script')}{fReq('script') && <b className="req-star" data-tip={tx("The admin made this required")}> *</b>}</span>
          <textarea className="input cm-script" rows={6} disabled={detailsLocked}
            placeholder={tx("The script / shot plan the crew works by…")}
            value={form.script} onChange={(e) => setForm({ ...form, script: e.target.value })} />
        </div>
      )}
      {(crewViewer || !canEdit) && form.script && (
        <div className="cm-row">
          <span className="cm-key"><FileText size={13} style={{ verticalAlign: -2 }} /> {t('task.script')}</span>
          <div className="crew-script">{form.script}</div>
        </div>
      )}

      {/* The description sits with the rest of the brief rather than at the
          foot of the form — it is read at the same moment as the reference. */}
      {show.description && !crewViewer && (
        <div className={'cm-row' + (badField === 'description' ? ' field-bad' : '')} data-field="description">
          <span className="cm-key"><AlignLeft size={13} style={{ verticalAlign: -2 }} /> {t('task.description')}{fReq('description') && <b className="req-star" data-tip={tx("The admin made this required")}> *</b>}</span>
          <textarea className="input" rows={2} disabled={detailsLocked} value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={tx("References, links, notes…")} />
        </div>
      )}

      {/* Review (SMM & admin): a Ready task waits here for release. Publish it,
          or send it back to the crew with one note (Pravki). */}
      {atReady && (canReview || canRequest) && (
        <div className="cm-row cm-review">
          <span className="cm-key">{t('task.reviewer')}</span>
          <div className="review-block">
            {reviewLinks.length > 0 && (
              <div className="review-links">
                {reviewLinks.map((l) => (
                  <a key={l.label} className="btn btn-sm" href={l.url} target="_blank" rel="noreferrer">
                    {l.label}{l.note ? ` · ${l.note}` : ''} <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            )}
            {!pravki && (
              <div className="review-actions">
                {canReview && (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={publish}>
                    <Send size={14} /> Publish
                  </button>
                )}
                {canRequest && (
                  <button type="button" className="btn" onClick={() => setPravki({ note: '', target: pravkiTargets[0].key, photo: null, photo_thumb: null })}>
                    <RotateCcw size={14} /> {t('task.requestchanges')}
                  </button>
                )}
                <span className="stat-sub">{tx("Waiting for review before it goes out.")}</span>
              </div>
            )}
            {pravki && (
              <div className="pravki-form">
                <textarea className="input" rows={3} autoFocus value={pravki.note}
                  onPaste={pravkiPaste}
                  onChange={(e) => setPravki({ ...pravki, note: e.target.value })}
                  placeholder={tx("Write everything that needs changing, in one go… (Ctrl+V pastes the screenshot)")} />
                <div className="pravki-voice">
                  {canRecord() && <VoiceRecorder key={`p${clipNonce}`} onClip={(c) => setPravki((p) => (p ? { ...p, clip: c } : p))} disabled={busy} />}
                  <span className="stat-sub">Say it out loud if it is quicker — the note still goes in writing, so it can be skimmed later.</span>
                </div>
                {pravki.photo ? (
                  <div className="photo-wrap pravki-shot">
                    <img src={pravki.photo_thumb || pravki.photo} alt="what needs changing" />
                    <button className="photo-remove" aria-label={tx("Remove screenshot")} data-tip={tx("Remove the screenshot")} data-tip-left=""
                      onClick={() => setPravki({ ...pravki, photo: null, photo_thumb: null })}><X size={14} /></button>
                  </div>
                ) : (
                  <span className="doc-hint"><ImagePlus size={12} />{' '}{tx("Press Ctrl+V to paste the frame you mean.")}</span>
                )}
                {pravkiTargets.length > 1 && (
                  <div className="pravki-target">
                    <span className="crew-opt">{t('task.sendbackto')}</span>
                    {pravkiTargets.map((t) => (
                      <button key={t.key} type="button" className={'tchip' + (pravki.target === t.key ? ' on' : '')}
                        onClick={() => setPravki({ ...pravki, target: t.key })}>{t.label}</button>
                    ))}
                  </div>
                )}
                <div className="pravki-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setPravki(null)}>{tx("Cancel")}</button>
                  <button type="button" className="btn btn-sm btn-primary" disabled={!pravki.note.trim() || busy} onClick={submitPravki}>
                    <RotateCcw size={13} /> {t('task.sendback')}
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
          <span className="cm-key"><History size={13} style={{ verticalAlign: -2 }} /> {t('task.revisions')}</span>
          <div className="rev-list">
            {revisions.map((r) => (
              <div key={r.id} className={'rev-item' + (r.resolved_at ? ' rev-done' : '')}>
                <span className="rev-round">#{r.round}</span>
                <span className="rev-body">
                  <span className="rev-note">{r.note}</span>
                  {r.voice_id ? <VoicePlayer id={r.voice_id} secs={r.voice_secs} /> : null}
                  {r.photo && <a className="rev-shot" href={r.photo} target="_blank" rel="noreferrer"><img src={r.photo} alt="what needed changing" /></a>}
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
      {/* The finished files, in reach of anyone who can open the task — an
          admin should never have to hunt for a link that is plainly there. */}
      {!creating && deliveryLinks.length > 0 && (
        <div className="cm-row">
          <span className="cm-key"><Link2 size={13} style={{ verticalAlign: -2 }} /> {t('task.files')}</span>
          <div className="file-links">
            {deliveryLinks.map((f) => {
              const Icon = f.icon
              return (
                <a key={f.col} className={`file-link fl-${f.kind}`} href={f.href} target="_blank" rel="noreferrer"
                  data-tip={f.note ? `${f.sub} — ${f.note}` : f.sub}>
                  <Icon size={13} /> {f.label}{f.note ? ` · ${f.note}` : ''} <ExternalLink size={12} className="fl-go" />
                </a>
              )
            })}
          </div>
        </div>
      )}

      {!creating && (deliveryFields.length > 0 || (crewViewer && (myHats.operator || myHats.editor || myHats.designer))) && (
        <div className="cm-row">
          <span className="cm-key">{t('task.yourpart')}</span>
          <div className="crew-do">
            {crewViewer && (myHats.operator || myHats.editor || myHats.designer) && (
              <div className="crew-ticks">
                {myHats.operator && (
                  <button type="button" className={'do-tick' + ((alreadyShot || milestone === 'shot') ? ' on' : '')}
                    disabled={alreadyShot} data-tip={tx("Filming is done")}
                    onClick={() => tickMilestone('shot')}>
                    <span className="do-box">{(alreadyShot || milestone === 'shot') && <Check size={12} strokeWidth={3.5} />}</span>
                    <Clapperboard size={13} /> {alreadyShot ? t('task.shot') : t('task.markshot')}
                  </button>
                )}
                {myHats.editor && (
                  <button type="button" className={'do-tick' + ((alreadyReady || milestone === 'edited') ? ' on' : '')}
                    disabled={alreadyReady} data-tip={tx("The cut is ready")}
                    onClick={() => tickMilestone('edited')}>
                    <span className="do-box">{(alreadyReady || milestone === 'edited') && <Check size={12} strokeWidth={3.5} />}</span>
                    <Scissors size={13} /> {alreadyReady ? t('task.edited') : t('task.markedited')}
                  </button>
                )}
                {myHats.designer && (
                  <button type="button" className={'do-tick' + ((alreadyReady || milestone === 'designed') ? ' on' : '')}
                    disabled={alreadyReady} data-tip={tx("The artwork is ready")}
                    onClick={() => tickMilestone('designed')}>
                    <span className="do-box">{(alreadyReady || milestone === 'designed') && <Check size={12} strokeWidth={3.5} />}</span>
                    <Palette size={13} /> {alreadyReady ? t('task.designed') : t('task.markdesigned')}
                  </button>
                )}
              </div>
            )}
            {/* Three near-identical Drive boxes in a row were impossible to
                tell apart at a glance — people pasted the cut into Recording.
                Each one now carries its stage's colour, its own icon and the
                name of the person it belongs to, so the box you want is the
                one you can see. */}
            {deliveryFields.map((f) => {
              const Icon = f.icon
              // In a borrowed seat only THEIR box is theirs to fill — otherwise
              // the preview would show reach the person does not have, which
              // is the thing it exists to reveal.
              const editable = f.mine || (canEdit && !asCrew)
              const owner = team.find((u) => u.id === item?.[{ shot: 'operator_id', edit: 'editor_id', design: 'designer_id' }[f.kind]])
              return (
                <label key={f.col} data-field={f.col}
                  className={`ready-link-field dlv-${f.kind}` + (f.mine ? ' dlv-mine' : '') + (badField === f.col ? ' field-bad' : '')}>
                  <span className="crew-label dlv-head">
                    {/* The filmed chain is numbered because it has an order —
                        footage first, cut second. Design is a track of its own
                        and wears no number rather than a confusing second "2". */}
                    {f.kind !== 'design' && <span className="dlv-step">{f.kind === 'shot' ? '1' : '2'}</span>}
                    <span className="dlv-badge"><Icon size={14} /></span>
                    <b className="dlv-name">{f.label}</b>
                    <span className="crew-opt dlv-sub">{f.sub}</span>
                    <span className="dlv-who">{f.mine ? 'yours' : owner ? owner.name.split(' ')[0] : 'nobody yet'}</span>
                  </span>
                  <span className="ready-link-input">
                    {/* With a folder on the channel, the box asks WHICH file —
                        the folder is the same forty times a week and the file
                        is the part people leave out. */}
                    {sharedFolder && !/^https?:\/\//i.test(form[f.col] || '') ? (
                      <input className="input" placeholder={tx("which file? e.g. 1-3, or “reel 14”")}
                        disabled={!editable}
                        value={form[f.file] || ''}
                        onChange={(e) => setForm({ ...form, [f.file]: e.target.value })} />
                    ) : (
                      <input className="input" placeholder="https://drive.google.com/…"
                        disabled={!editable}
                        value={form[f.col]}
                        onChange={(e) => setForm({ ...form, [f.col]: e.target.value })} />
                    )}
                    {deliveryHref(form[f.col]) && (
                      <a className="btn btn-sm" href={deliveryHref(form[f.col])} target="_blank" rel="noreferrer"><ExternalLink size={14} />{' '}{tx("Open")}</a>
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
          <span className="cm-key">{t('task.about')}</span>
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
        <span className="cm-key">{t('task.type')}</span>
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
          <span className="cm-key">{t('task.brief')}</span>
          {/* Own classes on purpose: these are brief fields, not crew hats —
              nothing that counts crew-fields may count these. */}
          <div className="brief-fields">
            {fOn('format') && (
              <label className={'brief-field' + (badField === 'format' ? ' field-bad' : '')} data-field="format">
                <span className="brief-label"><Layers size={12} /> Format {fReq('format')
                  ? <b className="req-star" data-tip={tx("The admin made this required")}>*</b>
                  : <span className="crew-opt">{tx("optional")}</span>}</span>
                <select className="select" disabled={detailsLocked} value={form.format}
                  onChange={(e) => setForm({ ...form, format: e.target.value })}>
                  <option value="">— pick a format —</option>
                  {[...new Set([...(fieldRules.format.options || []), ...(form.format ? [form.format] : [])])]
                    .map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            )}
            {fOn('rubrika') && (
              <label className={'brief-field' + (badField === 'rubrika' ? ' field-bad' : '')} data-field="rubrika">
                <span className="brief-label"><Hash size={12} /> Rubrika {fReq('rubrika')
                  ? <b className="req-star" data-tip={tx("The admin made this required")}>*</b>
                  : <span className="crew-opt">{tx("optional")}</span>}</span>
                {(fieldRules.rubrika.options || []).length > 0 ? (
                  <select className="select" disabled={detailsLocked} value={form.rubrika}
                    onChange={(e) => setForm({ ...form, rubrika: e.target.value })}>
                    <option value="">— pick a rubrika —</option>
                    {[...new Set([...(fieldRules.rubrika.options || []), ...(form.rubrika ? [form.rubrika] : [])])]
                      .map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="input" disabled={detailsLocked} placeholder={tx("e.g. SU events")}
                    value={form.rubrika} onChange={(e) => setForm({ ...form, rubrika: e.target.value })} />
                )}
              </label>
            )}
          </div>
        </div>
      )}

      {/* Platforms — a task can go out on several at once */}
      <div className="cm-row">
        <span className="cm-key">{t('task.platforms')}</span>
        <div className="checkbox-row">
          {visible.map((c) => (
            <label key={c.key} className={'checkbox-chip chip-sm' + (form.channels.includes(c.key) ? ' on' : '')}>
              <input type="checkbox" disabled={detailsLocked} checked={form.channels.includes(c.key)} onChange={() => toggleChannel(c.key)} />
              {c.label}
            </label>
          ))}
          {user.role === 'admin' && !detailsLocked && (
            newDept === null ? (
              <button type="button" className="checkbox-chip chip-sm chip-add" data-tip={tx("Create a new department right here")}
                onClick={() => setNewDept('')}>
                <Plus size={12} /> New
              </button>
            ) : (
              <span className="chip-add-form">
                <input className="input pc-mini" autoFocus placeholder={tx("Department name…")} value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createDept() } if (e.key === 'Escape') setNewDept(null) }} />
                <button type="button" className="btn btn-sm" onClick={createDept}>{tx("Add")}</button>
              </span>
            )
          )}
        </div>
      </div>

      {/* Who is it for? Admins assign any number of people; an empty list
          leaves the task to the whole channel. */}
      {user.role === 'admin' && (
        <div className="cm-row">
          <span className="cm-key"><UserRound size={13} style={{ verticalAlign: -2 }} /> {t('task.assignees')}</span>
          <div className="assignee-multi">
            {form.assignee_ids.length === 0 && <span className="chip chip-muted">{tx("Unassigned — whole channel")}</span>}
            {form.assignee_ids.map((id) => {
              const u = team.find((x) => x.id === id)
              return (
                <span key={id} className="chip assignee-chip">
                  {u?.name || '…'}
                  <button type="button" className="chip-x" aria-label={tx("Remove")}
                    onClick={() => setForm({ ...form, assignee_ids: form.assignee_ids.filter((x) => x !== id) })}>×</button>
                </span>
              )
            })}
            <select
              className="select assignee-add"
              value=""
              data-tip={tx("Add another person to this task")}
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
      <div className="cm-row" data-field={badField === 'operator_id' ? 'operator_id' : badField === 'editor_id' ? 'editor_id' : undefined}>
        <span className="cm-key">{t('task.crew')}</span>
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
            // Only the people who work on THIS channel. Somebody scoped to
            // two channels was previously offered on all nine, and the
            // refusal came at save time, after the picking. Now they simply
            // are not in the list. Nobody scoped is offered everywhere, as
            // before. The person already holding the hat stays visible even
            // if the channel later moves out from under them — a select whose
            // value is not among its options renders blank while still
            // holding the id, which is worse than showing it.
            const here = (u) => {
              if (u.id === form[f.key]) return true
              const mine = u.crew_channels || []
              if (!mine.length) return true
              return form.channels.some((ch) => mine.includes(ch))
            }
            const pool = team.filter(here)
            const specialists = pool.filter(holds).sort(bySort)
            const everyoneElse = pool.filter((u) => !holds(u)).sort(bySort)
            // What the stage owes: a booked shoot needs its shooter, and
            // footage in hand needs the editor who will cut it. An idea owes
            // neither — the hats say "optional" until the work reaches them.
            const mustHave = (f.key === 'operator_id' && needsOperator) || (f.key === 'editor_id' && needsEditor)
            return (
              <label key={f.key} className={'crew-field' + (mustHave && !form[f.key] ? ' crew-missing' : '') + (badField === f.key ? ' field-bad' : '')}>
                <span className="crew-label">
                  {f.label}{' '}
                  {mustHave
                    ? <span className="crew-req">{tx("required")}</span>
                    : <span className="crew-opt">{tx("optional")}</span>}
                </span>
                <select className="select" disabled={detailsLocked} value={form[f.key] ?? ''}
                  data-tip={mustHave ? `${f.label} — this stage can’t go on without one` : f.tip}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">{mustHave ? `— pick the ${f.label.toLowerCase()} —` : '— nobody —'}</option>
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

      {/* Review can be shared — several names, all of them on the hook for the
          same date. Kept apart from the single-hat crew pickers above. */}
      <div className="cm-row">
        <span className="cm-key">{t('task.reviewer')}</span>
        <div className="rev-picker">
          {team.map((u) => {
            const on = form.reviewer_ids.includes(u.id)
            return (
              <button key={u.id} type="button" disabled={detailsLocked}
                className={'rev-chip' + (on ? ' on' : '')}
                onClick={() => setForm({
                  ...form,
                  reviewer_ids: on ? form.reviewer_ids.filter((id) => id !== u.id) : [...form.reviewer_ids, u.id],
                })}>
                {u.name}
              </button>
            )
          })}
          {form.reviewer_ids.length === 0 && <span className="cm-hint">{tx("Nobody signs this off yet.")}</span>}
        </div>
      </div>

      {/* The three clocks. Read-only: each one is decided by what actually
          happened to the task, not by anything typed here. */}
      {!creating && phases.some((p) => p.state !== 'none') && (
        <div className="cm-row">
          <span className="cm-key">{t('task.deadlines')}</span>
          <div className="phases">
            {phases.filter((p) => p.state !== 'none').map((p) => {
              const who = (p.owner_ids || [p.owner_id]).filter(Boolean)
                .map((id) => team.find((u) => u.id === id)?.name).filter(Boolean)
              return (
                <div className="phase-row" key={p.phase}>
                  <span className="phase-name">
                    {p.label}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {who.length ? who.join(' · ') : 'nobody yet'}
                    </span>
                  </span>
                  <span className={`phase-state phase-${p.state}`}>{PHASE_WORDS[p.state] || p.state}</span>
                  <span className="phase-meta">
                    due {p.revised ? <><s>{p.promised}</s> → <b>{p.revised}</b></> : <b>{p.due}</b>}
                    {p.delivered_day
                      ? <> · delivered {p.delivered_day}</>
                      : p.started_day ? <> · in hand since {p.started_day}</> : null}
                    {p.days_late > 0 && <> · <b>{p.days_late} day{p.days_late === 1 ? '' : 's'} late</b></>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Campaign — one dropdown, so campaign progress follows the kanban */}
      <div className="cm-row">
        <span className="cm-key">{t('task.campaign')}</span>
        <select
          className="select"
          style={{ maxWidth: 280 }}
          disabled={detailsLocked}
          value={form.campaign_id ?? ''}
          data-tip={tx("Tags this card to a campaign — its board fills itself")}
          onChange={(e) => setForm({ ...form, campaign_id: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">{tx("No campaign")}</option>
          {campaigns.map((cp) => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
        </select>
      </div>
      </>)}

      {/* Dates — the shoot in hours (from–to), the editor's cut deadline, the
          designer's artwork deadline, and the public release. Each maker is
          judged by their own date, never by the release. */}
      <div className="dates-block">
        {(() => {
          const shared = {
            form, setForm, disabled: detailsLocked, confirmSet,
            locked: datesLocked && !creating, onAskMove: canAsk ? askToMove : null,
          }
          const at = (k) => ({ ...shared, bad: badField === k })
          return (<>
            {!isDesign && <DateRow icon={Clapperboard} label="Shoot" dateKey="recording_date" timeKey="recording_time" endKey="recording_end" {...at('recording_date')} />}
            {!isDesign && <DateRow icon={Scissors} label="Edit ready" dateKey="edit_ready_date" {...at('edit_ready_date')} />}
            <DateRow icon={Palette} label="Design ready" dateKey="design_ready_date" {...at('design_ready_date')} />
            {!crewViewer && <DateRow icon={Send} label="Release" dateKey="release_date" timeKey="release_time" {...at('release_date')} />}
          </>)
        })()}
      </div>

      {/* Asking for a promised day to move. The reason is the point: a date
          that slips without one is a date nobody can plan around next time. */}
      {asking && (
        <div className="ask-move">
          <div className="ask-head">
            <CalendarClock size={15} /> Ask an admin to move {PROMISED[asking.field]}
          </div>
          <div className="ask-row">
            <span className="ask-was">now <b>{item?.[asking.field] || '—'}</b></span>
            <span className="drow-dash">→</span>
            <input className="input" type="date" value={asking.to}
              onChange={(e) => setAsking({ ...asking, to: e.target.value })} />
          </div>
          <textarea className="input" rows={2} autoFocus value={asking.reason}
            onChange={(e) => setAsking({ ...asking, reason: e.target.value })}
            placeholder={tx("What happened? The shoot was rained off, the location fell through…")} />
          <div className="ask-actions">
            <span className="stat-sub">{tx("They see it in the bell and in Telegram. The day does not move until they say yes.")}</span>
            <button type="button" className="btn btn-sm" onClick={() => setAsking(null)}>{tx("Cancel")}</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !asking.reason.trim()} onClick={sendAsk}>
              <Send size={13} /> Ask
            </button>
          </div>
        </div>
      )}

      {/* The asks themselves: what is waiting, and what was decided and why. */}
      {dateReqs.length > 0 && (
        <div className="cm-row cm-asks">
          <span className="cm-key"><CalendarClock size={13} style={{ verticalAlign: -2 }} /> {t('task.daymoves')}</span>
          <div className="ask-list">
            {dateReqs.map((r) => (
              <div key={r.id} className={`ask-item ask-${r.state}`}>
                <span className="ask-line">
                  <b>{PROMISED[r.field] || r.field}</b>: {r.from_date || '—'} → {r.to_date || 'cleared'}
                  <span className={`chip ask-state ask-chip-${r.state}`}>
                    {r.state === 'open' ? 'waiting on an admin'
                      : r.state === 'approved' ? 'moved'
                        : r.state === 'stale' ? 'out of date' : 'kept where it was'}
                  </span>
                </span>
                <span className="ask-why">“{r.reason}” — {r.asked_name || 'someone'}</span>
                {r.decided_at && (
                  <span className="ask-meta">
                    {r.state === 'approved' ? 'Moved' : r.state === 'stale' ? 'Dropped' : 'Kept'} by {r.decided_name}
                    {r.decided_note ? ` — ${r.decided_note}` : ''}
                  </span>
                )}
                {r.state === 'open' && isAdmin && (
                  <span className="ask-decide">
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => decide(r.id, false)}>{tx("Keep the day")}</button>
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => decide(r.id, true)}>
                      <Check size={13} /> Move it
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
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

      {/* Reference and Description are open from the start now, so what is
          left here is the chrome that only earns its space once it holds
          something. */}
      {!detailsLocked && (!show.checklist || (fOn('script') && !show.script && !form.script && !fReq('script')) || (!creating && !show.docs && docs.length === 0) || (!creating && !crewViewer && canEdit && !show.delivery)) && (
        <div className="extra-btns">
          {!creating && !show.docs && docs.length === 0 && (
            <button type="button" className="extra-btn" onClick={() => setShow({ ...show, docs: true })}><Paperclip size={14} />{' '}{tx("Documents")}</button>
          )}
          {fOn('script') && !show.script && !form.script && !fReq('script') && <button type="button" className="extra-btn" onClick={() => setShow({ ...show, script: true })}><FileText size={14} />{' '}{tx("Script")}</button>}
          {!show.checklist && <button type="button" className="extra-btn" onClick={() => setShow({ ...show, checklist: true })}><CheckSquare size={14} />{' '}{tx("Checklist")}</button>}
          {!creating && !crewViewer && canEdit && !show.delivery && (
            <button type="button" className="extra-btn" onClick={() => setShow({ ...show, delivery: true })}><Link2 size={14} />{' '}{tx("Delivery links")}</button>
          )}
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
                {!checklistLocked && <button className="icon-btn" style={{ padding: 2 }} data-tip={tx("Remove this item")} data-tip-left="" onClick={() => removeCheck(i)} aria-label={tx("Remove")}><X size={13} /></button>}
              </div>
            ))}
          </div>
          {!checklistLocked && (
            <div className="add-inline" style={{ padding: '6px 0 0' }}>
              <input className="input" value={subText} onChange={(e) => setSubText(e.target.value)}
                placeholder={tx("Add an item, press Enter…")} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCheck() } }} />
              <button className="btn btn-sm" onClick={addCheck}><Plus size={14} /></button>
            </div>
          )}
        </div>
      )}

      {/* The talk that belongs to the task — one thread, everyone on the
          piece can speak (the crew included; that is the point), and the
          bell carries each line to the rest. */}
      {!creating && (
        <div className="cm-row cm-comments">
          <span className="cm-key"><MessageSquare size={13} style={{ verticalAlign: -2 }} /> {t('task.talk')}{comments.length > 0 && <span className="count"> · {comments.length}</span>}</span>
          <div className="cmt-block">
            {comments.map((c) => (
              <div key={c.id} className="cmt-row">
                <b className="cmt-who">{(c.author || '?').split(' ')[0]}</b>
                <span className="cmt-text">
                  {c.text ? withMentions(c.text) : <span className="muted">{tx("voice note")}</span>}
                  {c.voice_id ? <VoicePlayer id={c.voice_id} secs={c.voice_secs} mine={c.user_id === user.id} /> : null}
                </span>
                <span className="cmt-when">{cmtWhen(c.created_at)}</span>
              </div>
            ))}
            {comments.length === 0 && <div className="tt-none" style={{ padding: '0 0 6px' }}>{tx("Nothing said yet — better here than lost in Telegram.")}</div>}
            <div className="add-inline cmt-input">
              <input className="input" value={cmtDraft} placeholder={tx("Say it where the task lives… @name reaches them")}
                onChange={(e) => setCmtDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendComment() } }} />
              {canRecord() && <VoiceRecorder key={clipNonce} onClip={setCmtClip} disabled={cmtBusy} />}
              <button className="btn btn-sm" onClick={sendComment} disabled={cmtBusy || (!cmtDraft.trim() && !cmtClip)} aria-label={tx("Send comment")}>
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The paper trail — every change on this task, written as a sentence:
          who touched which field, from what, to what. Three lines by default;
          the whole story on request. */}
      {!creating && activity.length > 0 && (
        <div className="cm-row cm-history">
          <span className="cm-key"><History size={13} style={{ verticalAlign: -2 }} /> {t('task.history')}<span className="count"> · {activity.length}</span></span>
          <div className="hist-block">
            {(allLog ? activity : activity.slice(0, 3)).map((a) => (
              <div key={a.id} className="cmt-row hist-row">
                <b className="cmt-who">{(a.user_name || '?').split(' ')[0]}</b>
                <span className="cmt-text">{activityLine(a)}</span>
                <span className="cmt-when">{cmtWhen(a.created_at)}</span>
              </div>
            ))}
            {activity.length > 3 && (
              <button type="button" className="hist-more" onClick={() => setAllLog(!allLog)}>
                {allLog ? 'Show less' : `Show all ${activity.length}`}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
