// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Storage resilience: what the team sees when GitHub — the durable store —
// stumbles. A WARM instance always rode a blip out on its local copy; a
// process that happened to be starting answered every request "The data store
// is briefly unreachable" instead, which is what production showed. These
// pins hold the two cases together: a container that has the database keeps
// serving it, work done while blind still reaches GitHub afterwards, and a
// container with no data anywhere says so in a way the client can retry.
// Self-contained: its own mock on 9989 and instances on 4295+.
import { execSync, spawn } from 'child_process'

const MOCK = 'http://localhost:9989'
const REPO = process.env.REPO_DIR || ROOT
const SP = new URL('.', import.meta.url).pathname
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const outage = (on) => fetch(`${MOCK}/__outage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }),
})

const requireToken = (token) => fetch(`${MOCK}/__require`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
})
async function start(port, dir, env = {}) {
  const child = spawn('node', ['-e', `
    import('http').then(async ({ default: http }) => {
      const { default: handler } = await import('${REPO}/api/index.js')
      http.createServer((req, res) => handler(req, res)).listen(${port}, () => console.log('ready'))
    })
  `], {
    env: { ...process.env, GITHUB_API_BASE: MOCK, GITHUB_DATA_FORCE: '1', DATA_DIR: dir, PATH: process.env.PATH, ...env },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  procs.push(child)
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (d.toString().includes('ready')) resolve() })
    child.on('exit', (c) => reject(new Error(`instance exited ${c}`)))
    setTimeout(() => reject(new Error('start timeout')), 30000)
  })
  return {
    kill: () => new Promise((r) => { child.on('exit', r); child.kill('SIGKILL') }),
    req: async (path, { method = 'GET', body, token } = {}) => {
      const res = await fetch(`http://localhost:${port}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      let data = {}
      try { data = await res.json() } catch { /* empty */ }
      return { status: res.status, data }
    },
  }
}
const login = (i) => i.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } }).then((r) => r.data.token)

execSync('rm -rf /tmp/stg-a /tmp/stg-b /tmp/stg-c')
procs.push(spawn(process.execPath, [SP + 'mock-gh.mjs'], { env: { ...process.env, MOCK_PORT: '9989' }, stdio: 'ignore' }))
await new Promise((r) => setTimeout(r, 800))

// ---- a container that has been serving happily ----
let A = await start(4295, '/tmp/stg-a')
const T = await login(A)
await A.req('/content', { method: 'POST', token: T, body: { title: 'stg: before the storm', channels: ['youtube'], type: 'post' } })
await new Promise((r) => setTimeout(r, 700))
ok('the container holds its data', (await A.req('/content', { token: T })).data.some((c) => c.title === 'stg: before the storm'))

// ---- the process restarts mid-outage, /tmp still warm (the Vercel case) ----
await A.kill()
await outage(true)
A = await start(4296, '/tmp/stg-a')
ok('a fresh process on a warm container survives the outage', (await A.req('/health')).status === 200)
const T2 = await login(A)
ok('people still sign in while GitHub is down', !!T2)
ok('…and still read their tasks', (await A.req('/content', { token: T2 })).data.some?.((c) => c.title === 'stg: before the storm'))
const sick = (await A.req('/health')).data
ok('health names the trouble instead of hiding it', /failed/.test(sick.stale || ''), JSON.stringify(sick).slice(0, 110))
ok('…and reports what a write costs', typeof sick.bytes === 'number' && sick.bytes > 0)

// ---- work done blind must not be work lost ----
ok('a task can still be created', (await A.req('/content', {
  method: 'POST', token: T2, body: { title: 'stg: written blind', channels: ['youtube'], type: 'post' },
})).status === 201)

// ---- GitHub comes back ----
await outage(false)
await new Promise((r) => setTimeout(r, 5000)) // past the 4s sync throttle
await A.req('/content', { token: T2 })
await new Promise((r) => setTimeout(r, 1500)) // let the post-response flush land
ok('the instance reports itself current again', !(await A.req('/health')).data.stale)
const B = await start(4297, '/tmp/stg-b') // a brand-new container reads GitHub, not /tmp
const freshRes = await B.req('/content', { token: await login(B) })
const fresh = Array.isArray(freshRes.data) ? freshRes.data : [] // a bad answer fails a pin, never the run
ok('the blind write reached GitHub for everyone', fresh.some((c) => c.title === 'stg: written blind'))
ok('…and nothing older was lost', fresh.some((c) => c.title === 'stg: before the storm'))

// ---- with no copy anywhere, be honest — and let the client retry ----
await outage(true)
const C = await start(4298, '/tmp/stg-c')
const nothing = await C.req('/health')
ok('an empty container says so, retryably', nothing.status === 503 && nothing.data.retryable === true, JSON.stringify(nothing.data).slice(0, 90))
await outage(false)
ok('…and heals itself on the next request once GitHub answers', (await C.req('/health')).status === 200)

// ---- a refused token is not a blip: it says so, and asks not to be retried ----
execSync('rm -rf /tmp/stg-d /tmp/stg-e')
await requireToken('THE-GOOD-TOKEN')
const D = await start(4299, '/tmp/stg-d')
const locked = await D.req('/health')
ok('a refused token names itself', locked.status === 503 && /refused the storage token/.test(JSON.stringify(locked.data)),
  JSON.stringify(locked.data).slice(0, 120))
ok('…and asks not to be retried — waiting cannot mend it', locked.data.retryable === false)
// Locked out is exactly when /api/health cannot be reached to ask what the
// app is configured with — so the refusal carries that itself.
// This tree carries the token-free placeholder, so the honest answer here is
// "missing, from config.js" — the very reading that tells an admin their new
// environment variable never arrived.
ok('…and still says which token it is using', locked.data.config?.token_from === 'config.js' && locked.data.config?.token === 'missing',
  JSON.stringify(locked.data.config))
ok('…naming the repository, never the secret', locked.data.config?.repo === 'tolstobrovik/marketing-dashboard' &&
  !/REPLACE_WITH|THE-GOOD-TOKEN/.test(JSON.stringify(locked.data)))

// ---- a fresh token from the environment takes over, no commit needed ----
const E = await start(4300, '/tmp/stg-e', { GITHUB_DATA_TOKEN: 'THE-GOOD-TOKEN' })
const healed = await E.req('/health')
ok('a token from the environment brings storage back', healed.status === 200 && healed.data.storage === 'github', JSON.stringify(healed.data).slice(0, 110))
ok('…and health says where it came from', healed.data.token === 'set' && healed.data.token_from === 'environment')
ok('…naming the repository it writes to', !!healed.data.repo && !!healed.data.branch, JSON.stringify(healed.data).slice(0, 100))
await requireToken(null)

for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } }
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nStorage suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
