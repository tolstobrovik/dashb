// Login hardening + admin recovery, driven for real across server restarts.
import { spawn } from 'child_process'
import { chromium } from 'playwright'
const PORT = 4092
const BASE = `http://localhost:${PORT}`
const DATA = '/tmp/claude-0/-home-user-dashb/e1e8e6e3-0252-58c0-8ecc-a3edec104fdd/scratchpad/logindata'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

let proc = null
const start = async () => {
  proc = spawn('node', ['/home/user/dashb/server/index.js'], { env: { ...process.env, STORAGE: 'file', DATA_DIR: DATA, PORT: String(PORT) }, stdio: 'ignore' })
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return } catch { /* boot */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('server did not boot')
}
const stop = () => new Promise((r) => { proc.on('exit', r); proc.kill() })
const login = async (u, p) => {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

await import('fs').then((fs) => fs.rmSync(DATA, { recursive: true, force: true }))
await start()

// Fresh database: the documented credentials work, in every mobile-mangled form
ok('admin / admin123 signs in', (await login('admin', 'admin123')).status === 200)
ok('"Admin " (case + space in username) signs in', (await login('Admin ', 'admin123')).status === 200)
ok('trailing-space password forgiven', (await login('admin', 'admin123 ')).status === 200)
ok('leading-space password forgiven', (await login('admin', ' admin123')).status === 200)
ok('actually-wrong password still refused', (await login('admin', 'Admin123')).status === 401)
ok('unknown user refused with the same message', (await login('ghost', 'admin123')).data.error === 'Incorrect username or password')

// Lockout simulation: password changed to something forgotten, flag wiped ⇒
// next deploy restores admin123 exactly once
const T = (await login('admin', 'admin123')).data.token
const me = await (await fetch(BASE + '/api/auth/me', { headers: { Authorization: `Bearer ${T}` } })).json()
await fetch(BASE + `/api/users/${me.user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: JSON.stringify({ password: 'forgotten-Xy9' }) })
ok('password change works (old refused)', (await login('admin', 'admin123')).status === 401)
await stop()
// wipe the one-time flag to model a production DB that never ran the recovery
const { createClient } = await import('@libsql/client')
const db = createClient({ url: `file:${DATA}/dashboard.db` })
await db.execute("DELETE FROM meta WHERE key = 'admin_reset_2026_07'")
db.close()
await start()
ok('deploy recovers admin / admin123', (await login('admin', 'admin123')).status === 200)

// The recovery must NOT undo future password changes (flag persists)
const T2 = (await login('admin', 'admin123')).data.token
await fetch(BASE + `/api/users/${me.user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T2}` }, body: JSON.stringify({ password: 'my-new-secret-7' }) })
await stop()
await start()
ok('later password changes survive restarts', (await login('admin', 'my-new-secret-7')).status === 200 && (await login('admin', 'admin123')).status === 401)
// put admin123 back for the UI leg
const T3 = (await login('admin', 'my-new-secret-7')).data.token
await fetch(BASE + `/api/users/${me.user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T3}` }, body: JSON.stringify({ password: 'admin123' }) })

// UI: the form is mobile-proof and the flow works
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
await page.goto(BASE + '/login')
ok('username input blocks autocapitalize/autocorrect',
  await page.locator('input[name="username"]').evaluate((el) => el.getAttribute('autocapitalize') === 'none' && el.getAttribute('autocorrect') === 'off'))
ok('password input blocks autocapitalize even with the eye on',
  await page.locator('input[name="password"]').evaluate((el) => el.getAttribute('autocapitalize') === 'none' && el.getAttribute('autocomplete') === 'current-password'))
await page.fill('input[name="username"]', 'Admin')
await page.fill('input[name="password"]', 'admin123 ')
await page.click('button[type="submit"]')
await page.waitForURL(/overview|todo|dept/, { timeout: 15000 }).catch(() => {})
ok('UI login succeeds despite mobile mangling', !page.url().includes('/login'), page.url())
await browser.close()
await stop()

console.log(fails === 0 ? '\nLogin & recovery clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
