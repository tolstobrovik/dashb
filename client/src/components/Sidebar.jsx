import { useMemo, useRef, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import {
  Shield, LogOut, Briefcase, LayoutDashboard, Sun, BarChart3, Clapperboard, UsersRound, ScrollText, Send, Palette,
  SlidersHorizontal, GripVertical, Eye, EyeOff, Check, RotateCcw, ChevronUp, ChevronDown, Timer, GraduationCap,
  ChevronRight, Pin,
} from 'lucide-react'
import { LogoLockup } from './Logo.jsx'
import Avatar from './Avatar.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import LangToggle from './LangToggle.jsx'
import { useChannels } from '../lib/channels.jsx'
import { usePages } from '../lib/pages.jsx'
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
// Work is where the day is spent, so it stays open. The rest is where you go
// when you need something, and a heading is enough to say it is there.
const SHUT_AT_FIRST = ['channels', 'numbers', 'people']
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
        closed: Array.isArray(o.closed) ? o.closed : [],
        pins: Array.isArray(o.pins) ? o.pins : [],
      }
    }
  } catch { /* fall through */ }
  // First run: adopt the round-19 per-browser channel prefs, if any.
  return {
    order: { main: [], channels: readLegacy('satashkent_side_order'), manage: [] },
    hidden: readLegacy('satashkent_side_hidden'),
    // Folded to start with. Eleven doors open at once is the wall the hubs
    // were meant to replace; the hub holding the page you are on opens itself,
    // so a first run shows your work and three headings rather than
    // everything anybody could ever reach.
    closed: SHUT_AT_FIRST,
    pins: [],
  }
}

// The four hubs, in the order a day runs through them: what you are doing,
// where it goes, what happened, who does it. Channels sit second because they
// ARE the work — everything else is a way of looking at them.
const HUBS = [
  { g: 'work', label: () => tx('Work') },
  { g: 'channels', label: (t) => t('nav.channels') },
  { g: 'numbers', label: () => tx('Numbers') },
  { g: 'people', label: () => tx('People') },
]
const HUB_KEYS = HUBS.map((h) => h.g)

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
  // Folding a hub is a customization too, so somebody who has only folded
  // things still gets the way back to the default sidebar.
  const customized = prefs.hidden.length > 0 || (prefs.pins || []).length > 0
    || (prefs.closed || []).join() !== SHUT_AT_FIRST.join()
    || Object.values(prefs.order).some((l) => l.length > 0)

  const { shows } = usePages()
  const isAdmin = user.role === 'admin'
  // The Admin panel is where accounts, channels and the pipeline rules live —
  // the whole board's furniture. A CHANNEL admin runs content on their own
  // channels and would meet a refusal on every tab in there, so they are not
  // shown the door. Post Production and Team stay: both are about the work.
  const runsEverything = isAdmin && !(user.admin_channels || []).length
  // The ambassador programme is a job somebody can hold without running the
  // board — see server/routes/ambassadors.js.
  const runsProgramme = !!(user.permissions && user.permissions.manage_ambassadors)
  // A page the admin switched off in Settings has no door here. Only the ones
  // that ARE switchable are asked; My Day and the channels are the work.
  //
  // Four hubs, not one wall of nine. The old sidebar listed every page an
  // account could reach in a single column, so an admin met eleven doors at
  // once and had to read all of them to find the one they wanted. The doors
  // have not changed — the sorting has:
  //
  //   Work      what you are doing today
  //   Channels  where it goes
  //   Numbers   what happened
  //   People    who does it
  //
  // A hub with nothing in it is not drawn at all — no heading, no empty
  // chevron. An operator does not get a greyed-out People section telling
  // them about a door they cannot open; they get a sidebar that looks like it
  // was built for them.
  const groups = useMemo(() => ({
    work: [
      { key: 'brief', to: '/brief', label: t('nav.brief'), icon: Sun, locked: true },
      isAdmin && shows('overview') && { key: 'overview', to: '/overview', label: t('nav.overview'), icon: LayoutDashboard },
      // Every channel at once: what is going out, and what is being filmed.
      shows('releases') && { key: 'releases', to: '/releases', label: t('nav.releases'), icon: Send },
      shows('recordings') && { key: 'recordings', to: '/recordings', label: t('nav.recordings'), icon: Clapperboard },
      // The designer's own board, beside the work rather than inside a channel.
      shows('design') && { key: 'design', to: '/design', label: t('nav.design'), icon: Palette },
      shows('sprints') && { key: 'sprints', to: '/sprints', label: t('nav.sprints'), icon: Timer },
      // A campaign lives inside a project, so /campaigns/7 lights Projects up
      // rather than lighting nothing up.
      isAdmin && shows('projects') && { key: 'projects', to: '/projects', label: t('nav.projects'), icon: Briefcase, also: ['/campaigns'] },
    ].filter(Boolean),
    channels: visible.map((c) => ({ key: `ch:${c.key}`, to: `/dept/${c.key}`, label: c.label, icon: iconFor(c.icon) })),
    numbers: [
      shows('missed') && { key: 'missed', to: '/missed', label: t('nav.stats'), icon: BarChart3 },
      shows('docs') && { key: 'docs', to: '/docs', label: t('nav.docs'), icon: ScrollText },
    ].filter(Boolean),
    people: [
      isAdmin && shows('crew') && { key: 'crew', to: '/crew', label: t('nav.crew'), icon: Clapperboard },
      // The ambassador programme. Not switchable in Settings on purpose: this
      // is the only page some accounts have, and switching it off would strand
      // them on a board with nothing on it. And it is the one door here that
      // is not an admin's: whoever RUNS the programme gets it, which is the
      // point of the permission — the job without the rest of the board.
      (isAdmin || runsProgramme) && { key: 'ambassadors', to: '/ambassador', label: tx('Ambassadors'), icon: GraduationCap },
      isAdmin && shows('team') && { key: 'team', to: '/team', label: t('nav.team'), icon: UsersRound },
      ...(runsEverything ? [{ key: 'admin', to: '/admin', label: t('nav.admin'), icon: Shield }] : []),
    ].filter(Boolean),
  }), [isAdmin, runsEverything, runsProgramme, visible, t, shows])

  // Which hub holds the page you are on. A deep link drops you INSIDE one —
  // /sprints/backlog, /projects/7, /dept/instagram_main — so the match is on
  // the path's segments, not on string equality, and the hub holding the
  // current page is open whatever your folding preferences say. You cannot
  // fold away the thing you are looking at.
  const loc = useLocation()
  const onPath = (to) => loc.pathname === to || loc.pathname.startsWith(to + '/')
  const isHere = (it) => onPath(it.to) || (it.also || []).some(onPath)
  const hubHere = HUB_KEYS.find((g) => (groups[g] || []).some(isHere)) || null

  // Personal order first; unknown items (new channels) keep their place at
  // the end, visible — nothing is ever born hidden. The old sidebar's three
  // groups were called main/channels/manage; the keys inside them did not
  // change when the hubs did, so an order saved before this is still read and
  // still honoured rather than being silently thrown away.
  const LEGACY = { work: 'main', numbers: 'main', people: 'manage', channels: 'channels' }
  const orderedOf = (g) => {
    const saved = (prefs.order[g] || []).length ? prefs.order[g] : (prefs.order[LEGACY[g]] || [])
    const pos = new Map(saved.map((k, i) => [k, i]))
    return [...groups[g]].sort((a, b) =>
      (pos.has(a.key) ? pos.get(a.key) : 1e9) - (pos.has(b.key) ? pos.get(b.key) : 1e9))
  }
  const closed = useMemo(() => new Set(prefs.closed || []), [prefs])
  // The three or four doors you actually use, lifted out of their hubs and
  // put at the top. Everything stays exactly where it was as well — pinning
  // is a shortcut, not a move, so nothing is ever somewhere you did not
  // expect and nothing has to be un-pinned to be found again.
  const pins = useMemo(() => new Set(prefs.pins || []), [prefs])
  const togglePin = (key) => save({
    ...prefs,
    pins: pins.has(key) ? (prefs.pins || []).filter((k) => k !== key) : [...(prefs.pins || []), key],
  })
  const pinned = HUB_KEYS.flatMap((g) => (groups[g] || []).filter((it) => pins.has(it.key)))
  const toggleFold = (g) => save({
    ...prefs,
    closed: closed.has(g) ? (prefs.closed || []).filter((k) => k !== g) : [...(prefs.closed || []), g],
  })
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
  // Everything, including the hubs' own names — a reset that left an order
  // saved under a group name this sidebar no longer draws would look like it
  // had not worked.
  const resetPrefs = () => save({ order: {}, hidden: [], closed: SHUT_AT_FIRST, pins: [] })

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
              <button
                className={'side-eye side-pin' + (pins.has(it.key) ? ' on' : '')}
                onClick={() => togglePin(it.key)}
                data-tip={pins.has(it.key) ? 'Unpin from the top' : 'Pin to the top'}
                data-tip-left=""
                aria-label={pins.has(it.key) ? `Unpin ${it.label}` : `Pin ${it.label}`}
              >
                <Pin size={13} />
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
        {/* Pinned first, with no heading over them: they are not a category,
            they are the four things this person opens all day. */}
        {!editing && pinned.length > 0 && (
          <div className="nav-pins">
            {pinned.map((it) => {
              const Icon = it.icon
              return (
                <NavLink key={`pin:${it.key}`} to={it.to} className={cls} onClick={onNavigate}>
                  <Icon size={18} /> {it.label}
                </NavLink>
              )
            })}
          </div>
        )}
        {HUBS.map(({ g, label }) => {
          // What is actually on screen for THIS person, after their own
          // hiding. A hub everybody's role emptied, or that somebody hid the
          // last item out of, is not drawn at all — a heading over nothing is
          // furniture pretending to be a door. While personalizing, hidden
          // items are still listed, or you could never get them back.
          const items = orderedOf(g)
          const showing = editing ? items : items.filter((it) => !hidden.has(it.key))
          if (showing.length === 0) return null
          const here = g === hubHere
          const open = editing || here || !closed.has(g)
          return (
            <div key={g} className={'nav-hub' + (open ? ' open' : '')}>
              <button
                type="button"
                className="nav-hub-head"
                onClick={() => !here && toggleFold(g)}
                aria-expanded={open}
                // "Channels" is also the name of a tab in the Admin panel, and
                // a control whose whole accessible name is a word another
                // control on the page also answers to is ambiguous to anybody
                // arriving by screen reader or by voice. The visible word is
                // still the word; the name says which of the two this is.
                aria-label={tx('{name} section', { name: label(t) })}
                data-tip={here ? tx('The page you are on lives in here') : undefined}
              >
                <ChevronRight size={12} className="nav-hub-chev" />
                <span>{label(t)}</span>
                {!open && <span className="nav-hub-n">{showing.length}</span>}
              </button>
              {open && <div className="nav-hub-body"><Group g={g} /></div>}
            </div>
          )
        })}

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
