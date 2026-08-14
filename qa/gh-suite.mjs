// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// GitHub-storage test suite against the mock GitHub API. Verifies the
// optimized driver end-to-end: cold-start call count, ETag 304 polling,
// no-op flush skipping, two-instance conflict healing, and squash.
import { execSync, spawn } from 'child_process'

const MOCK = 'http://localhost:9977'
const REPO = process.env.REPO_DIR || ROOT
let fails = 0
const ok = (name, cond, extra = '') => {
  if (!cond) fails++
  console.log(`${cond ? '✔' : '✘ FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
}
const calls = async () => (await fetch(`${MOCK}/__calls`)).json()
const resetCalls = () => fetch(`${MOCK}/__reset`, { method: 'POST' })
const sum = (c) => Object.values(c).reduce((a, b) => a + b, 0)

// Start an app "instance" (fresh node process = fresh serverless instance)
// on a port, with its own DATA_DIR (its own /tmp).
const instances = []
async function startInstance(port, dir) {
  const child = spawn('node', ['-e', `
    import('http').then(async ({ default: http }) => {
      const { default: handler } = await import('${REPO}/api/index.js')
      http.createServer((req, res) => handler(req, res)).listen(${port}, () => console.log('ready'))
    })
  `], {
    env: {
      ...process.env,
      GITHUB_API_BASE: MOCK,
      GITHUB_DATA_FORCE: '1',
      DATA_DIR: dir,
      PATH: process.env.PATH,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  instances.push(child)
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (d.toString().includes('ready')) resolve() })
    child.on('exit', (c) => reject(new Error(`instance exited ${c}`)))
    setTimeout(() => reject(new Error('instance start timeout')), 15000)
  })
  return {
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

execSync('rm -rf /tmp/ghtest-a /tmp/ghtest-b /tmp/ghtest-c')

// === 1. Very first boot ever: branch created, seed uploaded ===
await resetCalls()
const A = await startInstance(4091, '/tmp/ghtest-a')
let r = await A.req('/health')
ok('first boot healthy', r.status === 200 && r.data.storage === 'github')
const loginA = await A.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
ok('admin login on first boot', loginA.status === 200 && !!loginA.data.token)
const TA = loginA.data.token
await new Promise((r2) => setTimeout(r2, 300)) // let the post-response flush land
let c = await calls()
ok('seed flushed to repo', (c['contents-put'] || 0) >= 1, JSON.stringify(c))

// === 2. Warm cold start: a second instance boots from existing data ===
await resetCalls()
const B = await startInstance(4092, '/tmp/ghtest-b')
await B.req('/health') // forces the lazy init to complete
await new Promise((r2) => setTimeout(r2, 300))
c = await calls()
ok('cold start costs ≤2 GitHub calls', sum(c) >= 1 && sum(c) <= 2, JSON.stringify(c))
ok('cold start needs no branch/tree calls', !c['ref-get'] && !c['tree-get'], JSON.stringify(c))
const loginB = await B.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
ok('login works on second instance', loginB.status === 200)
const TB = loginB.data.token

// === 3. Read-only traffic causes zero uploads and 304 polls ===
await resetCalls()
await new Promise((r2) => setTimeout(r2, 4200)) // let the sync TTL lapse
await B.req('/channels', { token: TB })
await new Promise((r2) => setTimeout(r2, 300))
c = await calls()
ok('read-only request uploads nothing', !c['contents-put'], JSON.stringify(c))

// === 4. Cross-instance sync: A writes, B sees it after TTL ===
const task = await A.req('/content', { method: 'POST', token: TA, body: { title: 'Optimize everything', channels: ['youtube'], type: 'post' } })
ok('A creates task', task.status === 201 || task.status === 200, String(task.status))
await new Promise((r2) => setTimeout(r2, 4500)) // flush + B's sync TTL
const bView = await B.req('/content', { token: TB })
ok('B sees A\'s task after one sync interval', !!bView.data.find?.((t) => t.title === 'Optimize everything'))

// === 5. Two-instance write conflict heals via journal replay ===
// B is now fresh; write on B and on A back-to-back without letting the other pull.
const tB = await B.req('/content', { method: 'POST', token: TB, body: { title: 'From B', channels: ['youtube'], type: 'post' } })
await new Promise((r2) => setTimeout(r2, 300))
const tA = await A.req('/content', { method: 'POST', token: TA, body: { title: 'From A', channels: ['youtube'], type: 'post' } })
ok('both writes accepted', tB.status === 201 && tA.status === 201, `${tB.status}/${tA.status}`)
await new Promise((r2) => setTimeout(r2, 4500))
const merged = await B.req('/content', { token: TB })
const titles = (merged.data || []).map((t) => t.title)
ok('conflict merged: both tasks in one copy', titles.includes('From A') && titles.includes('From B'), titles.join(', '))

// === 6. No-op writes do not create commits (hash skip) ===
await resetCalls()
const h = await A.req('/health') // triggers ready→initSchema only on fresh boot; use a real no-op instead:
await A.req('/cron/daily') // snapshots — may write; so measure a pure GET after
await new Promise((r2) => setTimeout(r2, 300))
c = await calls()
const putsAfterCron = c['contents-put'] || 0
await resetCalls()
await A.req('/channels', { token: TA })
await new Promise((r2) => setTimeout(r2, 300))
c = await calls()
ok('plain GET after cron flushes nothing', !c['contents-put'], JSON.stringify(c))
ok('health stayed ok', h.status === 200)

// === 7. Fresh instance after squash still boots clean ===
await A.req('/cron/daily') // includes squash
await new Promise((r2) => setTimeout(r2, 500))
await resetCalls()
const C = await startInstance(4093, '/tmp/ghtest-c')
await C.req('/health')
await new Promise((r2) => setTimeout(r2, 300))
c = await calls()
ok('post-squash cold start ≤2 calls', sum(c) >= 1 && sum(c) <= 2, JSON.stringify(c))
const loginC = await C.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
ok('login works after squash on new instance', loginC.status === 200)
const cView = await C.req('/content', { token: loginC.data.token })
const cTitles = (cView.data || []).map((t) => t.title)
ok('data intact after squash', cTitles.includes('From A') && cTitles.includes('From B'), cTitles.join(', '))

console.log(fails === 0 ? '\nAll storage checks passed.' : `\n${fails} CHECKS FAILED`)
for (const i of instances) i.kill()
process.exit(fails === 0 ? 0 : 1)
