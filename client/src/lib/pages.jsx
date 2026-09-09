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
const Ctx = createContext({ pages: ALL_ON, audience: ALL_ON, notice: null, shows: () => true, reload: () => {} })

// Who a page is for. The server stores the rule (getPageAudience in
// server/db.js) and this is the one place that applies it, so there is no
// second copy of the answer to drift.
//
// Admins always have every page. An empty audience means the page was not
// aimed at anybody in particular, which is everybody. Otherwise a member
// matches the word "member" and a crew account matches any of its
// capabilities, so a person hired as an editor AND a designer gets both
// boards without anyone having to think about the overlap.
export function openTo(user, audience) {
  if (!user) return false
  if (user.role === 'admin') return true
  if (!Array.isArray(audience) || audience.length === 0) return true
  if (audience.includes('member') && user.role === 'member') return true
  const caps = Array.isArray(user.crew_roles) ? user.crew_roles : []
  return audience.some((a) => caps.includes(a))
}

export function PagesProvider({ children }) {
  const { user } = useAuth()
  const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : ALL_ON)
  const [pages, setPages] = useState(() => asObj(cache.get('page_rules')))
  // Which account kinds each page is aimed at. Boots from the cache with the
  // switches so the sidebar paints once rather than drawing a door and taking
  // it away — and an unreadable cache leaves every page open to everyone,
  // which is the state that cannot strand anybody.
  const [audience, setAudience] = useState(() => asObj(cache.get('page_audience')))
  // The one notice an admin may put above everybody's work. It rides on the
  // same fetch, so it costs nothing and reaches the next page anybody opens.
  const asNotice = (v) => (v && typeof v === 'object' && v.text ? v : null)
  const [notice, setNotice] = useState(() => asNotice(cache.get('planned_update')))

  const reload = useCallback(() => {
    if (!user) return
    api.get('/fields').then((f) => {
      const p = asObj(f?.pages)
      setPages(p)
      cache.set('page_rules', p)
      const a = asObj(f?.page_audience)
      setAudience(a)
      cache.set('page_audience', a)
      const n = asNotice(f?.notice)
      setNotice(n)
      cache.set('planned_update', n)
    }).catch(() => {})
  }, [user])

  useEffect(() => { reload() }, [reload])

  const value = useMemo(() => ({
    pages,
    audience,
    notice,
    // Unknown keys are shown. A page the server has not heard of is a page
    // this build added, not one an admin switched off.
    //
    // Two questions, one answer: does the board have this page, and is it
    // aimed at you. Every door on the client goes through here — the sidebar,
    // the phone's More sheet, the tab bar and the route guard in App.jsx — so
    // a page that is not yours is not merely missing from the menu, its own
    // address bounces you home too.
    shows: (key) => pages[key] !== false && openTo(user, audience[key]),
    reload,
  }), [pages, audience, notice, user, reload])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const usePages = () => useContext(Ctx)
