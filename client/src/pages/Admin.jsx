import { useEffect, useMemo, useState } from 'react'
import {
  Users, PanelLeft, KanbanSquare, FileBarChart, Plus, Pencil, Trash2, AlertCircle,
  ShieldCheck, ArrowUp, ArrowDown, Check, Megaphone, ListChecks, Clapperboard, Send,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { useChannels } from '../lib/channels.jsx'
import { CHANNEL_ICONS, iconFor, PERMISSIONS, todayISO, addDaysISO, localISO, dateLabel, typeInfo } from '../lib/constants.js'
import Avatar from '../components/Avatar.jsx'
import Modal from '../components/Modal.jsx'
import ContentModal from '../components/ContentModal.jsx'

const SWATCHES = ['#a32234', '#8c1d2c', '#c0392b', '#7d1128', '#b5324a', '#711523', '#56101b']
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
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { key: 'channels', label: 'Channels', icon: PanelLeft },
  { key: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
  { key: 'reports', label: 'Reports', icon: FileBarChart },
]

export default function Admin() {
  const [tab, setTab] = useState('team')
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
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'channels' && <ChannelsTab />}
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'reports' && <ReportsTab />}
    </>
  )
}

/* ==================== TASKS (everyone's to-dos, per channel) ============= */
function TasksTab() {
  const { visible, byKey } = useChannels()
  const [items, setItems] = useState([])
  const [statuses, setStatuses] = useState([])
  const [users, setUsers] = useState([])
  const [chan, setChan] = useState('all')
  const [openItem, setOpenItem] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.get('/content'), api.get('/statuses'), api.get('/users')])
      .then(([ct, st, us]) => { setItems(ct); setStatuses(st); setUsers(us) })
      .finally(() => setLoading(false))
  }, [])

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  const filtered = chan === 'all' ? items : items.filter((i) => i.channels.includes(chan))
  const open = filtered.filter((i) => !i.done_at)
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

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const Row = ({ item }) => {
    const isDone = !!item.done_at
    const status = statusesById[item.status_id]
    const who = usersById[item.assignee_id]
    return (
      <div className="todo-row">
        <button className={`todo-check${isDone ? ' on' : ''}`} onClick={() => toggle(item)} aria-label="Complete">
          {isDone && <Check size={15} strokeWidth={3.5} />}
        </button>
        <button className="todo-main" onClick={() => setOpenItem(item)}>
          <span className={`todo-title${isDone ? ' done-txt' : ''}`}>{item.title}</span>
          <span className="todo-meta">
            <span className={`chip ct-${item.type}`}>{typeInfo(item.type).label}</span>
            {item.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
            {status && !isDone && <span className="chip" style={{ background: `${status.color}22`, color: status.color }}>{status.label}</span>}
            {item.recording_date && <span className="chip chip-muted"><Clapperboard size={10} /> {dateLabel(item.recording_date)}</span>}
            {item.release_date && <span className="chip chip-muted"><Send size={10} /> {dateLabel(item.release_date)}</span>}
            {who && <span className="chip chip-muted">{who.name.split(' ')[0]}</span>}
          </span>
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="pill-group" style={{ marginBottom: 6 }}>
        <button className={'pill' + (chan === 'all' ? ' active' : '')} onClick={() => setChan('all')}>All channels</button>
        {visible.map((c) => (
          <button key={c.key} className={'pill' + (chan === c.key ? ' active' : '')} onClick={() => setChan(c.key)}>{c.label}</button>
        ))}
      </div>

      <div className="section-head"><h2>Open</h2><span className="count">· {open.length}</span></div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {open.map((i) => <Row key={i.id} item={i} />)}
        {open.length === 0 && <div className="empty">Nothing open.</div>}
      </div>

      {done.length > 0 && (
        <>
          <div className="section-head"><h2>Completed</h2><span className="count">· {done.length}</span></div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {done.map((i) => <Row key={i.id} item={i} />)}
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
    </>
  )
}

/* ==================== CAMPAIGNS (plan: overview · calendar · projects) ==== */
const BLANK_CAMPAIGN = {
  name: '', timing: '', channel: '', audience: '', goal: '', notes: '',
  duration: 'short', owner: '', status: '', ongoing: false, months: [],
}

const ymLabel = (ym) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

// 'YYYY-MM' for the current month + the next n-1.
function upcomingMonths(n = 6) {
  const out = []
  const d = new Date(); d.setDate(1)
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() + 1)
  }
  return out
}
// Every month from the earliest to the latest, inclusive.
function monthSpan(months) {
  if (months.length === 0) return []
  const sorted = [...months].sort()
  const out = []
  const d = new Date(`${sorted[0]}-01T00:00:00`)
  const last = sorted[sorted.length - 1]
  let ym = sorted[0]
  while (ym <= last) {
    out.push(ym)
    d.setMonth(d.getMonth() + 1)
    ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return out
}

function CampaignsTab() {
  const [view, setView] = useState('overview') // overview | calendar | projects
  const [campaigns, setCampaigns] = useState([])
  const [modal, setModal] = useState(null) // BLANK_CAMPAIGN or {id, ...}
  const [err, setErr] = useState('')

  useEffect(() => { api.get('/campaigns').then(setCampaigns) }, [])

  const openAdd = () => { setModal({ ...BLANK_CAMPAIGN }); setErr('') }
  const openEdit = (c) => { setModal({ ...c }); setErr('') }

  const save = async () => {
    if (!modal.name.trim()) return
    setErr('')
    try {
      if (modal.id) {
        const u = await api.patch(`/campaigns/${modal.id}`, modal)
        setCampaigns((prev) => prev.map((x) => (x.id === modal.id ? u : x)))
      } else {
        const u = await api.post('/campaigns', modal)
        setCampaigns((prev) => [...prev, u])
      }
      setModal(null)
    } catch (e) { setErr(e.message) }
  }
  const del = async () => {
    if (!confirm(`Delete "${modal.name}"?`)) return
    try { await api.del(`/campaigns/${modal.id}`); setCampaigns((prev) => prev.filter((x) => x.id !== modal.id)); setModal(null) }
    catch (e) { setErr(e.message) }
  }
  const move = async (idx, dir) => {
    const j = idx + dir
    if (j < 0 || j >= campaigns.length) return
    const next = [...campaigns]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setCampaigns(next)
    try { await api.post('/campaigns/reorder', { ids: next.map((c) => c.id) }) } catch { /* ignore */ }
  }

  const toggleMonth = (ym) =>
    setModal((m) => ({ ...m, months: m.months.includes(ym) ? m.months.filter((x) => x !== ym) : [...m.months, ym] }))

  // Calendar spans the next half-year, stretched to include anything scheduled.
  const calendarMonths = monthSpan([...campaigns.flatMap((c) => c.months), ...upcomingMonths(6)])
  const monthChips = [...new Set([...upcomingMonths(6), ...(modal?.months || [])])].sort()

  const VIEWS = [
    { key: 'overview', label: 'Overview' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'projects', label: 'Projects' },
  ]

  return (
    <>
      <div className="section-head">
        <h2>Campaign plan</h2>
        <span className="count">· {campaigns.length}</span>
        <span className="spacer" />
        <div className="pill-group">
          {VIEWS.map((v) => (
            <button key={v.key} className={'pill' + (view === v.key ? ' active' : '')} onClick={() => setView(v.key)}>{v.label}</button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd}><Plus size={15} /> Add campaign</button>
      </div>

      {view === 'overview' && (
        <div className="card table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>Campaign</th><th>Timing</th><th>Channel</th><th>Audience</th><th>Goal</th><th /></tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr key={c.id} className="row-click" onClick={() => openEdit(c)}>
                  <td className="stat-sub">{i + 1}</td>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{c.name}</td>
                  <td>{c.timing}</td>
                  <td>{c.channel}</td>
                  <td>{c.audience}</td>
                  <td>{c.goal}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up"><ArrowUp size={14} /></button>
                      <button className="icon-btn" disabled={i === campaigns.length - 1} onClick={() => move(i, 1)} aria-label="Down"><ArrowDown size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {campaigns.length === 0 && <div className="empty">No campaigns yet.</div>}
        </div>
      )}

      {view === 'calendar' && (
        <div className="plan">
          <PlanRow tone="dark" label="Ongoing" items={campaigns.filter((c) => c.ongoing)} onOpen={openEdit}
            emptyText="No ongoing campaigns." />
          {calendarMonths.map((ym) => (
            <PlanRow key={ym} label={ymLabel(ym)} items={campaigns.filter((c) => c.months.includes(ym))} onOpen={openEdit}
              emptyText="Nothing scheduled — ongoing campaigns continue." />
          ))}
        </div>
      )}

      {view === 'projects' && (
        <div className="card table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>Campaign</th><th>Duration</th><th>Owner</th><th>Status</th></tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr key={c.id} className="row-click" onClick={() => openEdit(c)}>
                  <td className="stat-sub">{i + 1}</td>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{c.name}</td>
                  <td>{c.duration === 'long' ? <span className="dur-long">Long</span> : <span className="stat-sub" style={{ fontWeight: 600 }}>Short</span>}</td>
                  <td>{c.owner ? c.owner : <span className="unassigned">Not assigned</span>}</td>
                  <td className="stat-sub" style={{ fontSize: 13 }}>{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {campaigns.length === 0 && <div className="empty">No campaigns yet.</div>}
        </div>
      )}

      {modal && (
        <Modal
          wide
          title={modal.id ? 'Campaign' : 'New campaign'}
          onClose={() => setModal(null)}
          footer={<>
            {modal.id && <button className="btn btn-danger" onClick={del}><Trash2 size={15} /> Delete</button>}
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!modal.name.trim()}>{modal.id ? 'Save' : 'Add'}</button>
          </>}
        >
          {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
          <div className="field"><label>Name</label>
            <input className="input" autoFocus={!modal.id} value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} placeholder="e.g. Admissions Hype" />
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field"><label>Owner</label>
              <input className="input" value={modal.owner} onChange={(e) => setModal({ ...modal, owner: e.target.value })} placeholder="Leave empty if unassigned" />
            </div>
            <div className="field"><label>Duration</label>
              <div className="seg" style={{ alignSelf: 'flex-start' }}>
                {['short', 'long'].map((d) => (
                  <button key={d} type="button" className={'seg-btn' + (modal.duration === d ? ' on' : '')}
                    onClick={() => setModal({ ...modal, duration: d })} style={{ textTransform: 'capitalize' }}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="field"><label>When it runs</label>
            <div className="checkbox-row">
              <label className={'checkbox-chip' + (modal.ongoing ? ' on' : '')}>
                <input type="checkbox" checked={modal.ongoing} onChange={() => setModal({ ...modal, ongoing: !modal.ongoing })} />
                Ongoing
              </label>
              {monthChips.map((ym) => (
                <label key={ym} className={'checkbox-chip' + (modal.months.includes(ym) ? ' on' : '')}>
                  <input type="checkbox" checked={modal.months.includes(ym)} onChange={() => toggleMonth(ym)} />
                  {new Date(`${ym}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' })}
                </label>
              ))}
            </div>
          </div>
          <div className="field"><label>Timing</label>
            <input className="input" value={modal.timing} onChange={(e) => setModal({ ...modal, timing: e.target.value })} placeholder="e.g. July 10–15" />
          </div>
          <div className="field"><label>Channel</label>
            <input className="input" value={modal.channel} onChange={(e) => setModal({ ...modal, channel: e.target.value })} placeholder="e.g. All digital channels" />
          </div>
          <div className="field"><label>Audience</label>
            <input className="input" value={modal.audience} onChange={(e) => setModal({ ...modal, audience: e.target.value })} placeholder="e.g. Self-preps and their parents" />
          </div>
          <div className="field"><label>Goal</label>
            <input className="input" value={modal.goal} onChange={(e) => setModal({ ...modal, goal: e.target.value })} placeholder="e.g. Build brand awareness" />
          </div>
          <div className="field"><label>Status</label>
            <input className="input" value={modal.status} onChange={(e) => setModal({ ...modal, status: e.target.value })} placeholder="e.g. Blocked — needs an owner" />
          </div>
          <div className="field"><label>Notes</label>
            <textarea className="input" rows={2} value={modal.notes} onChange={(e) => setModal({ ...modal, notes: e.target.value })} />
          </div>
        </Modal>
      )}
    </>
  )
}

function PlanRow({ label, items, onOpen, emptyText, tone }) {
  return (
    <div className="plan-row">
      <div className={'plan-label' + (tone === 'dark' ? ' dark' : '')}>{label}</div>
      <div className="plan-body">
        {items.length === 0 ? (
          <span className="plan-empty">{emptyText}</span>
        ) : (
          items.map((c) => (
            <button key={c.id} className="plan-item" onClick={() => onOpen(c)}>
              <b>{c.name}</b>
              {c.timing && <span className="plan-sub"> — {c.timing}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

/* ==================== TEAM (+ permissions) ==================== */
const BLANK_USER = { name: '', username: '', password: '', role: 'member', departments: [], permissions: {} }

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
    setForm({ name: u.name, username: u.username, password: '', role: u.role, departments: u.departments, permissions: { ...u.permissions } })
    setUsernameTouched(true); setEditing(u.id); setErr(''); setModal(true)
  }

  const save = async () => {
    setBusy(true); setErr('')
    try {
      if (editing) {
        const body = { name: form.name, username: form.username, role: form.role, departments: form.departments, permissions: form.permissions }
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
                    <Avatar name={u.name} color={u.color} size="sm" />
                    <div>
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div className="stat-sub">@{u.username}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {u.role === 'admin'
                    ? <span className="badge"><ShieldCheck size={12} /> Admin</span>
                    : <span className="badge badge-muted">Member</span>}
                </td>
                <td>
                  <div className="dept-chips">
                    {u.role === 'admin'
                      ? <span className="stat-sub">All channels</span>
                      : u.departments.map((d) => {
                          const c = channels.find((x) => x.key === d)
                          return <span key={d} className="badge badge-muted">{c?.label || d}</span>
                        })}
                  </div>
                </td>
                <td>
                  {u.role === 'admin'
                    ? <span className="stat-sub">Everything</span>
                    : <span className="stat-sub">{PERMISSIONS.filter((p) => u.permissions[p.key]).length}/{PERMISSIONS.length} enabled</span>}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(u)} aria-label="Edit"><Pencil size={15} /></button>
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => del(u)} aria-label="Delete"><Trash2 size={15} /></button>
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
            <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {form.role !== 'admin' && (
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
        </Modal>
      )}
    </>
  )
}

/* ==================== CHANNELS (custom sidebar) ==================== */
function ChannelsTab() {
  const { channels, reload } = useChannels()
  const [modal, setModal] = useState(null) // {id?, label, icon}
  const [err, setErr] = useState('')

  const save = async () => {
    if (!modal.label.trim()) return
    setErr('')
    try {
      if (modal.id) await api.patch(`/channels/${modal.id}`, { label: modal.label.trim(), icon: modal.icon })
      else await api.post('/channels', { label: modal.label.trim(), icon: modal.icon })
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
    await api.post('/channels/reorder', { ids })
    reload()
  }

  return (
    <>
      <div className="section-head">
        <h2>Sidebar channels</h2>
        <span className="count">· shown top to bottom</span>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => { setModal({ label: '', icon: 'instagram' }); setErr('') }}><Plus size={15} /> Add channel</button>
      </div>
      <div className="card" style={{ padding: '6px 14px' }}>
        {channels.map((c, i) => {
          const Icon = iconFor(c.icon)
          return (
            <div key={c.id} className="chan-row">
              <span className="chan-icon"><Icon size={17} /></span>
              <span style={{ fontWeight: 600 }}>{c.label}</span>
              <span className="stat-sub" style={{ fontFamily: 'ui-monospace, monospace' }}>{c.key}</span>
              <span className="spacer" style={{ flex: 1 }} />
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up"><ArrowUp size={15} /></button>
              <button className="icon-btn" disabled={i === channels.length - 1} onClick={() => move(i, 1)} aria-label="Down"><ArrowDown size={15} /></button>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setModal({ id: c.id, label: c.label, icon: c.icon }); setErr('') }}><Pencil size={15} /></button>
              <button className="btn btn-danger btn-sm btn-icon" onClick={() => del(c)}><Trash2 size={15} /></button>
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
          <div className="field"><label>Icon</label>
            <div className="icon-grid">
              {Object.entries(CHANNEL_ICONS).map(([name, Icon]) => (
                <button key={name} type="button" className={'icon-cell' + (modal.icon === name ? ' on' : '')} onClick={() => setModal({ ...modal, icon: name })} aria-label={name}>
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
function PipelineTab() {
  const [statuses, setStatuses] = useState([])
  const [modal, setModal] = useState(null)
  const [err, setErr] = useState('')

  const load = () => api.get('/statuses').then(setStatuses)
  useEffect(() => { load() }, [])

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
    await api.post('/statuses/reorder', { ids })
    load()
  }
  const setFinal = async (s) => {
    await api.patch(`/statuses/${s.id}`, { is_final: true })
    load()
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
              : <button className="btn btn-ghost btn-sm" onClick={() => setFinal(s)}>Make final</button>}
            <span className="spacer" style={{ flex: 1 }} />
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up"><ArrowUp size={15} /></button>
            <button className="icon-btn" disabled={i === statuses.length - 1} onClick={() => move(i, 1)} aria-label="Down"><ArrowDown size={15} /></button>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setModal({ id: s.id, label: s.label, color: s.color }); setErr('') }}><Pencil size={15} /></button>
            <button className="btn btn-danger btn-sm btn-icon" onClick={() => del(s)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

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
function ReportsTab() {
  const { byKey } = useChannels()
  const t = todayISO()
  const monthStart = t.slice(0, 8) + '01'
  const prevMonthEnd = addDaysISO(monthStart, -1)
  const prevMonthStart = prevMonthEnd.slice(0, 8) + '01'
  const weekStart = (() => {
    const d = new Date()
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return localISO(d)
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

  return (
    <>
      <div className="section-head">
        <h2>Who did what</h2>
        <span className="count">· completed work per person</span>
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

      {!data ? (
        <div className="app-loading"><span className="spinner" /></div>
      ) : (
        <>
          <div className="stat-sub" style={{ marginBottom: 10 }}>
            {data.totalDone} task{data.totalDone === 1 ? '' : 's'} completed between {range.from} and {range.to}
          </div>
          <div className="grid" style={{ gap: 12 }}>
            {data.report.map((r) => (
              <div className="card card-pad" key={r.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Avatar name={r.name} color={r.color} />
                  <div style={{ minWidth: 120 }}>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                    <div className="stat-sub">{r.total} completed</div>
                  </div>
                  <div className="dept-chips" style={{ flex: 1 }}>
                    {Object.entries(r.byChannel).map(([k, n]) => (
                      <span key={k} className="badge badge-muted">{byKey[k]?.label || k} × {n}</span>
                    ))}
                    {Object.entries(r.byType).map(([k, n]) => (
                      <span key={k} className={`chip ct-${k}`}>{typeInfo(k).plan || typeInfo(k).label} × {n}</span>
                    ))}
                  </div>
                </div>
                {r.items.length > 0 && (
                  <details style={{ marginTop: 10 }}>
                    <summary className="stat-sub" style={{ cursor: 'pointer' }}>Show items</summary>
                    <div style={{ marginTop: 6 }}>
                      {r.items.map((it) => (
                        <div key={it.id} className="report-item">
                          <span>{it.title}</span>
                          <span className="stat-sub">{byKey[it.channel]?.label || it.channel} · {it.done_at.slice(0, 10)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
