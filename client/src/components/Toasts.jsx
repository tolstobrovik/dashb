import { useEffect, useState } from 'react'
import { Check, AlertCircle } from 'lucide-react'
import { registerToasts } from '../lib/toast.js'

// The toast rack: solid little confirmations, bottom-right, self-dismissing.
// At most three at once — old ones make room for new. A toast can carry one
// action (Undo, mostly); those stay up longer and dismiss on use.
export default function Toasts() {
  const [list, setList] = useState([])
  useEffect(() => {
    registerToasts((text, kind, action) => {
      const id = `${Date.now()}-${Math.random()}`
      setList((prev) => [...prev.slice(-2), { id, text, kind, action }])
      setTimeout(() => setList((prev) => prev.filter((t) => t.id !== id)), action ? 6000 : 2600)
    })
    return () => registerToasts(null)
  }, [])
  if (list.length === 0) return null
  const use = (t) => {
    setList((prev) => prev.filter((x) => x.id !== t.id))
    t.action.onClick()
  }
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={'toast' + (t.kind === 'err' ? ' err' : '')}>
          {t.kind === 'err' ? <AlertCircle size={14} /> : <Check size={14} strokeWidth={3} />}
          {t.text}
          {t.action && (
            <button type="button" className="toast-act" onClick={() => use(t)}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  )
}
