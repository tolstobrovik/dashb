import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import Modal from './Modal.jsx'
import { tr as tx, useT } from '../lib/i18n.jsx'
import { PAGE_GUIDES } from '../lib/pageGuides.js'
import { isDeletedLabel } from '../lib/constants.js'

// The question mark on a page, and what is behind it.
//
// The stage colours used to be decoded by a strip of named dots sitting across
// the top of every calendar: six chips, always there, saying the same six
// things whether or not anybody was asking. It cost a row of the screen on
// every visit to answer a question people have once.
//
// So it moves in here, behind one small mark, together with the rest of what
// the page will and will not do. A rule the board enforces and nobody wrote
// down reads as a bug the first time it refuses somebody, and this is where it
// is written down.
export default function PageGuide({ page, statusesById }) {
  const [open, setOpen] = useState(false)
  const { lang } = useT()
  const g = PAGE_GUIDES[page]
  if (!g) return null
  const sections = g[lang] || g.en
  const stages = Object.values(statusesById || {})
    .filter((s) => s && !isDeletedLabel(s.label || ''))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
  return (
    <>
      <button type="button" className="page-help" onClick={() => setOpen(true)}
        data-tip={tx('How this page works')} aria-label={tx('How this page works')}>
        <HelpCircle size={16} />
      </button>
      {open && (
        <Modal title={tx('How this page works')} onClose={() => setOpen(false)} wide footer={
          <button className="btn btn-primary" onClick={() => setOpen(false)}>{tx('Got it')}</button>
        }>
          <div className="sp-guide">
            {sections.map((s) => (
              <section key={s.h}>
                <h4>{s.h}</h4>
                {(s.p || []).map((line) => <p key={line}>{line}</p>)}
              </section>
            ))}
            {stages.length > 1 && (
              <section>
                <h4>{tx('The stages')}</h4>
                <div className="guide-stages">
                  {stages.map((s) => (
                    <span key={s.id} className="chip st-legend">
                      <i className="dot" style={{ background: s.color }} />{s.label}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
