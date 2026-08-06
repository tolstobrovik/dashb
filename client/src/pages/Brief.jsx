import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Sun, Clapperboard, Scissors, Send, AlertCircle, CheckCircle2, CalendarRange, Check, StickyNote, ListTodo, PenLine, Trash2, Palette,
  Rows3, CalendarDays, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, AlertTriangle, RotateCcw, ExternalLink, Link2,
  SlidersHorizontal, Eye, EyeOff,
} from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, addDaysISO, dateLabel, typeInfo, onColor, isDeletedLabel, can, tashkentDay } from '../lib/constants.js'
import ContentModal from '../components/ContentModal.jsx'
import { useContextMenu } from '../components/ContextMenu.jsx'
import { toast } from '../lib/toast.js'
import { playDone } from '../lib/sound.js'

// My Day — the deadline-first landing page, in two shapes:
//   crew (operator / editor / both): what to shoot at which hour, the editing
//     desk with the edit-ready deadline, releases — the videographer's day.
//   everyone else: dead simple — what is missing, what to do today, then
//     tomorrow / 3 days / 7 days / any custom dates. Their own tasks only.

const hhmm = (t) => (t ? t.slice(0, 5) : null)

// What kind of work a row is — worn as the first chip so SHOOT vs EDIT vs
// DESIGN vs RELEASE is never a guess.
const WORK = {
  shoot: { label: 'Shoot', icon: Clapperboard, cls: 'wk-shoot' },
  edit: { label: 'Edit', icon: Scissors, cls: 'wk-edit' },
  design: { label: 'Design', icon: Palette, cls: 'wk-edit' },
  release: { label: 'Release', icon: Send, cls: 'wk-rel' },
}
// Which kind a date belongs to on this task — every maker has their own date.
const workOnDate = (t, d) =>
  t.recording_date === d ? 'shoot'
    : t.design_ready_date === d ? 'design'
      : t.edit_ready_date === d ? 'edit' : 'release'

/* The crew's own month calendar: their shoots on the shoot day, their cuts on
   the edit-ready day, their artwork on the design-ready day. No release dates
   — the crew works to the maker deadlines, not the publishing schedule. */
function CrewCalendar({ tasks, userId, today, byKey, onOpen }) {
  const [month, setMonth] = useState(today.slice(0, 7)) // YYYY-MM
  const move = (n) => {
    const d = new Date(`${month}-01T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + n)
    setMonth(d.toISOString().slice(0, 7))
  }
  const entries = useMemo(() => {
    const m = {}
    const push = (date, kind, t) => { (m[date] ||= []).push({ kind, t }) }
    for (const t of tasks) {
      if (t.done_at) continue
      if (t.operator_id === userId && t.recording_date) push(t.recording_date, 'shoot', t)
      if (t.editor_id === userId && t.edit_ready_date && !t.ready_at) push(t.edit_ready_date, 'edit', t)
      if (t.designer_id === userId && t.design_ready_date && !t.ready_at) push(t.design_ready_date, 'design', t)
      // no maker date of their own → the release day is the implicit deadline,
      // shown as plain edit/design work (never as a release)
      if (t.editor_id === userId && !t.edit_ready_date && !t.ready_at && t.release_date) push(t.release_date, 'edit', t)
      if (t.designer_id === userId && !t.design_ready_date && !t.ready_at && t.release_date) push(t.release_date, 'design', t)
    }
    for (const list of Object.values(m))
      list.sort((a, b) => ((a.t.recording_time || '99')).localeCompare(b.t.recording_time || '99'))
    return m
  }, [tasks, userId])

  // Monday-first month grid.
  const weeks = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00Z`)
    const start = new Date(first)
    start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7))
    const out = []
    for (let w = 0; w < 6; w++) {
      const row = []
      for (let d = 0; d < 7; d++) {
        const day = new Date(start)
        day.setUTCDate(start.getUTCDate() + w * 7 + d)
        row.push(day.toISOString().slice(0, 10))
      }
      out.push(row)
      if (row[6] >= `${month}-28` && new Date(`${row[6]}T00:00:00Z`).getUTCMonth() !== first.getUTCMonth()) break
    }
    return out
  }, [month])

  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const KIND = { shoot: { icon: Clapperboard, cls: 'ev-shoot', word: 'Shoot' }, edit: { icon: Scissors, cls: 'ev-edit', word: 'Edit due' }, design: { icon: Palette, cls: 'ev-edit', word: 'Design due' } }
  return (
    <div className="card card-pad">
      <div className="cc-nav">
        <button className="icon-btn" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <b>{monthName}</b>
        <button className="icon-btn" onClick={() => move(1)} aria-label="Next month"><ChevronRight size={16} /></button>
        {month !== today.slice(0, 7) && <button className="lnk" onClick={() => setMonth(today.slice(0, 7))}>today</button>}
      </div>
      <div className="cc-grid cc-headrow">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cc-head">{d}</div>)}
      </div>
      {weeks.map((row, i) => (
        <div key={i} className="cc-grid">
          {row.map((iso) => {
            const other = iso.slice(0, 7) !== month
            return (
              <div key={iso} className={'cc-day' + (other ? ' cc-other' : '') + (iso === today ? ' cc-today' : '')}>
                <span className="cc-num">{Number(iso.slice(8))}</span>
                {(entries[iso] || []).map(({ kind, t }) => {
                  const K = KIND[kind]
                  const Icon = K.icon
                  return (
                    <button key={`${kind}${t.id}`} className={`cc-ev ${K.cls}`} onClick={() => onOpen(t)} title={t.title}>
                      <b><Icon size={10} /> {K.word}{kind === 'shoot' && t.recording_time ? ` · ${t.recording_time.slice(0, 5)}` : ''}</b>
                      <span>{t.title}</span>
                      <i>{t.channels.map((c) => byKey[c]?.label || c).join(' · ')}</i>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/* Module-level row (poll ticks must not remount it). */
function BriefRow({ item, when, time, late = false, done = false, work = null, byKey, statusesById, onOpen, onMenu }) {
  const status = statusesById[item.status_id]
  const wk = work && WORK[work]
  const WkIcon = wk?.icon
  return (
    <button className="ov-row" onClick={() => onOpen(item)}
      onContextMenu={onMenu ? (e) => onMenu(e, item) : undefined}>
      <span className={'brief-when' + (late ? ' late' : '')}>
        {time ? <b>{time}</b> : <span className="brief-anytime">any time</span>}
        {when && <span className="brief-when-sub">{when}</span>}
      </span>
      <span className="brief-main">
        <span className={'ov-title' + (done ? ' done-txt' : '')}>{item.title}</span>
        {item.description && !done && (
          <span className="brief-note" data-tip="Notes for shooting / editing — open the task for the full text">
            <StickyNote size={11} /> {item.description}
          </span>
        )}
      </span>
      <span className="ov-chips">
        {wk && <span className={`chip wk-chip ${wk.cls}`}><WkIcon size={10} /> {wk.label}</span>}
        <span className={`chip ct-${item.type}`}>{typeInfo(item.type).label}</span>
        {item.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
        {status && !done && <span className="chip" style={{ background: status.color, color: onColor(status.color) }}>{status.label}</span>}
      </span>
    </button>
  )
}

/* Two crafts, two lanes: SHOOT left, EDIT right. Each lane splits into
   DONE / TO-DO TODAY / TOMORROW / UPCOMING — and everything except today
   starts folded, so the day keeps the focus. "Done" is judged by the
   pipeline, not just the checkbox: a shoot counts done once the task moved
   past filming, a cut/artwork once it reached ready or published. */
function crewLanes(content, userId, statusesById, today) {
  const tomorrow = addDaysISO(today, 1)
  const stOf = (t) => statusesById[t.status_id]?.label || ''
  const shootDone = (t) => !!t.done_at || !!t.ready_at || /shot|edit|ready|publish|post|got/i.test(stOf(t))
  const makeDone = (t) => !!t.done_at || !!t.ready_at || /ready|publish|post|approv|got/i.test(stOf(t))
  const lane = { shoot: [], edit: [] }
  for (const t of content) {
    // A killed piece (Deleted stage) counts for its maker — the shoot is over,
    // it lands in the operator's Done — but never for the editor or designer:
    // there is nothing left to cut or draw.
    const dead = isDeletedLabel(stOf(t))
    if (t.operator_id === userId)
      lane.shoot.push({ t, kind: 'shoot', due: t.recording_date || null, done: shootDone(t) || dead, stamp: t.ready_at || t.done_at || t.recording_date || '' })
    if (dead) continue
    if (t.editor_id === userId)
      lane.edit.push({ t, kind: 'edit', due: t.edit_ready_date || t.release_date || null, done: makeDone(t), stamp: t.ready_at || t.done_at || '' })
    if (t.designer_id === userId)
      lane.edit.push({ t, kind: 'design', due: t.design_ready_date || t.release_date || null, done: makeDone(t), stamp: t.ready_at || t.done_at || '' })
  }
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') ||
    (a.t.recording_time || '99').localeCompare(b.t.recording_time || '99')
  const split = (list) => ({
    // Past its deadline and still not done — the work that keeps haunting.
    missed: list.filter((e) => !e.done && e.due && e.due < today).sort(byDue),
    today: list.filter((e) => !e.done && e.due === today).sort(byDue),
    tomorrow: list.filter((e) => !e.done && e.due === tomorrow).sort(byDue),
    upcoming: list.filter((e) => !e.done && (!e.due || e.due > tomorrow)).sort(byDue),
    done: list.filter((e) => e.done).sort((a, b) => String(b.stamp).localeCompare(String(a.stamp))).slice(0, 15),
  })
  return { shoot: split(lane.shoot), edit: split(lane.edit) }
}

function CrewBoard({ lanes, caps = [], today, byKey, onOpen, onMenu }) {
  const [unfolded, setUnfolded] = useState({}) // "lane:section" → true
  const toggle = (k, dflt = false) => setUnfolded((s) => ({ ...s, [k]: !(s[k] === undefined ? dflt : s[k]) }))
  const KIND = {
    shoot: { icon: Clapperboard, word: null },
    edit: { icon: Scissors, word: 'Edit' },
    design: { icon: Palette, word: 'Design' },
  }
  const Row = ({ e }) => {
    const late = !e.done && e.due && e.due < today
    const K = KIND[e.kind]
    const Icon = K.icon
    return (
      <button className="cb-row" onClick={() => onOpen(e.t)} onContextMenu={onMenu ? (ev) => onMenu(ev, e.t) : undefined}>
        <span className={'cb-when' + (late ? ' late' : '')}>
          {e.done
            ? <CheckCircle2 size={13} />
            : e.due
              ? (late ? `${dateLabel(e.due)}` : e.due === today ? (e.t.recording_time || '').slice(0, 5) || 'today' : dateLabel(e.due))
              : 'no date'}
        </span>
        <span className="cb-main">
          <span className={'cb-title' + (e.done ? ' done-txt' : '')}>{e.t.title}</span>
          <span className="cb-sub">
            {K.word && <b className="cb-kind"><Icon size={10} /> {K.word}</b>}
            {e.t.channels.map((c) => byKey[c]?.label || c).join(' · ')}
            {late && <b className="cb-late"> · late</b>}
          </span>
          {!e.done && e.t.description && (
            <span className="cb-note">{e.t.description.length > 90 ? `${e.t.description.slice(0, 90)}…` : e.t.description}</span>
          )}
        </span>
      </button>
    )
  }
  const Sec = ({ laneKey, secKey, label, items, always = false }) => {
    const k = `${laneKey}:${secKey}`
    const open = always || !!unfolded[k]
    return (
      <div className="cb-sec">
        {always ? (
          <div className="cb-sec-head">{label} <span className="count">· {items.length}</span></div>
        ) : (
          <button className="cb-sec-head cb-toggle" onClick={() => toggle(k)} aria-expanded={open}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {label} <span className="count">· {items.length}</span>
          </button>
        )}
        {open && (items.length === 0
          ? <div className="tt-none" style={{ padding: '2px 0 6px' }}>—</div>
          : items.map((e) => <Row key={`${e.kind}${e.t.id}`} e={e} />))}
      </div>
    )
  }
  // The overdue-but-open work, above everything. It shouts while it has items
  // (red, open by default) and goes calm — "read" — the moment it hits zero.
  const MissedSec = ({ laneKey, items }) => {
    if (items.length === 0) {
      return <div className="cb-sec cb-clear"><CheckCircle2 size={13} /> Nothing overdue — all clear</div>
    }
    const k = `${laneKey}:missed`
    const open = unfolded[k] === undefined ? true : unfolded[k]
    return (
      <div className="cb-sec cb-emergency">
        <button className="cb-sec-head cb-toggle" onClick={() => toggle(k, true)} aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <AlertTriangle size={13} /> Missed — still haunting <span className="count">· {items.length}</span>
        </button>
        {open && items.map((e) => <Row key={`m${e.kind}${e.t.id}`} e={e} />)}
      </div>
    )
  }
  const Lane = ({ laneKey, icon: Icon, title, data }) => (
    <div className="card card-pad cb-col">
      <div className="cb-col-head"><Icon size={17} /> {title}</div>
      <MissedSec laneKey={laneKey} items={data.missed} />
      <Sec laneKey={laneKey} secKey="today" label="To-do today" items={data.today} always />
      <Sec laneKey={laneKey} secKey="tomorrow" label="Tomorrow" items={data.tomorrow} />
      <Sec laneKey={laneKey} secKey="upcoming" label="Upcoming" items={data.upcoming} />
      <Sec laneKey={laneKey} secKey="done" label="Done" items={data.done} />
    </div>
  )
  // A lane earns its place by capability OR by work actually held — an
  // editor-only account never stares at an empty SHOOT column, but a member
  // handed a one-time shoot still sees it.
  const has = (d) => d.missed.length + d.today.length + d.tomorrow.length + d.upcoming.length + d.done.length > 0
  const showShoot = caps.includes('operator') || has(lanes.shoot)
  const showEdit = caps.includes('editor') || caps.includes('designer') || has(lanes.edit)
  const editTitle = caps.includes('designer') && !caps.includes('editor') ? 'DESIGN' : caps.includes('editor') && caps.includes('designer') ? 'EDIT & DESIGN' : 'EDIT'
  const EditIcon = editTitle === 'DESIGN' ? Palette : Scissors
  return (
    <div className={'crew-board' + (showShoot && showEdit ? '' : ' one-lane')}>
      {showShoot && <Lane laneKey="shoot" icon={Clapperboard} title="SHOOT" data={lanes.shoot} />}
      {showEdit && <Lane laneKey="edit" icon={EditIcon} title={editTitle} data={lanes.edit} />}
    </div>
  )
}

/* One Pravki (revision) card in the crew's "changes to make" lane: the task,
   who sent it, the change note, the reference, the relevant delivery link and
   the fix deadline. One "Fixed" action drops the updated link and returns the
   task to Ready for the SMM. Module-level so poll ticks don't remount it. */
function PravkiCard({ rev, byKey, today, onOpen, onFixed }) {
  const relCol = rev.target === 'operator' ? 'shot_link' : rev.target === 'designer' ? 'design_link' : 'ready_link'
  const [link, setLink] = useState(rev[relCol] || '')
  const [busy, setBusy] = useState(false)
  // The task's other rounds — everything asked before this one.
  const prior = (rev.history || []).filter((h) => h.round !== rev.round)
  const deadline = rev.target === 'operator' ? rev.recording_date
    : rev.target === 'designer' ? (rev.design_ready_date || rev.release_date)
      : (rev.edit_ready_date || rev.release_date)
  const fix = async () => { setBusy(true); try { await onFixed(rev, link.trim()) } finally { setBusy(false) } }
  return (
    <div className="pravki-card">
      <button className="pravki-open" onClick={() => onOpen(rev.content_id)}>
        <div className="pravki-top">
          <b className="pravki-title">{rev.title}</b>
          <span className="pravki-round">Pravki #{rev.round}</span>
        </div>
        <div className="pravki-meta">
          {rev.channels.map((c) => byKey[c]?.label || c).join(' · ')} · from {rev.requested_name || 'SMM'}
          {deadline && <> · <b className={deadline < today ? 'pravki-late' : ''}>due {dateLabel(deadline)}</b></>}
        </div>
        <div className="pravki-note">{rev.note}</div>
        {(rev.reference_text || (rev.reference_links || []).length > 0) && (
          <div className="pravki-ref">
            {rev.reference_text && <span className="pravki-ref-text">{rev.reference_text}</span>}
            {(rev.reference_links || []).map((u, i) => (/^https?:\/\//i.test(u)
              ? <a key={i} className="pravki-ref-link" href={u} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><ExternalLink size={10} /> ref {i + 1}</a>
              : null))}
          </div>
        )}
      </button>
      {/* The fixer's context, right on the card: the brief (ТЗ) the piece was
          made to, and the rounds that came before this one — no digging. */}
      {(rev.format || rev.rubrika || rev.script) && (
        <div className="pravki-brief">
          {rev.format && <span className="chip chip-muted">{rev.format}</span>}
          {rev.rubrika && <span className="chip chip-muted">#{rev.rubrika}</span>}
          {rev.script && (
            <details className="pravki-extra">
              <summary>The script / ТЗ</summary>
              <div className="crew-script">{rev.script}</div>
            </details>
          )}
        </div>
      )}
      {prior.length > 0 && (
        <details className="pravki-extra">
          <summary>Earlier rounds · {prior.length}</summary>
          <div className="pravki-prior">
            {prior.map((h) => (
              <div key={h.round} className="pravki-prior-row">
                <b>#{h.round}</b>{h.note}
                <span className="done-txt"> — {h.requested_name || 'SMM'}{h.resolved_at ? ' · fixed' : ''}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="pravki-fix">
        <input className="input" placeholder="Updated Google-Drive link…" value={link} onChange={(e) => setLink(e.target.value)} />
        {rev[relCol] && /^https?:\/\//i.test(rev[relCol]) && (
          <a className="btn btn-sm" href={rev[relCol]} target="_blank" rel="noreferrer"
            data-tip="Open the current file" aria-label="Open the current file"><ExternalLink size={14} /></a>
        )}
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={fix}><Check size={14} /> Fixed</button>
      </div>
    </div>
  )
}

export default function Brief() {
  const { user } = useAuth()
  const { byKey } = useChannels()
  const isCrew = ['editor', 'operator', 'crew'].includes(user.role)
  // The crew flips between the day list and their own month calendar.
  const [myView, setMyViewState] = useState(() => localStorage.getItem('satashkent_myday_view') || 'list')
  const setMyView = (v) => { setMyViewState(v); localStorage.setItem('satashkent_myday_view', v) }
  const [boot] = useState(() => cache.get(`brief:${user.id}`))
  const [content, setContent] = useState(boot?.content || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  const [personal, setPersonal] = useState(boot?.personal || [])
  const [pravki, setPravki] = useState(boot?.pravki || [])
  const [loading, setLoading] = useState(!boot)
  const [openItem, setOpenItem] = useState(null)
  // the simple view's custom horizon — folded until asked for
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  // My Day, your order: the simple view's sections can be reordered and
  // hidden per account (this browser). Defaults match the built-in order,
  // so an untouched day looks exactly as it always did.
  const DAY_KEYS = ['missing', 'pravki', 'review', 'today', 'personal', 'coming', 'done']
  const [dayPrefs, setDayPrefs] = useState(() => {
    try {
      const o = JSON.parse(localStorage.getItem(`satashkent_day_${user.id}`) || 'null')
      if (o && Array.isArray(o.order) && Array.isArray(o.hidden)) return o
    } catch { /* defaults */ }
    return { order: [], hidden: [] }
  })
  const [arranging, setArranging] = useState(false)
  const saveDayPrefs = (next) => {
    setDayPrefs(next)
    try { localStorage.setItem(`satashkent_day_${user.id}`, JSON.stringify(next)) } catch { /* ok */ }
  }
  const orderedDayKeys = () => {
    const pos = new Map(dayPrefs.order.map((k, i) => [k, i]))
    return [...DAY_KEYS].sort((a, b) => (pos.has(a) ? pos.get(a) : 1e9) - (pos.has(b) ? pos.get(b) : 1e9))
  }
  const moveSection = (key, dir) => {
    const keys = orderedDayKeys()
    const i = keys.indexOf(key)
    const j = i + dir
    if (i < 0 || j < 0 || j >= keys.length) return
    keys.splice(j, 0, keys.splice(i, 1)[0])
    saveDayPrefs({ ...dayPrefs, order: keys })
  }
  const toggleSection = (key) => saveDayPrefs({
    ...dayPrefs,
    hidden: dayPrefs.hidden.includes(key) ? dayPrefs.hidden.filter((k) => k !== key) : [...dayPrefs.hidden, key],
  })
  const resetDayPrefs = () => saveDayPrefs({ order: [], hidden: [] })

  useEffect(() => {
    Promise.all([api.get('/content'), api.cached('/statuses'), api.get('/personal'), api.get('/content/revisions/mine')])
      .then(([ct, st, ps, pv]) => {
        setContent(ct); setStatuses(st); setPersonal(ps); setPravki(pv)
        cache.set(`brief:${user.id}`, {
          content: ct.map(({ photo_thumb: _t, ...rest }) => rest), statuses: st, personal: ps, pravki: pv,
        })
      })
      .finally(() => setLoading(false))
  }, [user.id])

  useEffect(() => {
    const refresh = () => {
      if (document.hidden || openItem) return
      // All three ride ETags: unchanged data is a 304 and the page doesn't
      // re-render at all — the every-10s tick costs nothing when it's quiet.
      api.poll('/content').then((f) => { if (f) setContent(f) }).catch(() => {})
      api.poll('/personal').then((f) => { if (f) setPersonal(f) }).catch(() => {})
      api.pollView('/content/revisions/mine').then((f) => { if (f) setPravki(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [openItem])

  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  const today = todayISO()

  // "Mine" = anything where I hold a role: any of the assignees, the
  // operator, the editor, or the designer.
  const mine = useMemo(
    () => content.filter((t) => (t.assignees?.length ? t.assignees.includes(user.id) : t.assignee_id === user.id) ||
      t.operator_id === user.id || t.editor_id === user.id || t.designer_id === user.id),
    [content, user.id])

  // Open = not done and not killed: a Deleted task has no upcoming work for
  // anyone, so it leaves the day lists and the crew calendar entirely.
  const open = useMemo(
    () => mine.filter((t) => !t.done_at && !isDeletedLabel(statusesById[t.status_id]?.label)),
    [mine, statusesById])

  const recordToday = useMemo(
    () => open.filter((t) => t.recording_date === today)
      .sort((a, b) => (a.recording_time || '99').localeCompare(b.recording_time || '99')),
    [open, today])
  const releaseToday = useMemo(
    () => open.filter((t) => t.release_date === today && t.recording_date !== today)
      .sort((a, b) => (a.release_time || '99').localeCompare(b.release_time || '99')),
    [open, today])
  // The editing desk: anything I edit that is already shot (or undated) and not
  // out yet — due on the edit-ready date when one is set, the release otherwise.
  const desk = useMemo(
    () => open.filter((t) => t.editor_id === user.id && (!t.recording_date || t.recording_date < today))
      .sort((a, b) => ((a.edit_ready_date || a.release_date || '9999')).localeCompare(b.edit_ready_date || b.release_date || '9999')),
    [open, user.id, today])
  const inEditing = useMemo(
    () => desk.filter((t) => (statusesById[t.status_id]?.label || '').toLowerCase() === 'editing'),
    [desk, statusesById])
  // The task's live deadline: the release or an un-met edit-ready date —
  // whichever comes first. The shoot day only counts when it's the only date
  // (a past shoot with a future release is on schedule, not overdue).
  // Every clock still ticks — but the crew never SEES a release date. When a
  // cut has no edit-ready date of its own, the release day acts as the
  // implicit deadline and is presented as plain edit work ("due <date>").
  const deadlineOf = (t) =>
    [t.release_date, !t.ready_at ? t.edit_ready_date : null, !t.ready_at ? t.design_ready_date : null]
      .filter(Boolean).sort()[0] || t.recording_date
  // What a crew row's date means to THEM: never "release".
  const crewWork = (k) => (isCrew && k === 'release' ? 'edit' : k)
  const overdue = useMemo(
    () => open.filter((t) => {
      const dd = deadlineOf(t)
      return dd && dd < today
    }).sort((a, b) => deadlineOf(a).localeCompare(deadlineOf(b))),
    [open, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const upNext = useMemo(
    () => open.filter((t) => t.operator_id === user.id && t.recording_date && t.recording_date > today)
      .sort((a, b) => a.recording_date.localeCompare(b.recording_date)).slice(0, 5),
    [open, user.id, today])
  const personalToday = useMemo(
    () => personal.filter((p) => !p.done_at && (p.pinned || !p.due_date || p.due_date <= today)),
    [personal, today])
  // The two-lane board data (crew accounts only) — done judged by the pipeline.
  const lanes = useMemo(
    () => (isCrew ? crewLanes(content, user.id, statusesById, today) : null),
    [content, user.id, statusesById, today, isCrew])

  // The reviewer's queue: Ready work on your channels waits for your call —
  // publish it with one tap, or open it to send Pravki. The other half of
  // the crew's Pravki lane.
  const reviewQueue = useMemo(() => {
    if (isCrew || !(user.role === 'admin' || can(user, 'review_publish'))) return []
    const ready = new Set(statuses.filter((s) => /^ready$/i.test(s.label)).map((s) => s.id))
    return content
      .filter((t) => !t.done_at && ready.has(t.status_id) &&
        (user.role === 'admin' || t.channels.some((c) => (user.departments || []).includes(c))))
      // The run-sheet order: release day, then the slot time — the way the
      // SMM actually works down the list.
      .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999') ||
        (a.release_time || '99').localeCompare(b.release_time || '99'))
  }, [content, statuses, user, isCrew])


  // The nearest upcoming date of a task — shoot, edit-ready or release.
  const nextOf = (t) => {
    const ds = [t.recording_date, t.edit_ready_date, t.design_ready_date, t.release_date].filter((d) => d && d > today)
    return ds.sort()[0] || null
  }

  // Coming up, in the horizons everyone plans by. The simple view swaps the
  // month for a custom date range of your own.
  const horizons = useMemo(() => {
    const buckets = [
      { key: '1d', label: 'Tomorrow', from: 1, to: 1 },
      { key: '3d', label: 'Next 3 days', from: 2, to: 3 },
      { key: '7d', label: 'Next 7 days', from: 4, to: 7 },
      ...(isCrew ? [{ key: '30d', label: 'Next month', from: 8, to: 30 }] : []),
    ].map((b) => ({ ...b, items: [] }))
    for (const t of open) {
      const d = nextOf(t)
      if (!d) continue
      const away = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5)
      const b = buckets.find((x) => away >= x.from && away <= x.to)
      if (b) b.items.push({ ...t, _next: d, _rec: t.recording_date === d })
    }
    for (const b of buckets) b.items.sort((a, x) => a._next.localeCompare(x._next))
    return buckets
  }, [open, today, isCrew]) // eslint-disable-line react-hooks/exhaustive-deps

  // The custom horizon (simple view): any dates you pick.
  const customItems = useMemo(() => {
    if (!from && !to) return null
    return open
      .map((t) => ({ ...t, _next: nextOf(t) }))
      .filter((t) => t._next && (!from || t._next >= from) && (!to || t._next <= to))
      .sort((a, b) => a._next.localeCompare(b._next))
  }, [open, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  // Everything due today, whatever the clock — the simple view's main list.
  const dueToday = useMemo(
    () => open.filter((t) => t.recording_date === today || t.release_date === today || t.edit_ready_date === today)
      .sort((a, b) => (a.recording_time || a.release_time || '99').localeCompare(b.recording_time || b.release_time || '99')),
    [open, today])

  // What they have done — the finished work, freshest first.
  const doneRows = useMemo(
    () => mine.filter((t) => t.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 10),
    [mine])

  const togglePersonal = async (p) => {
    try {
      if (!p.done_at) playDone()
      const u = await api.patch(`/personal/${p.id}`, { done: !p.done_at })
      setPersonal((prev) => prev.map((x) => (x.id === p.id ? u : x)))
    } catch (e) { alert(e.message) }
  }
  const updateContent = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    setContent((prev) => prev.map((x) => (x.id === item.id ? u : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
  }
  // "Fixed": deliver the updated link and send the task back to Ready.
  const markFixed = async (rev, link) => {
    try {
      const r = await api.post(`/content/revisions/${rev.id}/resolve`, link ? { link } : {})
      if (r.task) setContent((prev) => prev.map((x) => (x.id === r.task.id ? r.task : x)))
      setPravki((prev) => prev.filter((x) => x.id !== rev.id))
      toast('Fixed — back to the SMM')
    } catch (e) { alert(e.message) }
  }
  const openByContentId = (cid) => { const t = content.find((x) => x.id === cid); if (t) setOpenItem(t) }

  // Right-click on any row: the quick verbs without opening the task.
  const { openMenu } = useContextMenu()
  const rowMenu = (e, item) => openMenu(e, [
    { label: 'Open', icon: PenLine, onClick: () => setOpenItem(item) },
    { label: item.done_at ? 'Mark as not done' : 'Mark as done', icon: Check, onClick: () => updateContent(item, { done: !item.done_at }).then(() => toast('Saved — synced')).catch((err) => alert(err.message)) },
    { sep: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => { if (confirm(`Delete “${item.title}”?`)) deleteContent(item).catch((err) => alert(err.message)) } },
  ])

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const niceDate = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const firstName = user.name.split(' ')[0]

  const missingBlock = overdue.length > 0 && (
    <>
      <div className="section-head">
        <AlertCircle size={17} style={{ color: '#A32D2D' }} />
        <h2 style={{ color: '#A32D2D' }}>{isCrew ? 'Needs attention' : 'Missing'}</h2>
        <span className="count">· past the deadline</span>
        <span className="spacer" />
        <Link className="btn btn-sm" to="/missed">All missed deadlines →</Link>
      </div>
      <div className="card card-pad brief-list">
        {overdue.map((t) => (
          <BriefRow key={t.id} item={t} late done={false}
            when={dateLabel(deadlineOf(t))} work={crewWork(workOnDate(t, deadlineOf(t)))}
            time={null} byKey={byKey} statusesById={statusesById} onOpen={setOpenItem} onMenu={rowMenu} />
        ))}
      </div>
    </>
  )

  const publishNow = async (t) => {
    const fin = statuses.find((s) => s.is_final)
    if (!fin) return
    try {
      playDone()
      await updateContent(t, { status_id: fin.id })
      toast('Published — synced')
    } catch (e) { alert(e.message) }
  }

  const reviewBlock = reviewQueue.length > 0 && (
    <>
      <div className="section-head">
        <Send size={17} style={{ color: '#2a78d6' }} />
        <h2 style={{ color: '#2a78d6' }}>Waiting for your review</h2>
        <span className="count">· {reviewQueue.length}</span>
      </div>
      <div className="card card-pad brief-list">
        {reviewQueue.slice(0, 12).map((t) => (
          <div key={t.id} className="ov-row rq-row" role="button" tabIndex={0}
            onClick={() => setOpenItem(t)}
            onKeyDown={(e) => { if (e.key === 'Enter') setOpenItem(t) }}>
            <span className="brief-when">
              {t.release_date
                ? <span className="brief-when-sub">{dateLabel(t.release_date)}{t.release_time ? ` · ${t.release_time.slice(0, 5)}` : ''}</span>
                : <span className="brief-anytime">no date</span>}
            </span>
            <span className="brief-main"><span className="ov-title">{t.title}</span></span>
            <span className="ov-chips">
              <span className={`chip ct-${t.type}`}>{typeInfo(t.type).label}</span>
              {t.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
              {(t.ready_link || t.design_link) && (
                <>
                  {/^https?:\/\//i.test(t.ready_link || t.design_link) && (
                    <a className="btn btn-sm rq-open" href={t.ready_link || t.design_link}
                      target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                      data-tip="Watch the finished file before releasing it">
                      <ExternalLink size={13} /> {t.ready_link ? 'Cut' : 'Design'}
                    </a>
                  )}
                  <button className="icon-btn rq-copy"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigator.clipboard?.writeText(t.ready_link || t.design_link)
                        .then(() => toast('Delivery link copied — paste it into the platform'))
                        .catch(() => {})
                    }}
                    data-tip="Copy the finished file's link" aria-label="Copy delivery link">
                    <Link2 size={14} />
                  </button>
                </>
              )}
              <button className="btn btn-sm btn-primary rq-pub"
                onClick={(e) => { e.stopPropagation(); publishNow(t) }}
                data-tip="Release it — Ready → Published">
                <Send size={13} /> Publish
              </button>
            </span>
          </div>
        ))}
        {reviewQueue.length > 12 && <div className="tt-none" style={{ padding: '4px 0 0' }}>+{reviewQueue.length - 12} more on the boards</div>}
      </div>
    </>
  )

  const pravkiBlock = pravki.length > 0 && (
    <>
      <div className="section-head">
        <RotateCcw size={17} style={{ color: '#b5324a' }} />
        <h2 style={{ color: '#b5324a' }}>Pravki — changes to make</h2>
        <span className="count">· {pravki.length}</span>
      </div>
      <div className="pravki-lane">
        {pravki.map((r) => (
          <PravkiCard key={r.id} rev={r} byKey={byKey} today={today} onOpen={openByContentId} onFixed={markFixed} />
        ))}
      </div>
    </>
  )

  const personalBlock = personalToday.length > 0 && (
    <>
      <div className="section-head">
        <CheckCircle2 size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>Also on your list</h2>
        <span className="count">· {personalToday.length}</span>
      </div>
      <div className="card card-pad brief-list">
        {personalToday.map((p) => (
          <div key={p.id} className="ov-row" style={{ cursor: 'default' }}>
            <button className="todo-check" onClick={() => togglePersonal(p)} data-tip="Mark as done" aria-label="Complete">
              {p.done_at && <Check size={15} strokeWidth={3.5} />}
            </button>
            <span className="ov-title">{p.title}</span>
            <span className="ov-chips">
              {p.due_date && <span className={'chip ' + (p.due_date < today ? 'chip-danger' : 'chip-muted')}>{dateLabel(p.due_date)}</span>}
            </span>
          </div>
        ))}
      </div>
    </>
  )

  // Nothing finished yet → no headline about it; the section earns its place.
  const doneBlock = doneRows.length > 0 && (
    <>
      <div className="section-head">
        <CheckCircle2 size={17} style={{ color: 'var(--good-ink, #0ca30c)' }} />
        <h2>What you’ve done</h2>
        <span className="count">· last {doneRows.length}</span>
      </div>
      {doneRows.length > 0 && (
        <div className="card card-pad brief-list">
          {doneRows.map((t) => (
            <BriefRow key={t.id} item={t} done
              when={dateLabel(tashkentDay(t.done_at))} time={null}
              byKey={byKey} statusesById={statusesById} onOpen={setOpenItem} onMenu={rowMenu} />
          ))}
        </div>
      )}
    </>
  )

  // ============ the simple view: admin & members ============
  if (!isCrew) {
    const nothingToday = dueToday.length === 0 && overdue.length === 0
    const todayBlock = dueToday.length > 0 && (
      <>
        <div className="section-head">
          <ListTodo size={17} style={{ color: 'var(--brand-500)' }} />
          <h2>To do today</h2>
          <span className="count">· {dueToday.length}</span>
        </div>
        <div className="card card-pad brief-list">
          {dueToday.map((t) => (
            <BriefRow key={t.id} item={t} work={workOnDate(t, today)}
              time={hhmm(t.recording_date === today ? t.recording_time : t.release_time)}
              byKey={byKey} statusesById={statusesById} onOpen={setOpenItem} onMenu={rowMenu} />
          ))}
        </div>
      </>
    )
    const comingBlock = (
      <>
        <div className="section-head">
          <CalendarRange size={17} style={{ color: 'var(--brand-500)' }} />
          <h2>Coming up</h2>
          <span className="stat-sub" style={{ fontWeight: 500 }}>tomorrow · 3 days · 7 days · your dates</span>
        </div>
        <div className="card card-pad brief-list">
          {/* Only horizons that hold work render — a quiet week is one calm
              line, not four headed blocks of dashes. */}
          {horizons.every((b) => b.items.length === 0) && (
            <div className="tt-none" style={{ padding: '2px 0 6px' }}>Nothing scheduled in the next 7 days.</div>
          )}
          {horizons.filter((b) => b.items.length > 0).map((b) => (
            <div key={b.key} className="brief-horizon">
              <div className="brief-h-head">
                {b.label} <span className="count">· {b.items.length}</span>
              </div>
              {b.items.map((t) => (
                <BriefRow key={`${t.id}-${t._next}`} item={t}
                  when={dateLabel(t._next)} work={workOnDate(t, t._next)}
                  time={t._rec ? (t.recording_time || '').slice(0, 5) || null : (t.release_time || '').slice(0, 5) || null}
                  byKey={byKey} statusesById={statusesById} onOpen={setOpenItem} onMenu={rowMenu} />
              ))}
            </div>
          ))}
          <div className="brief-horizon">
            {!customOpen ? (
              <button className="extra-btn" onClick={() => setCustomOpen(true)}>
                <CalendarRange size={13} /> Pick your own dates
              </button>
            ) : (
              <>
                <div className="brief-h-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  Custom
                  <span className="miss-custom" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                    <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                    <span className="drow-dash">–</span>
                    <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  </span>
                  {customItems && <span className="count">· {customItems.length}</span>}
                </div>
                {customItems === null ? (
                  <div className="tt-none" style={{ padding: '2px 0 6px' }}>pick dates to see that stretch</div>
                ) : customItems.length === 0 ? (
                  <div className="tt-none" style={{ padding: '2px 0 6px' }}>nothing in those dates</div>
                ) : customItems.map((t) => (
                  <BriefRow key={`${t.id}-c`} item={t} when={dateLabel(t._next)} time={null} work={workOnDate(t, t._next)}
                    byKey={byKey} statusesById={statusesById} onOpen={setOpenItem} onMenu={rowMenu} />
                ))}
              </>
            )}
          </div>
        </div>
      </>
    )
    // The day in the order YOU keep it — sections move and hide per account;
    // untouched prefs render the built-in order exactly as before.
    const SECTION_DEFS = {
      missing: { label: 'Missing — past the deadline', node: missingBlock },
      pravki: { label: 'Changes to make (Pravki)', node: pravkiBlock },
      review: { label: 'Waiting for your review', node: reviewBlock },
      today: { label: 'To do today', node: todayBlock },
      personal: { label: 'Personal tasks', node: personalBlock },
      coming: { label: 'Coming up', node: comingBlock },
      done: { label: 'What you’ve done', node: doneBlock },
    }
    const orderedKeys = orderedDayKeys()
    const customized = dayPrefs.order.length > 0 || dayPrefs.hidden.length > 0
    return (
      <>
        <div className="card card-pad brief-hero">
          <div className="brief-hello"><Sun size={18} /> {niceDate}</div>
          <h2 className="brief-title">
            {firstName}, today:{' '}
            {nothingToday ? 'nothing on the schedule — enjoy the quiet.' : (
              [
                dueToday.length > 0 && `${dueToday.length} to do`,
                overdue.length > 0 && `${overdue.length} missing`,
              ].filter(Boolean).join(' · ')
            )}
          </h2>
          <button className={'icon-btn brief-arrange' + (arranging ? ' on' : '')}
            onClick={() => setArranging((v) => !v)}
            data-tip="Arrange your day — order and hide sections" data-tip-left="" aria-label="Arrange sections">
            <SlidersHorizontal size={15} />
          </button>
        </div>

        {arranging && (
          <div className="card card-pad br-arrange">
            <div className="pc-check-head" style={{ marginBottom: 6 }}>
              <h3>Arrange your day</h3>
              <span className="stat-sub">order and visibility — saved to this account</span>
            </div>
            {orderedKeys.map((k) => {
              const off = dayPrefs.hidden.includes(k)
              return (
                <div key={k} className={'br-arr-row' + (off ? ' off' : '')}>
                  <span className="br-arr-name">{SECTION_DEFS[k].label}</span>
                  <button className="side-eye" onClick={() => moveSection(k, -1)} aria-label={`Move ${SECTION_DEFS[k].label} up`}><ChevronUp size={13} /></button>
                  <button className="side-eye" onClick={() => moveSection(k, +1)} aria-label={`Move ${SECTION_DEFS[k].label} down`}><ChevronDown size={13} /></button>
                  <button className={'side-eye' + (off ? ' off' : '')} onClick={() => toggleSection(k)}
                    data-tip={off ? 'Show this section' : 'Hide this section'} data-tip-left=""
                    aria-label={off ? `Show ${SECTION_DEFS[k].label}` : `Hide ${SECTION_DEFS[k].label}`}>
                    {off ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              )
            })}
            <div className="br-arr-foot">
              {customized && <button className="btn btn-sm" onClick={resetDayPrefs}><RotateCcw size={13} /> Reset</button>}
              <button className="btn btn-sm btn-primary" onClick={() => setArranging(false)}><Check size={14} /> Done</button>
            </div>
          </div>
        )}

        {orderedKeys.filter((k) => !dayPrefs.hidden.includes(k)).map((k) => (
          <Fragment key={k}>{SECTION_DEFS[k].node}</Fragment>
        ))}

        {openItem && (
          <ContentModal item={openItem} statuses={statuses} onClose={() => setOpenItem(null)}
            onUpdate={updateContent} onDelete={deleteContent} />
        )}
      </>
    )
  }

  // ============ the crew view: the videographer's day ============
  // No release dates anywhere here: the crew cares about the shoot day and
  // the edit/design deadline, nothing else. Published work is DONE work.
  const overdueN = lanes.shoot.missed.length + lanes.edit.missed.length
  const nothingToday = lanes.shoot.today.length === 0 && lanes.edit.today.length === 0 && overdueN === 0

  return (
    <>
      {/* The brief: one line that says what today is about */}
      <div className="card card-pad brief-hero">
        <div className="brief-hello"><Sun size={18} /> {niceDate}</div>
        <h2 className="brief-title">
          {firstName}, today:{' '}
          {nothingToday ? 'nothing on the schedule — enjoy the quiet.' : (
            [
              overdueN > 0 && `${overdueN} overdue`,
              lanes.shoot.today.length > 0 && `${lanes.shoot.today.length} to record`,
              lanes.edit.today.length > 0 && `${lanes.edit.today.length} on the editing desk`,
            ].filter(Boolean).join(' · ')
          )}
        </h2>
      </div>

      <div className="miss-filters">
        <div className="pill-group">
          <button className={'pill' + (myView === 'list' ? ' active' : '')} onClick={() => setMyView('list')}>
            <Rows3 size={14} /> List
          </button>
          <button className={'pill' + (myView === 'calendar' ? ' active' : '')} onClick={() => setMyView('calendar')}>
            <CalendarDays size={14} /> Calendar
          </button>
        </div>
      </div>

      {myView === 'calendar' && (
        <>
          <CrewCalendar tasks={open} userId={user.id} today={today} byKey={byKey} onOpen={setOpenItem} />
          {openItem && (
            <ContentModal item={openItem} statuses={statuses} onClose={() => setOpenItem(null)}
              onUpdate={updateContent} onDelete={deleteContent} />
          )}
        </>
      )}

      {myView !== 'calendar' && <>
      {pravkiBlock}
      <CrewBoard lanes={lanes} caps={user.crew_roles || []} today={today} byKey={byKey} onOpen={setOpenItem} onMenu={rowMenu} />
      {personalBlock}
      </>}

      {myView !== 'calendar' && openItem && (
        <ContentModal
          item={openItem}
          statuses={statuses}
          onClose={() => setOpenItem(null)}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
    </>
  )
}
