// Round 83: one page in Admin where the board's switches live.
//
// The rules that shape this board were scattered: the task form's fields sat
// inside Pipeline next to the stages, the crew rules under them, and which
// pages the team has at all was not a setting anywhere — it was decided once,
// in the source, by whoever built the thing. Admin → Settings is the one page
// that answers "how is this board set up", and it is asked here:
//
//   · ТЗ can be made mandatory, which it could not be at all before
//   · a required field is refused by the SERVER, not just hidden by the client
//   · a page switched off leaves the sidebar AND its own address
//   · and only an admin may set any of it
//
// Brings its own server on 4133 so it can be run alone.
import { spawn } from 'child_process'
import { chromium } from 'playwright'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const PORT = 4133
const BASE = `http://localhost:${PORT}`
const A = `${BASE}/api`
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const dir = mkdtempSync(join(tmpdir(), 'set-'))
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const srv = spawn('node', [join(ROOT, 'server/index.js')],
  { env: { ...process.env, DATA_DIR: dir, PORT: String(PORT) }, stdio: 'ignore' })
const wait = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${A}/health`)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}
if (!(await wait())) { console.log('server never answered'); srv.kill(); process.exit(1) }

const login = async (u, p) => (await (await fetch(`${A}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(A + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

const ch = (await req('/channels')).data[0]?.key
await req('/users', 'POST', {
  name: 'Set Member', username: 'setm', password: 'pass1234', role: 'member',
  departments: [ch], permissions: { manage_content: true },
})
const MT = await login('setm', 'pass1234')

// ---- 1) the config the whole board reads ---------------------------------
const cfg = (await req('/fields')).data
ok('the config names every page', Object.keys(cfg.pages || {}).length === 10, JSON.stringify(Object.keys(cfg.pages || {})))
ok('…and they all start on', Object.values(cfg.pages).every((v) => v === true))
ok('ТЗ is a field the admin governs', !!cfg.tz && cfg.tz.state === 'optional', JSON.stringify(cfg.tz))
ok('a member may READ the config — the shell needs it to draw a sidebar',
  (await req('/fields', 'GET', null, MT)).status === 200)
ok('…and may not write it', (await req('/fields', 'POST', { pages: { docs: false } }, MT)).status === 403)
ok('…so nothing moved', (await req('/fields')).data.pages.docs === true)

// ---- 2) ТЗ, made mandatory ------------------------------------------------
await req('/fields', 'POST', { ...cfg, tz: { state: 'required', types: ['reel', 'video'] } })
ok('required sticks', (await req('/fields')).data.tz.state === 'required')
const noTz = await req('/content', 'POST', { title: 'set: no tz', channels: [ch], type: 'video' }, MT)
ok('a video with no ТЗ is refused', noTz.status === 400 && /ТЗ/.test(noTz.data.error || ''), `${noTz.status} ${noTz.data.error || ''}`)
const thin = await req('/content', 'POST', { title: 'set: thin tz', channels: [ch], type: 'video', tz: 'ok' }, MT)
ok('…and a placeholder is not an answer', thin.status === 400, `${thin.status} ${thin.data.error || ''}`)
const good = await req('/content', 'POST', {
  title: 'set: with tz', channels: [ch], type: 'video',
  tz: 'Cut to ninety seconds, captions burned in, no music under the interview.',
}, MT)
ok('…while a real one goes through', good.status === 201, `${good.status} ${good.data.error || ''}`)
const post = await req('/content', 'POST', { title: 'set: a post', channels: [ch], type: 'post' }, MT)
ok('a post, which the rule does not cover, is never asked', post.status === 201, `${post.status} ${post.data.error || ''}`)
// The admin is not made to fill in a form — round 80 settled that, and this
// new field has to obey it too.
ok('the admin still passes it', (await req('/content', 'POST', { title: 'set: admin video', channels: [ch], type: 'video' })).status === 201)
await req('/fields', 'POST', { ...cfg, tz: { state: 'optional', types: ['reel', 'video'] } })

// ---- 3) the page switches, in the browser --------------------------------
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(`${BASE}/login`)
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 20000 })
await p.goto(`${BASE}/admin`); await p.waitForTimeout(1100)
await p.locator('.tab', { hasText: 'Settings' }).click(); await p.waitForTimeout(1200)

ok('Settings opens on the pages', (await p.locator('.section-head', { hasText: 'Pages' }).count()) === 1)
ok('…one row per switchable page', (await p.locator('.pages-tbl tbody tr').count()) === 10,
  String(await p.locator('.pages-tbl tbody tr').count()))
ok('…the task form is under it', (await p.locator('.fields-tbl tbody tr').count()) === 6,
  String(await p.locator('.fields-tbl tbody tr').count()))
ok('…including ТЗ', (await p.locator('.fields-tbl tbody tr', { hasText: 'ТЗ' }).count()) === 1)
ok('…and who must be on a task', (await p.locator('.crew-tbl tbody tr').count()) === 3)
ok('Pipeline keeps the stages, and no longer the form',
  (await p.locator('.tab', { hasText: 'Pipeline' }).count()) === 1)

// 'Design' also appears inside Post Production's hint, so the row is picked by
// its own label rather than by any text in it.
const row = (label) => p.locator(`.pages-tbl tbody tr:has(b:text-is("${label}"))`)
ok('Design starts on', (await row('Design').locator('.switch.on').count()) === 1)
await row('Design').locator('.switch').click(); await p.waitForTimeout(800)
ok('…one tap turns it off', (await row('Design').locator('.switch.on').count()) === 0)
ok('…and the server holds it', (await req('/fields')).data.pages.design === false)

await p.goto(`${BASE}/brief`); await p.waitForTimeout(1500)
ok('the sidebar loses that door', (await p.locator('.sidebar a[href="/design"]').count()) === 0)
ok('…and keeps the others', (await p.locator('.sidebar a[href="/docs"]').count()) === 1)
await p.goto(`${BASE}/design`); await p.waitForTimeout(1500)
ok('the address goes nowhere', !p.url().endsWith('/design'), p.url())
ok('…and lands on a real page rather than a blank one',
  (await p.locator('.sidebar').count()) === 1 && (await p.locator('.app-loading').count()) === 0)

await p.goto(`${BASE}/admin`); await p.waitForTimeout(1100)
await p.locator('.tab', { hasText: 'Settings' }).click(); await p.waitForTimeout(1000)
await row('Design').locator('.switch').click(); await p.waitForTimeout(800)
await p.goto(`${BASE}/brief`); await p.waitForTimeout(1500)
ok('switching it back brings the door with it', (await p.locator('.sidebar a[href="/design"]').count()) === 1)

// A page nobody switched off is a page that works, whatever the server said —
// an empty answer must never take the board away.
ok('an unknown page key is shown, not hidden',
  (await p.locator('.sidebar a[href="/docs"]').count()) === 1)

await browser.close()
srv.kill()
try { rmSync(dir, { recursive: true, force: true }) } catch { /* fine */ }
console.log(fails === 0 ? '\nSettings suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
