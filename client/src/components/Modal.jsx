import { useEffect } from 'react'
import { X } from 'lucide-react'

// While a sheet is up, the page behind it does not move. On a desk that is a
// nicety; on a phone it is the difference between a sheet and a hole in the
// page — a finger that misses the form scrolls the board underneath and you
// come back to somewhere else. Counted, because a modal opens over a modal
// (the handover gate over the task sheet) and the first one to close must not
// give the scroll back while the second is still up.
let held = 0
function holdPage() {
  if (held++ === 0) document.body.classList.add('page-held')
  return () => { if (--held === 0) document.body.classList.remove('page-held') }
}

export default function Modal({ title, onClose, children, footer, wide = false, subhead = null, bodyRef = null, bodyClass = '', tall = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(holdPage, [])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal${wide ? ' modal-wide' : ''}${tall ? ' modal-tall' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} data-tip="Close" data-tip-left="" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {/* A strip that belongs to the window rather than to the form: it
            stays put while the form scrolls under it. The task sheet uses it
            on a phone to deal one long form into pages. */}
        {subhead && <div className="modal-sub">{subhead}</div>}
        <div className={'modal-body' + (bodyClass ? ' ' + bodyClass : '')} ref={bodyRef}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
