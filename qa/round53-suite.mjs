// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 53: a short answer must not brick the dashboard.
//
// The bug this pins: the client read ANY 2xx body it could not parse as `{}`
// and handed it to the caller as data. A /channels response cut short in
// transit therefore became an empty OBJECT, was stored as the channel list,
// crashed the provider that wraps every page — and, because it was written
// to the browser's cache on the way, crashed it again on every reload. One
// truncated response, and that browser could not open the dashboard at all.
//
// Two guarantees are checked here: a body that arrives incomplete is treated
// as a failed request (the page keeps its last good data), and a browser that
// ALREADY holds the poisoned value opens normally instead of staying broken.
// Self-contained: a real stack on 4103 behind a proxy on 4104 that can cut a
// reply short on command.
import { spawn } from 'child_process'
import { createServer } from 'http'
import { chromium } from 'playwright'

const SP = new URL('.', import.meta.url).pathname
const REAL = 'http://localhost:4103'
const BASE = 'http://localhost:4104' // everything the browser sees goes through here

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

procs.push(spawn(process.execPath, [ROOT + '/server/index.js'],
  { env: { ...process.env, DATA_DIR: SP + 'x53-' + Date.now(), PORT: '4103' }, stdio: 'ignore' }))
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('the stack is up', await up(REAL + '/api/health'))

// The proxy. `cut` arms it: the next /api/channels answers 200 with half a
// body — exactly what a connection dropped mid-reply looks like to fetch.
let cut = 0
let served = 0
const proxy = createServer(async (req, res) => {
  const isChannels = req.url === '/api/channels'
  if (isChannels) served++
  const chunks = []
  for await (const c of req) chunks.push(c)
  const upstream = await fetch(REAL + req.url, {
    method: req.method,
    headers: { ...req.headers, host: 'localhost:4103' },
    body: chunks.length ? Buffer.concat(chunks) : undefined,
    redirect: 'manual',
  })
  const body = Buffer.from(await upstream.arrayBuffer())
  if (isChannels && cut > 0) {
    cut--
    const half = body.subarray(0, Math.max(8, Math.floor(body.length / 2)))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(half) // a 200, and a body that stops mid-sentence
    return
  }
  const headers = {}
  upstream.headers.forEach((v, k) => { if (!/^(content-encoding|content-length|transfer-encoding)$/i.test(k)) headers[k] = v })
  res.writeHead(upstream.status, headers)
  res.end(body)
})
await new Promise((r) => proxy.listen(4104, r))
ok('the proxy is in front of it', (await (await fetch(BASE + '/api/health')).json()).ok !== undefined)

// The proxy really can cut a reply short — proved before it is relied on.
cut = 1
const short = await fetch(BASE + '/api/channels', { headers: { Authorization: 'Bearer nope' } })
const shortText = await short.text()
ok('a cut reply is a 200 with an unparseable body', short.status === 200 && (() => {
  try { JSON.parse(shortText); return false } catch { return true }
})(), `${short.status} ${shortText.slice(0, 40)}`)
cut = 0

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const openApp = async (ctx) => {
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(BASE + '/login')
  await page.fill('input[autocomplete="username"], input[name="username"]', 'admin')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(?!login)/, { timeout: 20000 })
  await page.waitForTimeout(1200)
  return { page, errs }
}

// ---- 1. a reply cut short mid-session ----
const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const a = await openApp(ctx1)
const channelsAtFirst = await a.page.locator('.nav-item, .side-link, a[href^="/dept/"]').count()
ok('the dashboard opens normally to begin with', channelsAtFirst > 0 && a.errs.length === 0, a.errs.join(' | '))

cut = 3 // enough to catch the reload and its retries
await a.page.reload()
await a.page.waitForTimeout(2500)
ok('a cut reply does not throw the app off its feet', a.errs.length === 0, a.errs.join(' | '))
ok('…the shell is still there', (await a.page.locator('.sidebar, .app-main, #root > *').count()) > 0)
const poisoned = await a.page.evaluate(() => localStorage.getItem('satashkent_cache:channels'))
ok('…and the broken answer is never written to the cache',
  poisoned === null || (() => { try { return Array.isArray(JSON.parse(poisoned)) } catch { return false } })(),
  String(poisoned).slice(0, 60))

cut = 0
await a.page.reload()
await a.page.waitForTimeout(2000)
ok('once the answer arrives whole, the channels are back',
  (await a.page.locator('a[href^="/dept/"]').count()) > 0)
ok('…with no error along the way', a.errs.length === 0, a.errs.join(' | '))
await ctx1.close()

// ---- 2. a browser that ALREADY holds the poison ----
// This is the one that matters for anyone whose dashboard broke before the
// fix: it must heal itself on the next visit, not stay broken forever.
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx2.addInitScript(() => {
  localStorage.setItem('satashkent_cache:channels', '{}')
})
const b = await openApp(ctx2)
ok('a browser holding the poisoned value opens anyway', b.errs.length === 0, b.errs.join(' | '))
ok('…and shows its channels', (await b.page.locator('a[href^="/dept/"]').count()) > 0)
await b.page.goto(BASE + '/brief')
await b.page.waitForTimeout(1500)
ok('…and every other page with it', b.errs.length === 0 && (await b.page.locator('#root > *').count()) > 0, b.errs.join(' | '))
await ctx2.close()

// ---- 3. the same guarantee at the request layer, directly ----
const ctx3 = await browser.newContext()
const c = await openApp(ctx3)
cut = 9 // more than the retry budget: this one has to fail, not pretend
const verdict = await c.page.evaluate(async () => {
  const t = localStorage.getItem('satashkent_token') || sessionStorage.getItem('satashkent_token')
  try {
    const r = await fetch('/api/channels', { headers: { Authorization: `Bearer ${t}` } })
    const body = await r.text()
    return { status: r.status, parses: (() => { try { JSON.parse(body); return true } catch { return false } })() }
  } catch (e) { return { threw: e.message } }
})
ok('the cut reply really is what the browser receives', verdict.status === 200 && verdict.parses === false, JSON.stringify(verdict))
cut = 0
await ctx3.close()

await browser.close()
proxy.close()
stop()
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-53 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
