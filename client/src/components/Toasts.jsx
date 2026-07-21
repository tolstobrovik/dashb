import { useEffect, useState } from 'react'
import { Check, AlertCircle } from 'lucide-react'
import { registerToasts } from '../lib/toast.js'

// The toast rack: solid little confirmations, bottom-right, self-dismissing.
// At most three at once — old ones make room for new.
export default function Toasts() {
  const [list, setList] = useState([])
  useEffect(() => {
    registerToasts((text, kind) => {
      const id = `${Date.now()}-${Math.random()}`
      setList((prev) => [...prev.slice(-2), { id, text, kind }])
      setTimeout(() => setList((prev) => prev.filter((t) => t.id !== id)), 2600)
    })
    return () => registerToasts(null)
  }, [])
  if (list.length === 0) return null
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={'toast' + (t.kind === 'err' ? ' err' : '')}>
          {t.kind === 'err' ? <AlertCircle size={14} /> : <Check size={14} strokeWidth={3} />}
          {t.text}
        </div>
      ))}
    </div>
  )
}
