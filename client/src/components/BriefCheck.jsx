import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { api } from '../lib/api.js'
import { tr as tx, lang } from '../lib/i18n.jsx'

// A second pair of eyes on a brief, while it is being typed.
//
// Every wall on this board asks whether a field is EMPTY, because that is the
// only question a column can answer. So every wall is passed by typing a full
// stop. The save-time check catches the worst of it — "." and "N/A" — but it
// runs at the end, when the person has moved on, and it can only ever say the
// one thing a regular expression knows how to say.
//
// This runs while they are still here, which is the only moment the answer is
// cheap to act on, and it can say the useful thing: not "this box is empty"
// but "nobody reading this knows where you are filming or how long it should
// be". That question has no schema. It needs reading.
//
// Three rules it holds to:
//
//   silent when there is nothing to say. A brief that is fine gets no badge,
//   no tick, no "looks good!" — the reward for writing a good brief is that
//   nothing happens.
//
//   it advises, it never blocks. Save is not touched. Somebody writing in
//   shorthand their own crew reads fluently should not have to argue with a
//   model about it, and a board that refuses work when the model is down is a
//   board that is down.
//
//   it works with no key at all. The mechanical half — placeholders, four
//   words, keyboard mash, a bare link — is deterministic and free, and it is
//   most of what actually gets typed. The model adds the reading on top when
//   somebody has set one up.

// A one-word placeholder is the whole point of this component, so the gate
// cannot be a word count — "asdf" would never be looked at. It is time
// instead: somebody composing a brief types a word every half second, so
// two and a half seconds of silence over a short box means they have stopped
// and meant it, while a brief with some length to it is judged as soon as
// they pause. Nobody is told their half-typed sentence is too short.
const MIN_CHARS = 2
const IDLE_LONG = 2500
const IDLE_SHORT = 900

// role="status" is the whole of the announcement: the note sits directly
// under the box it is about, so naming the field again would read it twice.
export default function BriefCheck({ text, kind = 'video' }) {
  const [out, setOut] = useState(null)
  const [busy, setBusy] = useState(false)
  const seen = useRef('')

  useEffect(() => {
    const src = String(text || '').trim()
    // Nothing worth asking about: an empty box, or one already judged.
    if (src.length < MIN_CHARS) { setOut(null); return }
    if (src === seen.current) return

    let alive = true
    const words = src.split(/\s+/).filter(Boolean).length
    const timer = setTimeout(() => {
      seen.current = src
      setBusy(true)
      api.post('/ai/review', { text: src, kind, lang: lang() })
        .then((d) => { if (alive) setOut(d) })
        .catch(() => { if (alive) setOut(null) })
        .finally(() => { if (alive) setBusy(false) })
    }, words < 6 ? IDLE_LONG : IDLE_SHORT)
    return () => { alive = false; clearTimeout(timer) }
  }, [text, kind])

  if (busy && !out) return null
  if (!out || out.verdict === 'ok') return null

  const bad = out.verdict === 'bad'
  // The mechanical flags are specific and always true; the model's sentence is
  // a reading. The specific one leads.
  const lead = out.flags?.[0]?.say || out.say
  const rest = out.missing || []

  return (
    <div className={'brief-check' + (bad ? ' bc-bad' : '')} role="status">
      <span className="bc-mark">{bad ? <AlertTriangle size={14} /> : <Sparkles size={14} />}</span>
      <div>
        <b>{lead}</b>
        {rest.length > 0 && (
          <ul>{rest.map((m, i) => <li key={i}>{m}</li>)}</ul>
        )}
        {out.provider && out.provider !== 'rules' && (
          <span className="bc-by">{tx('Read by the assistant — it advises, it does not decide')}</span>
        )}
      </div>
    </div>
  )
}
