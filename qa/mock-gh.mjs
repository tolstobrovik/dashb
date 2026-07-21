// Mock GitHub API for testing the GitHub-as-database driver offline.
// Speaks the exact subset ghstore.js uses: ref read/create/delete, contents
// GET (object media type with ETag/304 + raw), contents PUT with sha CAS,
// blob raw GET, trees. Counts calls per category so tests can assert how many
// requests an operation costs. Control endpoints: GET /__calls, POST /__reset.
import http from 'http'
import { createHash } from 'crypto'

const PORT = Number(process.env.MOCK_PORT || 9977)
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex')

// state
let branches = { main: { head: 'commit-main-0' } } // name -> { head }
let file = null      // { bytes, blobSha } on the appdata branch
let commitN = 0
let etagN = 0
let currentEtag = null // etag of the current contents state
let calls = {}
let outage = false
const count = (k) => { calls[k] = (calls[k] || 0) + 1 }
const bumpEtag = () => { currentEtag = `"etag-${++etagN}"` }
bumpEtag()

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
    const url = new URL(req.url, 'http://x')
    const p = url.pathname
    const send = (status, data, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      res.end(data === undefined ? '' : (Buffer.isBuffer(data) ? data : JSON.stringify(data)))
    }

    // --- control ---
    if (p === '/__calls') return send(200, calls)
    if (p === '/__reset' && req.method === 'POST') { calls = {}; return send(200, { ok: true }) }
    // Simulate a GitHub outage: every API request answers 500 while on.
    if (p === '/__outage' && req.method === 'POST') { outage = !!body?.on; return send(200, { outage }) }
    if (outage) { count('outage-500'); return send(500, { message: 'Server Error (simulated outage)' }) }

    // --- refs ---
    let m = p.match(/^\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/(.+)$/)
    if (m && req.method === 'GET') {
      count('ref-get')
      const b = branches[m[1]]
      return b ? send(200, { object: { sha: b.head } }) : send(404, { message: 'Not Found' })
    }
    m = p.match(/^\/repos\/[^/]+\/[^/]+\/git\/refs\/heads\/(.+)$/)
    if (m && req.method === 'DELETE') {
      count('ref-delete')
      delete branches[m[1]]
      if (m[1] !== 'main') { file = null; bumpEtag() }
      return send(204)
    }
    if (p.match(/^\/repos\/[^/]+\/[^/]+\/git\/refs$/) && req.method === 'POST') {
      count('ref-create')
      const name = body.ref.replace('refs/heads/', '')
      if (branches[name]) return send(422, { message: 'Reference already exists' })
      branches[name] = { head: body.sha }
      return send(201, { object: { sha: body.sha } })
    }

    // --- repo meta ---
    if (p.match(/^\/repos\/[^/]+\/[^/]+$/) && req.method === 'GET') {
      count('repo-get')
      return send(200, { default_branch: 'main' })
    }

    // --- trees (legacy path, kept for completeness) ---
    m = p.match(/^\/repos\/[^/]+\/[^/]+\/git\/trees\/(.+)$/)
    if (m && req.method === 'GET') {
      count('tree-get')
      return send(200, { tree: file ? [{ path: 'data/dashboard.db', sha: file.blobSha }] : [] })
    }

    // --- blobs (the >1MB fallback) ---
    m = p.match(/^\/repos\/[^/]+\/[^/]+\/git\/blobs\/(.+)$/)
    if (m && req.method === 'GET') {
      count('blob-get')
      if (!file || file.blobSha !== m[1]) return send(404, { message: 'Not Found' })
      return send(200, file.bytes, { 'Content-Type': 'application/octet-stream' })
    }

    // --- contents ---
    m = p.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/)
    if (m && req.method === 'GET') {
      count('contents-get')
      const branch = url.searchParams.get('ref') || 'main'
      if (!branches[branch] || !file) return send(404, { message: 'Not Found' })
      const inm = req.headers['if-none-match']
      if (inm && inm === currentEtag) return send(304, undefined, { ETag: currentEtag })
      const accept = req.headers.accept || ''
      if (accept.includes('raw')) return send(200, file.bytes, { 'Content-Type': 'application/octet-stream', ETag: currentEtag })
      const big = file.bytes.length > 1024 * 1024
      return send(200, {
        sha: file.blobSha,
        size: file.bytes.length,
        encoding: big ? 'none' : 'base64',
        content: big ? '' : file.bytes.toString('base64'),
      }, { ETag: currentEtag })
    }
    if (m && req.method === 'PUT') {
      count('contents-put')
      const branch = body.branch
      if (!branches[branch]) return send(404, { message: 'Branch not found' })
      // compare-and-swap on the blob sha
      if (file && body.sha !== file.blobSha) return send(409, { message: 'sha mismatch' })
      if (!file && body.sha) return send(422, { message: 'sha provided but file does not exist' })
      const bytes = Buffer.from(body.content, 'base64')
      file = { bytes, blobSha: sha1(bytes) }
      branches[branch].head = `commit-${++commitN}`
      bumpEtag()
      return send(body.sha ? 200 : 201, { content: { sha: file.blobSha }, commit: { sha: branches[branch].head } })
    }

    send(404, { message: `unhandled ${req.method} ${p}` })
  })
})

server.listen(PORT, () => console.log(`mock github on :${PORT}`))
