import { useMemo, useRef, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import {
  Shield, LogOut, ListChecks, Briefcase, LayoutDashboard, Sun, BarChart3, Clapperboard, UsersRound, ScrollText,
  SlidersHorizontal, GripVertical, Eye, EyeOff, Check, RotateCcw,
} from 'lucide-react'
import { LogoLockup } from './Logo.jsx'
import Avatar from './Avatar.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { useChannels } from '../lib/channels.jsx'
import { iconFor } from '../lib/constants.js'

// ---- personal sidebar preferences (this browser only) ----
// Hide the channels you don't work in and drag the rest into your own order.
// A pure view preference: pages, permissions, platform pickers and the
// admin's global channel order never change.
const ORDER_KEY = 'satashkent_side_order'
const HIDDEN_KEY = 'satashkent_side_hidden'
const readList = (k) => {
  try { const a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}

export default function Sidebar({ user, onNavigate, onLogout }) {
  const { visible } = useChannels()
  const cls = ({ isActive }) => 'nav-item' + (isActive ? ' active' : '')

  const [order, setOrder] = useState(() => readList(ORDER_KEY))
  const [hidden, setHidden] = useState(() => new Set(readList(HIDDEN_KEY)))
  const [editing, setEditing] = useState(false)
  const dragKey = useRef(null)

  // Personal order first; channels it doesn't know (new ones) keep the
  // server order and land at the end, visible — nothing appears silently.
  const ordered = useMemo(() => {
    const pos = new Map(order.map((k, i) => [k, i]))
    return [...visible].sort((a, b) =>
      (pos.has(a.key) ? pos.get(a.key) : 1e9) - (pos.has(b.key) ? pos.get(b.key) : 1e9))
  }, [visible, order])
  const shown = ordered.filter((c) => !hidden.has(c.key))
  const customized = order.length > 0 || hidden.size > 0

  const saveOrder = (keys) => { setOrder(keys); localStorage.setItem(ORDER_KEY, JSON.stringify(keys)) }
  const toggleHide = (key) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]))
    return next
  })
  const resetPrefs = () => {
    setOrder([]); setHidden(new Set())
    localStorage.removeItem(ORDER_KEY); localStorage.removeItem(HIDDEN_KEY)
  }
  const onDragOverRow = (overKey) => {
    const from = dragKey.current
    if (!from || from === overKey) return
    const keys = ordered.map((c) => c.key)
    const a = keys.indexOf(from)
    const b = keys.indexOf(overKey)
    if (a < 0 || b < 0) return
    keys.splice(b, 0, keys.splice(a, 1)[0])
    saveOrder(keys)
  }

  return (
    <>
      <Link to="/" className="logo-link" onClick={onNavigate} data-tip="Home" aria-label="Home">
        <LogoLockup />
      </Link>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {user.role === 'admin' && (
          <NavLink to="/overview" className={cls} onClick={onNavigate}>
            <LayoutDashboard size={18} /> Overview
          </NavLink>
        )}
        <NavLink to="/brief" className={cls} onClick={onNavigate}>
          <Sun size={18} /> My Day
        </NavLink>
        <NavLink to="/todo" className={cls} onClick={onNavigate}>
          <ListChecks size={18} /> To-Do
        </NavLink>
        <NavLink to="/missed" className={cls} onClick={onNavigate}>
          <BarChart3 size={18} /> Statistics
        </NavLink>
        <NavLink to="/docs" className={cls} onClick={onNavigate}>
          <ScrollText size={18} /> Docs & KPIs
        </NavLink>
        {user.role === 'admin' && (
          <NavLink to="/projects" className={cls} onClick={onNavigate}>
            <Briefcase size={18} /> Projects
          </NavLink>
        )}

        {visible.length > 0 && <div className="nav-label">Channels</div>}

        {!editing && shown.map((c) => {
          const Icon = iconFor(c.icon)
          return (
            <NavLink key={c.key} to={`/dept/${c.key}`} className={cls} onClick={onNavigate}>
              <Icon size={18} /> {c.label}
            </NavLink>
          )
        })}

        {/* Edit mode: every channel as a row — drag to reorder, eye to hide.
            Saved instantly to this browser; Done just closes the list. */}
        {editing && ordered.map((c) => {
          const Icon = iconFor(c.icon)
          const off = hidden.has(c.key)
          return (
            <div
              key={c.key}
              className={'side-edit-row' + (off ? ' off' : '')}
              draggable
              onDragStart={(e) => {
                dragKey.current = c.key
                try { e.dataTransfer.setData('text/plain', c.key); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
              }}
              onDragOver={(e) => { e.preventDefault(); onDragOverRow(c.key) }}
              onDragEnd={() => { dragKey.current = null }}
            >
              <span className="side-grip"><GripVertical size={13} /></span>
              <Icon size={16} />
              <span className="side-edit-name">{c.label}</span>
              <button
                className={'side-eye' + (off ? ' off' : '')}
                onClick={() => toggleHide(c.key)}
                data-tip={off ? 'Show in the sidebar' : 'Hide from the sidebar'}
                data-tip-left=""
                aria-label={off ? `Show ${c.label}` : `Hide ${c.label}`}
              >
                {off ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          )
        })}

        {/* The bottom toggle of the channels group: enter/leave edit mode.
            Quiet by design — with a hint of how many are tucked away. */}
        {visible.length > 1 && (
          <div className="side-edit-foot">
            {editing && customized && (
              <button className="side-edit-btn" onClick={resetPrefs} data-tip="Back to the default order, everything shown">
                <RotateCcw size={12} /> Reset
              </button>
            )}
            <button className="side-edit-btn" onClick={() => setEditing((e) => !e)}
              aria-label={editing ? 'Finish personalizing' : 'Personalize sidebar'}>
              {editing
                ? <><Check size={12} /> Done</>
                : <><SlidersHorizontal size={12} /> Personalize{hidden.size > 0 ? ` · ${hidden.size} hidden` : ''}</>}
            </button>
          </div>
        )}

        {user.role === 'admin' && (
          <>
            <div className="nav-label">Manage</div>
            <NavLink to="/crew" className={cls} onClick={onNavigate}>
              <Clapperboard size={18} /> Post Production
            </NavLink>
            <NavLink to="/team" className={cls} onClick={onNavigate}>
              <UsersRound size={18} /> Team & hiring
            </NavLink>
            <NavLink to="/admin" className={cls} onClick={onNavigate}>
              <Shield size={18} /> Admin
            </NavLink>
          </>
        )}
      </nav>

      <div className="sidebar-foot">
        <div className="side-user">
          <Link to="/profile" className="side-user-link" onClick={onNavigate} data-tip="My profile — photo, name, password">
            <Avatar name={user.name} color={user.color} src={user.avatar} size="sm" />
            <div className="su-meta">
              <span className="su-name">{user.name}</span>
              <span className="su-role">{user.role}</span>
            </div>
          </Link>
          <ThemeToggle className="side-logout" />
          <button className="side-logout" onClick={onLogout} data-tip="Sign out" data-tip-left="" aria-label="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </>
  )
}
