import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Pencil, Link2, Check, AlertCircle, UserRound, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react'
import { api } from '../lib/api.js'
import { useFullscreen } from '../lib/useFullscreen.js'
import Avatar from './Avatar.jsx'
import { useContextMenu } from './ContextMenu.jsx'
import Modal from './Modal.jsx'

// Whiteboard: free-form canvas for the org structure. Each card is a role;
// bind a team member to it (their live name and photo render on the card),
// drag cards around, and link them into a hierarchy. Changes auto-save.
// A field big enough to actually run around in.
const CANVAS_W = 6000
const CANVAS_H = 4000
const NODE_W = 190
const NODE_H = 76
const COLORS = ['#a32234', '#2a78d6', '#0ca30c', '#fab219', '#7c5cd6', '#ec835a', '#8b8388']
const uid = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

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
  const [zoom, setZoomRaw] = useState(() => {
    const z = Number(localStorage.getItem('satashkent_board_zoom'))
    return z >= 0.4 && z <= 1.6 ? z : 1
  })
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const setZoom = (z) => {
    const v = Math.round(Math.min(1.6, Math.max(0.4, z)) * 10) / 10
    setZoomRaw(v)
    try { localStorage.setItem('satashkent_board_zoom', String(v)) } catch { /* ok */ }
  }

  // ---- nodes ----
  const canvasRef = useRef(null)
  const addNode = () => {
    const count = board.nodes.length
    // Spawn where the user is looking — the field is big, the corner is far.
    const sc = canvasRef.current
    const baseX = sc ? sc.scrollLeft / zoomRef.current + 80 : 80
    const baseY = sc ? sc.scrollTop / zoomRef.current + 60 : 60
    const node = {
      id: uid(),
      x: Math.min(CANVAS_W - 40 - NODE_W, baseX + (count % 5) * 210),
      y: Math.min(CANVAS_H - 40 - NODE_H, baseY + (Math.floor(count / 5) % 6) * 130),
      text: 'New role',
      sub: '',
      color: COLORS[count % COLORS.length],
      user_id: null,
    }
    change((prev) => ({ ...prev, nodes: [...prev.nodes, node] }))
    setEditNode(node)
  }
  const applyNode = (node) =>
    change((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === node.id ? node : n)) }))
  const removeNode = (id) =>
    change((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== id),
      edges: prev.edges.filter((e) => e.from !== id && e.to !== id),
    }))

  // ---- drag (mouse) ----
  const dragState = useRef(null)
  // Pointer events, not mouse events. A finger fires neither `mousedown` nor
  // `mousemove`, so on a phone the cards on this board could be looked at and
  // not moved — the whole point of the board. Capturing the pointer also means
  // a drag that wanders off the card keeps following the finger.
  const startDrag = (e, node) => {
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
      const x = Math.min(CANVAS_W - 20 - NODE_W, Math.max(0, d.ox + dx))
      const y = Math.min(CANVAS_H - 20 - NODE_H, Math.max(0, d.oy + dy))
      setBoard((prev) => {
        const next = { ...prev, nodes: prev.nodes.map((n) => (n.id === d.id ? { ...n, x, y } : n)) }
        boardRef.current = next
        return next
      })
    }
    const onUp = () => {
      const d = dragState.current
      dragState.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (!d) return
      if (d.moved) scheduleSave()
      else clickNode(d.id) // a plain click: link target or open the editor
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const clickNode = (id) => {
    const node = boardRef.current.nodes.find((n) => n.id === id)
    if (!node) return
    if (linkFrom) {
      if (linkFrom !== id) {
        const dup = boardRef.current.edges.some(
          (e) => (e.from === linkFrom && e.to === id) || (e.from === id && e.to === linkFrom))
        if (!dup) change((prev) => ({ ...prev, edges: [...prev.edges, { id: uid(), from: linkFrom, to: id }] }))
      }
      setLinkFrom(null)
    } else {
      setEditNode(node)
    }
  }

  const removeEdge = (id) => change((prev) => ({ ...prev, edges: prev.edges.filter((e) => e.id !== id) }))

  // Right-click a card: edit, connect, or delete without hunting the tiny icons.
  const { openMenu } = useContextMenu()
  const nodeMenu = (e, n) => openMenu(e, [
    { label: 'Edit role & member', icon: Pencil, onClick: () => setEditNode(n) },
    { label: 'Connect to another card', icon: Link2, onClick: () => setLinkFrom(n.id) },
    { sep: true },
    { label: 'Delete card', icon: Trash2, danger: true, onClick: () => { if (confirm(`Delete “${n.text}”?`)) removeNode(n.id) } },
  ])

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
        <div className="board-hint">Drag cards to arrange · click a card to edit it and assign a member · the <Link2 size={12} style={{ verticalAlign: -2 }} /> button links two cards</div>
      )}

      <div className="board-canvas" ref={canvasRef}>
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
              const x1 = f.x + NODE_W / 2, y1 = f.y + NODE_H
              const x2 = t.x + NODE_W / 2, y2 = t.y
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
              return (
                <g key={e.id} className="board-edge">
                  <path d={`M ${x1} ${y1} C ${x1} ${y1 + 45}, ${x2} ${y2 - 45}, ${x2} ${y2}`}
                    fill="none" stroke="#b59298" strokeWidth="2" markerEnd="url(#bArrow)" />
                  <g className="edge-x" onClick={() => removeEdge(e.id)}>
                    <circle cx={mx} cy={my} r="9" />
                    <path d={`M ${mx - 3.2} ${my - 3.2} L ${mx + 3.2} ${my + 3.2} M ${mx + 3.2} ${my - 3.2} L ${mx - 3.2} ${my + 3.2}`} stroke="#fff" strokeWidth="1.8" />
                  </g>
                </g>
              )
            })}
          </svg>

          {board.nodes.map((n) => {
            const bound = n.user_id ? teamById[n.user_id] : null
            return (
              <div
                key={n.id}
                className={'board-node' + (linkFrom === n.id ? ' link-src' : '') + (linkFrom && linkFrom !== n.id ? ' link-target' : '')}
                style={{ left: n.x, top: n.y, borderTopColor: n.color }}
                onPointerDown={(e) => startDrag(e, n)}
                onContextMenu={(e) => nodeMenu(e, n)}
              >
                <div className="bn-tools" onPointerDown={(e) => e.stopPropagation()}>
                  <button className="icon-btn" onClick={() => setLinkFrom(linkFrom === n.id ? null : n.id)} data-tip="Connect to another card" aria-label="Link"><Link2 size={13} /></button>
                  <button className="icon-btn" onClick={() => setEditNode(n)} data-tip="Edit role & member" aria-label="Edit"><Pencil size={13} /></button>
                  <button className="icon-btn del-btn" onClick={() => { if (confirm(`Delete “${n.text}”?`)) removeNode(n.id) }} data-tip="Delete this card" data-tip-left="" aria-label="Delete"><Trash2 size={13} /></button>
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
                {n.sub && <div className="bn-sub">{n.sub}</div>}
              </div>
            )
          })}
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
        <label>Note <span className="stat-sub">(optional — e.g. responsibilities)</span></label>
        <input className="input" value={form.sub} onChange={(e) => setForm({ ...form, sub: e.target.value })} placeholder="Reels, stories, shoots" />
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
