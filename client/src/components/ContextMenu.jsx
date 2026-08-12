import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'

// One right-click menu for the whole app. Any element can offer one:
//
//   const { openMenu } = useContextMenu()
//   <div onContextMenu={(e) => openMenu(e, [
//     { label: 'Open', icon: Eye, onClick: ... },
//     { sep: true },
//     { label: 'Delete', icon: Trash2, danger: true, onClick: ... },
//   ])}>
//
// Falsy items are skipped (so permissions can be inlined), the menu clamps
// itself inside the viewport, and it closes on click, Esc, scroll or resize.

const Ctx = createContext({ openMenu: () => {}, closeMenu: () => {} })
export const useContextMenu = () => useContext(Ctx)

function Menu({ menu, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: menu.x, top: menu.y })

  // Clamp inside the viewport once the real size is known.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { innerWidth: vw, innerHeight: vh } = window
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(menu.x, vw - r.width - 8)),
      top: Math.max(8, Math.min(menu.y, vh - r.height - 8)),
    })
  }, [menu])

  useEffect(() => {
    const born = Date.now()
    const onKey = (e) => e.key === 'Escape' && onClose()
    // Scroll dismisses the menu — but not the scroll that DELIVERED the
    // click: browsers auto-scroll the target into view on right-click, and
    // that event lands a frame after the menu opens. Grace it out.
    const onAway = () => { if (Date.now() - born > 250) onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onAway, true)
    window.addEventListener('resize', onAway)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onAway, true)
      window.removeEventListener('resize', onAway)
    }
  }, [onClose])

  return (
    <>
      {/* invisible click-catcher: any press outside the menu dismisses it */}
      <div className="ctx-catch" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div ref={ref} className="ctx-menu" style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
        {menu.items.map((it, i) => {
          if (it.sep) return <div key={i} className="ctx-sep" />
          const Icon = it.icon
          return (
            <button
              key={i}
              role="menuitem"
              className={'ctx-item' + (it.danger ? ' danger' : '')}
              disabled={it.disabled}
              onClick={() => { onClose(); it.onClick?.() }}
            >
              {Icon && <Icon size={14} />}
              <span>{it.label}</span>
              {it.hint && <span className="ctx-hint">{it.hint}</span>}
            </button>
          )
        })}
      </div>
    </>
  )
}

export function ContextMenuProvider({ children }) {
  const [menu, setMenu] = useState(null)
  const value = useRef({
    openMenu: (e, items) => {
      const usable = (items || []).filter(Boolean)
      if (usable.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      setMenu({ x: e.clientX, y: e.clientY, items: usable })
    },
    closeMenu: () => setMenu(null),
  }).current

  return (
    <Ctx.Provider value={value}>
      {children}
      {menu && <Menu menu={menu} onClose={value.closeMenu} />}
    </Ctx.Provider>
  )
}
