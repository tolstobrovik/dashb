import { useEffect, useRef, useState } from 'react'

// Look at a link without leaving the page.
//
// This board is mostly links: a reference on a task, a Drive folder, the cut
// an editor handed back, a published post, a contract. Checking any of them
// meant opening a tab, looking, and coming back — so mostly nobody checked,
// and a wrong link sat on a task until somebody tried to use it.
//
// Hovering shows the thing. One component for every kind, because a preview
// that works on some links and not others is one nobody trusts:
//
//   image     drawn straight
//   youtube   its poster frame, from the video id
//   drive     the file's own thumbnail, when Drive will give one
//   pdf       the first page, in a frame
//   anything  the address, spelled out, big enough to read
//
// DELAYED on purpose. A popover that appears the instant a cursor crosses a
// link is a popover that appears while you are moving the cursor somewhere
// else — the delay is what separates "I am looking at this" from "I passed
// over it".
const WAIT = 420

const YT = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i
const DRIVE = /drive\.google\.com\/(?:file\/d\/([\w-]{10,})|open\?id=([\w-]{10,}))/i
const IMG = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i
const PDF = /\.pdf(\?|$)/i

// What we can show for this address, worked out once.
export function previewOf(raw) {
  const url = String(raw || '').trim()
  if (!url) return null
  if (url.startsWith('data:image/')) return { kind: 'image', src: url, url }
  let u
  try { u = new URL(url) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null

  const yt = url.match(YT)
  if (yt) return { kind: 'video', src: `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`, url, note: 'YouTube' }
  const dr = url.match(DRIVE)
  if (dr) {
    const id = dr[1] || dr[2]
    return { kind: 'drive', src: `https://drive.google.com/thumbnail?id=${id}&sz=w640`, url, note: 'Google Drive' }
  }
  if (IMG.test(u.pathname)) return { kind: 'image', src: url, url }
  if (PDF.test(u.pathname)) return { kind: 'pdf', src: url, url, note: 'PDF' }
  return { kind: 'link', url, note: u.hostname.replace(/^www\./, '') }
}

// Wrap anything. `href` is what to preview; the children are what you hover.
export default function HoverPreview({ href, children, className = '', as: Tag = 'span' }) {
  const info = previewOf(href)
  const [at, setAt] = useState(null)      // { x, y } once it is open
  const [broke, setBroke] = useState(false)
  const timer = useRef(null)
  const box = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])
  if (!info) return <Tag className={className}>{children}</Tag>

  const enter = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { setBroke(false); setAt({ x: r.left, y: r.bottom }) }, WAIT)
  }
  const leave = () => { clearTimeout(timer.current); setAt(null) }

  // Kept inside the window: a preview half off the right edge is worse than
  // none, and the thing it is about is usually near an edge.
  const W = 340
  const style = at ? {
    left: Math.max(8, Math.min(at.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - W - 8)),
    top: at.y + 8,
    width: W,
  } : null

  return (
    <Tag className={className} onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}>
      {children}
      {at && (
        <span className="hp-pop" style={style} ref={box} role="tooltip">
          {info.src && !broke ? (
            info.kind === 'pdf'
              ? <iframe className="hp-frame" src={info.src} title={info.url} />
              : <img className="hp-img" src={info.src} alt="" onError={() => setBroke(true)} />
          ) : null}
          <span className="hp-meta">
            {info.note && <b className="hp-note">{info.note}</b>}
            <span className="hp-url">{info.url}</span>
          </span>
        </span>
      )}
    </Tag>
  )
}
