// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Every page, as every kind of account, on desktop and on a phone — watching
// for the things a suite of assertions never sees: a page that throws, a page
// that renders nothing, a layout that scrolls sideways, a request that 500s
// behind the scenes. Shallow on purpose; it is a net, not a microscope.
// Not part of the gate — run it by hand after a broad change:
//   node qa/page-walk.mjs
import { spawn } from 'child_process'
import { chromium } from 'playwright'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4111'
const B = BASE + '/api'
const p = spawn(process.execPath, [ROOT + '/server/index.js'],
  { env: { ...process.env, DATA_DIR: SP + 'walk-' + Date.now(), PORT: '4111' }, stdio: 'ignore' })
process.on('exit', () => { try { p.kill('SIGKILL') } catch { /* gone */ } })
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(B + '/health')).ok) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500))
}
const login = async (u, pw) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) })).json()).token
const T = await login('admin', 'admin123')
const call = async (path, tok = T, method = 'GET', body) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined })
  return await r.json().catch(() => null)
}

// ---- a world with something on every page ----
const ch = (await call('/channels'))[0].key
const statuses = await call('/statuses')
const mk = (name, username, role, departments) => call('/users', T, 'POST', { name, username, password: 'probe123', role, departments })
const member = await mk('Walk Member', 'wkmember', 'member', [ch])
const editor = await mk('Walk Editor', 'wkeditor', 'editor', [])
const operator = await mk('Walk Operator', 'wkoperator', 'operator', [])
const designer = await mk('Walk Designer', 'wkdesigner', 'designer', [])
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const shift = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const st = (re) => statuses.find((s) => re.test(s.label))?.id
for (const [i, s] of [
  { type: 'video', status: /to shoot/i, rec: shift(1), rel: shift(4), operator_id: operator.id, editor_id: editor.id },
  { type: 'reel', status: /editing/i, rec: shift(-2), rel: shift(1), editor_id: editor.id },
  { type: 'post', status: /idea/i, rel: shift(2), designer_id: designer.id },
  { type: 'story', status: /ready/i, rel: shift(-1), editor_id: editor.id },
  { type: 'video', status: /published/i, rel: shift(-5) },
  { type: 'post', status: /idea/i, rel: shift(9) },
  { type: 'reel', status: /to shoot/i, rec: shift(-4), rel: shift(-3), operator_id: operator.id },
].entries()) {
  await call('/content', T, 'POST', {
    title: `walk ${i}`, channels: [ch], type: s.type, status_id: st(s.status),
    recording_date: s.rec, release_date: s.rel,
    operator_id: s.operator_id, editor_id: s.editor_id, designer_id: s.designer_id,
    assignee_ids: i % 2 ? [member.id] : [],
  })
}
const proj = await call('/projects', T, 'POST', { name: 'Walk project' })
const camp = await call('/campaigns', T, 'POST', { name: 'Walk campaign', channels: [ch], project_id: proj?.id })
await call('/programs', T, 'POST', { name: 'Walk program', channel: ch, start_date: shift(-3), end_date: shift(10) })
await call('/hiring', T, 'POST', { title: 'Walk vacancy', channel: ch }).catch(() => {})

const PAGES = [
  ['Overview', '/overview'], ['My Day', '/brief'], ['Statistics', '/missed'],
  ['Design', '/design'], ['Documents', '/docs'], ['Projects', '/projects'],
  ['Project', `/projects/${proj?.id}`], ['Campaign', `/campaigns/${camp?.id}`],
  ['Channel', `/dept/${ch}`], ['Post Production', '/crew'], ['Team & hiring', '/team'],
  ['Admin', '/admin'], ['Profile', '/profile'],
]
const ROLES = [
  ['admin', 'admin', 'admin123'], ['member', 'wkmember', 'probe123'],
  ['editor', 'wkeditor', 'probe123'], ['operator', 'wkoperator', 'probe123'],
  ['designer', 'wkdesigner', 'probe123'],
]

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const problems = []
let visits = 0
for (const [vpName, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  for (const [role, u, pw] of ROLES) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 })
    const page = await ctx.newPage()
    const seen = []
    page.on('pageerror', (e) => seen.push(`THREW ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) seen.push(`CONSOLE ${m.text().slice(0, 160)}`) })
    page.on('response', (r) => { if (r.status() >= 500) seen.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`) })
    await page.goto(BASE + '/login')
    await page.fill('input[autocomplete="username"], input[name="username"]', u)
    await page.fill('input[type="password"]', pw)
    await page.click('button[type="submit"]')
    await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 25000 })
    for (const [name, path] of PAGES) {
      seen.length = 0
      await page.goto(BASE + path)
      // Wait for the app's OWN loading state to clear, rather than sleeping a
      // fixed interval and hoping. Every page here is code-split, so a cold
      // chunk on a slow sandbox used to overrun a flat 1.4s wait and get
      // reported as a hang — a different page each run, none of them actually
      // broken. The deadline below is what now separates "slow" from "stuck",
      // and the spinner check further down still catches a genuine hang.
      await page.waitForFunction(() => !document.querySelector('.app-loading'), null, { timeout: 12000 })
        .catch(() => { /* still spinning — reported as a problem below */ })
      await page.waitForTimeout(350)   // let the first paint after loading settle
      visits++
      const state = await page.evaluate(() => ({
        text: (document.querySelector('.app-main, main, #root')?.innerText || '').trim().length,
        spinner: !!document.querySelector('.app-loading'),
        wide: document.documentElement.scrollWidth - window.innerWidth,
        url: location.pathname,
      }))
      const where = `${vpName}/${role.padEnd(9)} ${name.padEnd(15)}`
      for (const s2 of seen) problems.push(`${where} ${s2}`)
      if (state.spinner) problems.push(`${where} still spinning after 1.4s`)
      else if (state.url === path && state.text < 20) problems.push(`${where} renders almost nothing (${state.text} chars)`)
      if (state.wide > 1) problems.push(`${where} scrolls sideways by ${state.wide}px`)
    }
    await ctx.close()
  }
}
await browser.close()
console.log(`walked ${visits} page visits`)
if (problems.length === 0) console.log('nothing broken')
else { console.log(`\n${problems.length} PROBLEMS:`); for (const x of problems) console.log('  ' + x) }
try { p.kill('SIGKILL') } catch { /* gone */ }
process.exit(0)
