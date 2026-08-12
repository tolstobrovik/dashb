import { useEffect, useState } from 'react'

// Full-screen mode for a workspace section: the wrapped block expands over
// the whole viewport (sidebar and all), Esc brings the page back.
export function useFullscreen() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!on) return
    const onKey = (e) => { if (e.key === 'Escape') setOn(false) }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [on])
  return [on, setOn]
}
