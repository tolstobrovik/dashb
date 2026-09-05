import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, cache } from './api.js'
import { useAuth } from './auth.jsx'

// Which pages this board shows, as the admin set them (Admin → Settings).
//
// It boots from the cache so the sidebar paints with the right doors on it
// rather than drawing a page and taking it away a moment later, then refreshes.
// Like the channels provider this one wraps EVERY page, so it trusts nothing:
// a bad cache or a bad answer leaves every page ON, which is the state that
// cannot strand anybody.
const ALL_ON = {}
const Ctx = createContext({ pages: ALL_ON, shows: () => true, reload: () => {} })

export function PagesProvider({ children }) {
  const { user } = useAuth()
  const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : ALL_ON)
  const [pages, setPages] = useState(() => asObj(cache.get('page_rules')))

  const reload = useCallback(() => {
    if (!user) return
    api.get('/fields').then((f) => {
      const p = asObj(f?.pages)
      setPages(p)
      cache.set('page_rules', p)
    }).catch(() => {})
  }, [user])

  useEffect(() => { reload() }, [reload])

  const value = useMemo(() => ({
    pages,
    // Unknown keys are shown. A page the server has not heard of is a page
    // this build added, not one an admin switched off.
    shows: (key) => pages[key] !== false,
    reload,
  }), [pages, reload])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const usePages = () => useContext(Ctx)
