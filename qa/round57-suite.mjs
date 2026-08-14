// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 57: the storage layer under a team, not one person.
//
// Every change uploads the WHOLE database file. That is the deal this storage
// makes, and it is fine — until several people work at once, when it stopped
// being fine in two separate ways:
//
// 1. NOTHING STOPPED TWO UPLOADS OF THE SAME FILE. Overlapping requests each
//    pushed the whole database; the loser failed the compare-and-swap, pulled
//    the fresh copy, replayed and pushed AGAIN. Three round trips of a
//    megabyte-odd for one change — the traffic that gets a deployment
//    throttled, which is exactly what took the dashboard down.
//
// 2. A WRITE THAT LANDED MID-UPLOAD WAS MARKED SAVED WITHOUT BEING SENT. The
//    push succeeded, the journal was emptied and the file called clean — but
//    the bytes in the air did not contain the write that had just arrived.
//    Nothing pushed again until some later, unrelated write happened along.
//    On a serverless host, where the machine is reclaimed between requests,
//    that is a typed task quietly gone.
//
// Self-contained: a stack on 4115 against a GitHub mock on 9990 that can hold
// an upload open long enough for the race to be real.
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const MOCK = 'http://localhost:9990'
const BASE = 'http://localhost:4115'
const B = BASE + '/api'

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

procs.push(spawn(process.execPath, [SP + 'mock-gh.mjs'], { env: { ...process.env, MOCK_PORT: '9990' }, stdio: 'ignore' }))
const up = async (url) => {
  for (let i = 0; i < 80; i++) {
    try { await fetch(url); return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}
await up(MOCK + '/__calls')

procs.push(spawn(process.execPath, [ROOT + '/server/index.js'], {
  env: {
    ...process.env,
    DATA_DIR: SP + 'r57-' + Date.now(), PORT: '4115',
    GITHUB_API_BASE: MOCK, GITHUB_DATA_FORCE: '1',
    GITHUB_DATA_TOKEN: 'r57-token', GITHUB_DATA_REPO: 'probe/r57', GITHUB_DATA_BRANCH: 'appdata',
  },
  stdio: 'ignore',
}))
const health = async () => (await (await fetch(B + '/health')).json())
for (let i = 0; i < 80; i++) {
  try { if ((await health()).ok !== undefined) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 400))
}
ok('the stack is up on GitHub storage', (await health()).storage === 'github')

const T = (await (await fetch(B + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
})).json()).token
const req = async (p, m = 'GET', b) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const calls = async () => (await (await fetch(MOCK + '/__calls')).json())
const reset = () => fetch(MOCK + '/__reset', { method: 'POST' })
const slow = (ms) => fetch(MOCK + '/__slow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ms }) })
const settle = async (ms = 20000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const h = await health()
    if (!h.dirty && !h.flushError) return h
    await new Promise((r) => setTimeout(r, 200))
  }
  return await health()
}
const chKey = (await req('/channels')).data[0].key
await settle()

// ---- a team working at once does not multiply the traffic ----
// Driven through the SERVERLESS shape — write, flush, per request, eight at
// once. The long-running server flushes on a three-second timer instead, so
// running this through its HTTP API would prove nothing: the timer collapses
// the uploads by itself and the race never happens.
await reset()
await slow(250) // every upload takes a beat, so the requests really do overlap
const driver = spawn(process.execPath, [SP + 'r57-driver.mjs'], {
  env: {
    ...process.env,
    DATA_DIR: SP + 'r57drv-' + Date.now(), R57_N: '8',
    GITHUB_API_BASE: MOCK, GITHUB_DATA_FORCE: '1',
    GITHUB_DATA_TOKEN: 'r57-token', GITHUB_DATA_REPO: 'probe/r57d', GITHUB_DATA_BRANCH: 'appdata',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let drvOut = ''
driver.stdout.on('data', (d) => { drvOut += d })
driver.stderr.on('data', (d) => { drvOut += d })
const code = await new Promise((r) => driver.on('exit', r))
ok('eight simultaneous request-shaped writes all go through', code === 0 && /DRIVER-DONE/.test(drvOut), drvOut.slice(-200))
const c = await calls()
// Eight flushes of the same file, unguarded, are eight uploads — and most of
// them lose the compare-and-swap, pull the fresh copy and upload again.
ok('…without eight separate uploads of the whole database',
  (c['contents-put'] || 0) > 0 && (c['contents-put'] || 0) <= 4, `${c['contents-put']} uploads for 8 writes`)
ok('…and without a storm of compare-and-swap conflicts',
  (c['contents-get'] || 0) <= 4, `${c['contents-get'] || 0} downloads`)

await slow(0)
await reset()
const many = await Promise.all([...Array(8)].map((_, i) =>
  req('/content', 'POST', { title: `r57 parallel ${i}`, channels: [chKey], type: 'post' })))
ok('eight people can add a task at the same moment', many.every((r) => r.status === 201),
  many.map((r) => r.status).join(','))
await settle()
ok('…and every one of them is stored', (await req(`/content?department=${chKey}`)).data
  .filter((t) => t.title.startsWith('r57 parallel')).length === 8)
ok('…with nothing left unsaved', (await health()).dirty === false)

// ---- a write that lands mid-upload is not forgotten ----
// The upload is held open; a task is created while it is in the air. The
// bytes being sent cannot contain it, so the file must NOT be called clean.
await slow(1200)
await reset()
await req('/content', 'POST', { title: 'r57 first', channels: [chKey], type: 'post' })
await new Promise((r) => setTimeout(r, 250))          // the upload is now in flight
const during = await req('/content', 'POST', { title: 'r57 during the upload', channels: [chKey], type: 'post' })
ok('a task can be created while an upload is in the air', during.status === 201)
await slow(0)
const after = await settle()
ok('…and the storage settles clean afterwards',
  after.dirty === false && !after.flushError, JSON.stringify({ dirty: after.dirty, err: after.flushError }))
// NOTE: this half checks that a mid-upload write survives end to end. The
// narrower race it guards against — a write landing mid-upload with no flush
// of its own behind it, so the finishing upload marks it clean without having
// sent it — is prevented by comparing the file against the bytes actually
// uploaded, and is not separately constructed here.

// The proof: pull the file GitHub actually holds, through a fresh instance
// that has never seen this data, and look for the task inside it.
procs.push(spawn(process.execPath, [ROOT + '/server/index.js'], {
  env: {
    ...process.env,
    DATA_DIR: SP + 'r57b-' + Date.now(), PORT: '4116',
    GITHUB_API_BASE: MOCK, GITHUB_DATA_FORCE: '1',
    GITHUB_DATA_TOKEN: 'r57-token', GITHUB_DATA_REPO: 'probe/r57', GITHUB_DATA_BRANCH: 'appdata',
  },
  stdio: 'ignore',
}))
const B2 = 'http://localhost:4116/api'
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(B2 + '/health')).ok) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 400))
}
const T2 = (await (await fetch(B2 + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
})).json()).token
const fresh = await (await fetch(`${B2}/content?department=${chKey}`, { headers: { Authorization: `Bearer ${T2}` } })).json()
const titles = fresh.map((t) => t.title)
ok('a second machine, reading only what GitHub holds, sees the mid-upload task',
  titles.includes('r57 during the upload'), titles.filter((t) => t.startsWith('r57 ')).join(' / '))
ok('…and the one before it', titles.includes('r57 first'))
ok('…and all eight of the parallel ones',
  titles.filter((t) => t.startsWith('r57 parallel')).length === 8)

stop()
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-57 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
