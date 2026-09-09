import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Timer, Plus, X, Check, Trash2, GripVertical, Link2, FileUp, AlignLeft,
  LayoutGrid, Rows3, Lock, Circle, ArrowUpDown, Lightbulb, HelpCircle,
  ChevronLeft, ChevronRight, History, Undo2, ScrollText, CalendarClock,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import Avatar from '../components/Avatar.jsx'
import Modal from '../components/Modal.jsx'
import Fold from '../components/Fold.jsx'
import { tr as tx, useT } from '../lib/i18n.jsx'
import { SPRINT_GUIDE } from '../lib/sprintGuide.js'

// The weekly sprint board.
//
// One request builds the whole screen and every write returns the whole
// screen back, so there is exactly one shape of truth in this file and no
// second copy to drift. It makes the board feel instant for the size it is —
// a week holds two or three tasks per person, not thousands — and it means a
// drag, a tick and a delete all refresh the person strip without anybody
// having to remember to.
//
// Nothing here reaches outside the module except the assignee picker, which
// reads the platform's user list and never writes to it.

const COLUMNS = [
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
]

// The freeze, counted down in the header. Seconds are deliberate: on Saturday
// morning the difference between "2 hours" and "1 hour 58 minutes" is the
// difference between finishing and not.
function useCountdown(iso) {
  const [left, setLeft] = useState(() => Date.parse(iso) - Date.now())
  useEffect(() => {
    setLeft(Date.parse(iso) - Date.now())
    const id = setInterval(() => setLeft(Date.parse(iso) - Date.now()), 1000)
    return () => clearInterval(id)
  }, [iso])
  return left
}
function countdownWords(ms) {
  if (ms <= 0) return tx('frozen')
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s % 60}s`
}

// How it works, on both screens.
//
// The rules this module enforces are strict on purpose, and a rule nobody was
// told about reads as a bug. Everything the board will refuse to do is
// written down here, with the exact times and the exact numbers, in the
// language the reader has set.
function GuideModal({ onClose }) {
  const { lang } = useT()
  const sections = SPRINT_GUIDE[lang] || SPRINT_GUIDE.en
  return (
    <Modal title={tx('How sprints work')} onClose={onClose} wide footer={
      <button className="btn btn-primary" onClick={onClose}>{tx('Got it')}</button>
    }>
      <div className="sp-guide">
        {sections.map((s) => (
          <section key={s.h}>
            <h4>{s.h}</h4>
            {(s.p || []).map((line) => <p key={line}>{line}</p>)}
            {s.list && <ul>{s.list.map((line) => <li key={line}>{line}</li>)}</ul>}
            {(s.after || []).map((line) => <p key={line}>{line}</p>)}
          </section>
        ))}
      </div>
    </Modal>
  )
}

// The module's two screens. Real routes, so the browser's back button and a
// pasted link both work; shared here so they cannot drift apart.
export function SprintTabs() {
  const [guide, setGuide] = useState(false)
  return (
    <div className="sp-tabs">
      <NavLink end to="/sprints" className={({ isActive }) => 'sp-tab' + (isActive ? ' active' : '')}>
        <Timer size={14} /> {tx('Sprint')}
      </NavLink>
      <NavLink to="/sprints/backlog" className={({ isActive }) => 'sp-tab' + (isActive ? ' active' : '')}>
        <Lightbulb size={14} /> {tx('Backlog')}
      </NavLink>
      <button type="button" className="sp-help" onClick={() => setGuide(true)}
        data-tip={tx('How sprints work')} aria-label={tx('How sprints work')}>
        <HelpCircle size={16} />
      </button>
      {guide && <GuideModal onClose={() => setGuide(false)} />}
    </div>
  )
}

const dayOf = (iso) => (iso || '').slice(0, 10)
const firstLine = (text) => String(text || '').split('\n')[0].slice(0, 80)

export default function Sprints() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [view, setView] = useState('board')   // board | list
  const [open, setOpen] = useState(null)      // the task in the modal
  const [asking, setAsking] = useState(null)  // { task, to } — result or blocker
  const [people, setPeople] = useState([])
  // Which week is on screen. null means this one, and this one is whatever
  // the calendar says today — never a remembered id, or a Monday would open
  // on last week because that is where you left off.
  const [weekId, setWeekId] = useState(null)
  const [weeks, setWeeks] = useState([])

  const load = useCallback(() => api.get(weekId ? `/sprints/${weekId}` : '/sprints/current')
    .then((d) => { setData(d); setErr('') })
    .catch((e) => setErr(e.message)), [weekId])
  useEffect(() => { load() }, [load])
  useEffect(() => { api.get('/sprints/people').then(setPeople).catch(() => setPeople([])) }, [])
  useEffect(() => { api.get('/sprints/history').then(setWeeks).catch(() => setWeeks([])) }, [])

  // Every write hands back the whole board, so this is the only place state
  // is replaced and there is never a half-updated screen.
  const [writes, setWrites] = useState(0)
  const push = useCallback(async (p) => {
    try { setData(await p); setWrites((n) => n + 1); return true }
    catch (e) { toast(e.message, 'err'); return false }
  }, [])
  // Anything that hands back a whole board counts as a write, wherever it came
  // from — the task sheet and the two question sheets all go through here.
  const took = useCallback((d) => { setData(d); setWrites((n) => n + 1) }, [])

  const sprint = data?.sprint
  const left = useCountdown(sprint?.freeze_at || new Date().toISOString())
  const locked = !!data?.frozen && !data?.owner
  // A past week is finished business. Even an owner, who may still correct
  // it, is not offered the box that adds NEW work — that box writes to the
  // current week, and a task typed while reading August would land in
  // September without saying so.
  const liveWeek = !!sprint && weeks.find((w) => w.current)?.id === sprint.id
  const at = weeks.findIndex((w) => w.id === sprint?.id)
  const step = (n) => { const w = weeks[at + n]; if (w) setWeekId(w.current ? null : w.id) }

  const byId = useMemo(() => Object.fromEntries((people || []).map((p) => [p.id, p])), [people])

  if (err) return <div className="card card-pad empty">{err}</div>
  if (!data) return <div className="app-loading"><span className="spinner" /></div>

  const move = async (task, to) => {
    if (locked) return toast(tx('This sprint is frozen'), 'err')
    if (task.status === to) return
    // The two that cost something ask first — and the server asks again.
    if (to === 'done' || to === 'blocked') { setAsking({ task, to }); return }
    push(api.patch(`/sprints/tasks/${task.id}`, { status: to }))
  }

  // The same move, made from inside the task window. Dragging a card is a
  // mouse trick: HTML5 drag does nothing under a finger, so on a phone the
  // board was read-only — there was no way to finish a task at all. The
  // window gets the columns as buttons, and they go through the same two
  // questions the drag does.
  const moveFromWindow = (task, to) => {
    if (locked) return toast(tx('This sprint is frozen'), 'err')
    if (task.status === to) return
    if (to === 'done' || to === 'blocked') { setOpen(null); setAsking({ task, to }); return }
    push(api.patch(`/sprints/tasks/${task.id}`, { status: to }))
  }

  return (
    <>
      <SprintTabs />
      <div className="sp-head">
        {/* One step back is the week before, which is the question people
            actually have. The list is there for the ones further off. */}
        <button className="icon-btn" disabled={at < 0 || at + 1 >= weeks.length}
          onClick={() => step(1)} data-tip={tx('The week before')} aria-label={tx('The week before')}>
          <ChevronLeft size={18} />
        </button>
        <h2>{sprint.code}</h2>
        <button className="icon-btn" disabled={at <= 0}
          onClick={() => step(-1)} data-tip={tx('The week after')} aria-label={tx('The week after')}>
          <ChevronRight size={18} />
        </button>
        <span className="sp-range">{sprint.label}</span>
        {liveWeek ? (
          <span className={'sp-count' + (left <= 0 ? ' out' : left < 6 * 3600e3 ? ' soon' : '')}>
            <Timer size={14} /> {countdownWords(left)}
          </span>
        ) : (
          <span className="sp-past">
            <History size={13} /> {tx('A week that has finished')}
          </span>
        )}
        {!liveWeek && (
          <button className="btn btn-sm" onClick={() => setWeekId(null)}>{tx('This week')}</button>
        )}
        {weeks.length > 1 && (
          <select className="select sp-weeks" value={sprint.id}
            onChange={(e) => {
              const w = weeks.find((x) => String(x.id) === e.target.value)
              setWeekId(w?.current ? null : Number(e.target.value))
            }}
            data-tip={tx('Jump to a week')}>
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.label} · {w.done}/{w.tasks}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <div className="pill-group">
          <button className={'pill' + (view === 'board' ? ' active' : '')} onClick={() => setView('board')}>
            <LayoutGrid size={14} /> {tx('Board')}
          </button>
          <button className={'pill' + (view === 'list' ? ' active' : '')} onClick={() => setView('list')}>
            <Rows3 size={14} /> {tx('List')}
          </button>
        </div>
      </div>

      {data.frozen && (
        <div className={'card card-pad sp-locked' + (data.owner ? ' sp-locked-owner' : '')}>
          <Lock size={16} />
          <b>
            {sprint.status === 'closed'
              ? tx('This sprint is closed.')
              : liveWeek
                ? tx('This sprint froze at noon on Saturday.')
                : tx('This week is over.')}
          </b>
          <span className="stat-sub">
            {data.owner ? tx('You are an owner — you can still change it.') : tx('An owner can still change it.')}
          </span>
        </div>
      )}

      <PersonStrip people={data.people} />

      {view === 'board'
        ? <Board data={data} locked={locked || !liveWeek} byId={byId} onMove={move} onOpen={setOpen} onAdd={push} />
        : <ListView data={data} byId={byId} onOpen={setOpen} sprint={sprint} />}

      <Dropped rows={data.dropped} owner={data.owner} byId={byId} onRestored={took} />
      <Changes sprintId={sprint.id} stamp={writes} />

      {open && (
        <TaskModal
          task={data.tasks.find((t) => t.id === open.id) || open}
          people={people} locked={locked} owner={data.owner}
          onMove={liveWeek ? moveFromWindow : null}
          sprint={sprint} sprintId={liveWeek ? null : sprint.id}
          onClose={() => setOpen(null)} onSaved={took}
        />
      )}
      {asking && (
        <AskModal
          task={asking.task} to={asking.to} reasons={data.blockerReasons}
          onClose={() => setAsking(null)} onSaved={(d) => { took(d); setAsking(null) }}
        />
      )}
    </>
  )
}

// ---- the person strip --------------------------------------------------------
// Derived from who holds a task this week. No membership list: somebody with a
// task is on it, somebody without one is not, and the strip cannot fall out of
// step with the work because it IS the work.
function PersonStrip({ people }) {
  if (!people.length) {
    return <div className="sp-strip-empty stat-sub">{tx('No tasks assigned yet.')}</div>
  }
  return (
    <div className="sp-strip">
      {people.map((p) => (
        <div className="sp-person" key={p.user_id}>
          <Avatar name={p.name} color={p.color} src={p.avatar} size="sm" />
          <span className="sp-person-meta">
            <b>{p.name}</b>
            <span className="stat-sub">{p.done}/{p.assigned}</span>
          </span>
          {p.blocked > 0 && <span className="sp-blocked">{p.blocked}</span>}
        </div>
      ))}
    </div>
  )
}

// ---- what was dropped --------------------------------------------------------
// A task nobody is going to do still happened: it was promised on Monday and
// abandoned by Thursday, and that is exactly the thing the Saturday meeting
// is for. Deleting it took the question away with it, so now it leaves the
// columns and lands here, with who dropped it and why. Folded like everything
// else, and absent altogether on a week where nothing was dropped.
function Dropped({ rows, owner, byId, onRestored }) {
  const [busy, setBusy] = useState(0)
  if (!rows?.length) return null

  const restore = async (t) => {
    setBusy(t.id)
    try { onRestored(await api.post(`/sprints/tasks/${t.id}/restore`)) }
    catch (e) { toast(e.message, 'err') } finally { setBusy(0) }
  }

  return (
    <Fold id="sprint_dropped" title={tx('Dropped this week')} icon={<X size={15} />} count={rows.length}>
      <div className="card table-wrap">
        <table className="tbl sp-dropped-tbl">
          <thead>
            <tr>
              <th>{tx('Task')}</th>
              <th>{tx('Who dropped it')}</th>
              <th>{tx('Why')}</th>
              {owner && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td><b className="sp-dropped-title">{t.title}</b></td>
                <td>{byId[t.dropped_by]?.name || <span className="stat-sub">—</span>}</td>
                <td>{t.dropped_reason || <span className="stat-sub">{tx('No reason given')}</span>}</td>
                {owner && (
                  <td className="right">
                    <button className="btn btn-sm" disabled={busy === t.id} onClick={() => restore(t)}>
                      <Undo2 size={13} /> {tx('Put it back')}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!owner && (
        <div className="stat-sub sp-dropped-note">
          {tx('Only a sprint owner can put a dropped task back.')}
        </div>
      )}
    </Fold>
  )
}

// ---- what changed ------------------------------------------------------------
// The board shows where things stand. This shows what MOVED to get them
// there — a deadline pushed, a result un-ticked, a task dropped — newest
// first, with the name of whoever did it. Read out on Saturday when a number
// does not look like it did on Monday.
// Only the status move that undoes something is ever written down, so this
// says what that move actually is rather than the vague "moved it" it said
// while every move was being recorded.
const CHANGE_WORDS = {
  deadline: 'moved the deadline',
  status: 'took it back out of Done',
  title: 'renamed it',
  dropped: 'dropped it',
  restored: 'put it back',
}
function Changes({ sprintId, stamp }) {
  const [rows, setRows] = useState(null)
  // `stamp` moves on every write the page makes, so dropping a task from the
  // card puts the drop in the log underneath it straight away. Without it the
  // log was whatever it had been when the page opened — a record that does not
  // include what you just did is a record nobody will trust twice.
  useEffect(() => {
    let live = true
    api.get(`/sprints/activity?sprint=${sprintId}`)
      .then((r) => { if (live) setRows(Array.isArray(r) ? r : []) })
      .catch(() => { if (live) setRows([]) })
    return () => { live = false }
  }, [sprintId, stamp])
  if (!rows?.length) return null

  return (
    <Fold id="sprint_changes" title={tx('What changed')} icon={<ScrollText size={15} />} count={rows.length}>
      <div className="card card-pad sp-log">
        {rows.map((r) => (
          <div className="sp-log-row" key={r.id}>
            <span className="sp-log-when stat-sub">{String(r.created_at).slice(5, 16).replace('T', ' ')}</span>
            <span className="sp-log-what">
              <b>{r.user_name || tx('Someone who left')}</b>
              {' '}{tx(CHANGE_WORDS[r.kind] || r.kind)}{' '}
              <i>{r.task_title}</i>
              {(r.old_value || r.new_value) && (
                <span className="stat-sub">
                  {' · '}{r.old_value || '—'} → {r.new_value || '—'}
                </span>
              )}
              {r.note && <span className="sp-log-note">“{r.note}”</span>}
            </span>
          </div>
        ))}
      </div>
    </Fold>
  )
}

// ---- the board ---------------------------------------------------------------
function Board({ data, locked, byId, onMove, onOpen, onAdd }) {
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const dragRef = useRef(null)
  const [adding, setAdding] = useState('')

  const addTask = async (e) => {
    e.preventDefault()
    const title = adding.trim()
    if (!title) return
    setAdding('')
    onAdd(api.post('/sprints/tasks', { title }))
  }

  return (
    <div className="sp-board">
      {COLUMNS.map((col) => {
        const list = data.tasks.filter((t) => t.status === col.key)
        return (
          <div
            key={col.key}
            className={'sp-col' + (overCol === col.key ? ' over' : '')}
            onDragOver={(e) => { if (!locked) { e.preventDefault(); setOverCol(col.key) } }}
            onDragLeave={() => setOverCol(null)}
            onDrop={(e) => {
              e.preventDefault()
              setOverCol(null)
              const id = dragRef.current
              dragRef.current = null
              setDragId(null)
              const task = data.tasks.find((t) => t.id === id)
              if (task) onMove(task, col.key)
            }}
          >
            <div className="sp-col-head">
              <b>{tx(col.label)}</b><span className="count">{list.length}</span>
            </div>
            <div className="sp-col-body">
              {list.map((t) => (
                <Card
                  key={t.id} task={t} byId={byId} sprint={data.sprint}
                  dim={dragId === t.id} locked={locked}
                  onDragStart={(e) => {
                    dragRef.current = t.id
                    setDragId(t.id)
                    try { e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
                  }}
                  onDragEnd={() => { dragRef.current = null; setDragId(null); setOverCol(null) }}
                  onClick={() => onOpen(t)}
                />
              ))}
              {/* Adding a task is one field, and it lives where the task will. */}
              {col.key === 'todo' && !locked && (
                <form className="sp-add" onSubmit={addTask}>
                  <Plus size={14} />
                  <input
                    className="input" value={adding} onChange={(e) => setAdding(e.target.value)}
                    placeholder={tx('Add a task, press Enter')}
                  />
                </form>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Card({ task, byId, sprint, dim, locked, onDragStart, onDragEnd, onClick }) {
  const own = task.deadline && task.deadline !== dayOf(sprint.freeze_at)
  return (
    <div
      className={'sp-card' + (dim ? ' dim' : '')}
      draggable={!locked}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="sp-card-title">
        {task.is_growth && <span className="sp-growth" data-tip={tx('Growth')} />}
        {task.title}
      </div>
      <div className="sp-card-foot">
        <span className="sp-faces">
          {task.assignees.map((id) => (
            <Avatar key={id} name={byId[id]?.name || '?'} color={byId[id]?.color} src={byId[id]?.avatar} size="xs" />
          ))}
        </span>
        {task.checklist.total > 0 && (
          <span className="sp-checks">{task.checklist.done}/{task.checklist.total}</span>
        )}
        {own && <span className="sp-deadline">{task.deadline.slice(5)}</span>}
        {task.carried_count > 0 && (
          <span className="sp-carried" data-tip={tx('Carried over from an earlier week')}>
            {tx('Sprint {n} of {m}', { n: task.sprints_run, m: task.sprints_run })}
          </span>
        )}
      </div>
      {task.status === 'done' && task.result_type === 'text' && (
        <div className="sp-result stat-sub">{firstLine(task.result_text)}</div>
      )}
      {task.status === 'blocked' && task.blocker_reason && (
        <div className="sp-result stat-sub">{task.blocker_reason}</div>
      )}
    </div>
  )
}

// ---- the list ----------------------------------------------------------------
const COLS = [
  { key: 'title', label: 'Title' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'status', label: 'Status' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'growth', label: 'Growth' },
  { key: 'deadline', label: 'Deadline' },
  { key: 'result', label: 'Result' },
]
function ListView({ data, byId, onOpen, sprint }) {
  const [sort, setSort] = useState({ key: 'title', dir: 1 })
  const [who, setWho] = useState('')

  const rows = useMemo(() => {
    const val = (t, key) => {
      if (key === 'assignee') return (t.assignees.map((id) => byId[id]?.name || '').sort()[0] || '')
      if (key === 'checklist') return t.checklist.total ? t.checklist.done / t.checklist.total : -1
      if (key === 'growth') return t.is_growth ? 1 : 0
      if (key === 'deadline') return t.deadline || ''
      if (key === 'result') return t.result_type || ''
      if (key === 'status') return COLUMNS.findIndex((c) => c.key === t.status)
      return String(t.title).toLowerCase()
    }
    const list = who ? data.tasks.filter((t) => t.assignees.includes(Number(who))) : data.tasks
    return [...list].sort((a, b) => {
      const x = val(a, sort.key), y = val(b, sort.key)
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir
    })
  }, [data.tasks, sort, who, byId])

  const everyone = useMemo(
    () => [...new Set(data.tasks.flatMap((t) => t.assignees))].map((id) => byId[id]).filter(Boolean),
    [data.tasks, byId])

  return (
    <>
      <div className="sp-filters">
        <select className="select" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{tx('Everyone')}</option>
          {everyone.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="card table-wrap">
        <table className="tbl sp-table">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key}>
                  <button className="sp-sort" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : 1 }))}>
                    {tx(c.label)} <ArrowUpDown size={11} className={sort.key === c.key ? 'on' : ''} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} onClick={() => onOpen(t)} style={{ cursor: 'pointer' }}>
                <td><b>{t.title}</b></td>
                <td>{t.assignees.map((id) => byId[id]?.name).filter(Boolean).join(', ') || <span className="stat-sub">—</span>}</td>
                <td>{tx(COLUMNS.find((c) => c.key === t.status)?.label || t.status)}</td>
                <td>{t.checklist.total ? `${t.checklist.done}/${t.checklist.total}` : <span className="stat-sub">—</span>}</td>
                <td>{t.is_growth ? <span className="sp-growth" /> : <span className="stat-sub">—</span>}</td>
                <td>{t.deadline && t.deadline !== dayOf(sprint.freeze_at) ? t.deadline : <span className="stat-sub">—</span>}</td>
                <td>
                  {t.result_type === 'link' ? <a href={t.result_link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{tx('Link')}</a>
                    : t.result_type === 'text' ? firstLine(t.result_text)
                      : t.result_type === 'file' ? tx('File')
                        : <span className="stat-sub">—</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={COLS.length} className="empty">{tx('Nothing here yet.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---- the two required-field modals -------------------------------------------
// Both of these are asked here AND enforced on the server. The modal is the
// courtesy; the refusal is the rule.
function AskModal({ task, to, reasons, onClose, onSaved }) {
  const [tab, setTab] = useState('link')
  const [link, setLink] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const send = async (extra) => {
    setBusy(true); setErr('')
    try { onSaved(await api.patch(`/sprints/tasks/${task.id}`, { status: to, ...extra })) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const pickFile = async (f) => {
    if (!f) return
    setErr('')
    if (f.size > 5 * 1024 * 1024) { setErr(tx('That file is over 5 MB')); return }
    const data = await new Promise((done) => {
      const r = new FileReader()
      r.onload = () => done(r.result)
      r.readAsDataURL(f)
    })
    setBusy(true)
    try { setFile(await api.post(`/sprints/tasks/${task.id}/files`, { name: f.name, data })) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (to === 'blocked') {
    return (
      <Modal title={tx('What is it waiting on?')} onClose={onClose} footer={<>
        <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
        <button className="btn btn-primary" disabled={busy || !reason}
          onClick={() => send({ blocker_reason: reason, blocker_note: note })}>
          {tx('Mark blocked')}
        </button>
      </>}>
        {err && <div className="form-error">{err}</div>}
        <div className="field">
          <label>{tx('Reason')}</label>
          <select className="select" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
            <option value="">{tx('— pick one —')}</option>
            {reasons.map((r) => <option key={r} value={r}>{tx(r)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{tx('Anything to add')} <span className="stat-sub">{tx('optional')}</span></label>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={tx('What came out of it?')} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
      <button className="btn btn-primary" disabled={busy}
        onClick={() => send(
          tab === 'link' ? { result_type: 'link', result_link: link }
            : tab === 'text' ? { result_type: 'text', result_text: text }
              : { result_type: 'file', result_attachment_id: file?.id })}>
        {tx('Mark done')}
      </button>
    </>}>
      {err && <div className="form-error">{err}</div>}
      <div className="pill-group" style={{ marginBottom: 12 }}>
        <button className={'pill' + (tab === 'link' ? ' active' : '')} onClick={() => setTab('link')}><Link2 size={13} /> {tx('Link')}</button>
        <button className={'pill' + (tab === 'file' ? ' active' : '')} onClick={() => setTab('file')}><FileUp size={13} /> {tx('File')}</button>
        <button className={'pill' + (tab === 'text' ? ' active' : '')} onClick={() => setTab('text')}><AlignLeft size={13} /> {tx('Text')}</button>
      </div>
      {tab === 'link' && (
        <div className="field">
          <label>{tx('Where is it?')}</label>
          <input className="input" value={link} autoFocus placeholder="https://…"
            onChange={(e) => setLink(e.target.value)} />
        </div>
      )}
      {tab === 'file' && (
        <div className="field">
          <label>{tx('The file')} <span className="stat-sub">{tx('up to 5 MB')}</span></label>
          <input type="file" onChange={(e) => pickFile(e.target.files?.[0])} />
          {file && <div className="stat-sub">{file.name}</div>}
        </div>
      )}
      {tab === 'text' && (
        <div className="field">
          <label>{tx('What happened')} <span className="stat-sub">{tx('{n} of 100 characters', { n: text.trim().length })}</span></label>
          <textarea className="input" rows={6} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
        </div>
      )}
    </Modal>
  )
}

// ---- the task ----------------------------------------------------------------
// One screen, no tabs. Everything except the title is optional.
export function TaskModal({ task, people, locked, owner = false, onClose, onSaved, onMove, sprint = null, sprintId = null }) {
  const [form, setForm] = useState({
    title: task.title, description: task.description,
    is_growth: task.is_growth, deadline: task.deadline || '',
    assignees: [...task.assignees],
  })
  const [items, setItems] = useState([])
  const [adding, setAdding] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [dropping, setDropping] = useState(false)
  const dragRef = useRef(null)

  // A day somebody CHOSE is a promise, and it takes an owner to move it. The
  // day every task is born with — the end of the week — is not a promise
  // anybody made, so putting a first real date on a task stays open to
  // everybody. The server enforces exactly this; the disabled field is the
  // courtesy that stops somebody typing a date they cannot save.
  //
  // Without a week to compare against — the backlog opens this sheet before a
  // task has one — nothing is treated as promised. The server is the rule
  // either way, and of the two ways to be wrong here, a box that refuses with
  // a sentence is far better than a box that is silently dead.
  const weekEnd = (sprint?.freeze_at || '').slice(0, 10)
  const promised = !!weekEnd && !!task.deadline && task.deadline !== weekEnd
  const dayLocked = locked || (promised && !owner)

  // Naming the week matters when the week is not this one: a task opened from
  // a sprint three weeks ago has to show the items committed for THAT week.
  const reloadItems = useCallback(
    () => api.get(`/sprints/tasks/${task.id}/checklist${sprintId ? `?sprint=${sprintId}` : ''}`)
      .then(setItems).catch(() => setItems([])), [task.id, sprintId])
  useEffect(() => { reloadItems() }, [reloadItems])
  useEffect(() => { api.get(`/sprints/tasks/${task.id}/files`).then(setFiles).catch(() => setFiles([])) }, [task.id])

  const save = async () => {
    setBusy(true); setErr('')
    try {
      onSaved(await api.patch(`/sprints/tasks/${task.id}`, { ...form, deadline: form.deadline || null }))
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  // Dropping, not deleting. The week keeps its promise count either way — see
  // the server — so the only thing worth asking for here is why.
  const drop = async (reason) => {
    try { onSaved(await api.del(`/sprints/tasks/${task.id}`, { reason })); setDropping(false); onClose() }
    catch (e) { setDropping(false); setErr(e.message) }
  }
  const addItem = async (e) => {
    e.preventDefault()
    const text = adding.trim()
    if (!text) return
    setAdding('')
    try { await api.post(`/sprints/tasks/${task.id}/checklist`, { text }); reloadItems() }
    catch (e2) { toast(e2.message, 'err') }
  }
  const tick = async (item) => {
    try { await api.patch(`/sprints/checklist/${item.id}`, { done: !item.done }); reloadItems() }
    catch (e) { toast(e.message, 'err') }
  }
  const dropItem = async (overId) => {
    const from = dragRef.current
    if (!from || from === overId) return
    const ids = items.map((i) => i.id)
    const a = ids.indexOf(from), b = ids.indexOf(overId)
    if (a < 0 || b < 0) return
    ids.splice(b, 0, ids.splice(a, 1)[0])
    setItems(ids.map((id) => items.find((i) => i.id === id)))
    try { await api.put(`/sprints/tasks/${task.id}/checklist/order`, { ids }) } catch { reloadItems() }
  }
  const upload = async (f) => {
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { setErr(tx('That file is over 5 MB')); return }
    const data = await new Promise((done) => {
      const r = new FileReader(); r.onload = () => done(r.result); r.readAsDataURL(f)
    })
    try {
      await api.post(`/sprints/tasks/${task.id}/files`, { name: f.name, data })
      setFiles(await api.get(`/sprints/tasks/${task.id}/files`))
    } catch (e) { setErr(e.message) }
  }

  const toggleWho = (id) => setForm((f) => ({
    ...f, assignees: f.assignees.includes(id) ? f.assignees.filter((x) => x !== id) : [...f.assignees, id],
  }))

  return (
    <>
    <Modal title={tx('Task')} onClose={onClose} wide footer={<>
      {!locked && (
        <button className="btn" onClick={() => setDropping(true)}>
          <Trash2 size={14} /> {tx('Drop it')}
        </button>
      )}
      <span className="foot-gap" />
      <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
      <button className="btn btn-primary" disabled={busy || locked} onClick={save}>{tx('Save')}</button>
    </>}>
      {err && <div className="form-error">{err}</div>}

      <div className="field">
        <label>{tx('Title')}</label>
        <input className="input" value={form.title} disabled={locked}
          onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </div>

      {onMove && (
        <div className="field">
          <label>{tx('Column')}</label>
          <div className="sp-stage">
            {COLUMNS.map((c) => (
              <button key={c.key} type="button" disabled={locked}
                className={'pill' + (task.status === c.key ? ' active' : '')}
                onClick={() => onMove(task, c.key)}>
                {tx(c.label)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label>{tx('Assignee')}</label>
        <div className="rev-picker">
          {people.map((p) => (
            <button key={p.id} type="button" disabled={locked}
              className={'rev-chip' + (form.assignees.includes(p.id) ? ' on' : '')}
              onClick={() => toggleWho(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="field sp-growth-row">
        <label className={'checkbox-chip' + (form.is_growth ? ' on' : '')}>
          <input type="checkbox" checked={form.is_growth} disabled={locked}
            onChange={(e) => setForm({ ...form, is_growth: e.target.checked })} />
          {tx('Growth')}
        </label>
        <span className="sp-deadline-field">
          <label>{tx('Deadline')}</label>
          <input className="input" type="date" value={form.deadline} disabled={dayLocked}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
        </span>
      </div>
      {dayLocked && !locked && (
        <div className="sp-day-locked stat-sub">
          <CalendarClock size={13} />
          {tx('That day is already promised — ask a sprint owner to move it, and say what happened.')}
        </div>
      )}

      <div className="field">
        <label>{tx('Description')}</label>
        <textarea className="input" rows={3} value={form.description} disabled={locked}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>

      <div className="field">
        <label>{tx('Checklist')} <span className="stat-sub">{tx('this week only')}</span></label>
        <div className="sp-checklist">
          {items.map((it) => (
            <div key={it.id} className="sp-item" draggable={!locked}
              onDragStart={() => { dragRef.current = it.id }}
              onDragOver={(e) => { e.preventDefault(); dropItem(it.id) }}
              onDragEnd={() => { dragRef.current = null }}>
              {!locked && <span className="sp-grip"><GripVertical size={12} /></span>}
              <button type="button" className={'mini-check' + (it.done ? ' on' : '')} disabled={locked}
                onClick={() => tick(it)}>
                {it.done ? <Check size={12} strokeWidth={3.5} /> : <Circle size={10} />}
              </button>
              <span className={it.done ? 'done-txt' : ''}>{it.text}</span>
              {!locked && (
                <button type="button" className="icon-btn"
                  onClick={() => api.del(`/sprints/checklist/${it.id}`).then(reloadItems).catch((e) => toast(e.message, 'err'))}>
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          {!locked && (
            <form className="sp-add" onSubmit={addItem}>
              <Plus size={13} />
              <input className="input" value={adding} onChange={(e) => setAdding(e.target.value)}
                placeholder={tx('Add an item, press Enter')} />
            </form>
          )}
        </div>
      </div>

      <div className="field">
        <label>{tx('Files')}</label>
        {files.map((f) => <div key={f.id} className="stat-sub">{f.name} · {(f.size / 1024).toFixed(0)} KB</div>)}
        {!locked && <input type="file" onChange={(e) => upload(e.target.files?.[0])} />}
      </div>
    </Modal>

    {/* A sheet over a sheet, the same way the handover gate opens over a task
        on the content side — a sibling, not a child, so the question is not
        laid out inside the form it is asking about. */}
    {dropping && <DropModal task={task} onClose={() => setDropping(false)} onDrop={drop} />}
    </>
  )
}

// Dropping a task asks one question, and the answer is what the week is read
// back from. It is not required — somebody halfway out of the door should not
// be stopped by a form — but it is asked, because "why did twelve become ten"
// has no other answer once the week is over.
function DropModal({ task, onClose, onDrop }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={tx('Drop this task?')} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx('Keep it')}</button>
      <button className="btn btn-danger" disabled={busy}
        onClick={() => { setBusy(true); onDrop(reason.trim()) }}>
        <Trash2 size={14} /> {tx('Drop it')}
      </button>
    </>}>
      <div className="sp-drop-what"><b>{task.title}</b></div>
      <p className="stat-sub">
        {tx('It leaves the board and stays on the week, so the count of what was promised does not change. An owner can put it back.')}
      </p>
      <div className="field">
        <label>{tx('What happened?')} <span className="stat-sub">{tx('optional')}</span></label>
        <textarea className="input sp-drop-why" rows={3} value={reason} autoFocus
          placeholder={tx('Priority changed, the client cancelled, we are doing it next week…')}
          onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  )
}
