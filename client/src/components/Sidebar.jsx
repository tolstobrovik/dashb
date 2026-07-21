import { NavLink, Link } from 'react-router-dom'
import { Shield, LogOut, ListChecks, Briefcase, LayoutDashboard, Sun, BarChart3, Clapperboard, UsersRound, ScrollText } from 'lucide-react'
import { LogoLockup } from './Logo.jsx'
import Avatar from './Avatar.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { useChannels } from '../lib/channels.jsx'
import { iconFor } from '../lib/constants.js'

export default function Sidebar({ user, onNavigate, onLogout }) {
  const { visible } = useChannels()
  const cls = ({ isActive }) => 'nav-item' + (isActive ? ' active' : '')

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
        {visible.map((c) => {
          const Icon = iconFor(c.icon)
          return (
            <NavLink key={c.key} to={`/dept/${c.key}`} className={cls} onClick={onNavigate}>
              <Icon size={18} /> {c.label}
            </NavLink>
          )
        })}

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
