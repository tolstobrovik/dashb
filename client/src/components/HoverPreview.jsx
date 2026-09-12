import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, FileText, Folder, Play, Table2, Presentation, File } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'

// Hover on a link, a photo, a document, a Drive URL or a YouTube link and,
// after a beat, see what it is before you commit to it — the way a thumbnail
// answers "is this the one?" without opening anything.
//
// One listener on the document, not a prop on every link: the board has
// hundreds of anchors in a dozen files, and a preview that only works where
// somebody remembered to add it is a preview people stop trusting. The
// popover never takes the mouse (pointer-events: none), is gone on scroll,
// on any key and on any click, and does not exist at all on a screen with no
// hover — a phone would only ever see it stuck open.
const YT = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/i
const DRIVE = /^https?:\/\/(?:drive|docs)\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/([\w-]+)|file\/d\/([\w-]+)|document\/d\/([\w-]+)|spreadsheets\/d\/([\w-]+)|presentation\/d\/([\w-]+)|open\?id=([\w-]+))/i
const DOC = /\/([^/?#]+\.(pdf|docx?|xlsx?|pptx?|txt))(?:[?#]|$)/i
const DELAY = 450

function describe(el) {
  if (el.tagName === 'IMG') {
    const src = el.currentSrc || el.src
    if (!src || (el.naturalWidth && el.naturalWidth < 48)) return null
    return { kind: 'image', src }
  }
  const href = el.getAttribute('href') || el.dataset.preview
  if (!href || !/^https?:\/\//i.test(href)) return null
  const yt = YT.exec(href)
  if (yt) return { kind: 'youtube', id: yt[1], href }
  const d = DRIVE.exec(href)
  if (d) return { kind: 'drive', what: d[1] ? 'folder' : d[3] ? 'doc' : d[4] ? 'sheet' : d[5] ? 'slides' : 'file', href }
  const doc = DOC.exec(href)
  if (doc) return { kind: 'doc', name: decodeURIComponent(doc[1]), ext: doc[2].toLowerCase(), href }
  let where = href
  try { const u = new URL(href); where = u.host.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : '') } catch { /* keep the raw string */ }
  return { kind: 'link', where: where.length > 72 ? `${where.slice(0, 70)}…` : where, href }
}

const DRIVE_WORD = { folder: () => tx('Folder'), doc: () => tx('Document'), sheet: () => tx('Spreadsheet'), slides: () => tx('Slides'), file: () => tx('File') }
const DRIVE_ICON = { folder: Folder, doc: FileText, sheet: Table2, slides: Presentation, file: File }

function Body({ info }) {
  if (info.kind === 'image') return <img className="hp-img" src={info.src} alt="" />
  if (info.kind === 'youtube') {
    return (<>
      <div className="hp-media"><img src={`https://img.youtube.com/vi/${info.id}/hqdefault.jpg`} alt="" /><Play size={30} className="hp-play" /></div>
      <div className="hp-line"><Play size={14} /><b>YouTube</b><span>{info.id}</span></div>
    </>)
  }
  if (info.kind === 'drive') {
    const Icon = DRIVE_ICON[info.what]
    return <div className="hp-line"><Icon size={16} /><b>Google Drive</b><span>{DRIVE_WORD[info.what]()}</span></div>
  }
  if (info.kind === 'doc') return <div className="hp-line"><FileText size={16} /><b>{info.ext.toUpperCase()}</b><span>{info.name}</span></div>
  return <div className="hp-line"><ExternalLink size={14} /><span>{info.where}</span></div>
}

export default function HoverPreview() {
  const [show, setShow] = useState(null) // { info, x, y }
  const timer = useRef(null)
  const target = useRef(null)
  useEffect(() => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches) return undefined
    const SEL = 'a[href], img, [data-preview]'
    const cancel = () => { clearTimeout(timer.current); timer.current = null; target.current = null; setShow(null) }
    const onOver = (e) => {
      const el = e.target?.closest?.(SEL)
      if (!el || el === target.current || el.closest('.hover-preview')) return
      clearTimeout(timer.current)
      const info = describe(el)
      if (!info) { target.current = null; setShow(null); return }
      target.current = el
      const { clientX: x, clientY: y } = e
      timer.current = setTimeout(() => setShow({ info, x, y }), DELAY)
    }
    const onOut = (e) => {
      const el = e.target?.closest?.(SEL)
      if (el && el === target.current && !(e.relatedTarget && el.contains(e.relatedTarget))) cancel()
    }
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('scroll', cancel, true)
    document.addEventListener('keydown', cancel)
    document.addEventListener('mousedown', cancel)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('scroll', cancel, true)
      document.removeEventListener('keydown', cancel)
      document.removeEventListener('mousedown', cancel)
      clearTimeout(timer.current)
    }
  }, [])
  if (!show) return null
  const { info, x, y } = show
  const W = 340, H = info.kind === 'image' || info.kind === 'youtube' ? 260 : 56
  const left = Math.max(8, Math.min(x + 16, window.innerWidth - W - 12))
  const top = y + 22 + H > window.innerHeight ? Math.max(8, y - H - 14) : y + 22
  return createPortal(
    <div className={`hover-preview hp-${info.kind}`} style={{ left, top }} role="tooltip"><Body info={info} /></div>,
    document.body,
  )
}
