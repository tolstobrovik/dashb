import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { typeInfo, onColor } from '../lib/constants.js'
import ContentModal from './ContentModal.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// Ctrl/Cmd-K quick find: one box that reaches anything from anywhere —
// pages by name, tasks by title. Enter takes the highlighted row; a task
// opens right here, a page navigates. Esc closes.
export default function QuickFind({ onClose }) {
  const { user } = useAuth()
  const { visible, byKey } = useChannels()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [tasks, setTasks] = useState([])
  const [statuses, setStatuses] = useState([])
  const [sel, setSel] = useState(0)
  const [openItem, setOpenItem] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    api.get('/content').then(setTasks).catch(() => {})
    api.cached('/statuses').then(setStatuses).catch(() => {})
    inputRef.current?.focus()
  }, [])

  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  const isAdmin = user.role === 'admin'
  const pages = useMemo(() => [
    isAdmin && { label: 'Overview', to: '/overview' },
    { label: 'My Day', to: '/brief' },
    { label: 'To-Do', to: '/todo' },
    { label: tx('Releases'), to: '/releases' },
    { label: tx('Recordings'), to: '/recordings' },
    { label: 'Statistics', to: '/missed' },
    isAdmin && { label: 'Unassigned', to: '/unassigned' },
    { label: 'Docs & KPIs', to: '/docs' },
    isAdmin && { label: 'Projects', to: '/projects' },
    ...visible.map((c) => ({ label: c.label, to: `/dept/${c.key}` })),
    isAdmin && { label: tx('Post Production'), to: '/crew' },
    isAdmin && { label: 'Team & hiring', to: '/team' },
    isAdmin && { label: 'Admin', to: '/admin' },
    { label: 'My profile', to: '/profile' },
  ].filter(Boolean), [isAdmin, visible])

  const needle = q.trim().toLowerCase()
  const results = useMemo(() => {
    if (!needle) return []
    const pg = pages
      .filter((p) => p.label.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((p) => ({ kind: 'page', ...p }))
    const rank = (t) => (t.title.toLowerCase().startsWith(needle) ? 0 : 1)
    const ts = tasks
      .filter((t) => t.title.toLowerCase().includes(needle))
      .sort((a, b) => rank(a) - rank(b) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 12)
      .map((t) => ({ kind: 'task', t }))
    return [...pg, ...ts]
  }, [needle, pages, tasks])

  useEffect(() => { setSel(0) }, [needle])

  const go = (r) => {
    if (!r) return
    if (r.kind === 'page') { navigate(r.to); onClose() }
    else setOpenItem(r.t)
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, Math.max(results.length - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[sel]) }
    else if (e.key === 'Escape') onClose()
  }

  const updateTask = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    setTasks((prev) => prev.map((x) => (x.id === item.id ? u : x)))
  }
  const deleteTask = async (item) => {
    await api.del(`/content/${item.id}`)
    setTasks((prev) => prev.filter((x) => x.id !== item.id))
  }

  return (
    <>
      {!openItem && (
        <div className="qf-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
          <div className="qf card" role="dialog" aria-label={tx("Quick find")}>
            <div className="qf-box">
              <Search size={16} />
              <input
                ref={inputRef}
                className="qf-input"
                value={q}
                placeholder={tx("Find a task or page…")}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
              />
              {/* A phone has no Esc key, so naming one is a leftover from the
                  desk. Same corner, same job, a control a thumb can use. */}
              <span className="qf-esc">{tx("esc")}</span>
              <button type="button" className="qf-x" onClick={onClose} aria-label={tx("Close")}><X size={18} /></button>
            </div>
            {needle && (
              <div className="qf-list">
                {results.length === 0 && <div className="qf-none">Nothing matches “{q.trim()}”.</div>}
                {results.map((r, i) => {
                  if (r.kind === 'page') {
                    return (
                      <button key={`p${r.to}`} className={'qf-row' + (i === sel ? ' on' : '')}
                        onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                        <span className="qf-kind">{tx("Page")}</span>
                        <span className="qf-title">{r.label}</span>
                        <span className="spacer" />
                        {i === sel && <CornerDownLeft size={13} className="qf-enter" />}
                      </button>
                    )
                  }
                  const t = r.t
                  const st = statusesById[t.status_id]
                  return (
                    <button key={`t${t.id}`} className={'qf-row' + (i === sel ? ' on' : '')}
                      onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                      <span className={`chip ct-${t.type} qf-type`}>{typeInfo(t.type).label}</span>
                      <span className="qf-title">{t.title}</span>
                      <span className="spacer" />
                      {st && <span className="chip qf-st" style={{ background: st.color, color: onColor(st.color) }}>{st.label}</span>}
                      {t.channels.slice(0, 2).map((c) => <span key={c} className="chip chip-muted qf-ch">{byKey[c]?.label || c}</span>)}
                      {i === sel && <CornerDownLeft size={13} className="qf-enter" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {openItem && (
        <ContentModal key={openItem?.id || 'new'}
          item={openItem}
          statuses={statuses}
          onClose={() => { setOpenItem(null); onClose() }}
          onUpdate={updateTask}
          onDelete={deleteTask}
        />
      )}
    </>
  )
}
