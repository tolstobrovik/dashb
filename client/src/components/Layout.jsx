import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, ListChecks, LogOut } from 'lucide-react'
import Sidebar from './Sidebar.jsx'
import Logo from './Logo.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { iconFor } from '../lib/constants.js'

export default function Layout() {
  const { user, logout } = useAuth()
  const { visible, byKey } = useChannels()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => setOpen(false), [location.pathname])

  let title = ''
  if (location.pathname.startsWith('/admin')) title = 'Admin Panel'
  else if (location.pathname.startsWith('/todo')) title = 'To-Do'
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
          <Logo size={30} tone="var(--brand-500)" />
          <h1>{title}</h1>
          <div className="topbar-spacer" />
          {soloChannel && (
            <NavLink to={`/dept/${soloChannel.key}`} className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
              <SoloIcon size={16} /> {soloChannel.label}
            </NavLink>
          )}
          <NavLink to="/todo" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <ListChecks size={16} /> To-Do
          </NavLink>
          <button className="icon-btn" onClick={logout} title="Sign out"><LogOut size={17} /></button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    )
  }

  return (
    <div className="layout">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <Sidebar user={user} onNavigate={() => setOpen(false)} onLogout={logout} />
      </aside>
      <div className={`scrim${open ? ' show' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <div>
            <h1>{title}</h1>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
