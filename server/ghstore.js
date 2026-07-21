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

export function createGhStore({ token, repo, branch, path }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'satashkent-dashboard',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  let fileSha = null // blob sha of the database file at our last sync
  let etag = null    // ETag of the last contents download → free 304 checks

  const gh = async (method, url, body, accept = 'application/vnd.github+json', extra) => {
    const res = await fetch(`${API}${url}`, {
      method,
      headers: {
        ...headers,
        Accept: accept,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(extra || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    return res
  }

  const readJson = async (res) => {
    try { return await res.json() } catch { return {} }
  }

  // Current head of the data branch, or null if the branch doesn't exist yet.
  async function branchHead() {
    const res = await gh('GET', `/repos/${repo}/git/ref/heads/${branch}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`ref read failed (${res.status})`)
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
      if (!res.ok) throw new Error(`data download failed (${res.status})`)
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
        if (!raw.ok) throw new Error(`blob download failed (${raw.status})`)
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
      if (!res.ok) throw new Error(`data upload failed (${res.status}): ${JSON.stringify(await readJson(res)).slice(0, 200)}`)
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
      if (!mainRes.ok) throw new Error(`cannot read default branch (${mainRes.status})`)
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
