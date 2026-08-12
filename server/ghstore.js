// GitHub-as-storage: keeps the SQLite database file on a branch of the app's
// own repository, synced through the GitHub Contents API. This gives a small
// team durable data with zero external services — the repo IS the database.
//
// Consistency model: optimistic concurrency on the file's blob sha. Every
// flush uploads the whole database file with the sha we last saw; if another
// instance got there first GitHub answers 409/422, we download the fresh
// copy, replay our unflushed statements on top of it, and try again.
//
// Read model: one conditional GET per pull. The ETag from the last download
// makes the no-change case a 304 — which GitHub serves fast and does NOT
// count against the API rate limit — and the changed case returns blob sha
// and content together in a single response (files ≤ 1 MB; bigger databases
// fall back to one extra blob download).
const API = process.env.GITHUB_API_BASE || 'https://api.github.com'

// GitHub says "403" for two completely different things: a credential it will
// not accept, and a deployment it wants to slow down. Telling them apart is
// the difference between "issue a new token" (an afternoon of work, and the
// old token was fine) and "wait a moment" (which the app can do by itself).
// A rate limit announces itself: Retry-After, an exhausted budget, or plain
// words in the body.
const isRateLimit = (res, bodyText = '') =>
  (res.status === 403 || res.status === 429) && (
    Number(res.headers.get('retry-after')) > 0 ||
    res.headers.get('x-ratelimit-remaining') === '0' ||
    /rate limit|secondary|abuse/i.test(bodyText))

// Name the failure where anyone will read it — in the logs, in /api/health,
// and in the 503 the browser shows. The wording is load-bearing: the
// serverless entry marks a *token* refusal as NOT retryable (retrying cannot
// help) while everything else, rate limits included, stays retryable.
const hintFor = (res, bodyText = '') => {
  if (isRateLimit(res, bodyText)) {
    const after = Number(res.headers.get('retry-after')) || 0
    return ` — GitHub is rate-limiting this deployment${after ? ` (asked to wait ${after}s)` : ''}. The token is fine; the dashboard is writing faster than GitHub allows. It backs off and retries by itself.`
  }
  if (res.status === 401 || res.status === 403)
    return ' — GitHub refused the storage token (expired, revoked or lacking Contents write). Issue a new one and set GITHUB_DATA_TOKEN in the deployment’s environment.'
  return ''
}
const authHint = (res) => (typeof res === 'number' ? '' : hintFor(res))

export function createGhStore({ token, repo, branch, path }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'satashkent-dashboard',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  let fileSha = null // blob sha of the database file at our last sync
  let etag = null    // ETag of the last contents download → free 304 checks

  // A request that fails on a hiccup — a 5xx, a rate-limit pause, a dropped
  // connection — is worth asking again before anyone hears about it.
  //
  // WRITES retry too, and that is safe here precisely because the upload is a
  // compare-and-swap on the file's blob sha: if the first attempt actually
  // landed and only its answer was lost, the repeat carries the now-stale sha
  // and GitHub refuses it as a conflict, which the caller already knows how to
  // handle (re-pull, replay the journal, push again). Not retrying was the
  // gap: one rate-limited PUT lost the whole flush, and the team was told
  // their token had died.
  const TRANSIENT = new Set([408, 429, 500, 502, 503, 504])
  const worthRetrying = (res) => TRANSIENT.has(res.status) || isRateLimit(res)
  const gh = async (method, url, body, accept = 'application/vnd.github+json', extra) => {
    const send = () => fetch(`${API}${url}`, {
      method,
      headers: {
        ...headers,
        Accept: accept,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(extra || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    let last = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await send()
        if (!worthRetrying(res) || attempt === 2) return res
        last = res
        // GitHub says when to come back after a rate-limit pause; otherwise
        // wait a beat longer each time (with jitter, so instances don't
        // stampede the API in lockstep).
        const after = Number(res.headers.get('retry-after'))
        await new Promise((r) => setTimeout(r, after > 0 ? Math.min(after, 5) * 1000 : 200 * 2 ** attempt + Math.random() * 120))
      } catch (e) {
        if (attempt === 2) throw e
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt + Math.random() * 120))
      }
    }
    return last
  }

  const readJson = async (res) => {
    try { return await res.json() } catch { return {} }
  }

  // Current head of the data branch, or null if the branch doesn't exist yet.
  async function branchHead() {
    const res = await gh('GET', `/repos/${repo}/git/ref/heads/${branch}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`ref read failed (${res.status})${authHint(res)}`)
    return (await readJson(res)).object?.sha || null
  }

  return {
    // → { changed, bytes, exists } — bytes only when the remote moved since
    // last sync. One request in every case that matters: 304 when nothing
    // changed, sha + base64 content in the same response when it did.
    async pull() {
      const res = await gh('GET', `/repos/${repo}/contents/${path}?ref=${branch}`, null,
        'application/vnd.github.object+json', etag ? { 'If-None-Match': etag } : undefined)
      if (res.status === 304) return { changed: false, bytes: null, exists: true }
      if (res.status === 404) {
        etag = null
        return { changed: false, bytes: null, exists: false }
      }
      if (!res.ok) throw new Error(`data download failed (${res.status})${authHint(res)}`)
      const json = await readJson(res)
      const freshEtag = res.headers.get('etag')
      if (json.sha && json.sha === fileSha) {
        // Same blob as our working copy (typically right after our own push,
        // when the old ETag no longer matches) — nothing to apply.
        etag = freshEtag || etag
        return { changed: false, bytes: null, exists: true }
      }
      let bytes
      if (json.encoding === 'base64' && json.content) {
        bytes = Buffer.from(json.content, 'base64')
      } else {
        // Databases over 1 MB come back without inline content — fetch the
        // blob directly (works up to 100 MB).
        const raw = await gh('GET', `/repos/${repo}/git/blobs/${json.sha}`, null, 'application/vnd.github.raw+json')
        if (!raw.ok) throw new Error(`blob download failed (${raw.status})${authHint(raw)}`)
        bytes = Buffer.from(await raw.arrayBuffer())
      }
      fileSha = json.sha
      etag = freshEtag
      return { changed: true, bytes, exists: true }
    },

    // Upload the current database file. Returns true on success, 'conflict'
    // when someone else wrote in between (caller re-pulls, replays, retries).
    async push(bytes) {
      const body = {
        message: 'satashkent data update',
        content: Buffer.from(bytes).toString('base64'),
        branch,
        ...(fileSha ? { sha: fileSha } : {}),
      }
      const res = await gh('PUT', `/repos/${repo}/contents/${path}`, body)
      if (res.status === 409 || res.status === 422) return 'conflict'
      if (!res.ok) {
        const detail = JSON.stringify(await readJson(res)).slice(0, 200)
        throw new Error(`data upload failed (${res.status})${hintFor(res, detail)}: ${detail}`)
      }
      const out = await readJson(res)
      fileSha = out.content?.sha || fileSha
      return true
    },

    // Make sure the data branch exists (created from the default branch).
    async ensureBranch() {
      if (await branchHead()) return
      const repoRes = await gh('GET', `/repos/${repo}`)
      const defaultBranch = (await readJson(repoRes)).default_branch || 'main'
      const mainRes = await gh('GET', `/repos/${repo}/git/ref/heads/${defaultBranch}`)
      if (!mainRes.ok) throw new Error(`cannot read default branch (${mainRes.status})${authHint(mainRes)}`)
      const sha = (await readJson(mainRes)).object.sha
      const mk = await gh('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha })
      if (!mk.ok && mk.status !== 422) throw new Error(`cannot create data branch (${mk.status})`)
    },

    // Drop the caches so the next pull re-reads everything.
    invalidate() { etag = null },

    // Rewrite the data branch to a single fresh commit (the nightly cron calls
    // this) so the repository never accumulates one commit per write. Another
    // instance writing mid-squash just gets a normal conflict and self-heals.
    async squash(bytes) {
      await gh('DELETE', `/repos/${repo}/git/refs/heads/${branch}`)
      etag = null
      fileSha = null
      await this.ensureBranch()
      return this.push(bytes)
    },
  }
}
