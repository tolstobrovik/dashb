import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import GetSetUp from './GetSetUp.jsx'
import { Menu, ListChecks, LogOut, Sun, BarChart3, ScrollText, PanelLeftClose, PanelLeftOpen, Search, AlertTriangle, ShieldAlert , Timer } from 'lucide-react'
import Sidebar from './Sidebar.jsx'
import QuickFind from './QuickFind.jsx'
import NotificationsBell from './NotificationsBell.jsx'
import Logo from './Logo.jsx'
import Avatar from './Avatar.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { useT, tr as tx } from '../lib/i18n.jsx'
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
        <b>{tx('Your password is the one this app ships with.')}</b>{' '}
        {tx('Anyone who finds the dashboard can sign in as {name}.', { name: user.name })}
      </span>
      <NavLink to="/profile" className="weak-pw-go">{tx('Change it')}</NavLink>
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { visible, byKey } = useChannels()
  const { t } = useT()
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

  // The channel's own name is never translated — it is what the team called
  // it, in whichever language they called it.
  let title = ''
  if (location.pathname.startsWith('/admin')) title = t('nav.adminpanel')
  else if (location.pathname.startsWith('/overview')) title = t('nav.overview')
  else if (location.pathname.startsWith('/brief')) title = t('nav.brief')
  else if (location.pathname.startsWith('/todo')) title = t('nav.todo')
  else if (location.pathname.startsWith('/missed-tasks')) title = t('nav.missedtasks')
  else if (location.pathname.startsWith('/missed')) title = t('nav.stats')
  else if (location.pathname.startsWith('/crew')) title = t('nav.crew')
  else if (location.pathname.startsWith('/team')) title = t('nav.team')
  else if (location.pathname.startsWith('/docs')) title = t('nav.docs')
  else if (location.pathname.startsWith('/sprints')) title = t('nav.sprints')
  else if (location.pathname.startsWith('/profile')) title = t('nav.myprofilepage')
  else if (location.pathname.startsWith('/projects') || location.pathname.startsWith('/campaigns')) title = t('nav.projectspage')
  else if (location.pathname.startsWith('/dept/')) title = byKey[location.pathname.split('/')[2]]?.label || t('nav.channel')

  // A member with a single channel doesn't need a sidebar at all —
  // everything fits in the top bar.
  const solo = user.role !== 'admin' && visible.length <= 1
  const soloChannel = solo ? visible[0] : null
  const SoloIcon = soloChannel ? iconFor(soloChannel.icon) : null

  if (solo) {
    return (
      <div className="main solo">
        <header className="topbar solo-bar">
          <Link to="/" className="logo-link" data-tip={t('nav.home')} aria-label={t('nav.home')}>
            <Logo size={30} tone="var(--brand-500)" />
          </Link>
          <h1>{title}</h1>
          <div className="topbar-spacer" />
          <NavLink to="/brief" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <Sun size={16} /> {t('nav.brief')}
          </NavLink>
          {soloChannel && (
            <NavLink to={`/dept/${soloChannel.key}`} className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
              <SoloIcon size={16} /> {soloChannel.label}
            </NavLink>
          )}
          <NavLink to="/todo" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <ListChecks size={16} /> {t('nav.todo')}
          </NavLink>
          <NavLink to="/missed" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <BarChart3 size={16} /> {t('nav.stats')}
          </NavLink>
          <NavLink to="/missed-tasks" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <AlertTriangle size={16} /> {t('nav.missedtasks')}
          </NavLink>
          <NavLink to="/docs" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <ScrollText size={16} /> {t('nav.docs')}
          </NavLink>
          {/* Sprints is for the whole team, whatever hats they wear. It was in
              the sidebar and ungated there, but somebody with no channels
              gets this bar instead of a sidebar, so for them it did not exist
              at all. The page itself always let them in; only the door was
              missing. */}
          <NavLink to="/sprints" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <Timer size={16} /> {t('nav.sprints')}
          </NavLink>
          <button className="icon-btn" onClick={() => setFinding(true)} data-tip={t('nav.find')} aria-label={t('nav.quickfind')}><Search size={17} /></button>
          <NotificationsBell user={user} />
          <ThemeToggle />
          <NavLink to="/profile" className="solo-avatar" data-tip={t('nav.myprofile')} data-tip-left="" aria-label={t('nav.myprofilepage')}>
            <Avatar name={user.name} color={user.color} src={user.avatar} size="sm" />
          </NavLink>
          <button className="icon-btn" onClick={logout} data-tip="Sign out" data-tip-left="" aria-label="Sign out"><LogOut size={17} /></button>
        </header>
        <main className="content">
          <GetSetUp />
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
          <button className="hamburger" onClick={() => setOpen(true)} data-tip={t('nav.menu')} aria-label={t('nav.openmenu')}>
            <Menu size={22} />
          </button>
          <button className="side-toggle" onClick={toggleSide}
            data-tip={sideOff ? t('nav.showside') : t('nav.hideside')}
            aria-label={sideOff ? t('nav.showside') : t('nav.hideside')}>
            {sideOff ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          </button>
          <div>
            <h1>{title}</h1>
          </div>
          <span className="topbar-spacer" />
          <button className="icon-btn topbar-find" onClick={() => setFinding(true)}
            data-tip={t('nav.find')} data-tip-left="" aria-label={t('nav.quickfind')}>
            <Search size={18} />
          </button>
          <NotificationsBell user={user} />
        </header>
        <main className="content">
          <GetSetUp />
          <WeakPasswordBanner user={user} />
          <Outlet />
        </main>
        {finding && <QuickFind onClose={() => setFinding(false)} />}
      </div>
    </div>
  )
}
