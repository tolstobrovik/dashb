// An idea moves on the calendar; nothing else starts to.
//
// The board has said since the idea carve-out went in that a thought nobody
// has promised anything about may be shoved around by whoever can see it —
// no move_tasks, no asking an admin. The SERVER said it (content.js,
// `wasAnIdea`) and the kanban said it (ContentBoard's canDrag). The calendar
// did not: its drag gate was one page-level boolean, `can(user, 'move_tasks')`,
// so an idea sat still in the month grid for exactly the people the carve-out
// was written for. Nothing refused them — the card simply never lifted, which
// reads as the board being broken rather than as a rule.
//
// What makes this worth a suite of its own is that the two halves fail in
// opposite directions and only one of them is visible. Widening the gate to
// "anybody may drag anything" would look identical on the screen this tests
// and would quietly hand every member the schedule. So both are asked:
//
//   an idea            a member with no move_tasks drags it to a new day and
//                      the day sticks
//   anything else      the same member, the same gesture, and the piece does
//                      not move — the pill never lifts and no PATCH is sent
//
// It drives a real browser because the bug was entirely in the pointer
// handler: every API call underneath it already answered correctly, which is
// why an API-level test would have passed throughout.
//
// Self-contained: port 4123.
import { spawn } from 'child_process'
import { chromium } from 'playwright'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = new URL('.', import.meta.url).pathname
const PORT = 4123
const B = `http://localhost:${PORT}`

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
procs.push(spawn(process.execPath, [ROOT + '/server/index.js'],
  { env: { ...process.env, DATA_DIR: SP + 'idrag-' + Date.now(), PORT: String(PORT) }, stdio: 'ignore' }))
const up = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(B + '/api/health')).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('the stack is up', await up())

const login = async (u, p) => (await (await fetch(B + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const api = async (path, tok, opts = {}) => {
  const r = await fetch(B + '/api' + path, { ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}`, ...(opts.headers || {}) } })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (n) => {
  const d = new Date(Date.now() + 5 * 3600e3)   // the Tashkent day, like the server
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const stages = (await api('/statuses', T)).data
const idea = stages.find((s) => /^idea/i.test(s.label))
const later = stages.find((s) => /to\s*shoot/i.test(s.label)) || stages[1]
const ch = (await api('/channels', T)).data[0].key

// The person the carve-out is for: on the channel, and holding neither of the
// permissions that would let them move a date on their own account. Every
// seeded member has move_tasks switched ON, so none of them can stand in for
// this — the one being tested has to be built.
const stamp = Date.now().toString().slice(-6)
const made = await api('/users', T, { method: 'POST', body: JSON.stringify({
  name: `Idea Drag ${stamp}`, username: `idrag${stamp}`, password: 'probe-only-123', role: 'member' }) })
await api(`/users/${made.data.id}`, T, { method: 'PATCH', body: JSON.stringify({
  departments: [ch],
  permissions: { manage_content: false, move_tasks: false, review_publish: false, request_changes: false,
    deliver_work: true, edit_metrics: false, manage_metrics: false, manage_layout: false, manage_ambassadors: false },
}) })
const me = (await api('/users', T)).data.find((u) => u.id === made.data.id)
ok('the member is on the channel and holds neither moving right',
  me?.departments?.includes(ch) && !me?.permissions?.move_tasks && !me?.permissions?.manage_content,
  JSON.stringify({ on: me?.departments, move: me?.permissions?.move_tasks, manage: me?.permissions?.manage_content }))

const task = async (title, status_id) => (await api('/content', T, { method: 'POST', body: JSON.stringify({
  title, channels: [ch], type: 'reel', status_id, release_date: day(2) }) })).data

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 } })
// The webfont is fetched from Google and this sandbox cannot always reach it.
// Nothing here is about type, and page.goto waits for it.
await ctx.route('**fonts.g**', (r) => r.abort())
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
const patches = []
page.on('request', (r) => { if (r.method() === 'PATCH') patches.push(r.url()) })

await page.goto(B + '/login', { waitUntil: 'domcontentloaded' })
await page.fill('input[name=username]', `idrag${stamp}`)
await page.fill('input[name=password]', 'probe-only-123')
await page.click('button[type=submit]')
await page.waitForTimeout(2500)

// Drag whatever pill carries `title` two days to the right, and say what the
// day became.
const dragIt = async (t, where = '/releases') => {
  await page.goto(B + where, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2200)
  const pill = page.locator('.rel-ev', { hasText: t.title }).first()
  if (!(await pill.count())) return { found: false }
  const box = await pill.boundingBox()
  const cells = await page.evaluate(() => [...document.querySelectorAll('[data-drop]')]
    .filter((e) => e.getAttribute('data-drop') !== 'tray')
    .map((e) => { const r = e.getBoundingClientRect()
      return { iso: e.getAttribute('data-drop'), x: r.x, y: r.y, w: r.width, h: r.height } }))
  const to = cells.find((c) => c.iso === day(4))
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 3, { steps: 5 })
  await page.waitForTimeout(180)
  const lifted = await page.evaluate(() => !!document.querySelector('.rel-ev.dim'))
  if (to) { await page.mouse.move(to.x + to.w / 2, to.y + to.h / 2, { steps: 12 }); await page.waitForTimeout(220) }
  await page.mouse.up()
  await page.waitForTimeout(2200)
  const after = (await api(`/content/${t.id}`, T)).data.release_date
  return { found: true, lifted, after }
}

// ---- an idea moves ----
const thought = await task(`idea ${stamp}`, idea.id)
const a = await dragIt(thought)
ok('the idea is on the calendar', a.found)
ok('…and the pill lifts for somebody with no move_tasks', a.lifted === true)
ok('…and the day it was dropped on is the day it keeps', a.after === day(4), `${a.after} (wanted ${day(4)})`)

// ---- nothing else does ----
const booked = await task(`booked ${stamp}`, later.id)
patches.length = 0
const c = await dragIt(booked)
ok('a piece past the idea stage is on the calendar too', c.found)
ok('…but its pill never lifts', c.lifted === false)
ok('…so nothing is sent for it', patches.length === 0, JSON.stringify(patches))
ok('…and its day is untouched', c.after === day(2), `${c.after} (wanted ${day(2)})`)

// ---- and the chain holds when a card is dragged ----
// The form has always cascaded: shoot, then cut, then out, keeping the gaps
// the plan had. The calendar sent the one day it was given, so a card dragged
// forward left its cut stranded before the footage existed — the board showing
// a plan it would refuse if you typed it in. Same rule, two paths, one of them
// forgotten. Dragged here, not called directly, because the helper was never
// the broken part.
const chained = await api('/content', T, { method: 'POST', body: JSON.stringify({
  title: `chain ${stamp}`, channels: [ch], type: 'reel', status_id: idea.id,
  recording_date: day(0), edit_ready_date: day(1), release_date: day(2) }) })
// Dragged on RECORDINGS, so the day that moves is the shoot — the first link,
// with a cut and a release behind it. Dragging the release instead would prove
// nothing: it is last in the chain and has nothing to push.
await dragIt({ ...chained.data, title: `chain ${stamp}` }, '/recordings')
const whole = (await api(`/content/${chained.data.id}`, T)).data
ok('the shoot lands where it was dropped', whole.recording_date === day(4),
  `${whole.recording_date} (wanted ${day(4)})`)
ok('…and the cut came with it rather than staying before the footage',
  whole.edit_ready_date >= whole.recording_date,
  JSON.stringify({ shoot: whole.recording_date, cut: whole.edit_ready_date }))
ok('…and the release stayed after the cut',
  whole.release_date >= whole.edit_ready_date,
  JSON.stringify({ cut: whole.edit_ready_date, out: whole.release_date }))
ok('…and the plan kept its shape rather than collapsing onto one day',
  whole.edit_ready_date > whole.recording_date && whole.release_date > whole.edit_ready_date,
  JSON.stringify({ shoot: whole.recording_date, cut: whole.edit_ready_date, out: whole.release_date }))

ok('no page errors throughout', errs.length === 0, JSON.stringify(errs.slice(0, 3)))
await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nIdea-drag suite clean.')
process.exit(fails ? 1 : 0)
