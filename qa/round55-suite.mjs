// Round 55: "slow down" is not "your token is dead".
//
// GitHub answers 403 for two unrelated things — a credential it refuses, and
// a deployment it wants to throttle. The driver treated both as a dead token:
// the logs, /api/health and the 503 in the browser all told the admin to
// issue a new token, and the answer was marked NOT retryable so the client
// stopped trying. Meanwhile the write itself was simply lost, because only
// GETs were ever retried — one throttled PUT dropped a whole flush.
//
// Both are fixed here, and both halves matter: a throttled write must SURVIVE
// (retried behind the scenes, nobody hears about it), and a throttle that
// outlasts the retries must SAY it is a throttle, while a genuinely refused
// token must still say that.
// Self-contained: a stack on 4112 against a GitHub mock on 9988.
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const MOCK = 'http://localhost:9988'
const BASE = 'http://localhost:4112'
const B = BASE + '/api'
const TOKEN = 'r55-good-token'

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

procs.push(spawn(process.execPath, [SP + 'mock-gh.mjs'], { env: { ...process.env, MOCK_PORT: '9988' }, stdio: 'ignore' }))
const up = async (url) => {
  for (let i = 0; i < 80; i++) {
    try { await fetch(url); return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}
await up(MOCK + '/__calls')

procs.push(spawn(process.execPath, ['/home/user/dashb/server/index.js'], {
  env: {
    ...process.env,
    DATA_DIR: SP + 'r55-' + Date.now(), PORT: '4112',
    GITHUB_API_BASE: MOCK, GITHUB_DATA_FORCE: '1',
    GITHUB_DATA_TOKEN: TOKEN, GITHUB_DATA_REPO: 'probe/r55', GITHUB_DATA_BRANCH: 'appdata',
  },
  stdio: 'ignore',
}))
const health = async () => (await (await fetch(B + '/health')).json())
for (let i = 0; i < 80; i++) {
  try { if ((await health()).ok !== undefined) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 400))
}
ok('the stack is up on GitHub storage', (await health()).storage === 'github')

const rate = (n, opts = {}) => fetch(MOCK + '/__ratelimit', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n, ...opts }),
})
const require_ = (token) => fetch(MOCK + '/__require', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
})
const T = (await (await fetch(B + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
})).json()).token
const req = async (p, m = 'GET', b) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
// Wait until the storage layer actually reports a problem — a flush is not
// instant, and asserting on wording before the attempt has been made only
// measures the clock.
const waitForError = async (ms = 20000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const h = await health()
    if (h.flushError) return h
    await new Promise((r) => setTimeout(r, 250))
  }
  return await health()
}
const settle = async (ms = 5000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const h = await health()
    if (!h.dirty && !h.flushError) return h
    await new Promise((r) => setTimeout(r, 250))
  }
  return await health()
}
const chKey = (await req('/channels')).data[0].key
await settle()

// ---- a throttled write SURVIVES ----
// Two calls throttled is more than one flush costs, so the whole flush would
// have been lost before: the retry is what saves it.
await rate(2)
const made = (await req('/content', 'POST', { title: 'r55 survives a throttle', channels: [chKey], type: 'post' })).data
ok('the task is created even while GitHub is throttling', !!made?.id)
let h = await settle(12000)
ok('…and the write reaches GitHub anyway', !h.dirty && !h.flushError, JSON.stringify({ dirty: h.dirty, err: h.flushError }))
const calls = await (await fetch(MOCK + '/__calls')).json()
ok('…having actually been throttled on the way', (calls.ratelimited || 0) >= 2, JSON.stringify(calls.ratelimited))
ok('…and the task really is stored', (await req(`/content/${made.id}`)).status === 200)

// ---- a throttle that outlasts the retries SAYS it is a throttle ----
await rate(-1) // never lets up
await req('/content', 'POST', { title: 'r55 during a long throttle', channels: [chKey], type: 'post' })
h = await waitForError()
ok('a lasting throttle is reported as a failure', !!h.flushError, JSON.stringify(h.flushError))
ok('…named as rate limiting, not as a dead token', /rate-limiting/i.test(h.flushError || ''), h.flushError)
ok('…and it explicitly does NOT blame the token',
  !/refused the storage token/.test(h.flushError || ''), h.flushError)
ok('…while saying the app retries by itself', /retries by itself/i.test(h.flushError || ''), h.flushError)

// A throttle answered as 429 with no words is still a throttle.
await rate(0)
await settle(8000)
await rate(-1, { status: 429, words: false })
await req('/content', 'POST', { title: 'r55 429 throttle', channels: [chKey], type: 'post' })
h = await waitForError()
ok('a 429 with only headers is recognised too',
  /rate-limiting/i.test(h.flushError || '') && !/refused the storage token/.test(h.flushError || ''), h.flushError)

// ---- a genuinely refused token still says exactly that ----
await rate(0)
await settle(8000)
await require_('a-completely-different-token')
await req('/content', 'POST', { title: 'r55 during a refusal', channels: [chKey], type: 'post' })
h = await waitForError()
ok('a refused credential is still called a refused credential',
  /refused the storage token/.test(h.flushError || ''), h.flushError)
ok('…and is not mistaken for a rate limit', !/rate-limiting/i.test(h.flushError || ''), h.flushError)

// ---- and the recovery ----
await require_(null)
await rate(0)
h = await settle(15000)
ok('once GitHub relents, the backlog flushes and the error clears',
  !h.dirty && !h.flushError, JSON.stringify({ dirty: h.dirty, err: h.flushError }))
const titles = (await req(`/content?department=${chKey}`)).data.map((t) => t.title)
ok('…with every task written during the trouble still present',
  ['r55 survives a throttle', 'r55 during a long throttle', 'r55 429 throttle', 'r55 during a refusal']
    .every((t) => titles.includes(t)), titles.filter((t) => t.startsWith('r55')).join(' / '))

stop()
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-55 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
