import { useEffect, useState } from 'react'
import { Languages, WandSparkles, X, Loader2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { useT, tr as tx } from '../lib/i18n.jsx'

// Two questions a person has about somebody else's ТЗ, and a button for each.
//
//   "I cannot read this"       — it is in Russian and they read Uzbek
//   "I cannot follow this"     — it is in their language and still a wall
//
// THE ORIGINAL IS NEVER TOUCHED. The answer appears underneath, in its own
// panel, and the field above it keeps whatever the author wrote. A brief is a
// work order: a machine may help somebody read it, and must not quietly
// become it. Closing the panel is the only way it goes away, and nothing is
// saved to the task.
//
// Translate is only OFFERED when it would do something — the text is asked
// what language it is in first, and a brief already in the reader's language
// gets no button. Explain is always offered, because a wall of text is a wall
// in any language.

const PROVIDER_NOTE = {
  // The one that matters: no model was reachable, so this is not a rewrite —
  // it is the mechanical part of readability. Saying so is the difference
  // between a helpful tool and a lying one.
  plain: 'Simple version — sentences split and terms spelled out. No AI was available, so nothing was reworded.',
  google: 'Machine translation',
  mymemory: 'Machine translation',
}

export default function TextHelp({ text, label }) {
  const { lang } = useT()
  const [src, setSrc] = useState(null)      // the language the text is in
  const [busy, setBusy] = useState('')      // '' | 'translate' | 'simplify'
  const [out, setOut] = useState(null)      // { text, provider, kind }
  const [err, setErr] = useState('')

  const body = String(text || '').trim()
  useEffect(() => {
    setOut(null); setErr('')
    if (!body) { setSrc(null); return }
    let alive = true
    api.post('/ai/detect', { text: body })
      .then((d) => { if (alive) setSrc(d.lang) })
      .catch(() => { if (alive) setSrc(null) })
    return () => { alive = false }
  }, [body])

  if (!body) return null
  const canTranslate = src && src !== lang

  const run = async (kind) => {
    setBusy(kind); setErr(''); setOut(null)
    try {
      const d = kind === 'translate'
        ? await api.post('/ai/translate', { text: body, to: lang, from: src })
        : await api.post('/ai/simplify', { text: body, lang })
      setOut({ ...d, kind })
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  return (
    <div className="txh">
      <div className="txh-bar">
        {canTranslate && (
          <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => run('translate')}
            data-tip={tx('Read it in your language — the original stays as it is')}>
            {busy === 'translate' ? <Loader2 size={13} className="txh-spin" /> : <Languages size={13} />}
            {' '}{tx('Translate')}
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => run('simplify')}
          data-tip={tx('Shorter sentences, one instruction per line')}>
          {busy === 'simplify' ? <Loader2 size={13} className="txh-spin" /> : <WandSparkles size={13} />}
          {' '}{tx('Explain simply')}
        </button>
        {err && <span className="txh-err">{err}</span>}
      </div>

      {out && (
        <div className="txh-out">
          <div className="txh-head">
            <b>{out.kind === 'translate' ? tx('In your language') : tx('The simple version')}</b>
            <span className="stat-sub">
              {tx(PROVIDER_NOTE[out.provider] || 'Written by AI')}
              {out.cached ? ` · ${tx('kept from earlier')}` : ''}
            </span>
            <button type="button" className="icon-btn" onClick={() => setOut(null)}
              data-tip={tx('Close — the original is above')} aria-label={tx('Close')}>
              <X size={14} />
            </button>
          </div>
          <div className="txh-body">{out.text}</div>
          <div className="cm-hint">
            {tx('This is a reading aid. {what} on the task is unchanged.', { what: label || tx('The text') })}
          </div>
        </div>
      )}
    </div>
  )
}
