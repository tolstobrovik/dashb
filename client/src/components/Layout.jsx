import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, ListChecks, LogOut, Sun, BarChart3, ScrollText, PanelLeftClose, PanelLeftOpen, Search, AlertTriangle, ShieldAlert } from 'lucide-react'
import Sidebar from './Sidebar.jsx'
import QuickFind from './QuickFind.jsx'
import NotificationsBell from './NotificationsBell.jsx'
import Logo from './Logo.jsx'
import Avatar from './Avatar.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { useAutoUpdate } from '../lib/useAutoUpdate.js'
import { iconFor } from '../lib/constants.js'

// Signed in with a password that is printed in this repository. The source is
// readable and the dashboard sits on a public URL, so this is the shortest way
// in for anyone who finds it. It follows you across every page — not a toast
// that scrolls away — and it takes one click to fix.
function WeakPasswordBanner({ user }) {
  if (!user?.weak_password) return null
  return (
    <div className="weak-pw" role="alert">
      <ShieldAlert size={16} />
      <span>
        <b>Your password is the one this app ships with.</b> Anyone who finds the
        dashboard can sign in as {user.name}.
      </span>
      <NavLink to="/profile" className="weak-pw-go">Change it</NavLink>
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { visible, byKey } = useChannels()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  // Ctrl/Cmd-K quick find — reach any task or page from anywhere.
  const [finding, setFinding] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setFinding((v) => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Full-screen mode: tuck the sidebar away and give the page every pixel.
  const [sideOff, setSideOff] = useState(() => localStorage.getItem('satashkent_side_off') === '1')
  const toggleSide = () => {
    setSideOff((v) => {
      try { localStorage.setItem('satashkent_side_off', v ? '' : '1') } catch { /* ok */ }
      return !v
    })
  }
  useAutoUpdate() // long-lived tabs pick up new deploys on their own

  useEffect(() => setOpen(false), [location.pathname])

  let title = ''
  if (location.pathname.startsWith('/admin')) title = 'Admin Panel'
  else if (location.pathname.startsWith('/overview')) title = 'Overview'
  else if (location.pathname.startsWith('/brief')) title = 'My Day'
  else if (location.pathname.startsWith('/todo')) title = 'To-Do'
  else if (location.pathname.startsWith('/missed-tasks')) title = 'Missed tasks'
  else if (location.pathname.startsWith('/missed')) title = 'Statistics'
  else if (location.pathname.startsWith('/crew')) title = 'Post Production'
  else if (location.pathname.startsWith('/team')) title = 'Team & hiring'
  else if (location.pathname.startsWith('/docs')) title = 'Docs & KPIs'
  else if (location.pathname.startsWith('/profile')) title = 'My Profile'
  else if (location.pathname.startsWith('/projects') || location.pathname.startsWith('/campaigns')) title = 'Projects & Campaigns'
  else if (location.pathname.startsWith('/dept/')) title = byKey[location.pathname.split('/')[2]]?.label || 'Channel'

  // A member with a single channel doesn't need a sidebar at all —
  // everything fits in the top bar.
  const solo = user.role !== 'admin' && visible.length <= 1
  const soloChannel = solo ? visible[0] : null
  const SoloIcon = soloChannel ? iconFor(soloChannel.icon) : null

  if (solo) {
    return (
      <div className="main solo">
        <header className="topbar solo-bar">
          <Link to="/" className="logo-link" data-tip="Home" aria-label="Home">
            <Logo size={30} tone="var(--brand-500)" />
          </Link>
          <h1>{title}</h1>
          <div className="topbar-spacer" />
          <NavLink to="/brief" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <Sun size={16} /> My Day
          </NavLink>
          {soloChannel && (
            <NavLink to={`/dept/${soloChannel.key}`} className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
              <SoloIcon size={16} /> {soloChannel.label}
            </NavLink>
          )}
          <NavLink to="/todo" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <ListChecks size={16} /> To-Do
          </NavLink>
          <NavLink to="/missed" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <BarChart3 size={16} /> Statistics
          </NavLink>
          <NavLink to="/missed-tasks" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <AlertTriangle size={16} /> Missed tasks
          </NavLink>
          <NavLink to="/docs" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <ScrollText size={16} /> Docs & KPIs
          </NavLink>
          <button className="icon-btn" onClick={() => setFinding(true)} data-tip="Find anything — Ctrl K" aria-label="Quick find"><Search size={17} /></button>
          <NotificationsBell user={user} />
          <ThemeToggle />
          <NavLink to="/profile" className="solo-avatar" data-tip="My profile — photo, appearance, password" data-tip-left="" aria-label="My profile">
            <Avatar name={user.name} color={user.color} src={user.avatar} size="sm" />
          </NavLink>
          <button className="icon-btn" onClick={logout} data-tip="Sign out" data-tip-left="" aria-label="Sign out"><LogOut size={17} /></button>
        </header>
        <main className="content">
          <WeakPasswordBanner user={user} />
          <Outlet />
        </main>
        {finding && <QuickFind onClose={() => setFinding(false)} />}
      </div>
    )
  }

  return (
    <div className={'layout' + (sideOff ? ' side-off' : '')}>
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <Sidebar key={user.id} user={user} onNavigate={() => setOpen(false)} onLogout={logout} />
      </aside>
      <div className={`scrim${open ? ' show' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen(true)} data-tip="Menu" aria-label="Open menu">
            <Menu size={22} />
          </button>
          <button className="side-toggle" onClick={toggleSide}
            data-tip={sideOff ? 'Show the sidebar' : 'Hide the sidebar — full screen for this page'}
            aria-label={sideOff ? 'Show sidebar' : 'Hide sidebar'}>
            {sideOff ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          </button>
          <div>
            <h1>{title}</h1>
          </div>
          <span className="topbar-spacer" />
          <button className="icon-btn topbar-find" onClick={() => setFinding(true)}
            data-tip="Find anything — Ctrl K" data-tip-left="" aria-label="Quick find">
            <Search size={18} />
          </button>
          <NotificationsBell user={user} />
        </header>
        <main className="content">
          <WeakPasswordBanner user={user} />
          <Outlet />
        </main>
        {finding && <QuickFind onClose={() => setFinding(false)} />}
      </div>
    </div>
  )
}
