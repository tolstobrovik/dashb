import { useEffect, useState } from 'react'

// The build this bundle was made from, stamped in by Vite. Shown in the app so
// "is the new version live yet?" is a question you can answer by looking.
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'

// Long-lived tabs keep running the build they loaded — polling keeps the DATA
// fresh, but fixes to the app itself never arrive until someone reloads.
// This watches the served index.html for a new asset hash and reloads the tab
// at a harmless moment: when it goes to the background, and never while a
// modal is open (nothing typed is ever lost).
//
// It also SAYS when a new build is waiting, and returns the means to take it
// now. Waiting for the tab to be backgrounded is right for a desk, where tabs
// are left open for days; it is wrong for somebody holding a phone, staring
// at the screen, wondering why the thing they were told shipped is not there.
export function useAutoUpdate() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let current = null
    let pending = false

    const check = async () => {
      try {
        const res = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } })
        const hash = (await res.text()).match(/\/assets\/index-[\w-]+\.js/)?.[0]
        if (!hash) return // dev server — nothing to compare
        if (current === null) current = hash
        else if (hash !== current) { pending = true; setReady(true) }
      } catch { /* offline — try again later */ }
    }

    const maybeReload = () => {
      if (!pending || document.visibilityState !== 'hidden') return
      if (document.querySelector('.modal-backdrop')) return // unsaved work on screen
      location.reload()
    }

    // Recheck every few minutes and whenever the tab slips to the background —
    // the moment nobody is looking is exactly the right time to swap builds.
    const onVisibility = () => { check().then(maybeReload) }
    const id = setInterval(onVisibility, 5 * 60 * 1000)
    check()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisibility) }
  }, [])
  return { ready, take: () => location.reload() }
}
