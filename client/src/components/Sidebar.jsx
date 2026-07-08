import { NavLink } from 'react-router-dom'
import { Shield, LogOut, ListChecks } from 'lucide-react'
import { LogoLockup } from './Logo.jsx'
import Avatar from './Avatar.jsx'
import { useChannels } from '../lib/channels.jsx'
import { iconFor } from '../lib/constants.js'

export default function Sidebar({ user, onNavigate, onLogout }) {
  const { visible } = useChannels()
  const cls = ({ isActive }) => 'nav-item' + (isActive ? ' active' : '')

  return (
    <>
      <LogoLockup />
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        <NavLink to="/todo" className={cls} onClick={onNavigate}>
          <ListChecks size={18} /> To-Do
        </NavLink>

        <div className="nav-label">Channels</div>
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
            <NavLink to="/admin" className={cls} onClick={onNavigate}>
              <Shield size={18} /> Admin
            </NavLink>
          </>
        )}
      </nav>

      <div className="sidebar-foot">
        <div className="side-user">
          <Avatar name={user.name} color={user.color} size="sm" />
          <div className="su-meta">
            <span className="su-name">{user.name}</span>
            <span className="su-role">{user.role}</span>
          </div>
          <button className="side-logout" onClick={onLogout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </>
  )
}
