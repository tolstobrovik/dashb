// Round 27: the video brief. Format / Rubrika / Script live on the task card,
// the admin tunes each field (off / optional / required, per type, with
// option lists) in Admin → Pipeline → The task form, a required field blocks
// creation server-side AND client-side, and the crew pickers now offer
// everyone — a member can take a one-time editor or operator duty.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const DEFAULT_FORMAT = { state: 'optional', types: ['reel', 'video'], options: ['Talking head', 'Split screen', 'Voiceover', 'Interview', 'Vlog', 'Skit'] }
const resetFields = () => req('/fields', 'POST', {
  format: DEFAULT_FORMAT,
  rubrika: { state: 'optional', types: ['post', 'reel', 'story', 'video', 'other'], options: [] },
  script: { state: 'optional', types: ['reel', 'video'] },
})
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x27:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
  await resetFields()
}
await cleanup()
const users = (await req('/users')).data
const jas = users.find((u) => u.username === 'jas')

// ---- 1) the API contract: defaults, admin writes, the required gate ----
const eff = (await req('/fields')).data
ok('defaults: Format is optional on filmed types with its presets',
  eff.format?.state === 'optional' && eff.format.types.includes('video') && eff.format.options.includes('Talking head'))
const jasT = await login('jas', 'j1234')
ok('members cannot rewrite the task form', (await req('/fields', 'POST', { format: { state: 'off' } }, jasT)).status === 403)
await req('/fields', 'POST', {
  script: { state: 'required', types: ['video'] },
  rubrika: { state: 'optional', types: ['post', 'reel', 'story', 'video', 'other'], options: ['SU events', 'Book Hype'] },
})
const noScript = await req('/content', 'POST', { title: 'x27: scriptless video', channels: ['youtube'], type: 'video' })
ok('a required Script blocks creating the video', noScript.status === 400 && /Script/.test(noScript.data.error))
const withAll = await req('/content', 'POST', {
  title: 'x27: proper video', channels: ['youtube'], type: 'video',
  script: 'INT. CAMPUS — DAY. The dean waves.', format: 'Talking head', rubrika: 'SU events',
  editor_id: jas.id, // a member takes a one-time editor duty
})
ok('with the script it lands, brief stored', withAll.status === 201
  && withAll.data.script?.includes('dean') && withAll.data.format === 'Talking head' && withAll.data.rubrika === 'SU events')
ok('a member can hold the editor hat', withAll.data.editor_id === jas.id)
ok('…and clearing the required script is refused',
  (await req(`/content/${withAll.data.id}`, 'PATCH', { script: '' })).status === 400)
ok('a reel is not gated — the rule is scoped to videos',
  (await req('/content', 'POST', { title: 'x27: free reel', channels: ['instagram_main'], type: 'reel' })).status === 201)

// ---- 2) the modal: brief fields, the required star, the client gate ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.goto(BASE + '/dept/youtube'); await p.waitForTimeout(1000)
await p.locator('button', { hasText: 'New task' }).first().click()
await p.waitForSelector('.modal', { timeout: 6000 })
await p.locator('.modal .tchip', { hasText: 'Video' }).click(); await p.waitForTimeout(400)
ok('the Brief row rides the video type', (await p.locator('.modal .cm-key', { hasText: 'Brief' }).count()) === 1)
ok('Rubrika became a dropdown once options exist',
  (await p.locator('.modal .brief-field', { hasText: 'Rubrika' }).locator('option', { hasText: 'Book Hype' }).count()) === 1)
ok('the demanded Script is open with its star',
  (await p.locator('.modal .cm-script').count()) === 1 && (await p.locator('.modal .req-star').count()) >= 1)
await p.fill('.modal .cm-title', 'x27: ui video')
await p.locator('.modal .btn-primary', { hasText: 'Create task' }).click(); await p.waitForTimeout(500)
ok('the client refuses to save without the script',
  (await p.locator('.modal').count()) === 1 && /Script/.test(await p.locator('.modal').textContent()))
await p.fill('.modal .cm-script', 'Opening shot: the gates.')
await p.locator('.modal .btn-primary', { hasText: 'Create task' }).click(); await p.waitForTimeout(800)
ok('with the script written it saves', (await p.locator('.modal').count()) === 0)
const made = (await req('/content')).data.find((c) => c.title === 'x27: ui video')
ok('…and the script reached the record', !!made && made.script === 'Opening shot: the gates.')

// ---- 3) the crew picker offers everyone ----
await p.locator('button', { hasText: 'New task' }).first().click()
await p.waitForSelector('.modal', { timeout: 6000 })
await p.locator('.modal .tchip', { hasText: 'Video' }).click(); await p.waitForTimeout(300)
const opSel = p.locator('.modal .crew-field', { hasText: 'Operator' }).locator('select')
ok('the operator list carries the one-time group',
  (await opSel.locator('optgroup[label*="Everyone"] option', { hasText: jas.name.split(' ')[0] }).count()) === 1)
await p.keyboard.press('Escape')

// ---- 4) the admin card edits the form live ----
await p.goto(BASE + '/admin'); await p.waitForTimeout(800)
await p.locator('button', { hasText: 'Pipeline' }).first().click(); await p.waitForTimeout(800)
ok('the task-form card renders all five fields', (await p.locator('.fields-tbl tbody tr').count()) === 5)
const scriptRow = p.locator('.fields-tbl tr', { hasText: 'the words and shots' })
ok('the stored rule shows: script required', (await scriptRow.locator('.pill.active', { hasText: 'required' }).count()) === 1)
await scriptRow.locator('.pill', { hasText: 'optional' }).click(); await p.waitForTimeout(600)
ok('one tap relaxes it back to optional', (await req('/fields')).data.script.state === 'optional')
await p.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-27 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
