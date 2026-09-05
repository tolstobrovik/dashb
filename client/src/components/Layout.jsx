import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import GetSetUp from './GetSetUp.jsx'
import { Menu, LogOut, Sun, BarChart3, ScrollText, PanelLeftClose, PanelLeftOpen, Search, Send, Palette, ShieldAlert, Timer, LayoutGrid, User, RefreshCw, Clapperboard, Briefcase, GraduationCap } from 'lucide-react'
import Sidebar from './Sidebar.jsx'
import MobileTabs, { MoreSheet } from './MobileTabs.jsx'
import NewTask from './NewTask.jsx'
import QuickFind from './QuickFind.jsx'
import NotificationsBell from './NotificationsBell.jsx'
import Logo from './Logo.jsx'
import Avatar from './Avatar.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import LangToggle from './LangToggle.jsx'
import { useT, tr as tx } from '../lib/i18n.jsx'
import { usePages } from '../lib/pages.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { useAutoUpdate, BUILD } from '../lib/useAutoUpdate.js'
import { useIsPhone } from '../lib/usePhone.js'
import { watchTables } from '../lib/stackTables.js'
import { can, iconFor } from '../lib/constants.js'
import { trackUsage, trackPage } from '../lib/usage.js'

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

// A new build is on the server and this tab is still running the old one.
// The auto-update takes it when the tab is next backgrounded; this is for the
// person who is looking right now.
function UpdateReady({ on, take }) {
  if (!on) return null
  return (
    <div className="new-build" role="status">
      <RefreshCw size={15} />
      <span>{tx('A newer version of the board is ready.')}</span>
      <button type="button" className="new-build-go" onClick={take}>{tx('Load it')}</button>
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { visible, byKey } = useChannels()
  const { t } = useT()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
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
  // Long-lived tabs pick up new deploys on their own when they are put down.
  // Somebody holding a phone and waiting for a change does not put it down,
  // so they are told and handed the button.
  const update = useAutoUpdate()

  // What the board is used for: minutes in front of it, and which buttons get
  // pressed. Counted per person per DAY and never per moment — the admin's
  // Usage tab reads it back. Starts once, with the account.
  useEffect(() => trackUsage(user), [user?.id])
  useEffect(() => trackPage(location.pathname), [location.pathname])
  useEffect(() => setOpen(false), [location.pathname])

  // ---- the phone shell ----
  // Giving a task used to start with finding the channel that owns it. The
  // raised button in the tab bar starts it from anywhere, in the same form the
  // channel board opens, with the channel filled in from where you were.
  const [giving, setGiving] = useState(false)
  const canGive = can(user, 'manage_content')
  // A route change closes both the More sheet and the drawer; the sheet is a
  // place you leave, not a thing you dismiss.
  useEffect(() => setMore(false), [location.pathname])
  // Tables become stacked cards on a phone, and each cell needs the name of
  // the column it came from. One watcher for the whole app.
  const phone = useIsPhone()
  useEffect(() => (phone ? watchTables() : undefined), [phone])

  // The channel's own name is never translated — it is what the team called
  // it, in whichever language they called it.
  let title = ''
  if (location.pathname.startsWith('/admin')) title = t('nav.adminpanel')
  else if (location.pathname.startsWith('/overview')) title = t('nav.overview')
  else if (location.pathname.startsWith('/brief')) title = t('nav.brief')
  else if (location.pathname.startsWith('/releases')) title = t('nav.releases')
  else if (location.pathname.startsWith('/recordings')) title = t('nav.recordings')
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
  // An ambassador has one page and is not staff. No sidebar, no tab bar, no
  // quick find, no bell, no Give a task — none of it would answer them
  // anyway, and a door that opens onto a refusal is worse than no door.
  const ambassador = user.role === 'ambassador'
  const soloChannel = solo ? visible[0] : null
  const { shows } = usePages()
  const SoloIcon = soloChannel ? iconFor(soloChannel.icon) : null

  // Four destinations and the action, which is all a phone has room for. A
  // member with one channel gets that channel in the bar — it is their whole
  // job — and everything else moves behind More.
  // The bar has room for two destinations beside My Day and More, and a slot
  // cannot hold a page an admin switched off — so they are taken from what is
  // still there, in the order they matter, and the rest fall into More.
  const crewHats = user.crew_roles || []
  const designsToo = user.role === 'admin' || crewHats.includes('designer')
    || !(crewHats.includes('editor') || crewHats.includes('operator'))
  const CANDIDATES = [
    { key: 'releases', to: '/releases', label: t('nav.releases'), icon: Send },
    { key: 'recordings', to: '/recordings', label: t('nav.recordings'), icon: Clapperboard },
    { key: 'missed', to: '/missed', label: t('nav.stats'), icon: BarChart3 },
    // Same as the sidebar: an editor is not shown a door to the designers'
    // board. See client/src/components/Sidebar.jsx.
    ...(designsToo ? [{ key: 'design', to: '/design', label: t('nav.design'), icon: Palette }] : []),
    { key: 'docs', to: '/docs', label: t('nav.docs'), icon: ScrollText },
    { key: 'sprints', to: '/sprints', label: t('nav.sprints'), icon: Timer },
    { key: 'projects', to: '/projects', label: t('nav.projects'), icon: Briefcase },
  ].filter((c) => shows(c.key))
  const soloFirst = soloChannel
    ? { key: 'ch', to: `/dept/${soloChannel.key}`, label: soloChannel.label, icon: SoloIcon }
    : CANDIDATES[0]
  const soloSecond = CANDIDATES.find((c) => c.key !== soloFirst?.key)
  const soloTabs = [
    { key: 'brief', to: '/brief', label: t('nav.brief'), icon: Sun },
    soloFirst,
    soloSecond,
    { key: 'more', onClick: () => setMore((v) => !v), on: more, label: tx('More'), icon: LayoutGrid },
  ].filter(Boolean)
  // Whoever runs the ambassador programme reaches it from here too. A member
  // with one channel gets this shell instead of a sidebar, so a door that only
  // exists in the sidebar is a door they do not have — and the programme is
  // their whole job, not an extra.
  const runsProgramme = user.role === 'admin' || !!(user.permissions && user.permissions.manage_ambassadors)
  const soloMore = [
    ...CANDIDATES.filter((c) => c.key !== soloFirst?.key && c.key !== soloSecond?.key),
    ...(runsProgramme ? [{ key: 'ambassadors', to: '/ambassador', label: tx('Ambassadors'), icon: GraduationCap }] : []),
    { key: 'profile', to: '/profile', label: t('nav.myprofilepage'), icon: User },
  ]

  if (ambassador) {
    return (
      <div className="main solo amb-shell">
        <header className="topbar solo-bar">
          <span className="logo-link"><Logo size={30} tone="var(--brand-500)" /></span>
          <h1>{tx('Ambassadors')}</h1>
          <div className="topbar-spacer" />
          <ThemeToggle className="icon-btn solo-theme" />
          <LangToggle />
          <button className="icon-btn" onClick={logout} aria-label={tx('Sign out')}><LogOut size={17} /></button>
        </header>
        <main className="content">
          <UpdateReady on={update.ready} take={update.take} />
          <WeakPasswordBanner user={user} />
          <Outlet />
        </main>
      </div>
    )
  }

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
          {shows('missed') && (
            <NavLink to="/missed" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
              <BarChart3 size={16} /> {t('nav.stats')}
            </NavLink>
          )}
          {shows('design') && (
            <NavLink to="/design" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
              <Palette size={16} /> {t('nav.design')}
            </NavLink>
          )}
          {shows('docs') && (
            <NavLink to="/docs" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
              <ScrollText size={16} /> {t('nav.docs')}
            </NavLink>
          )}
          {/* Sprints is for the whole team, whatever hats they wear. It was in
              the sidebar and ungated there, but somebody with no channels
              gets this bar instead of a sidebar, so for them it did not exist
              at all. The page itself always let them in; only the door was
              missing. */}
          {shows('sprints') && (
            <NavLink to="/sprints" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
              <Timer size={16} /> {t('nav.sprints')}
            </NavLink>
          )}
          {/* Same story as Sprints, for the same reason: somebody who runs the
              ambassador programme and works on one channel gets this bar
              instead of a sidebar, so a door that only exists in the sidebar
              is a door they do not have — and the programme is their job, not
              an extra. */}
          {runsProgramme && (
            <NavLink to="/ambassador" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
              <GraduationCap size={16} /> {tx('Ambassadors')}
            </NavLink>
          )}
          <button className="icon-btn" onClick={() => setFinding(true)} data-tip={t('nav.find')} aria-label={t('nav.quickfind')}><Search size={17} /></button>
          <NotificationsBell user={user} />
          {/* Named so a phone can put it away: theme, language, the profile
              and Sign out all live in the More sheet there. */}
          <ThemeToggle className="icon-btn solo-theme" />
          <NavLink to="/profile" className="solo-avatar" data-tip={t('nav.myprofile')} data-tip-left="" aria-label={t('nav.myprofilepage')}>
            <Avatar name={user.name} color={user.color} src={user.avatar} size="sm" />
          </NavLink>
          <button className="icon-btn" onClick={logout} data-tip="Sign out" data-tip-left="" aria-label="Sign out"><LogOut size={17} /></button>
        </header>
        <main className="content">
          <UpdateReady on={update.ready} take={update.take} />
          <GetSetUp />
          <WeakPasswordBanner user={user} />
          <Outlet />
        </main>
        {finding && <QuickFind onClose={() => setFinding(false)} />}
        <MobileTabs tabs={soloTabs} canGive={canGive}
          onNew={() => (canGive ? setGiving(true) : setFinding(true))}
          newLabel={canGive ? tx('Give a task') : tx('Find anything')} />
        <MoreSheet open={more} onClose={() => setMore(false)} links={soloMore}
          foot={<>
            <ThemeToggle />
            <LangToggle />
            <button type="button" className="mob-sheet-out" onClick={logout}><LogOut size={16} /> {tx('Sign out')}</button>
            <span className="build-stamp" title={tx('Which build this is')}>{BUILD}</span>
          </>} />
        {giving && <NewTask onClose={() => setGiving(false)} />}
      </div>
    )
  }

  // Same two slots, same rule: what is switched off is not offered.
  const barPicks = [
    { key: 'releases', to: '/releases', label: t('nav.releases'), icon: Send },
    { key: 'sprints', to: '/sprints', label: t('nav.sprints'), icon: Timer },
    { key: 'recordings', to: '/recordings', label: t('nav.recordings'), icon: Clapperboard },
    { key: 'missed', to: '/missed', label: t('nav.stats'), icon: BarChart3 },
    { key: 'design', to: '/design', label: t('nav.design'), icon: Palette },
    { key: 'docs', to: '/docs', label: t('nav.docs'), icon: ScrollText },
  ].filter((c) => shows(c.key)).slice(0, 2)
  const tabs = [
    { key: 'brief', to: '/brief', label: t('nav.brief'), icon: Sun },
    ...barPicks,
    { key: 'more', onClick: () => setOpen((v) => !v), on: open, label: tx('More'), icon: LayoutGrid },
  ]

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
          <UpdateReady on={update.ready} take={update.take} />
          <GetSetUp />
          <WeakPasswordBanner user={user} />
          <Outlet />
        </main>
        {finding && <QuickFind onClose={() => setFinding(false)} />}
        {/* The same four slots for everyone else. More opens the sidebar,
            which on a phone comes up from the bottom as a sheet instead of
            sliding in from the left as a desktop drawer that was never a
            phone thing to begin with. */}
        <MobileTabs tabs={tabs} canGive={canGive}
          onNew={() => (canGive ? setGiving(true) : setFinding(true))}
          newLabel={canGive ? tx('Give a task') : tx('Find anything')} />
        {giving && <NewTask onClose={() => setGiving(false)} />}
      </div>
    </div>
  )
}
