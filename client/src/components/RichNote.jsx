import { useRef } from 'react'
import { Bold, List } from 'lucide-react'
import { Rich } from '../lib/richtext.js'

// The small box the role cards' details are written in.
//
// Two buttons, because there are two marks (see lib/richtext.js). They work on
// the selection the way every editor does — press Bold with three words picked
// out and those three words go bold; press it again and they come back. The
// bullet button works on whole lines, so selecting four lines and pressing it
// makes four bullets rather than one.
//
// EDITS GO THROUGH execCommand WHERE IT IS AVAILABLE, which looks like a
// strange choice for new code and is not: it is the only way to change a
// textarea's value and leave the browser's own undo stack intact. Setting
// .value directly wipes it, and somebody who has just bulleted the wrong four
// lines wants ⌘Z to work. Where it is missing we fall back to setting the
// value, and undo is the only thing lost.
const BULLET = /^(\s*)([-*•]\s+)(.*)$/

export default function RichNote({ value, onChange, placeholder, rows = 5, preview = true }) {
  const ref = useRef(null)

  const put = (text, from, to, caret) => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(from, to)
    let ok = false
    try { ok = document.execCommand('insertText', false, text) } catch { ok = false }
    if (!ok) {
      const next = el.value.slice(0, from) + text + el.value.slice(to)
      onChange(next)
      // React owns the value, so the caret has to be put back after the render.
      requestAnimationFrame(() => {
        if (ref.current) ref.current.setSelectionRange(caret[0], caret[1])
      })
      return
    }
    onChange(el.value)
    requestAnimationFrame(() => {
      if (ref.current) ref.current.setSelectionRange(caret[0], caret[1])
    })
  }

  const bold = () => {
    const el = ref.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value: v } = el
    // Already bold? Take it off — a toggle, not a one-way trip.
    const out = v.slice(a - 2, a) === '**' && v.slice(b, b + 2) === '**'
    if (out) return put(v.slice(a, b), a - 2, b + 2, [a - 2, b - 2])
    const inner = v.slice(a, b)
    const m = /^\*\*([\s\S]+)\*\*$/.exec(inner)
    if (m) return put(m[1], a, b, [a, a + m[1].length])
    if (a === b) return put('****', a, b, [a + 2, a + 2])
    put(`**${inner}**`, a, b, [a + 2, b + 2])
  }

  const bullets = () => {
    const el = ref.current
    if (!el) return
    const { value: v } = el
    // Whole lines, however little of them was selected.
    const from = v.lastIndexOf('\n', el.selectionStart - 1) + 1
    const nl = v.indexOf('\n', el.selectionEnd)
    const to = nl === -1 ? v.length : nl
    const lines = v.slice(from, to).split('\n')
    const allBullets = lines.every((l) => !l.trim() || BULLET.test(l))
    const next = lines.map((l) => {
      if (!l.trim()) return l
      const m = BULLET.exec(l)
      if (allBullets && m) return m[1] + m[3]
      return m ? l : `- ${l}`
    }).join('\n')
    put(next, from, to, [from, from + next.length])
  }

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); bold(); return }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === '8') { e.preventDefault(); bullets(); return }
    if (e.key !== 'Enter' || e.shiftKey) return
    // Enter inside a list carries the list on, which is the whole reason a
    // list is quick to type. Enter on an EMPTY bullet ends it instead — the
    // universal way out, and without it the only escape is backspacing a
    // marker the editor just put there.
    const el = ref.current
    const { value: v, selectionStart: a } = el
    if (a !== el.selectionEnd) return
    const from = v.lastIndexOf('\n', a - 1) + 1
    const m = BULLET.exec(v.slice(from, a))
    if (!m) return
    e.preventDefault()
    if (!m[3].trim()) return put('', from, a, [from, from])
    put(`\n${m[1]}${m[2]}`, a, a, [a + 1 + m[1].length + m[2].length, a + 1 + m[1].length + m[2].length])
  }

  return (
    <div className="rn">
      <div className="rn-bar">
        <button type="button" className="rn-btn" onClick={bold} data-tip="Bold (⌘B)" aria-label="Bold"><Bold size={13} /></button>
        <button type="button" className="rn-btn" onClick={bullets} data-tip="Bullet list" aria-label="Bullet list"><List size={13} /></button>
        <span className="rn-hint">**bold** · start a line with - for a bullet</span>
      </div>
      <textarea
        ref={ref}
        className="input rn-area"
        rows={rows}
        value={value}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        onChange={(e) => onChange(e.target.value)}
      />
      {preview && value.trim() && (
        <div className="rn-preview">
          <span className="rn-preview-key">On the card</span>
          <Rich text={value} className="bn-rich" />
        </div>
      )}
    </div>
  )
}
