import { createContext, useContext, useEffect, useState } from 'react'
import { api, cache, setToken, getToken } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // Returning visitors paint instantly: the last known profile renders the
  // app shell right away while /auth/me revalidates in the background.
  const [user, setUser] = useState(() => (getToken() ? cache.get('me') : null))
  const [loading, setLoading] = useState(() => !!getToken() && !cache.get('me'))

  const rememberUser = (u) => {
    setUser(u)
    cache.set('me', u)
  }

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    // Only a real "not you" (401) ends the session. A flaky network or a
    // slow server cold-start must NOT log anyone out — retry a couple of
    // times and keep the token either way.
    ;(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { user } = await api.get('/auth/me')
          rememberUser(user)
          break
        } catch (e) {
          if (e.status === 401) { // token already cleared by api.js
            cache.clear()
            setUser(null)
            break
          }
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
        }
      }
      setLoading(false)
    })()
  }, [])

  const login = async (username, password, remember = true) => {
    const { token, user } = await api.post('/auth/login', { username, password, remember })
    cache.clear() // never show a previous account's cached data
    setToken(token, remember)
    rememberUser(user)
    return user
  }

  const logout = () => {
    setToken(null)
    cache.clear()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, setUser: rememberUser, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
