const TOKEN_KEY = 'satashkent_token'

// ---- little comfort cookies (login prefill, remember-me choice) ----
export const setCookie = (name, value, days = 30) => {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${days * 86400}; samesite=lax`
  } catch { /* ok */ }
}
export const getCookie = (name) => {
  try {
    const hit = document.cookie.split('; ').find((c) => c.startsWith(name + '='))
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null
  } catch { return null }
}

// The token lives in localStorage when "remember me" is on (survives closing
// the browser, a week-long JWT), in sessionStorage otherwise (signing out
// happens by itself when the browser closes).
export const getToken = () => localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
export const setToken = (t, remember = true) => {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
  if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t)
}

// Instant-boot cache: pages render the last known data immediately and swap
// in fresh data when the network answers. Cleared on login/logout so one
// account never sees another's leftovers. Quota errors are silently ignored —
// the cache is an accelerator, never a requirement.
const CACHE_PREFIX = 'satashkent_cache:'
export const cache = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key)) } catch { return null }
  },
  set(key, value) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)) } catch { /* quota — skip */ }
  },
  clear() {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k)
      }
    } catch { /* ignore */ }
  },
}

// A serverless instance that cannot reach the data store answers 503 with
// `retryable` BEFORE the request touches anything — nothing was read, written
// or half-done, so sending it again is always safe. The wait is short and
// silent: a storage hiccup should cost a heartbeat, not somebody's typed task.
const RETRY_WAITS = [400, 1200, 2500]
async function request(path, { method = 'GET', body } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) return data
    if (res.status === 503 && data.retryable && attempt < RETRY_WAITS.length) {
      await new Promise((r) => setTimeout(r, RETRY_WAITS[attempt]))
      continue
    }
    if (res.status === 401) setToken(null)
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    err.data = data // extra payload (e.g. scheduling conflicts) for smarter UIs
    throw err
  }
}

// Short-lived GET memo with in-flight de-duplication: reference lists like the
// team roster or campaign names are fetched by every modal that opens — one
// network trip serves them all for a little while. Writes to the same path
// (post/patch/del) drop the memo so nothing stale survives an edit.
const memo = new Map() // path -> { at, promise }
const MEMO_TTL = 30000
function cachedGet(path) {
  const hit = memo.get(path)
  if (hit && Date.now() - hit.at < MEMO_TTL) return hit.promise
  const promise = request(path).catch((e) => { memo.delete(path); throw e })
  memo.set(path, { at: Date.now(), promise })
  return promise
}
const dropMemo = (path) => {
  const base = path.split('?')[0].split('/').slice(0, 2).join('/')
  for (const k of memo.keys()) if (k.startsWith(base)) memo.delete(k)
}

// ---- recent-write memory: polls must never erase what you just did ----
// On serverless hosts several instances answer in turn, and one can lag a
// few seconds behind a write. Every successful POST/PATCH/DELETE is noted
// here; when a poll body arrives, rows written in the last grace period win
// over the (possibly stale) body — so a task you just added can't vanish.
const RECENT_GRACE = 45000
const recentWrites = new Map() // `${base}:${id}` → { at, row|null }
const baseOf = (p) => '/' + p.split('?')[0].split('/').filter(Boolean)[0]
const noteWrite = (p, row) => {
  if (row && typeof row === 'object' && row.id != null && !Array.isArray(row))
    recentWrites.set(`${baseOf(p)}:${row.id}`, { at: Date.now(), row })
}
const noteDelete = (p) => {
  const parts = p.split('?')[0].split('/').filter(Boolean)
  const id = Number(parts[1])
  if (parts.length === 2 && Number.isFinite(id))
    recentWrites.set(`/${parts[0]}:${id}`, { at: Date.now(), row: null })
}
function mergeRecent(path, fresh) {
  if (!Array.isArray(fresh)) return fresh
  const base = baseOf(path)
  let out = fresh
  for (const [key, v] of recentWrites) {
    if (Date.now() - v.at > RECENT_GRACE) { recentWrites.delete(key); continue }
    const cut = key.lastIndexOf(':')
    if (key.slice(0, cut) !== base) continue
    const id = Number(key.slice(cut + 1))
    if (v.row === null) out = out.filter((x) => x.id !== id) // we deleted it
    else if (!out.some((x) => x.id === id)) out = [v.row, ...out] // stale body lost it
    else out = out.map((x) => (x.id === id ? v.row : x)) // ours is newer
  }
  return out
}

// Conditional GET for the live-sync polls: remembers the ETag per path and
// asks the server "only if it changed". Unchanged data comes back as a tiny
// 304 with no body — poll() then returns null so callers skip re-rendering.
const etags = new Map()
async function conditionalGet(path) {
  const etag = etags.get(path)
  const res = await fetch(`/api${path}`, {
    cache: 'no-store',
    headers: {
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(etag ? { 'If-None-Match': etag } : {}),
    },
  })
  if (res.status === 304) return null
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  const next = res.headers.get('ETag')
  if (next) etags.set(path, next)
  return res.json()
}
async function poll(path) {
  const fresh = await conditionalGet(path)
  return fresh === null ? null : mergeRecent(path, fresh)
}
// ETag'd poll for derived views and single objects (a revision feed, one
// campaign): the recent-write merge is for plain row lists and would splice
// foreign rows into these shapes — so it is skipped on purpose.
const pollView = conditionalGet

export const api = {
  get: (p) => request(p),
  cached: cachedGet,
  post: async (p, body) => { dropMemo(p); const r = await request(p, { method: 'POST', body }); noteWrite(p, r); return r },
  patch: async (p, body) => { dropMemo(p); const r = await request(p, { method: 'PATCH', body }); noteWrite(p, r); return r },
  del: async (p) => { dropMemo(p); const r = await request(p, { method: 'DELETE' }); noteDelete(p); return r },
  poll,
  pollView,
}
