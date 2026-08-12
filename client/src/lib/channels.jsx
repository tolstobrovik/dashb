import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, cache } from './api.js'
import { useAuth } from './auth.jsx'

// Sidebar channels come from the server so the admin can add/rename/reorder them.
const Ctx = createContext({ channels: [], visible: [], byKey: {}, reload: () => {} })

export function ChannelsProvider({ children }) {
  const { user } = useAuth()
  // Boot from the cached list (instant sidebar + home redirect), then refresh.
  // This provider wraps EVERY page, so anything it renders that is not a list
  // is not one broken page — it is the whole dashboard, on every reload for as
  // long as the cache holds it. It therefore trusts nothing: not the cache it
  // wrote, and not the answer it is handed.
  const asList = (v) => (Array.isArray(v) ? v : [])
  const [channels, setChannels] = useState(() => asList(cache.get('channels')))

  const reload = useCallback(() => {
    if (!user) return
    api.get('/channels').then((list) => {
      if (!Array.isArray(list)) return // keep the last good list rather than break
      setChannels(list)
      cache.set('channels', list)
    }).catch(() => {})
  }, [user])

  useEffect(() => { reload() }, [reload])

  const value = useMemo(() => {
    const byKey = Object.fromEntries(channels.map((c) => [c.key, c]))
    const visible = !user
      ? []
      : user.role === 'admin'
        ? channels
        : channels.filter((c) => user.departments.includes(c.key))
    return { channels, visible, byKey, reload }
  }, [channels, user])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useChannels = () => useContext(Ctx)
