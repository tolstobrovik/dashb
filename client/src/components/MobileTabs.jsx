import { NavLink } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'

// ---- the bar a thumb lives on ----
// The phone used to get the desk's furniture: a sidebar slid in from the left
// holding thirteen destinations, and no way to start a task without first
// finding the channel that owns it. That is a website on a phone.
//
// This is the shape a phone app actually has. Four destinations across the
// bottom where the thumb already rests, the one thing you came to do raised in
// the middle, and everything else behind More — which comes up as a sheet, not
// as a drawer. The bar is fixed, so it survives every scroll on every page.
//
// Slots take either a route (`to`) or a press (`onClick`); the middle one is
// always the action, and it is never a route because giving a task is a thing
// you do, not a place you go.
export default function MobileTabs({ tabs, onNew, newLabel, canGive = true }) {
  const half = Math.ceil(tabs.length / 2)
  const Slot = (tab) => {
    const inner = <><span className="mob-ico">{<tab.icon size={21} strokeWidth={2.1} />}</span><span>{tab.label}</span></>
    return tab.to ? (
      <NavLink key={tab.key} to={tab.to} end={tab.end} className={({ isActive }) => 'mob-tab' + (isActive ? ' active' : '')}>
        {inner}
      </NavLink>
    ) : (
      <button key={tab.key} type="button" className={'mob-tab' + (tab.on ? ' active' : '')} onClick={tab.onClick}>
        {inner}
      </button>
    )
  }
  return (
    <nav className="mob-tabs" aria-label={tx('Main')}>
      {tabs.slice(0, half).map(Slot)}
      {/* Somebody who cannot give tasks is not shown a plus that opens
          something else. The slot keeps its place in the bar and does the
          most useful thing that person CAN do from anywhere. */}
      <button type="button" className="mob-new" onClick={onNew} aria-label={newLabel} title={newLabel}>
        <i>{canGive ? <Plus size={24} strokeWidth={2.7} /> : <Search size={21} strokeWidth={2.6} />}</i>
      </button>
      {tabs.slice(half).map(Slot)}
    </nav>
  )
}

// The More sheet for an account with no sidebar to show — one channel, one
// job, and until now eight links crushed into a top bar 390px wide.
export function MoreSheet({ open, onClose, links, foot }) {
  return (
    <div className={'mob-sheet' + (open ? ' open' : '')} role="dialog" aria-modal={open ? 'true' : undefined}
      aria-label={tx('More')} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mob-sheet-card">
        <div className="mob-sheet-grip" />
        <div className="mob-sheet-list">
          {links.map((l) => (
            <NavLink key={l.key} to={l.to} className={({ isActive }) => 'mob-sheet-row' + (isActive ? ' active' : '')} onClick={onClose}>
              <l.icon size={18} /> <span>{l.label}</span>
            </NavLink>
          ))}
        </div>
        {foot && <div className="mob-sheet-foot">{foot}</div>}
      </div>
    </div>
  )
}
