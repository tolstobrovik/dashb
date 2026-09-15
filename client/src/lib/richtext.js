// A very small amount of formatting, for places where one line was not enough.
//
// The org board's role cards had a single-line Note, so a job that really is
// "owns the channel; plans, produces, publishes; measured on views" arrived as
// one grey run-on sentence nobody reads. The answer is NOT a rich-text editor:
// a card 190px wide has no room for headings, links, colours or tables, and an
// editor that offers them invites a card that cannot be read at a glance.
//
// So: two marks, and nothing else.
//
//   **bold**            a word, or a line used as a little heading
//   - a line like this  a bullet
//
// Stored as PLAIN TEXT — what the person typed, byte for byte. That matters
// for three reasons: an existing one-line note is already valid and renders
// exactly as it did; the server keeps validating a string rather than trusting
// a shape; and nothing here is ever fed to innerHTML, because this file builds
// React elements and React escapes everything it is handed.
import { createElement as h } from 'react'

const BULLET = /^\s*[-*•]\s+(.*)$/

// `**…**` → bold runs. Anything unmatched stays literal, so a lone pair of
// asterisks is just asterisks rather than a piece of the note disappearing.
export function inlineSpans(s) {
  const out = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) })
    out.push({ t: m[1], b: true })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ t: s.slice(last) })
  return out.length ? out : [{ t: '' }]
}

// Lines in, blocks out. Consecutive bullets gather into one list so they draw
// as a list; every other non-empty line is its own line, which is what makes
// "NOTES in one line" still work in the same box as a list of duties.
export function parseRich(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let list = null
  const flush = () => { if (list) { blocks.push({ type: 'ul', items: list }); list = null } }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = BULLET.exec(line)
    if (bullet) {
      if (!list) list = []
      list.push(inlineSpans(bullet[1]))
    } else if (!line.trim()) {
      flush()
    } else {
      flush()
      blocks.push({ type: 'p', spans: inlineSpans(line) })
    }
  }
  flush()
  return blocks
}

// True when the text uses nothing but plain lines — lets a caller keep the
// old, tighter single-line look for the notes that never grew into a list.
export const isPlain = (src) => !/(^|\n)\s*[-*•]\s+/.test(String(src || '')) && !/\*\*/.test(String(src || ''))

const spansOf = (spans, key) => spans.map((s, i) => (s.b
  ? h('b', { key: `${key}b${i}` }, s.t)
  : h('span', { key: `${key}s${i}` }, s.t)))

// The renderer. `className` lands on the wrapper so the card and the editor's
// preview can size the same markup differently.
export function Rich({ text, className }) {
  const blocks = parseRich(text)
  if (!blocks.length) return null
  return h('div', { className }, blocks.map((b, i) => (b.type === 'ul'
    ? h('ul', { key: i }, b.items.map((it, j) => h('li', { key: j }, spansOf(it, `${i}-${j}`))))
    : h('p', { key: i }, spansOf(b.spans, String(i))))))
}

export default Rich
