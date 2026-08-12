import { useEffect, useState } from 'react'
import { Check, AlertCircle } from 'lucide-react'
import { registerToasts } from '../lib/toast.js'

// The toast rack: solid little confirmations, bottom-right, self-dismissing.
// At most three at once — old ones make room for new. A toast can carry one
// action (Undo, mostly); those stay up longer and dismiss on use.
//
// An action toast counts itself down out loud. The server gives a move ten
// seconds to be taken back, and a button that quietly stops working is worse
// than no button — so the number on it is the number of seconds actually left.
const ACTION_MS = 10000
const PLAIN_MS = 2600

export default function Toasts() {
  const [list, setList] = useState([])
  const [, tick] = useState(0)

  useEffect(() => {
    registerToasts((text, kind, action) => {
      const id = `${Date.now()}-${Math.random()}`
      const life = action ? ACTION_MS : PLAIN_MS
      setList((prev) => [...prev.slice(-2), { id, text, kind, action, until: Date.now() + life }])
      setTimeout(() => setList((prev) => prev.filter((t) => t.id !== id)), life)
    })
    return () => registerToasts(null)
  }, [])

  // Only run a clock while something is actually counting down.
  const counting = list.some((t) => t.action)
  useEffect(() => {
    if (!counting) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [counting])

  if (list.length === 0) return null
  const use = (t) => {
    setList((prev) => prev.filter((x) => x.id !== t.id))
    t.action.onClick()
  }
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => {
        const left = t.action ? Math.max(0, Math.ceil((t.until - Date.now()) / 1000)) : 0
        return (
          <div key={t.id} className={'toast' + (t.kind === 'err' ? ' err' : '')}>
            {t.kind === 'err' ? <AlertCircle size={14} /> : <Check size={14} strokeWidth={3} />}
            {t.text}
            {t.action && (
              <button type="button" className="toast-act" onClick={() => use(t)}>
                {t.action.label} <span className="toast-count">{left}</span>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
