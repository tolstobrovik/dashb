import { useEffect, useState } from 'react'

// A phone is not a small desk. It is one column, a thumb at the bottom of the
// screen, and no hover at all — so the app has to take a different shape on
// it, not the same shape scaled down. 640px is the line the stylesheet already
// draws; reading it here as well keeps the markup and the CSS from ever
// disagreeing about which shape is on screen.
export const PHONE_Q = '(max-width: 640px)'

const ask = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia(PHONE_Q).matches

export function useIsPhone() {
  const [is, setIs] = useState(ask)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(PHONE_Q)
    const on = (e) => setIs(e.matches)
    setIs(mq.matches) // a rotation between first paint and this line
    // Safari before 14 has addListener and not addEventListener. The board is
    // opened on whatever phone somebody already owns.
    if (mq.addEventListener) mq.addEventListener('change', on)
    else mq.addListener(on)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on)
      else mq.removeListener(on)
    }
  }, [])
  return is
}
