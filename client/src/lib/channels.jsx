import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { useAuth } from './auth.jsx'

// Sidebar channels come from the server so the admin can add/rename/reorder them.
const Ctx = createContext({ channels: [], visible: [], byKey: {}, reload: () => {} })

export function ChannelsProvider({ children }) {
  const { user } = useAuth()
  const [channels, setChannels] = useState([])

  const reload = useCallback(() => {
    if (!user) return
    api.get('/channels').then(setChannels).catch(() => {})
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
