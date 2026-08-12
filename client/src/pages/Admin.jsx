import { useEffect, useMemo, useState } from 'react'
import {
  Users, PanelLeft, KanbanSquare, FileBarChart, Plus, Pencil, Trash2, AlertCircle,
  ShieldCheck, ArrowUp, ArrowDown, Check, Megaphone, ListChecks, Clapperboard, Send, Pin, Network,
  X, CheckSquare, Scissors, Video, History, Eye, EyeOff,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { useChannels } from '../lib/channels.jsx'
import RolePicker from '../components/RolePicker.jsx'
import { CHANNEL_ICONS, iconFor, PERMISSIONS, CONTENT_TYPES, todayISO, addDaysISO, dateLabel, typeInfo, onColor, deptColor, tashkentDay } from '../lib/constants.js'
import Avatar from '../components/Avatar.jsx'
import Modal from '../components/Modal.jsx'
import ContentModal from '../components/ContentModal.jsx'
import { useContextMenu } from '../components/ContextMenu.jsx'
import Whiteboard from '../components/Whiteboard.jsx'
import { activityLine } from '../lib/activity.js'

// Distinct hues so member avatars/chips are tellable apart (matches Profile).
const SWATCHES = ['#a32234', '#2a78d6', '#1D9E75', '#BA7517', '#7b5ad6', '#0e8f8f', '#d6499b', '#5a6b7a']
const STATUS_COLORS = ['#8b8388', '#fab219', '#ec835a', '#b5324a', '#a32234', '#2a78d6', '#7c5cd6', '#0ca30c']
const slug = (s) => s.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '')
const colorFor = (seed) => {
  let h = 0
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SWATCHES[h % SWATCHES.length]
}

const TABS = [
  { key: 'team', label: 'Team', icon: Users },
  { key: 'tasks', label: 'Tasks', icon: ListChecks },
  { key: 'board', label: 'Whiteboard', icon: Network },
  { key: 'channels', label: 'Channels', icon: PanelLeft },
  { key: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
  { key: 'reports', label: 'Reports', icon: FileBarChart },
  { key: 'history', label: 'History', icon: History },
  { key: 'telegram', label: 'Telegram', icon: Send },
]

export default function Admin() {
  const [tab, setTab] = useState('team')
  const [reportChannel, setReportChannel] = useState('all')
  // A channel row's "Report" button jumps straight into that channel's report.
  const openReport = (key) => { setReportChannel(key); setTab('reports') }
  return (
    <>
      <div className="tabs">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button key={t.key} className={'tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
              <Icon size={16} /> {t.label}
            </button>
          )
        })}
      </div>
      {tab === 'team' && <TeamTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'board' && <Whiteboard />}
      {tab === 'channels' && <ChannelsTab onOpenReport={openReport} />}
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'reports' && <ReportsTab channel={reportChannel} setChannel={setReportChannel} />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'telegram' && <TelegramTab />}
    </>
  )
}

/* ==================== TELEGRAM (the bot's admin panel) =================== */
/* The bridge at a glance: is it configured, where the webhook points (straight
   from Telegram, last error included), who of the team is wired up — with an
   admin unlink for people who left — and a broadcast line to everyone linked. */
function TelegramTab() {
  const [st, setSt] = useState(null)
  const [msg, setMsg] = useState('')
  const [cast, setCast] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => api.get('/telegram/admin').then(setSt).catch((e) => setMsg(e.message))
  useEffect(() => {
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const activate = async () => {
    setMsg(''); setBusy(true)
    try {
      const out = await api.post('/telegram/set-webhook', {})
      setMsg(out.ok ? `Webhook set: ${out.url}` : 'Telegram refused the webhook — check the token')
      await load()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  const unlink = async (u) => {
    if (!confirm(`Disconnect ${u.name} from the bot?`)) return
    try { await api.post('/telegram/admin/unlink', { user_id: u.id }); await load() } catch (e) { setMsg(e.message) }
  }
  const broadcast = async () => {
    const text = cast.trim()
    if (!text) return
    setBusy(true); setMsg('')
    try {
      const out = await api.post('/telegram/broadcast', { text })
      toast(`Sent to ${out.sent} ${out.sent === 1 ? 'person' : 'people'}`, 'ok')
      setCast('')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  if (!st) return <div className="card card-pad"><div className="stat-sub">Checking the bridge…</div></div>
  const linked = st.members.filter((m) => m.linked)
  return (
    <>
      <div className="section-head"><h2>The bridge</h2></div>
      <div className="card card-pad">
        {!st.enabled ? (
          <div className="stat-sub">
            The bot isn’t configured. Put the @BotFather token into <b>TELEGRAM_BOT_TOKEN</b> (Vercel → Environment Variables) or into <b>server/config.js</b> of the private repo, redeploy — then press Activate here.
          </div>
        ) : (
          <>
            <div className="stat-sub" style={{ marginBottom: 8 }}>
              Bot: <b>{st.bot ? `@${st.bot}` : '—'}</b>
              {' · '}Webhook: {st.webhook?.url ? <b>{st.webhook.url}</b> : <b>not set</b>}
              {st.webhook?.last_error_message ? <> · <span style={{ color: 'var(--critical)' }}>last error: {st.webhook.last_error_message}</span></> : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={activate} disabled={busy}>Activate webhook</button>
              <span className="stat-sub">Once after the token lands or the domain changes{st.public_url ? <> · task links point to <b>{st.public_url}</b></> : null}.</span>
            </div>
          </>
        )}
        {msg && <div className="stat-sub" style={{ marginTop: 8 }}>{msg}</div>}
      </div>

      <div className="section-head" style={{ marginTop: 18 }}><h2>Connected</h2><span className="count">· {linked.length} of {st.members.length}</span></div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {st.members.map((m) => (
          <div key={m.id} className="alog-row">
            <b className="alog-who">{m.name}</b>
            <span className="stat-sub">@{m.username}{m.role === 'admin' ? ' · admin' : ''}</span>
            <span style={{ flex: 1 }} />
            {m.linked
              ? <><span className="save-ok"><Check size={14} /> connected</span>
                <button className="btn btn-sm" onClick={() => unlink(m)}>Unlink</button></>
              : <span className="stat-sub">—</span>}
          </div>
        ))}
      </div>

      {st.enabled && (
        <>
          <div className="section-head" style={{ marginTop: 18 }}><h2>Broadcast</h2></div>
          <div className="card card-pad">
            <div className="stat-sub" style={{ marginBottom: 8 }}>One announcement to everyone connected — planning changes, «планёрка в 15:00».</div>
            <div className="add-inline">
              <input className="input" value={cast} placeholder="Write the announcement…"
                onChange={(e) => setCast(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); broadcast() } }} />
              <button className="btn btn-primary btn-sm" onClick={broadcast} disabled={busy || !cast.trim() || linked.length === 0}>
                <Send size={14} /> Send to {linked.length}
              </button>
            </div>
          </div>

          <Reminders members={st.members} />
        </>
      )}
    </>
  )
}

/* ---- the reminders an admin keeps ready ----------------------------------
   The nudges worth repeating — "is the week planned?", "does every task carry
   its brief?" — written once and kept. Each can be fired at anybody on the
   spot, or left to arrive by itself on chosen weekdays at a chosen hour. */
const WEEK = [{ d: 1, l: 'Mon' }, { d: 2, l: 'Tue' }, { d: 3, l: 'Wed' }, { d: 4, l: 'Thu' }, { d: 5, l: 'Fri' }, { d: 6, l: 'Sat' }, { d: 0, l: 'Sun' }]
const BLANK = { title: '', text: '', audience: 'linked', days: [], hour: 9, enabled: true }
function Reminders({ members }) {
  const [list, setList] = useState(null)
  const [edit, setEdit] = useState(null)     // the template being written
  const [picking, setPicking] = useState(null) // { tpl, ids }
  const [busy, setBusy] = useState(false)
  const load = () => api.get('/telegram/templates').then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])
  const linked = members.filter((m) => m.linked)

  const save = async () => {
    if (!edit.title.trim() || !edit.text.trim()) return
    setBusy(true)
    try {
      if (edit.id) await api.patch(`/telegram/templates/${edit.id}`, edit)
      else await api.post('/telegram/templates', edit)
      setEdit(null); await load(); toast('Reminder saved — synced')
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  const toggle = async (t) => {
    try { await api.patch(`/telegram/templates/${t.id}`, { enabled: !t.enabled }); await load() } catch (e) { alert(e.message) }
  }
  const remove = async (t) => {
    if (!confirm(`Delete the reminder “${t.title}”?`)) return
    try { await api.del(`/telegram/templates/${t.id}`); await load() } catch (e) { alert(e.message) }
  }
  const sendNow = async (tpl, ids) => {
    setBusy(true)
    try {
      const out = await api.post(`/telegram/templates/${tpl.id}/send`, ids ? { user_ids: ids } : {})
      toast(out.sent ? `Sent to ${out.sent} ${out.sent === 1 ? 'person' : 'people'}` : 'Nobody in that audience is connected yet', out.sent ? 'ok' : 'err')
      setPicking(null)
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  const whoReads = (a) => (a === 'linked' ? 'everyone connected'
    : a.startsWith('role:') ? `${a.slice(5)}s`
      : a.startsWith('channel:') ? `the ${a.slice(8)} team` : 'chosen people')

  if (!list) return null
  return (
    <>
      <div className="section-head" style={{ marginTop: 18 }}>
        <h2>Reminders</h2>
        <span className="count">· send on the spot, or let them arrive on their own</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setEdit({ ...BLANK })}><Plus size={14} /> New reminder</button>
      </div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {list.length === 0 && <div className="stat-sub" style={{ padding: '10px 0' }}>No reminders yet.</div>}
        {list.map((t) => (
          <div key={t.id} className="rem-row">
            <button className={'side-eye' + (t.enabled ? '' : ' off')} onClick={() => toggle(t)}
              data-tip={t.enabled ? 'Scheduled — turn off' : 'Manual only — turn the schedule on'}
              aria-label={t.enabled ? 'Disable schedule' : 'Enable schedule'}>
              {t.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <span className="rem-main">
              <b className="rem-title">{t.title}</b>
              <span className="rem-sub">
                {t.days.length > 0
                  ? <>every {t.days.map((d) => WEEK.find((w) => w.d === d)?.l).join(', ')} at {String(t.hour).padStart(2, '0')}:00</>
                  : <>on demand only</>}
                {' · '}{whoReads(t.audience)}
                {t.last_sent ? ` · last sent ${t.last_sent}` : ''}
              </span>
            </span>
            <button className="btn btn-sm" onClick={() => setPicking({ tpl: t, ids: linked.map((m) => m.id) })}
              disabled={busy || linked.length === 0}><Send size={13} /> Send</button>
            <button className="btn btn-sm" onClick={() => setEdit({ ...t })}>Edit</button>
            <button className="icon-btn" onClick={() => remove(t)} aria-label="Delete reminder"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {edit && (
        <Modal title={edit.id ? 'Edit reminder' : 'New reminder'} onClose={() => setEdit(null)}
          footer={<>
            <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !edit.title.trim() || !edit.text.trim()}>Save</button>
          </>}>
          <div className="field"><label>Name — for you, not for them</label>
            <input className="input" autoFocus value={edit.title} placeholder="e.g. Is the week planned?"
              onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          </div>
          <div className="field"><label>The message</label>
            <textarea className="input" rows={5} value={edit.text}
              placeholder="Write it the way you would say it — warm, short, and ending in one clear action."
              onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
          </div>
          <div className="field"><label>Who hears it</label>
            <select className="select" value={edit.audience} onChange={(e) => setEdit({ ...edit, audience: e.target.value })}>
              <option value="linked">Everyone connected</option>
              <option value="role:member">Members</option>
              <option value="role:editor">Editors</option>
              <option value="role:operator">Operators</option>
              <option value="role:designer">Designers</option>
              <option value="role:admin">Admins</option>
            </select>
          </div>
          <div className="field"><label>When it arrives by itself</label>
            <div className="pill-group" style={{ flexWrap: 'wrap' }}>
              {WEEK.map((w) => (
                <button key={w.d} type="button"
                  className={'pill' + (edit.days.includes(w.d) ? ' active' : '')}
                  onClick={() => setEdit({ ...edit, days: edit.days.includes(w.d) ? edit.days.filter((x) => x !== w.d) : [...edit.days, w.d] })}>
                  {w.l}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span className="stat-sub">at</span>
              <select className="select" style={{ maxWidth: 110 }} value={edit.hour}
                onChange={(e) => setEdit({ ...edit, hour: Number(e.target.value) })}>
                {[...Array(24)].map((_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
              <span className="stat-sub">Tashkent{edit.days.length === 0 ? ' — pick days above, or leave it for hand-sending' : ''}</span>
            </div>
          </div>
        </Modal>
      )}

      {picking && (
        <Modal title={`Send “${picking.tpl.title}”`} onClose={() => setPicking(null)}
          footer={<>
            <button className="btn" onClick={() => setPicking(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || picking.ids.length === 0}
              onClick={() => sendNow(picking.tpl, picking.ids)}>
              <Send size={14} /> Send to {picking.ids.length}
            </button>
          </>}>
          <div className="stat-sub" style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>{picking.tpl.text}</div>
          <div className="field"><label>Who gets it now</label>
            <div className="checkbox-row">
              {linked.map((m) => (
                <label key={m.id} className={'checkbox-chip chip-sm' + (picking.ids.includes(m.id) ? ' on' : '')}>
                  <input type="checkbox" checked={picking.ids.includes(m.id)}
                    onChange={() => setPicking({
                      ...picking,
                      ids: picking.ids.includes(m.id) ? picking.ids.filter((x) => x !== m.id) : [...picking.ids, m.id],
                    })} />
                  {m.name}
                </label>
              ))}
            </div>
            {linked.length === 0 && <div className="stat-sub">Nobody has connected Telegram yet.</div>}
          </div>
        </Modal>
      )}
    </>
  )
}

/* ==================== HISTORY (the whole team's paper trail) ============= */
/* Every change anyone made, newest first, written as a sentence — "Mirabbos
   changed the shoot start: 10:00 → 11:00 on «Campus tour»". The task link
   opens the piece; deleted tasks keep their name on the record. */
function HistoryTab() {
  const [rows, setRows] = useState([])
  const [who, setWho] = useState('all')
  useEffect(() => {
    let on = true
    const load = () => api.get('/content/activity/all').then((r) => { if (on) setRows(r) }).catch(() => {})
    load()
    const id = setInterval(load, 15000)
    return () => { on = false; clearInterval(id) }
  }, [])
  const people = useMemo(() => [...new Set(rows.map((r) => r.user_name).filter(Boolean))].sort(), [rows])
  const shown = who === 'all' ? rows : rows.filter((r) => r.user_name === who)
  const when = (ts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
  return (
    <>
      <div className="section-head">
        <h2>History</h2><span className="count">· {shown.length}</span>
        <span style={{ flex: 1 }} />
        <select className="select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by person">
          <option value="all">Everyone</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {shown.map((a) => (
          <div key={a.id} className="alog-row">
            <span className="alog-when">{when(a.created_at)}</span>
            <b className="alog-who">{a.user_name || '?'}</b>
            <span className="alog-text">
              {activityLine(a)} on{' '}
              {a.kind !== 'deleted' && a.content_id
                ? <a className="alog-task" href={`/todo?task=${a.content_id}`}>«{a.content_title}»</a>
                : <>«{a.content_title}»</>}
            </span>
          </div>
        ))}
        {shown.length === 0 && <div className="empty">Nothing yet — changes will be written down here.</div>}
      </div>
    </>
  )
}

/* ==================== TASKS (everyone's to-dos, per channel) ============= */
/* Module-level on purpose: an inline component would remount every row on
   each state change (poll ticks, modals), losing hover and focus. */
function TaskRow({ item, ctx }) {
  const { statusesById, usersById, byKey, toggle, setOpenItem, togglePin, removeTask, openMenu } = ctx
  const isDone = !!item.done_at
  const status = statusesById[item.status_id]
  const who = usersById[item.assignee_id]
  return (
    <div className={'todo-row' + (item.pinned && !isDone ? ' pinned' : '')}
      onContextMenu={(e) => openMenu(e, [
        { label: 'Open', icon: Pencil, onClick: () => setOpenItem(item) },
        { label: isDone ? 'Mark as not done' : 'Mark as done', icon: Check, onClick: () => toggle(item) },
        !isDone && { label: item.pinned ? 'Unpin' : 'Pin to the top', icon: Pin, onClick: () => togglePin(item) },
        { sep: true },
        { label: 'Delete', icon: Trash2, danger: true, onClick: () => removeTask(item) },
      ])}>
      <button className={`todo-check${isDone ? ' on' : ''}`} onClick={() => toggle(item)} data-tip={isDone ? 'Mark as not done' : 'Mark as done'} aria-label="Complete">
        {isDone && <Check size={15} strokeWidth={3.5} />}
      </button>
      <button className="todo-main" onClick={() => setOpenItem(item)} data-tip="Open the task">
        <span className={`todo-title${isDone ? ' done-txt' : ''}`}>{item.title}</span>
        <span className="todo-meta">
          {!!item.pinned && !isDone && <span className="chip chip-pin"><Pin size={10} /> Pinned</span>}
          <span className={`chip ct-${item.type}`}>{typeInfo(item.type).label}</span>
          {item.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
          {status && !isDone && <span className="chip" style={{ background: status.color, color: onColor(status.color) }}>{status.label}</span>}
          {item.recording_date && <span className="chip chip-muted"><Clapperboard size={10} /> {dateLabel(item.recording_date)}</span>}
          {item.release_date && (
            <span className={'chip ' + (!isDone && item.release_date < todayISO() ? 'chip-danger' : 'chip-muted')}
              data-tip={!isDone && item.release_date < todayISO() ? 'Past its release date' : undefined}>
              <Send size={10} /> {dateLabel(item.release_date)}
            </span>
          )}
          {who && <span className="chip chip-muted">{who.name.split(' ')[0]}</span>}
        </span>
      </button>
      <span className="todo-actions">
        {!isDone && (
          <button className={'icon-btn pin-btn' + (item.pinned ? ' on' : '')} onClick={() => togglePin(item)}
            data-tip={item.pinned ? 'Unpin' : 'Pin to the top for everyone'} data-tip-left="" aria-label="Pin">
            <Pin size={14} />
          </button>
        )}
        <button className="icon-btn del-btn" onClick={() => removeTask(item)} data-tip="Delete this task" data-tip-left="" aria-label="Delete task">
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  )
}

function TasksTab() {
  const { visible, byKey } = useChannels()
  const [items, setItems] = useState([])
  const [statuses, setStatuses] = useState([])
  const [users, setUsers] = useState([])
  const [chan, setChan] = useState('all')
  const [openItem, setOpenItem] = useState(null)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.get('/content'), api.get('/statuses'), api.get('/users')])
      .then(([ct, st, us]) => { setItems(ct); setStatuses(st); setUsers(us) })
      .finally(() => setLoading(false))
  }, [])

  // Live sync: new tasks and completions from the team appear on their own.
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || openItem || creating) return
      api.poll('/content').then((fresh) => { if (fresh) setItems(fresh) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [openItem, creating])

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  const filtered = chan === 'all' ? items : items.filter((i) => i.channels.includes(chan))
  const open = filtered.filter((i) => !i.done_at).sort((a, b) => (b.pinned || 0) - (a.pinned || 0))
  const done = filtered.filter((i) => i.done_at)

  const toggle = async (item) => {
    try {
      const u = await api.patch(`/content/${item.id}`, { done: !item.done_at })
      setItems((prev) => prev.map((x) => (x.id === item.id ? u : x)))
    } catch (e) { alert(e.message) }
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

  const togglePin = async (item) => {
    try {
      const u = await api.patch(`/content/${item.id}`, { pinned: !item.pinned })
      setItems((prev) => prev.map((x) => (x.id === item.id ? u : x)))
    } catch (e) { alert(e.message) }
  }
  const removeTask = async (item) => {
    if (!confirm(`Delete “${item.title}”?`)) return
    try { await deleteContent(item) } catch (e) { alert(e.message) }
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const { openMenu } = useContextMenu()
  const rowCtx = { statusesById, usersById, byKey, toggle, setOpenItem, togglePin, removeTask, openMenu }

  return (
    <>
      <div className="pill-group" style={{ marginBottom: 6, alignItems: 'center' }}>
        <button className={'pill' + (chan === 'all' ? ' active' : '')} onClick={() => setChan('all')}>All channels</button>
        {visible.map((c) => (
          <button key={c.key} className={'pill' + (chan === c.key ? ' active' : '')} onClick={() => setChan(c.key)}>{c.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={15} /> New task</button>
      </div>

      <div className="section-head"><h2>Open</h2><span className="count">· {open.length}</span></div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {open.map((i) => <TaskRow key={i.id} item={i} ctx={rowCtx} />)}
        {open.length === 0 && <div className="empty">Nothing open.</div>}
      </div>

      {done.length > 0 && (
        <>
          <div className="section-head"><h2>Completed</h2><span className="count">· {done.length}</span></div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {done.map((i) => <TaskRow key={i.id} item={i} ctx={rowCtx} />)}
          </div>
        </>
      )}

      {openItem && (
        <ContentModal
          item={openItem}
          statuses={statuses}
          onClose={() => setOpenItem(null)}
          onCreate={() => {}}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
      {creating && (
        <ContentModal
          item={null}
          statuses={statuses}
          defaults={chan !== 'all' ? { channels: [chan] } : {}}
          onClose={() => setCreating(false)}
          onCreate={createContent}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      )}
    </>
  )
}

/* ==================== TEAM (+ permissions) ==================== */
const BLANK_USER = { name: '', username: '', password: '', role: 'member', crew_roles: [], departments: [], permissions: {} }

function TeamTab() {
  const { channels } = useChannels()
  const [users, setUsers] = useState([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(BLANK_USER)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [usernameTouched, setUsernameTouched] = useState(false)

  useEffect(() => { api.get('/users').then(setUsers) }, [])

  const openAdd = () => { setForm(BLANK_USER); setUsernameTouched(false); setEditing(null); setErr(''); setModal(true) }
  const openEdit = (u) => {
    setForm({ name: u.name, username: u.username, password: '', role: u.role, crew_roles: [...(u.crew_roles || [])], departments: u.departments, permissions: { ...u.permissions } })
    setUsernameTouched(true); setEditing(u.id); setErr(''); setModal(true)
  }

  const save = async () => {
    setBusy(true); setErr('')
    try {
      if (editing) {
        const body = { name: form.name, username: form.username, role: form.role, crew_roles: form.crew_roles, departments: form.departments, permissions: form.permissions }
        if (form.password) body.password = form.password
        const u = await api.patch(`/users/${editing}`, body)
        setUsers((prev) => prev.map((x) => (x.id === editing ? u : x)))
      } else {
        const u = await api.post('/users', { ...form, color: colorFor(form.username || form.name) })
        setUsers((prev) => [...prev, u])
      }
      setModal(false)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const del = async (u) => {
    if (!confirm(`Remove ${u.name}?`)) return
    try { await api.del(`/users/${u.id}`); setUsers((prev) => prev.filter((x) => x.id !== u.id)) }
    catch (e) { alert(e.message) }
  }

  const toggleDept = (k) =>
    setForm((f) => ({ ...f, departments: f.departments.includes(k) ? f.departments.filter((d) => d !== k) : [...f.departments, k] }))
  const togglePerm = (k) =>
    setForm((f) => ({ ...f, permissions: { ...f.permissions, [k]: !f.permissions[k] } }))

  return (
    <>
      <div className="section-head">
        <h2>Team members</h2>
        <span className="count">· {users.length}</span>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={openAdd}><Plus size={15} /> Add member</button>
      </div>
      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr><th>Member</th><th>Role</th><th>Channels</th><th>Permissions</th><th style={{ textAlign: 'right' }} /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
                    <div>
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div className="stat-sub">@{u.username}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {u.role === 'admin' ? <span className="badge"><ShieldCheck size={12} /> Admin</span>
                    : (u.crew_roles || []).length > 0 ? <span className="badge badge-muted"><Video size={12} /> {(u.crew_roles || []).map((c) => c[0].toUpperCase() + c.slice(1)).join(' & ')}</span>
                    : <span className="badge badge-muted">Member</span>}
                </td>
                <td>
                  <div className="dept-chips">
                    {u.role === 'admin'
                      ? <span className="stat-sub">All channels</span>
                      : (u.crew_roles || []).length > 0
                        ? <span className="stat-sub">Their work, any channel</span>
                        : u.departments.map((d) => {
                            const c = channels.find((x) => x.key === d)
                            return <span key={d} className="badge badge-muted">{c?.label || d}</span>
                          })}
                  </div>
                </td>
                <td>
                  {u.role === 'admin'
                    ? <span className="stat-sub">Everything</span>
                    : (u.crew_roles || []).length > 0
                      ? <span className="stat-sub">Move own work</span>
                      : <span className="stat-sub">{PERMISSIONS.filter((p) => u.permissions[p.key]).length}/{PERMISSIONS.length} enabled</span>}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(u)} data-tip="Edit member, channels & rights" aria-label="Edit"><Pencil size={15} /></button>
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => del(u)} data-tip="Remove this member" data-tip-left="" aria-label="Delete"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={editing ? 'Edit member' : 'Add member'}
          onClose={() => setModal(false)}
          footer={<>
            <button className="btn" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{editing ? 'Save changes' : 'Create member'}</button>
          </>}
        >
          {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
          <div className="field"><label>Name</label>
            <input className="input" value={form.name} autoFocus placeholder="e.g. Dilnoza Karimova"
              onChange={(e) => {
                const name = e.target.value
                setForm((f) => ({ ...f, name, username: usernameTouched ? f.username : slug(name) }))
              }} />
          </div>
          <div className="field"><label>Username <span style={{ color: 'var(--muted)', fontWeight: 400 }}>— used to sign in</span></label>
            <input className="input" type="text" autoCapitalize="none" autoCorrect="off" value={form.username} placeholder="dilnoza"
              onChange={(e) => { setUsernameTouched(true); setForm({ ...form, username: e.target.value }) }} />
          </div>
          <div className="field"><label>{editing ? 'New password (leave blank to keep)' : 'Password'}</label>
            <input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Set a password" />
          </div>
          <div className="field"><label>Role</label>
            <RolePicker role={form.role} crewRoles={form.crew_roles}
              onChange={(role, crew_roles) => setForm({ ...form, role, crew_roles })} />
          </div>
          {form.role === 'member' && (
            <>
              <div className="field"><label>Channels</label>
                <div className="checkbox-row">
                  {channels.map((c) => (
                    <label key={c.key} className={'checkbox-chip' + (form.departments.includes(c.key) ? ' on' : '')}>
                      <input type="checkbox" checked={form.departments.includes(c.key)} onChange={() => toggleDept(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field"><label>Permissions</label>
                <div className="perm-list">
                  {PERMISSIONS.map((p) => (
                    <button key={p.key} type="button" className={'perm-row' + (form.permissions[p.key] ? ' on' : '')} onClick={() => togglePerm(p.key)}>
                      <span className={'perm-toggle' + (form.permissions[p.key] ? ' on' : '')}>{form.permissions[p.key] && <Check size={12} strokeWidth={3.5} />}</span>
                      <span>
                        <span className="perm-label">{p.label}</span>
                        <span className="perm-desc">{p.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {form.role === 'admin' && <span className="stat-sub">Admins can access every channel and do everything.</span>}
          {!['member', 'admin'].includes(form.role) && (
            <span className="stat-sub">
              Production crew: no channels, no metrics, no task creation. They sign in to a daily brief of
              the tasks where they hold a hat ({(form.crew_roles || []).join(', ') || 'crew'}) — set on each task’s
              Crew row — with deadlines and hours, and they move that work through the pipeline themselves.
            </span>
          )}
        </Modal>
      )}
    </>
  )
}

/* ==================== CHANNELS (custom sidebar) ==================== */
function ChannelsTab({ onOpenReport }) {
  const { channels, reload } = useChannels()
  const [modal, setModal] = useState(null) // {id?, label, icon, head_id}
  const [team, setTeam] = useState([])
  const [err, setErr] = useState('')
  // The same numbers the Reports tab shows for "This month" — one source.
  const [monthReport, setMonthReport] = useState(null)
  const [content, setContent] = useState([])

  const t = todayISO()
  const monthStart = t.slice(0, 8) + '01'
  const loadStats = () => {
    api.get(`/reports?from=${monthStart}&to=${t}`).then(setMonthReport).catch(() => {})
    api.get('/content').then(setContent).catch(() => {})
  }
  useEffect(() => {
    api.get('/users').then(setTeam).catch(() => {})
    loadStats()
    const id = setInterval(() => { if (!document.hidden) loadStats() }, 15000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const statsFor = (key) => {
    const open = content.filter((c) => !c.done_at && c.channels.includes(key))
    const overdue = open.filter((c) => {
      const d = c.release_date || c.recording_date
      return d && d < t
    })
    return { done: monthReport?.byChannel?.[key]?.total || 0, open: open.length, overdue: overdue.length }
  }

  const save = async () => {
    if (!modal.label.trim()) return
    setErr('')
    try {
      const body = { label: modal.label.trim(), icon: modal.icon, head_id: modal.head_id ?? null }
      if (modal.id) await api.patch(`/channels/${modal.id}`, body)
      else await api.post('/channels', body)
      reload()
      setModal(null)
    } catch (e) { setErr(e.message) }
  }
  const del = async (c) => {
    if (!confirm(`Delete "${c.label}"? Its metrics and tasks will be removed too.`)) return
    try { await api.del(`/channels/${c.id}`); reload() } catch (e) { alert(e.message) }
  }
  const move = async (idx, dir) => {
    const ids = channels.map((c) => c.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    try { await api.post('/channels/reorder', { ids }); reload() } catch (e) { alert(e.message) }
  }

  return (
    <>
      <div className="section-head">
        <h2>Sidebar channels</h2>
        <span className="count">· shown top to bottom</span>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => { setModal({ label: '', icon: 'instagram', head_id: null }); setErr('') }}><Plus size={15} /> Add channel</button>
      </div>
      <div className="card" style={{ padding: '6px 14px' }}>
        {channels.map((c, i) => {
          const Icon = iconFor(c.icon)
          return (
            <div key={c.id} className="chan-row">
              <span className="chan-icon"><Icon size={17} /></span>
              <span style={{ fontWeight: 600 }}>{c.label}</span>
              <span className="stat-sub" style={{ fontFamily: 'ui-monospace, monospace' }}>{c.key}</span>
              {c.head_id && c.head_name ? (
                <span className="chan-head" title={`Head: ${c.head_name}`}>
                  <Avatar name={c.head_name} color={c.head_color} src={c.head_avatar} size="sm" />
                  {c.head_name}
                </span>
              ) : (
                <span className="no-owner-badge" data-tip="Nobody owns this channel — assign a head">no owner</span>
              )}
              {(() => {
                const st = statsFor(c.key)
                return (
                  <span className="chan-stats">
                    <span className="chan-stat" data-tip="Completed this month — same number as the Reports tab"><b>{st.done}</b> done</span>
                    <span className="chan-stat" data-tip="Open tasks right now"><b>{st.open}</b> open</span>
                    {st.overdue > 0 && <span className="chan-stat late" data-tip="Open tasks past their date"><b>{st.overdue}</b> overdue</span>}
                    <button className="btn btn-ghost btn-sm" onClick={() => onOpenReport(c.key)} data-tip="This channel's full report">
                      Report →
                    </button>
                  </span>
                )
              })()}
              <span className="spacer" style={{ flex: 1 }} />
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} data-tip="Move up in the sidebar" aria-label="Up"><ArrowUp size={15} /></button>
              <button className="icon-btn" disabled={i === channels.length - 1} onClick={() => move(i, 1)} data-tip="Move down in the sidebar" aria-label="Down"><ArrowDown size={15} /></button>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setModal({ id: c.id, label: c.label, icon: c.icon, head_id: c.head_id ?? null }); setErr('') }} data-tip="Edit name, head & icon" aria-label="Edit"><Pencil size={15} /></button>
              <button className="btn btn-danger btn-sm btn-icon" onClick={() => del(c)} data-tip="Delete channel & its data" data-tip-left="" aria-label="Delete"><Trash2 size={15} /></button>
            </div>
          )
        })}
      </div>

      {modal && (
        <Modal
          title={modal.id ? 'Edit channel' : 'New channel'}
          onClose={() => setModal(null)}
          footer={<>
            <button className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!modal.label.trim()}>{modal.id ? 'Save' : 'Add'}</button>
          </>}
        >
          {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
          <div className="field"><label>Name</label>
            <input className="input" autoFocus value={modal.label} onChange={(e) => setModal({ ...modal, label: e.target.value })} placeholder="e.g. Instagram Kids" />
          </div>
          <div className="field"><label>Head of department <span className="stat-sub">(shown on the channel page)</span></label>
            <select className="select" value={modal.head_id ?? ''} onChange={(e) => setModal({ ...modal, head_id: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">— No head yet —</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === 'admin' ? ' (admin)' : ''}</option>)}
            </select>
          </div>
          <div className="field"><label>Icon</label>
            <div className="icon-grid">
              {Object.entries(CHANNEL_ICONS).map(([name, Icon]) => (
                <button key={name} type="button" className={'icon-cell' + (modal.icon === name ? ' on' : '')} onClick={() => setModal({ ...modal, icon: name })} data-tip={name} aria-label={name}>
                  <Icon size={18} />
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

/* ==================== PIPELINE (statuses) ==================== */
// Who moves work OUT of which stage — the natural chain by default (operator
// works until Shot, editor until Ready, the SMM everywhere), tunable per cell.
const STAGE_ACTORS = [
  { key: 'operator', label: 'Operator' },
  { key: 'editor', label: 'Editor' },
  { key: 'designer', label: 'Designer' },
  { key: 'member', label: 'Member (SMM)' },
]

// The brief fields the admin can tune (ClickUp-style): each can be off,
// optional or required, per content type; Format and Rubrika carry option
// lists the dropdowns offer.
const TASK_FIELD_DEFS = [
  { key: 'format', label: 'Format', hint: 'talking head, split screen…' },
  { key: 'rubrika', label: 'Rubrika', hint: 'the recurring column it belongs to' },
  { key: 'script', label: 'Script', hint: 'the words and shots the crew films by' },
  { key: 'reference', label: 'Reference', hint: 'examples, mood, style — the brief' },
  { key: 'description', label: 'Description', hint: 'free notes on the task' },
]

function PipelineTab() {
  const [statuses, setStatuses] = useState([])
  const [modal, setModal] = useState(null)
  const [err, setErr] = useState('')
  const [rules, setRules] = useState(null)
  const [fields, setFields] = useState(null)
  const [optDraft, setOptDraft] = useState({})

  const load = () => Promise.all([
    api.get('/statuses').then(setStatuses),
    api.get('/statuses/rules').then(setRules).catch(() => {}),
    api.get('/fields').then(setFields).catch(() => {}),
  ])
  useEffect(() => { load() }, [])

  // One change = one save; the server answers the effective config back.
  const patchField = (k, part) => {
    const next = { ...fields, [k]: { ...fields[k], ...part } }
    setFields(next)
    api.post('/fields', next).then((eff) => { setFields(eff); toast('Task form saved — synced') })
      .catch((e) => { alert(e.message); load() })
  }
  const toggleFieldType = (k, t) => patchField(k, {
    types: fields[k].types.includes(t) ? fields[k].types.filter((x) => x !== t) : [...fields[k].types, t],
  })
  const addOption = (k) => {
    const v = (optDraft[k] || '').trim()
    if (!v) return
    setOptDraft({ ...optDraft, [k]: '' })
    patchField(k, { options: [...new Set([...(fields[k].options || []), v])] })
  }
  // The crew rules: which types DEMAND each hat — what the Unassigned page
  // and Overview's gap strip count as a real gap.
  const patchCrew = (hat, type) => {
    const cur = fields.crew?.[hat] || []
    const next = {
      ...fields,
      crew: { ...fields.crew, [hat]: cur.includes(type) ? cur.filter((x) => x !== type) : [...cur, type] },
    }
    setFields(next)
    api.post('/fields', next).then((eff) => { setFields(eff); toast('Crew rules saved — synced') })
      .catch((e) => { alert(e.message); load() })
  }

  const toggleRule = async (actor, sid) => {
    const next = { ...rules, [actor]: { ...rules[actor], [sid]: !rules[actor]?.[sid] } }
    setRules(next)
    try { await api.post('/statuses/rules', next); toast('Stage rules saved — synced') }
    catch (e) { alert(e.message); load() }
  }

  const save = async () => {
    if (!modal.label.trim()) return
    setErr('')
    try {
      if (modal.id) await api.patch(`/statuses/${modal.id}`, { label: modal.label.trim(), color: modal.color })
      else await api.post('/statuses', { label: modal.label.trim(), color: modal.color })
      await load()
      setModal(null)
    } catch (e) { setErr(e.message) }
  }
  const del = async (s) => {
    if (!confirm(`Delete stage "${s.label}"? Its tasks move to the first stage.`)) return
    try { await api.del(`/statuses/${s.id}`); load() } catch (e) { alert(e.message) }
  }
  const move = async (idx, dir) => {
    const ids = statuses.map((s) => s.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    try { await api.post('/statuses/reorder', { ids }); load() } catch (e) { alert(e.message) }
  }
  const setFinal = async (s) => {
    try { await api.patch(`/statuses/${s.id}`, { is_final: true }); load() } catch (e) { alert(e.message) }
  }

  return (
    <>
      <div className="section-head">
        <h2>Content pipeline</h2>
        <span className="count">· stages every task moves through</span>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => { setModal({ label: '', color: STATUS_COLORS[0] }); setErr('') }}><Plus size={15} /> Add stage</button>
      </div>
      <div className="card" style={{ padding: '6px 14px' }}>
        {statuses.map((s, i) => (
          <div key={s.id} className="chan-row">
            <span className="status-dot" style={{ background: s.color, width: 12, height: 12 }} />
            <span style={{ fontWeight: 600 }}>{s.label}</span>
            {s.is_final
              ? <span className="badge">Final — counts as published</span>
              : <button className="btn btn-ghost btn-sm" onClick={() => setFinal(s)} data-tip="Tasks reaching this stage count as published">Make final</button>}
            <span className="spacer" style={{ flex: 1 }} />
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} data-tip="Move stage earlier" aria-label="Up"><ArrowUp size={15} /></button>
            <button className="icon-btn" disabled={i === statuses.length - 1} onClick={() => move(i, 1)} data-tip="Move stage later" aria-label="Down"><ArrowDown size={15} /></button>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setModal({ id: s.id, label: s.label, color: s.color }); setErr('') }} data-tip="Rename or recolor" aria-label="Edit"><Pencil size={15} /></button>
            <button className="btn btn-danger btn-sm btn-icon" onClick={() => del(s)} data-tip="Delete this stage" data-tip-left="" aria-label="Delete"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      {/* ---- stage rules: who moves work out of each stage ---- */}
      {rules && statuses.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 18 }}>
            <h2>Stage rules</h2>
            <span className="count">· who may move a task out of each stage</span>
          </div>
          <div className="card table-wrap">
            <table className="tbl rules-tbl">
              <thead>
                <tr>
                  <th>Stage</th>
                  {STAGE_ACTORS.map((a) => <th key={a.key}>{a.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {statuses.filter((s) => !s.is_final).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="status-dot" style={{ background: s.color, marginRight: 7 }} />
                      <b>{s.label}</b> <span className="stat-sub">→ onward</span>
                    </td>
                    {STAGE_ACTORS.map((a) => {
                      const on = !!rules[a.key]?.[s.id]
                      return (
                        <td key={a.key}>
                          <button type="button" className={'perm-toggle rules-cell' + (on ? ' on' : '')}
                            onClick={() => toggleRule(a.key, s.id)}
                            data-tip={on ? `${a.label} may move work out of ${s.label}` : `${a.label} may NOT move work out of ${s.label}`}
                            aria-label={`${a.label} out of ${s.label}`}>
                            {on && <Check size={12} strokeWidth={3.5} />}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="stat-sub" style={{ padding: '4px 14px 12px' }}>
              Admins always move everything. Publishing (into the final stage) is governed by each member’s
              “Review &amp; publish” permission, not by this table. Rules narrow what a role could already do —
              the crew still work through their ticks.
            </div>
          </div>
        </>
      )}

      {/* ---- the task form: which brief fields exist, and which are demanded ---- */}
      {fields && (
        <>
          <div className="section-head" style={{ marginTop: 18 }}>
            <h2>The task form</h2>
            <span className="count">· which brief fields a task carries — and which are demanded</span>
          </div>
          <div className="card table-wrap">
            <table className="tbl fields-tbl">
              <thead>
                <tr><th>Field</th><th>Rule</th><th>Applies to</th><th>Options</th></tr>
              </thead>
              <tbody>
                {TASK_FIELD_DEFS.map((f) => {
                  const cfg = fields[f.key]
                  if (!cfg) return null
                  return (
                    <tr key={f.key}>
                      <td>
                        <b>{f.label}</b>
                        <div className="stat-sub">{f.hint}</div>
                      </td>
                      <td>
                        <div className="pill-group">
                          {['off', 'optional', 'required'].map((st) => (
                            <button key={st} type="button"
                              className={'pill' + (cfg.state === st ? ' active' : '') + (st === 'required' && cfg.state === st ? ' pill-req' : '')}
                              onClick={() => patchField(f.key, { state: st })}>
                              {st}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="pill-group">
                          {CONTENT_TYPES.map((t) => (
                            <button key={t.key} type="button"
                              className={'pill' + (cfg.types.includes(t.key) ? ' active' : '')}
                              data-tip={cfg.types.includes(t.key) ? `${t.label}s carry ${f.label}` : `${t.label}s don’t carry ${f.label}`}
                              onClick={() => toggleFieldType(f.key, t.key)}>
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        {cfg.options !== undefined ? (
                          <div className="opt-chips">
                            {cfg.options.map((o) => (
                              <span key={o} className="chip chip-muted opt-chip">
                                {o}
                                <button type="button" className="opt-chip-x" aria-label={`Remove ${o}`}
                                  onClick={() => patchField(f.key, { options: cfg.options.filter((x) => x !== o) })}>
                                  <X size={11} />
                                </button>
                              </span>
                            ))}
                            <span className="opt-add">
                              <input className="input pc-mini" placeholder="Add…" value={optDraft[f.key] || ''}
                                onChange={(e) => setOptDraft({ ...optDraft, [f.key]: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(f.key) } }} />
                              <button type="button" className="btn btn-sm" onClick={() => addOption(f.key)}>Add</button>
                            </span>
                          </div>
                        ) : <span className="stat-sub">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="stat-sub" style={{ padding: '4px 14px 12px' }}>
              A required field blocks saving a task of those types without it — and blocks clearing it later.
              Off hides the field from the task card entirely; the crew always see what’s filled in.
            </div>
          </div>

          {/* ---- who must be on a task: the hats the gap views count ---- */}
          {fields.crew && (
            <>
              <div className="section-head" style={{ marginTop: 18 }}>
                <h2>Who must be on a task</h2>
                <span className="count">· only these hats count as gaps on Unassigned and Overview</span>
              </div>
              <div className="card table-wrap">
                <table className="tbl crew-tbl">
                  <thead>
                    <tr><th>Hat</th><th>Demanded on</th></tr>
                  </thead>
                  <tbody>
                    {[
                      { key: 'operator', label: 'Operator', hint: 'who films it' },
                      { key: 'editor', label: 'Editor', hint: 'who cuts it' },
                      { key: 'designer', label: 'Designer', hint: 'who draws the artwork' },
                    ].map((h) => (
                      <tr key={h.key}>
                        <td>
                          <b>{h.label}</b>
                          <div className="stat-sub">{h.hint}</div>
                        </td>
                        <td>
                          <div className="pill-group">
                            {CONTENT_TYPES.map((t) => (
                              <button key={t.key} type="button"
                                className={'pill' + ((fields.crew[h.key] || []).includes(t.key) ? ' active' : '')}
                                data-tip={(fields.crew[h.key] || []).includes(t.key)
                                  ? `A ${t.label.toLowerCase()} without ${h.label.toLowerCase()} shows on Unassigned`
                                  : `${t.label}s never ask for ${h.label.toLowerCase()}`}
                                onClick={() => patchCrew(h.key, t.key)}>
                                {t.label}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="stat-sub" style={{ padding: '4px 14px 12px' }}>
                  Untick a type and its tasks stop shouting for that hat — the Unassigned page quiets down instantly.
                </div>
              </div>
            </>
          )}
        </>
      )}

      {modal && (
        <Modal
          title={modal.id ? 'Edit stage' : 'New stage'}
          onClose={() => setModal(null)}
          footer={<>
            <button className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!modal.label.trim()}>{modal.id ? 'Save' : 'Add'}</button>
          </>}
        >
          {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
          <div className="field"><label>Name</label>
            <input className="input" autoFocus value={modal.label} onChange={(e) => setModal({ ...modal, label: e.target.value })} placeholder="e.g. On review" />
          </div>
          <div className="field"><label>Color</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {STATUS_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setModal({ ...modal, color: c })} aria-label={c}
                  style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: modal.color === c ? '3px solid var(--ink)' : '2px solid var(--hairline)', cursor: 'pointer' }} />
              ))}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

/* ==================== REPORTS ==================== */
function ReportsTab({ channel, setChannel }) {
  const { channels, byKey } = useChannels()
  const t = todayISO()
  const monthStart = t.slice(0, 8) + '01'
  const prevMonthEnd = addDaysISO(monthStart, -1)
  const prevMonthStart = prevMonthEnd.slice(0, 8) + '01'
  const weekStart = (() => {
    const d = new Date(`${t}T00:00:00`) // weekday of today's Tashkent date
    return addDaysISO(t, -((d.getDay() + 6) % 7))
  })()

  const PRESETS = [
    { key: 'week', label: 'This week', from: weekStart, to: t },
    { key: 'month', label: 'This month', from: monthStart, to: t },
    { key: 'prev', label: 'Last month', from: prevMonthStart, to: prevMonthEnd },
    { key: 'custom', label: 'Custom' },
  ]
  const [preset, setPreset] = useState('month')
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(t)
  const [data, setData] = useState(null)

  const range = useMemo(() => {
    const p = PRESETS.find((x) => x.key === preset)
    return preset === 'custom' ? { from, to } : { from: p.from, to: p.to }
  }, [preset, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get(`/reports?from=${range.from}&to=${range.to}`).then(setData).catch(() => setData(null))
  }, [range.from, range.to])

  const colorOf = useMemo(() => Object.fromEntries(channels.map((c, i) => [c.key, deptColor(i)])), [channels])
  const chStats = channel !== 'all' ? data?.byChannel?.[channel] : null
  const shownTotal = channel === 'all' ? data?.totalDone : (chStats?.total || 0)

  // People, through the selected channel's lens — the same numbers as the
  // channel breakdown, never a second calculation.
  const people = useMemo(() => {
    if (!data) return []
    if (channel === 'all') return data.report
    return data.report
      .map((r) => ({ ...r, shown: r.byChannel[channel] || 0, items: r.items.filter((it) => (it.channels || [it.channel]).includes(channel)) }))
      .filter((r) => r.shown > 0 || r.role !== 'admin')
      .sort((a, b) => (b.shown || 0) - (a.shown || 0))
  }, [data, channel])

  return (
    <>
      <div className="section-head">
        <h2>Who did what</h2>
        <span className="count">· completed work, one source of truth</span>
        <span className="spacer" />
        <div className="pill-group">
          {PRESETS.map((p) => (
            <button key={p.key} className={'pill' + (preset === p.key ? ' active' : '')} onClick={() => setPreset(p.key)}>{p.label}</button>
          ))}
        </div>
      </div>
      {preset === 'custom' && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <input className="input" type="date" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input" type="date" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}

      {/* Channel lens: All, or one channel in its own color */}
      <div className="pill-group" style={{ margin: '4px 0 14px' }}>
        <button className={'pill' + (channel === 'all' ? ' active' : '')} onClick={() => setChannel('all')} data-tip="All channels together">All channels</button>
        {channels.map((c) => (
          <button key={c.key} className={'pill' + (channel === c.key ? ' active' : '')} onClick={() => setChannel(c.key)}
            data-tip={`Only ${c.label}'s completed work`}>
            <span className="rp-dot" style={{ background: colorOf[c.key] }} />{c.label}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="app-loading"><span className="spinner" /></div>
      ) : (
        <>
          {/* The headline: one big number and where it happened */}
          <div className="card card-pad rp-head">
            <div className="rp-big">
              <b>{shownTotal}</b>
              <span className="rp-big-label">
                task{shownTotal === 1 ? '' : 's'} completed
                {channel !== 'all' ? <> on <b style={{ color: colorOf[channel] }}>{byKey[channel]?.label || channel}</b></> : ''}
                <br /><span className="stat-sub">{range.from} → {range.to}</span>
              </span>
            </div>
            <div className="rp-chips">
              {channel === 'all'
                ? channels.map((c) => {
                    const n = data.byChannel?.[c.key]?.total || 0
                    if (n === 0) return null
                    return (
                      <button key={c.key} className="chip rp-chan" style={{ background: colorOf[c.key], color: onColor(colorOf[c.key]) }}
                        onClick={() => setChannel(c.key)} data-tip={`Open ${c.label}'s report`}>
                        {c.label} · {n}
                      </button>
                    )
                  })
                : Object.entries(chStats?.byType || {}).map(([k, n]) => (
                    <span key={k} className={`chip ct-${k}`}>{typeInfo(k).plan || typeInfo(k).label} · {n}</span>
                  ))}
            </div>
          </div>

          {/* People — big bold numbers, biggest first */}
          <div className="grid" style={{ gap: 12, marginTop: 14 }}>
            {people.map((r) => {
              const n = channel === 'all' ? r.total : r.shown
              return (
                <div className="card card-pad rp-person" key={r.id}>
                  <div className="rp-person-row">
                    <Avatar name={r.name} color={r.color} src={r.avatar} />
                    <div className="rp-person-meta">
                      <div className="rp-person-name">{r.name}</div>
                      <div className="dept-chips">
                        {channel === 'all' && Object.entries(r.byChannel).map(([k, cnt]) => (
                          <span key={k} className="chip" style={{ background: colorOf[k] || '#6d6a70', color: onColor(colorOf[k] || '#6d6a70') }}>
                            {byKey[k]?.label || k} · {cnt}
                          </span>
                        ))}
                        {Object.entries(r.byType).map(([k, cnt]) => (
                          <span key={k} className={`chip ct-${k}`}>{typeInfo(k).plan || typeInfo(k).label} · {cnt}</span>
                        ))}
                      </div>
                    </div>
                    <div className="rp-person-total">
                      <b>{n}</b>
                      <span>done</span>
                    </div>
                  </div>
                  {r.items.length > 0 && (
                    <details style={{ marginTop: 10 }}>
                      <summary className="stat-sub" style={{ cursor: 'pointer' }}>Show the {r.items.length} item{r.items.length === 1 ? '' : 's'}</summary>
                      <div style={{ marginTop: 6 }}>
                        {r.items.map((it) => (
                          <div key={it.id} className="report-item">
                            <span>{it.title}</span>
                            <span className="stat-sub">{byKey[it.channel]?.label || it.channel} · {tashkentDay(it.done_at)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )
            })}
            {people.length === 0 && <div className="card card-pad empty">Nothing completed in this period.</div>}
          </div>
        </>
      )}
    </>
  )
}
