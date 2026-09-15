import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'

// A screenshot you can actually look at.
//
// Every photo on the board was a plain <img> with no click handler, so the
// reference somebody pasted in stayed the size of a stamp forever. The one
// place that tried — the review shot — wrapped it in <a target="_blank">,
// which for a data: URI opens a blank tab or is blocked outright.
//
// The viewer is portalled to the body on purpose: half of these photos live
// inside a modal whose body scrolls and clips, and an overlay that renders
// inside that box can only ever be as big as the box.
export default function Zoom({ src, full, alt = '', className = '', tip }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    // Capture, so Escape closes the picture rather than the window behind it.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!src) return null
  return (
    <>
      <img
        className={`zoomable${className ? ` ${className}` : ''}`}
        src={src} alt={alt} loading="lazy"
        data-tip={tip || tx('Click to see it full size')}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
      />
      {open && createPortal(
        <div className="zoom-back" onMouseDown={() => setOpen(false)}>
          <button className="zoom-close" aria-label={tx('Close')} onMouseDown={() => setOpen(false)}>
            <X size={20} />
          </button>
          <img className="zoom-img" src={full || src} alt={alt} onMouseDown={(e) => e.stopPropagation()} />
        </div>,
        document.body,
      )}
    </>
  )
}
