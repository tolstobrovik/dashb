// The blip that cost a task: production showed "The data store is briefly
// unreachable — try again in a moment" the moment someone pressed Add, and
// the typed task was gone. That 503 is sent by the serverless entry BEFORE
// the request touches anything, so repeating it is always safe — the client
// now does, quietly. These pins hold the cure and its limits: the safe retry
// must not duplicate the task, must not swallow a real error, and must not
// turn a refusal into a hang. A proxy on 4400 injects the failures in front
// of the main 4090 stack.
import http from 'http'
import { chromium } from 'playwright'

const UP = 'http://localhost:4090'
const PORT = 4400
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

// inject: { path, method, times, status, body } — served instead of upstream
let inject = null
let injected = 0
const proxy = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    const url = new URL(req.url, 'http://x')
    if (inject && req.method === inject.method && inject.path.test(url.pathname) && injected < inject.times) {
      injected++
      res.writeHead(inject.status, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(inject.body))
    }
    try {
      const up = await fetch(UP + req.url, {
        method: req.method,
        headers: { ...req.headers, host: 'localhost:4090' },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      })
      const buf = Buffer.from(await up.arrayBuffer())
      const h = {}
      up.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) h[k] = v })
      res.writeHead(up.status, h)
      res.end(buf)
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
  })
})
await new Promise((r) => proxy.listen(PORT, r))

const T = (await (await fetch(`${UP}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
})).json()).token
const server = async (path, method = 'GET') => (await fetch(`${UP}/api${path}`, {
  method, headers: { Authorization: `Bearer ${T}` },
})).json()
const cleanup = async () => {
  for (const c of (await server('/content')).filter((c) => /^x45:/.test(c.title))) await server(`/content/${c.id}`, 'DELETE')
}
await cleanup()

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const p = await ctx.newPage()
const dialogs = []
p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss() })
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(`http://localhost:${PORT}/login`)
await p.fill('input[name="username"]', 'admin')
await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]')
await p.waitForURL(/overview/, { timeout: 15000 })

// The To-Do page's add line was where this round pressed; round 82 removed
// that page and the board's own column foot took the job. Same POST, same
// retry, same question: does a blip ever reach the person pressing the key?
const addTask = async (title) => {
  await p.goto(`http://localhost:${PORT}/dept/instagram_main`)
  await p.waitForSelector('.board-col', { timeout: 15000 })
  await p.waitForTimeout(800)
  await p.locator('.board-col').first().locator('.board-quick-btn').click()
  await p.locator('.board-quick-input').fill(title)
  await p.keyboard.press('Enter')
  await p.waitForTimeout(4000)
}

// ---- a storage blip on the very press ----
inject = { path: /^\/api\/content$/, method: 'POST', times: 1, status: 503, body: { error: 'The data store is briefly unreachable — try again in a moment', retryable: true } }
injected = 0
dialogs.length = 0
await addTask('x45: survives the blip')
ok('a storage blip never reaches the user', dialogs.length === 0, JSON.stringify(dialogs))
ok('…the task lands on the page anyway', (await p.locator('text=x45: survives the blip').count()) > 0)
const once = (await server('/content')).filter((c) => c.title === 'x45: survives the blip')
ok('…exactly once — a safe retry is not a double post', once.length === 1, `saved ${once.length}`)

// ---- a blip that outlasts the patience still tells the truth ----
inject = { path: /^\/api\/content$/, method: 'POST', times: 9, status: 503, body: { error: 'The data store is briefly unreachable — try again in a moment', retryable: true } }
injected = 0
dialogs.length = 0
await addTask('x45: storage really down')
await p.waitForTimeout(3000)
ok('a lasting outage is finally reported', dialogs.some((d) => /briefly unreachable/.test(d)), JSON.stringify(dialogs))

// ---- a real refusal must NOT be retried away ----
inject = { path: /^\/api\/content$/, method: 'POST', times: 5, status: 403, body: { error: 'Not your channel' } }
injected = 0
dialogs.length = 0
await addTask('x45: refused')
ok('a refusal surfaces at once, unretried', dialogs.some((d) => /Not your channel/.test(d)) && injected === 1, `tries=${injected}`)

inject = null
await p.close()
await browser.close()
proxy.close()
await cleanup()
console.log(fails === 0 ? '\nRound-45 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
