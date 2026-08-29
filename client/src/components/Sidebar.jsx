import { useMemo, useRef, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import {
  Shield, LogOut, Briefcase, LayoutDashboard, Sun, BarChart3, Clapperboard, UsersRound, ScrollText, Send, Palette,
  SlidersHorizontal, GripVertical, Eye, EyeOff, Check, RotateCcw, ChevronUp, ChevronDown, Timer,
} from 'lucide-react'
import { LogoLockup } from './Logo.jsx'
import Avatar from './Avatar.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import LangToggle from './LangToggle.jsx'
import { useChannels } from '../lib/channels.jsx'
import { iconFor } from '../lib/constants.js'
import { useT, tr as tx } from '../lib/i18n.jsx'
import { BUILD } from '../lib/useAutoUpdate.js'

// ---- personal sidebar (this account, this browser) ----
// Every group — the main pages, the channels, the admin's Manage links — can
// be trimmed and rearranged: hide what you don't use, drag (or arrow) the
// rest into your own order. One "Personalize" switch at the bottom governs
// it all. A pure view preference: pages stay reachable by URL, permissions
// and platform pickers never change, and new channels always appear.
// "My Day" is the anchor and can't be hidden.
const PREFS_KEY = (uid) => `satashkent_side2_${uid}`
const readLegacy = (k) => {
  try { const a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}
function readPrefs(uid) {
  try {
    const o = JSON.parse(localStorage.getItem(PREFS_KEY(uid)) || 'null')
    if (o && typeof o === 'object') {
      return {
        order: { main: [], channels: [], manage: [], ...(o.order || {}) },
        hidden: Array.isArray(o.hidden) ? o.hidden : [],
      }
    }
  } catch { /* fall through */ }
  // First run: adopt the round-19 per-browser channel prefs, if any.
  return { order: { main: [], channels: readLegacy('satashkent_side_order'), manage: [] }, hidden: readLegacy('satashkent_side_hidden') }
}

export default function Sidebar({ user, onNavigate, onLogout }) {
  const { visible } = useChannels()
  const { t } = useT()
  const cls = ({ isActive }) => 'nav-item' + (isActive ? ' active' : '')

  const [prefs, setPrefs] = useState(() => readPrefs(user.id))
  const [editing, setEditing] = useState(false)
  const dragRef = useRef(null) // { group, key }

  const save = (next) => {
    setPrefs(next)
    localStorage.setItem(PREFS_KEY(user.id), JSON.stringify(next))
    localStorage.removeItem('satashkent_side_order')
    localStorage.removeItem('satashkent_side_hidden')
  }
  const hidden = useMemo(() => new Set(prefs.hidden), [prefs])
  const customized = prefs.hidden.length > 0 || Object.values(prefs.order).some((l) => l.length > 0)

  const isAdmin = user.role === 'admin'
  // The Admin panel is where accounts, channels and the pipeline rules live —
  // the whole board's furniture. A CHANNEL admin runs content on their own
  // channels and would meet a refusal on every tab in there, so they are not
  // shown the door. Post Production and Team stay: both are about the work.
  const runsEverything = isAdmin && !(user.admin_channels || []).length
  const groups = useMemo(() => ({
    main: [
      isAdmin && { key: 'overview', to: '/overview', label: t('nav.overview'), icon: LayoutDashboard },
      { key: 'brief', to: '/brief', label: t('nav.brief'), icon: Sun, locked: true },
      // Every channel at once: what is going out, and what is being filmed.
      { key: 'releases', to: '/releases', label: t('nav.releases'), icon: Send },
      { key: 'recordings', to: '/recordings', label: t('nav.recordings'), icon: Clapperboard },
      { key: 'missed', to: '/missed', label: t('nav.stats'), icon: BarChart3 },
      // The designer's own board, beside the work rather than inside a channel.
      { key: 'design', to: '/design', label: t('nav.design'), icon: Palette },
      { key: 'docs', to: '/docs', label: t('nav.docs'), icon: ScrollText },
      { key: 'sprints', to: '/sprints', label: t('nav.sprints'), icon: Timer },
      isAdmin && { key: 'projects', to: '/projects', label: t('nav.projects'), icon: Briefcase },
    ].filter(Boolean),
    channels: visible.map((c) => ({ key: `ch:${c.key}`, to: `/dept/${c.key}`, label: c.label, icon: iconFor(c.icon) })),
    manage: isAdmin ? [
      { key: 'crew', to: '/crew', label: t('nav.crew'), icon: Clapperboard },
      { key: 'team', to: '/team', label: t('nav.team'), icon: UsersRound },
      ...(runsEverything ? [{ key: 'admin', to: '/admin', label: t('nav.admin'), icon: Shield }] : []),
    ] : [],
  }), [isAdmin, runsEverything, visible, t])

  // Personal order first; unknown items (new channels) keep their place at
  // the end, visible — nothing is ever born hidden.
  const orderedOf = (g) => {
    const pos = new Map((prefs.order[g] || []).map((k, i) => [k, i]))
    return [...groups[g]].sort((a, b) =>
      (pos.has(a.key) ? pos.get(a.key) : 1e9) - (pos.has(b.key) ? pos.get(b.key) : 1e9))
  }
  const toggleHide = (key) => {
    const next = hidden.has(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key]
    save({ ...prefs, hidden: next })
  }
  const saveOrder = (g, keys) => save({ ...prefs, order: { ...prefs.order, [g]: keys } })
  const moveBy = (g, key, dir) => {
    const keys = orderedOf(g).map((x) => x.key)
    const i = keys.indexOf(key)
    const j = i + dir
    if (i < 0 || j < 0 || j >= keys.length) return
    keys.splice(j, 0, keys.splice(i, 1)[0])
    saveOrder(g, keys)
  }
  const onDragOverRow = (g, overKey) => {
    const from = dragRef.current
    if (!from || from.group !== g || from.key === overKey) return
    const keys = orderedOf(g).map((x) => x.key)
    const a = keys.indexOf(from.key)
    const b = keys.indexOf(overKey)
    if (a < 0 || b < 0) return
    keys.splice(b, 0, keys.splice(a, 1)[0])
    saveOrder(g, keys)
  }
  const resetPrefs = () => save({ order: { main: [], channels: [], manage: [] }, hidden: [] })

  const Group = ({ g }) => {
    const items = orderedOf(g)
    if (items.length === 0) return null
    return (
      <>
        {!editing && items.filter((it) => !hidden.has(it.key)).map((it) => {
          const Icon = it.icon
          return (
            <NavLink key={it.key} to={it.to} className={cls} onClick={onNavigate}>
              <Icon size={18} /> {it.label}
            </NavLink>
          )
        })}
        {editing && items.map((it) => {
          const Icon = it.icon
          const off = hidden.has(it.key)
          return (
            <div
              key={it.key}
              className={`side-edit-row grp-${g}` + (off ? ' off' : '')}
              draggable
              onDragStart={(e) => {
                dragRef.current = { group: g, key: it.key }
                try { e.dataTransfer.setData('text/plain', it.key); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
              }}
              onDragOver={(e) => { e.preventDefault(); onDragOverRow(g, it.key) }}
              onDragEnd={() => { dragRef.current = null }}
            >
              <span className="side-grip"><GripVertical size={13} /></span>
              <Icon size={16} />
              <span className="side-edit-name">{it.label}</span>
              <button className="side-eye" onClick={() => moveBy(g, it.key, -1)} aria-label={`Move ${it.label} up`}>
                <ChevronUp size={13} />
              </button>
              <button className="side-eye" onClick={() => moveBy(g, it.key, +1)} aria-label={`Move ${it.label} down`}>
                <ChevronDown size={13} />
              </button>
              {it.locked ? (
                <span className="side-eye locked" data-tip="My Day is home — it always stays" data-tip-left=""><Eye size={14} /></span>
              ) : (
                <button
                  className={'side-eye' + (off ? ' off' : '')}
                  onClick={() => toggleHide(it.key)}
                  data-tip={off ? 'Show in the sidebar' : 'Hide from the sidebar'}
                  data-tip-left=""
                  aria-label={off ? `Show ${it.label}` : `Hide ${it.label}`}
                >
                  {off ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <>
      <Link to="/" className="logo-link" onClick={onNavigate} data-tip={t('nav.home')} aria-label={t('nav.home')}>
        <LogoLockup />
      </Link>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        <Group g="main" />

        {groups.channels.length > 0 && <div className="nav-label">{t('nav.channels')}</div>}
        <Group g="channels" />

        {groups.manage.length > 0 && <div className="nav-label">{t('nav.manage')}</div>}
        <Group g="manage" />

        {/* One quiet switch governs the whole sidebar. */}
        <div className="side-edit-foot">
          {editing && customized && (
            <button className="side-edit-btn" onClick={resetPrefs} data-tip="Back to the default sidebar — everything shown, default order">
              <RotateCcw size={12} /> {t('nav.reset')}
            </button>
          )}
          <button className="side-edit-btn" onClick={() => setEditing((e) => !e)}
            aria-label={editing ? 'Finish personalizing' : 'Personalize sidebar'}>
            {editing
              ? <><Check size={12} /> {t('nav.donepersonalizing')}</>
              : <><SlidersHorizontal size={12} /> {t('nav.personalize')}{hidden.size > 0 ? ` · ${t('nav.hiddencount', { n: hidden.size })}` : ''}</>}
          </button>
        </div>
      </nav>

      <div className="sidebar-foot">
        <div className="side-user">
          <Link to="/profile" className="side-user-link" onClick={onNavigate} data-tip={t('nav.myprofile')}>
            <Avatar name={user.name} color={user.color} src={user.avatar} size="sm" />
            <div className="su-meta">
              <span className="su-name">{user.name}</span>
              <span className="su-role">{user.role}</span>
            </div>
          </Link>
          <LangToggle className="side-logout" />
          <ThemeToggle className="side-logout" />
          <button className="side-logout" onClick={onLogout} data-tip={t('nav.signout')} data-tip-left="" aria-label={t('nav.signout')}>
            <LogOut size={16} />
          </button>
        </div>
        {/* Which build is on screen. "Is the new thing live yet?" should be a
            question you can answer by looking. */}
        <div className="build-stamp" data-tip={tx('Which build this is')}>{BUILD}</div>
      </div>
    </>
  )
}
