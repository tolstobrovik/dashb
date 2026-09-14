import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Pencil, Link2, Check, AlertCircle, UserRound, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react'
import { api } from '../lib/api.js'
import { useFullscreen } from '../lib/useFullscreen.js'
import Avatar from './Avatar.jsx'
import { useContextMenu } from './ContextMenu.jsx'
import Modal from './Modal.jsx'
import RichNote from './RichNote.jsx'
import { Rich } from '../lib/richtext.js'

// Whiteboard: free-form canvas for the org structure. Each card is a role;
// bind a team member to it (their live name and photo render on the card),
// drag cards around, and link them into a hierarchy. Changes auto-save.
// A field big enough to actually run around in.
const CANVAS_W = 6000
const CANVAS_H = 4000
const NODE_W = 190
const NODE_H = 76          // the height of an empty card — a floor, not the truth
const COLORS = ['#a32234', '#2a78d6', '#0ca30c', '#fab219', '#7c5cd6', '#ec835a', '#8b8388']
const uid = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ---- one card ---------------------------------------------------------------
// Memoised, and that is the difference between a board that drags smoothly and
// one that does not. Moving a card rebuilds the nodes ARRAY but leaves every
// other node OBJECT identical, so with this in place a drag re-renders one
// card instead of all of them — on a real org chart that is one small div
// against sixty, thirty times a second.
const Node = memo(function Node({ n, bound, linkFrom, register, onDown, onMenu, onLink, onEdit, onDelete }) {
  const hold = useCallback((el) => register(n.id, el), [register, n.id])
  return (
    <div
      ref={hold}
      data-nid={n.id}
      className={'board-node' + (linkFrom === n.id ? ' link-src' : '') + (linkFrom && linkFrom !== n.id ? ' link-target' : '')}
      style={{ left: n.x, top: n.y, borderTopColor: n.color }}
      onPointerDown={(e) => onDown(e, n)}
      onContextMenu={(e) => onMenu(e, n)}
    >
      <div className="bn-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon-btn" onClick={() => onLink(n.id)} data-tip="Connect to another card" aria-label="Link"><Link2 size={13} /></button>
        <button className="icon-btn" onClick={() => onEdit(n)} data-tip="Edit role & member" aria-label="Edit"><Pencil size={13} /></button>
        <button className="icon-btn del-btn" onClick={() => onDelete(n)} data-tip="Delete this card" data-tip-left="" aria-label="Delete"><Trash2 size={13} /></button>
      </div>
      <div className="bn-title">{n.text || 'Role'}</div>
      {bound ? (
        <div className="bn-user">
          <Avatar name={bound.name} color={bound.color} src={bound.avatar} size="sm" />
          <span>{bound.name}</span>
        </div>
      ) : (
        <div className="bn-empty"><UserRound size={11} /> No one assigned</div>
      )}
      {n.sub && <Rich text={n.sub} className="bn-rich" />}
    </div>
  )
})

// ---- one connector ----------------------------------------------------------
// Memoised on the four numbers it is drawn from, so a card moving at the far
// end of the board does not redraw every line on it.
const Edge = memo(function Edge({ id, x1, y1, x2, y2, onRemove }) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return (
    <g className="board-edge">
      <path d={`M ${x1} ${y1} C ${x1} ${y1 + 45}, ${x2} ${y2 - 45}, ${x2} ${y2}`}
        fill="none" stroke="#b59298" strokeWidth="2" markerEnd="url(#bArrow)" />
      <g className="edge-x" onClick={() => onRemove(id)}>
        <circle cx={mx} cy={my} r="9" />
        <path d={`M ${mx - 3.2} ${my - 3.2} L ${mx + 3.2} ${my + 3.2} M ${mx + 3.2} ${my - 3.2} L ${mx - 3.2} ${my + 3.2}`} stroke="#fff" strokeWidth="1.8" />
      </g>
    </g>
  )
})

export default function Whiteboard() {
  const [boards, setBoards] = useState(null)
  const [board, setBoard] = useState(null) // { id, name, nodes, edges }
  const [team, setTeam] = useState([])
  const [editNode, setEditNode] = useState(null)
  const [linkFrom, setLinkFrom] = useState(null)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const saveTimer = useRef(null)
  const [fs, setFs] = useFullscreen()
  const boardRef = useRef(null)
  boardRef.current = board

  const teamById = Object.fromEntries(team.map((u) => [u.id, u]))

  // ---- load boards; the first visit creates "Team structure" ----
  useEffect(() => {
    Promise.all([api.get('/boards'), api.get('/users')]).then(async ([bs, us]) => {
      setTeam(us)
      if (bs.length === 0) {
        const created = await api.post('/boards', { name: 'Team structure' })
        setBoards([{ id: created.id, name: created.name }])
        setBoard(created)
      } else {
        setBoards(bs)
        setBoard(await api.get(`/boards/${bs[0].id}`))
      }
    }).catch((e) => setErr(e.message))
  }, [])

  const openBoard = async (id) => {
    flushSave()
    try { setBoard(await api.get(`/boards/${id}`)); setLinkFrom(null) } catch (e) { setErr(e.message) }
  }

  // ---- persistence: debounce, plus flush on unmount/board switch ----
  const scheduleSave = () => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushSave, 700)
  }
  const flushSave = () => {
    clearTimeout(saveTimer.current)
    const b = boardRef.current
    if (!b) return
    api.patch(`/boards/${b.id}`, { data: { nodes: b.nodes, edges: b.edges } })
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1800) })
      .catch((e) => setErr(e.message))
  }
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const change = (fn) => {
    setBoard((prev) => {
      const next = fn(prev)
      boardRef.current = next
      return next
    })
    scheduleSave()
  }

  // ---- board management ----
  const newBoard = async () => {
    const name = prompt('Board name:', 'New board')
    if (!name?.trim()) return
    try {
      const created = await api.post('/boards', { name: name.trim() })
      setBoards((prev) => [...prev, { id: created.id, name: created.name }])
      setBoard(created)
    } catch (e) { setErr(e.message) }
  }
  const renameBoard = async () => {
    const name = prompt('Board name:', board.name)
    if (!name?.trim() || name.trim() === board.name) return
    try {
      await api.patch(`/boards/${board.id}`, { name: name.trim() })
      setBoards((prev) => prev.map((b) => (b.id === board.id ? { ...b, name: name.trim() } : b)))
      setBoard((prev) => ({ ...prev, name: name.trim() }))
    } catch (e) { setErr(e.message) }
  }
  const deleteBoard = async () => {
    if (!confirm(`Delete the board “${board.name}” and everything on it?`)) return
    try {
      await api.del(`/boards/${board.id}`)
      const left = boards.filter((b) => b.id !== board.id)
      setBoards(left)
      if (left[0]) openBoard(left[0].id)
      else {
        const created = await api.post('/boards', { name: 'Team structure' })
        setBoards([{ id: created.id, name: created.name }])
        setBoard(created)
      }
    } catch (e) { setErr(e.message) }
  }

  // ---- zoom: see the whole field small, or work close up ----
  const canvasRef = useRef(null)
  const [zoom, setZoomRaw] = useState(() => {
    const z = Number(localStorage.getItem('satashkent_board_zoom'))
    return z >= 0.4 && z <= 1.6 ? z : 1
  })
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const setZoom = (z) => {
    const v = Math.round(clamp(z, 0.4, 1.6) * 100) / 100
    setZoomRaw(v)
    try { localStorage.setItem('satashkent_board_zoom', String(v)) } catch { /* ok */ }
    return v
  }

  // ⌘/Ctrl + wheel zooms, and zooms AROUND THE POINTER — the thing under the
  // cursor stays under the cursor. Zooming from the top-left corner instead
  // (which is what changing the scale alone does) throws the card you were
  // looking at off the screen, so every zoom costs a hunt to find it again.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const box = el.getBoundingClientRect()
      const px = e.clientX - box.left
      const py = e.clientY - box.top
      const z0 = zoomRef.current
      const z1 = setZoom(z0 * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
      if (z1 === z0) return
      const cx = (el.scrollLeft + px) / z0
      const cy = (el.scrollTop + py) / z0
      requestAnimationFrame(() => {
        el.scrollLeft = cx * z1 - px
        el.scrollTop = cy * z1 - py
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- how tall each card really is -------------------------------------
  // Cards used to be one fixed height, so the connectors could leave from a
  // number. Now that a card carries a list of duties it is as tall as what is
  // written on it, and a line leaving from 76px down would come out of the
  // middle of the text. Measured, so the arrows stay on the edges.
  const [heights, setHeights] = useState({})
  const hRef = useRef({})
  const roRef = useRef(null)
  const elsRef = useRef(new Map())
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      let changed = false
      const next = { ...hRef.current }
      for (const en of entries) {
        const id = en.target.dataset.nid
        const h = en.target.offsetHeight
        if (id && h && next[id] !== h) { next[id] = h; changed = true }
      }
      if (changed) { hRef.current = next; setHeights(next) }
    })
    roRef.current = ro
    for (const el of elsRef.current.values()) ro.observe(el)
    return () => { ro.disconnect(); roRef.current = null }
  }, [])
  const register = useCallback((id, el) => {
    const map = elsRef.current
    const prev = map.get(id)
    if (prev === el) return
    if (prev && roRef.current) roRef.current.unobserve(prev)
    if (el) { map.set(id, el); roRef.current?.observe(el) } else { map.delete(id) }
  }, [])
  const tall = (id) => heights[id] || NODE_H

  // ---- nodes ----
  const addNodeAt = (x, y) => {
    const node = {
      id: uid(),
      x: clamp(Math.round(x), 0, CANVAS_W - 40 - NODE_W),
      y: clamp(Math.round(y), 0, CANVAS_H - 40 - NODE_H),
      text: 'New role',
      sub: '',
      color: COLORS[(boardRef.current?.nodes.length || 0) % COLORS.length],
      user_id: null,
    }
    change((prev) => ({ ...prev, nodes: [...prev.nodes, node] }))
    setEditNode(node)
  }
  const addNode = () => {
    const count = board.nodes.length
    // Spawn where the user is looking — the field is big, the corner is far.
    const sc = canvasRef.current
    const baseX = sc ? sc.scrollLeft / zoomRef.current + 80 : 80
    const baseY = sc ? sc.scrollTop / zoomRef.current + 60 : 60
    addNodeAt(baseX + (count % 5) * 210, baseY + (Math.floor(count / 5) % 6) * 130)
  }
  const applyNode = (node) =>
    change((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === node.id ? node : n)) }))
  const removeNode = (id) => {
    register(id, null)
    change((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== id),
      edges: prev.edges.filter((e) => e.from !== id && e.to !== id),
    }))
  }

  // ---- drag (pointer) ----
  const dragState = useRef(null)
  const rafRef = useRef(0)
  const pendRef = useRef(null)
  // Pointer events, not mouse events. A finger fires neither `mousedown` nor
  // `mousemove`, so on a phone the cards on this board could be looked at and
  // not moved — the whole point of the board. Capturing the pointer also means
  // a drag that wanders off the card keeps following the finger.
  //
  // And ONE STATE CHANGE PER FRAME. A pointer device reports faster than the
  // screen redraws — a trackpad happily fires three or four moves between two
  // frames — and every one of those used to be a React render whose result was
  // thrown away before anybody saw it. The moves are collapsed into the next
  // frame instead, so the work done matches the frames drawn.
  const moveTo = (id, p) => setBoard((prev) => {
    const next = { ...prev, nodes: prev.nodes.map((n) => (n.id === id ? { ...n, x: p.x, y: p.y } : n)) }
    boardRef.current = next
    return next
  })
  const commit = () => {
    rafRef.current = 0
    const d = dragState.current
    const p = pendRef.current
    if (d && p) moveTo(d.id, p)
  }
  const startDrag = useCallback((e, node) => {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* not captured, still works */ }
    dragState.current = { id: node.id, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y, moved: false }
    const onMove = (ev) => {
      const d = dragState.current
      if (!d) return
      // Screen pixels shrink with the zoom — divide to stay under the cursor.
      const dx = (ev.clientX - d.sx) / zoomRef.current
      const dy = (ev.clientY - d.sy) / zoomRef.current
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
      if (!d.moved) return
      pendRef.current = {
        x: clamp(d.ox + dx, 0, CANVAS_W - 20 - NODE_W),
        y: clamp(d.oy + dy, 0, CANVAS_H - 20 - NODE_H),
      }
      if (!rafRef.current) rafRef.current = requestAnimationFrame(commit)
    }
    const onUp = () => {
      // THE LAST POSITION ALWAYS LANDS. The frame-throttling above means the
      // newest position may still be waiting for a frame that has not come —
      // and a quick flick of a card fits entirely between two frames, so that
      // is the common case, not the rare one. Read the pending position out
      // FIRST and apply it by hand; clearing the drag and then asking the
      // frame handler to finish the job left the card where it started.
      const d = dragState.current
      const p = pendRef.current
      dragState.current = null
      pendRef.current = null
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (!d) return
      if (d.moved) { if (p) moveTo(d.id, p); scheduleSave() }
      else clickNode(d.id) // a plain click: link target or open the editor
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [])

  // ---- pan the field ------------------------------------------------------
  // A six-thousand-pixel field reached only by its scrollbars is a field
  // nobody crosses. Dragging the empty space moves it, the way every canvas
  // anybody has used works, and the middle mouse button does it from anywhere
  // — including from on top of a card, where a left-drag means something else.
  const [panning, setPanning] = useState(false)
  const startPan = (e) => {
    const onCard = e.target.closest?.('.board-node, .edge-x')
    if (e.button === 1) e.preventDefault()
    else if (e.button !== 0 || onCard) return
    const el = canvasRef.current
    if (!el) return
    const sx = e.clientX
    const sy = e.clientY
    const l0 = el.scrollLeft
    const t0 = el.scrollTop
    setPanning(true)
    const onMove = (ev) => {
      el.scrollLeft = l0 - (ev.clientX - sx)
      el.scrollTop = t0 - (ev.clientY - sy)
    }
    const onUp = () => {
      setPanning(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  // Double-click the empty field to put a card exactly there — quicker than
  // adding one somewhere and dragging it to where it was always going.
  const dblAdd = (e) => {
    if (e.target.closest?.('.board-node')) return
    const el = canvasRef.current
    const box = el.getBoundingClientRect()
    addNodeAt((el.scrollLeft + e.clientX - box.left) / zoomRef.current - NODE_W / 2,
      (el.scrollTop + e.clientY - box.top) / zoomRef.current - 20)
  }

  const clickNode = (id) => {
    const node = boardRef.current.nodes.find((n) => n.id === id)
    if (!node) return
    if (linkFromRef.current) {
      const src = linkFromRef.current
      if (src !== id) {
        const dup = boardRef.current.edges.some(
          (e) => (e.from === src && e.to === id) || (e.from === id && e.to === src))
        if (!dup) change((prev) => ({ ...prev, edges: [...prev.edges, { id: uid(), from: src, to: id }] }))
      }
      setLinkFrom(null)
    } else {
      setEditNode(node)
    }
  }
  // clickNode runs from a listener closed over at pointerdown, so it must read
  // link mode from a ref rather than the render it was born in.
  const linkFromRef = useRef(null)
  linkFromRef.current = linkFrom

  const removeEdge = useCallback((id) =>
    change((prev) => ({ ...prev, edges: prev.edges.filter((e) => e.id !== id) })), [])

  // Right-click a card: edit, connect, or delete without hunting the tiny icons.
  const { openMenu } = useContextMenu()
  const nodeMenu = useCallback((e, n) => openMenu(e, [
    { label: 'Edit role & member', icon: Pencil, onClick: () => setEditNode(n) },
    { label: 'Connect to another card', icon: Link2, onClick: () => setLinkFrom(n.id) },
    { sep: true },
    { label: 'Delete card', icon: Trash2, danger: true, onClick: () => { if (confirm(`Delete “${n.text}”?`)) removeNode(n.id) } },
  ]), [openMenu])
  const onLink = useCallback((id) => setLinkFrom((cur) => (cur === id ? null : id)), [])
  const onEdit = useCallback((n) => setEditNode(n), [])
  const onDelete = useCallback((n) => { if (confirm(`Delete “${n.text}”?`)) removeNode(n.id) }, [])

  // Esc cancels link mode
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setLinkFrom(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!boards || !board) return <div className="app-loading"><span className="spinner" /></div>

  const nodesById = Object.fromEntries(board.nodes.map((n) => [n.id, n]))

  return (
    <div className={'fs-wrap' + (fs ? ' on' : '')}>
      {err && <div className="form-error" onClick={() => setErr('')}><AlertCircle size={16} /> {err}</div>}

      <div className="pill-group" style={{ marginBottom: 6, alignItems: 'center' }}>
        {boards.map((b) => (
          <button key={b.id} className={'pill' + (b.id === board.id ? ' active' : '')} onClick={() => openBoard(b.id)}>{b.name}</button>
        ))}
        <button className="pill" onClick={newBoard}><Plus size={13} /> New board</button>
        <span style={{ flex: 1 }} />
        {saved && <span className="save-ok"><Check size={14} /> Saved</span>}
        <button className="icon-btn" onClick={renameBoard} data-tip="Rename this board" aria-label="Rename board"><Pencil size={15} /></button>
        <button className="icon-btn del-btn" onClick={deleteBoard} data-tip="Delete this board" aria-label="Delete board"><Trash2 size={15} /></button>
        <span className="zoom-ctl">
          <button className="icon-btn" onClick={() => setZoom(zoom - 0.1)} data-tip="Zoom out — see more of the field" aria-label="Zoom out"><ZoomOut size={15} /></button>
          <button className="zoom-pct" onClick={() => setZoom(1)} data-tip="Back to 100%">{Math.round(zoom * 100)}%</button>
          <button className="icon-btn" onClick={() => setZoom(zoom + 0.1)} data-tip="Zoom in — work close up" aria-label="Zoom in"><ZoomIn size={15} /></button>
        </span>
        <button className="icon-btn" onClick={() => setFs(!fs)}
          data-tip={fs ? 'Exit full screen (Esc)' : 'Full screen — the whole display for the board'} aria-label="Full screen">
          {fs ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button className="btn btn-primary btn-sm" onClick={addNode}><Plus size={15} /> Add role</button>
      </div>

      {linkFrom ? (
        <div className="link-banner"><Link2 size={14} /> Click another card to connect it — Esc to cancel</div>
      ) : (
        <div className="board-hint">Drag the empty field to move around · double-click it to add a role there · ⌘/Ctrl + scroll to zoom · click a card to edit it</div>
      )}

      <div className={'board-canvas' + (panning ? ' panning' : '')} ref={canvasRef}
        onPointerDown={startPan} onDoubleClick={dblAdd}>
        <div className="board-zoom" style={{ width: CANVAS_W * zoom, height: CANVAS_H * zoom }}>
        <div className="board-inner" style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
          <svg className="board-svg" width={CANVAS_W} height={CANVAS_H}>
            <defs>
              <marker id="bArrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                <path d="M0,0 L8,4.5 L0,9 z" fill="#b59298" />
              </marker>
            </defs>
            {board.edges.map((e) => {
              const f = nodesById[e.from]
              const t = nodesById[e.to]
              if (!f || !t) return null
              return (
                <Edge key={e.id} id={e.id}
                  x1={f.x + NODE_W / 2} y1={f.y + tall(f.id)}
                  x2={t.x + NODE_W / 2} y2={t.y}
                  onRemove={removeEdge} />
              )
            })}
          </svg>

          {board.nodes.map((n) => (
            <Node key={n.id} n={n}
              bound={n.user_id ? teamById[n.user_id] : null}
              linkFrom={linkFrom}
              register={register}
              onDown={startDrag}
              onMenu={nodeMenu}
              onLink={onLink}
              onEdit={onEdit}
              onDelete={onDelete} />
          ))}
        </div>
        </div>
      </div>

      {editNode && (
        <NodeModal
          node={board.nodes.find((n) => n.id === editNode.id) || editNode}
          team={team}
          onClose={() => setEditNode(null)}
          onSave={(node) => { applyNode(node); setEditNode(null) }}
          onDelete={() => { removeNode(editNode.id); setEditNode(null) }}
        />
      )}
    </div>
  )
}

function NodeModal({ node, team, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({ ...node })
  return (
    <Modal
      title="Role"
      onClose={onClose}
      footer={<>
        <button className="btn btn-danger" onClick={() => { if (confirm(`Delete “${node.text}”?`)) onDelete() }}><Trash2 size={15} /> Delete</button>
        <span className="foot-gap" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave({ ...form, text: form.text.trim() || 'Role' })}>Save</button>
      </>}
    >
      <div className="field">
        <label>Role / position</label>
        <input className="input" autoFocus value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="e.g. Head of SMM" />
      </div>
      <div className="field">
        <label>Team member</label>
        <select className="select" value={form.user_id ?? ''} onChange={(e) => setForm({ ...form, user_id: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">— Nobody yet —</option>
          {team.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === 'admin' ? ' (admin)' : ''}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Details <span className="stat-sub">(what they own, what they are measured on, notes)</span></label>
        <RichNote
          value={form.sub}
          onChange={(sub) => setForm((f) => ({ ...f, sub }))}
          placeholder={'**Owns** the YouTube channel\n- Plan, produce, publish\n- Answer comments\n**Metric** views, videos out vs planned'}
        />
      </div>
      <div className="field">
        <label>Card color</label>
        <div className="swatch-row">
          {COLORS.map((c) => (
            <button key={c} type="button" className={'swatch' + (form.color === c ? ' on' : '')} style={{ background: c }} onClick={() => setForm({ ...form, color: c })} aria-label={c}>
              {form.color === c && <Check size={13} strokeWidth={3.5} color="#fff" />}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
