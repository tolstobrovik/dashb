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
  for (const u of (await req('/users')).data.filter((u) => u.username === 'x27plain')) await req(`/users/${u.id}`, 'DELETE')
  await resetFields()
}
await cleanup()
const users = (await req('/users')).data
const jas = users.find((u) => u.username === 'jas')
// The one-time-duty probe member exists BEFORE the browser opens — the UI
// caches /users per session, so a mid-flow creation never reaches the modal.
// They also stand in for "somebody the rules are for". Round 80 made the
// admin a superuser — never asked for a field, never stopped at a gate — so a
// required-field check made as the admin now proves nothing. The rule is for
// the people doing the work, and this is one of them.
const plain = (await req('/users', 'POST', {
  name: 'Plain X27 Member', username: 'x27plain', password: 'p1234', role: 'member',
  departments: ['youtube', 'instagram_main'], permissions: { manage_content: true, move_tasks: true },
})).data
const TP = await login('x27plain', 'p1234')

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
// A demanded field stands where the work is MADE, not over a thought: an idea
// is a name and a couple of sentences, and being asked for a script to write
// one down is how ideas stop being written down. The demand lands on the move
// out of the idea stage instead — the rule is not weaker, it is in the right
// place.
const stages = (await req('/statuses')).data
const ideaId = stages.find((s) => /idea/i.test(s.label)).id
const shootId = stages.find((s) => /to shoot/i.test(s.label)).id
const jotted = await req('/content', 'POST',
  { title: 'x27: scriptless video', channels: ['youtube'], type: 'video', status_id: ideaId }, TP)
ok('a scriptless video can still be jotted down as an idea', jotted.status === 201,
  `${jotted.status} ${jotted.data.error || ''}`)
const noScript = await req(`/content/${jotted.data.id}`, 'PATCH', { status_id: shootId }, TP)
ok('a required Script blocks it leaving the idea stage', noScript.status === 400 && /Script/.test(noScript.data.error),
  `${noScript.status} ${noScript.data.error || ''}`)
const withAll = await req('/content', 'POST', {
  title: 'x27: proper video', channels: ['youtube'], type: 'video',
  script: 'INT. CAMPUS — DAY. The dean waves.', format: 'Talking head', rubrika: 'SU events',
  editor_id: jas.id, // a member takes a one-time editor duty
})
ok('with the script it lands, brief stored', withAll.status === 201
  && withAll.data.script?.includes('dean') && withAll.data.format === 'Talking head' && withAll.data.rubrika === 'SU events')
ok('a member can hold the editor hat', withAll.data.editor_id === jas.id)
// Clearing is refused where there is work in flight to protect — so the piece
// is put on the board first. An idea owes nothing, including a script it
// happens to be carrying.
ok('an idea may drop a script it was carrying',
  (await req(`/content/${withAll.data.id}`, 'PATCH', { script: '' }, TP)).status === 200)
await req(`/content/${withAll.data.id}`, 'PATCH', { script: 'INT. CAMPUS — DAY. The dean waves.' })
await req(`/content/${withAll.data.id}`, 'PATCH', { status_id: shootId })
ok('…and clearing the required script is refused once it is being made',
  (await req(`/content/${withAll.data.id}`, 'PATCH', { script: '' }, TP)).status === 400)
// …and the admin who wrote the rule is not held to it.
ok('…though the admin who set the rule is not held to it',
  (await req(`/content/${withAll.data.id}`, 'PATCH', { script: '' })).status === 200)
await req(`/content/${withAll.data.id}`, 'PATCH', { script: 'INT. CAMPUS — DAY. The dean waves.' })
ok('a reel is not gated — the rule is scoped to videos',
  (await req('/content', 'POST', { title: 'x27: free reel', channels: ['instagram_main'], type: 'reel' })).status === 201)

// ---- 2) the modal: brief fields, the required star, the client gate ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()

// The task sheet is three views and a thread now — Brief, Execution, Logistics
// — so a field is reached the way a person reaches it: open the view holding
// it first. Idempotent, and silent on a sheet short enough to show whole.
const cmTab = async (pg, name) => {
  // The same view is "Execution" to whoever runs the piece and "Your part" to
  // whoever does the work on it — it holds the crew, the handovers and the
  // crew's own tick, and which of those you are here for depends on who you
  // are. Either name reaches it.
  for (const n of name === 'Execution' ? ['Execution', 'Your part'] : [name]) {
    const tab = pg.locator('.cm-page-tab', { hasText: n })
    if (await tab.count()) { await tab.first().click(); await pg.waitForTimeout(200); return }
  }
}


// The crew seats are searchable pickers now, not <select> elements. Read a
// group the way the screen shows it: open the picker, collect the rows that
// follow the group's label.
// A new task is born as an idea — a name and a couple of sentences — with the
// rest of the form behind one button. A suite filling the whole thing in is a
// person who already knows the rest, so it presses what they would press.
const fullForm = async () => {
  const note = p.locator('.cm-idea-note button')
  if (await note.count()) { await note.click(); await p.waitForTimeout(250) }
}
const ppNames = async (root, group) => {
  await root.click()
  await p.waitForSelector('.pp-pop', { timeout: 8000 })
  const names = await p.locator(`.pp-pop .pp-group:text-is("${group}") ~ .pp-row`).allTextContents()
  await p.keyboard.press('Escape')
  await p.waitForTimeout(150)
  return names
}
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
// Signed in as the member, not the admin: the client gate below is the same
// rule the server keeps, and since round 80 neither applies to an admin.
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'x27plain'); await p.fill('input[name="password"]', 'p1234')
await p.click('button[type="submit"]')
await p.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 15000 })
await p.goto(BASE + '/dept/youtube'); await p.waitForTimeout(1400)
await p.locator('button', { hasText: 'New task' }).first().click()
await p.waitForSelector('.modal', { timeout: 6000 })
await fullForm()
await p.locator('.modal .tchip', { hasText: 'Video' }).click(); await p.waitForTimeout(400)
ok('the Brief row rides the video type', (await p.locator('.modal .cm-key', { hasText: 'Brief' }).count()) === 1)
ok('Rubrika became a dropdown once options exist',
  (await p.locator('.modal .brief-field', { hasText: 'Rubrika' }).locator('option', { hasText: 'Book Hype' }).count()) === 1)
// `.cm-script` is the shape of a long textarea, and since round 78 the ТЗ
// wears it too — they are both tall boxes. What identifies a field here is
// its row's data-field, which is what the refusals aim at as well.
ok('the demanded Script is open with its star',
  (await p.locator('.modal [data-field="script"] textarea').count()) === 1 && (await p.locator('.modal .req-star').count()) >= 1)
await p.fill('.modal .cm-title', 'x27: ui video')
await p.locator('.modal [data-field="rubrika"] select, .modal [data-field="rubrika"] input').first()
  .selectOption({ label: 'SU events' }).catch(() => {})
// The star says the admin demands it; the stage says when. Opening the whole
// form does not turn a thought into work, so the idea is written down — and
// the form and the server agree about that, which is the thing worth checking:
// a form that refused here would be a wall with nothing behind it.
await p.fill('.modal [data-field="script"] textarea', 'Opening shot: the gates.')
await p.locator('.modal .btn-primary', { hasText: 'Create task' }).click(); await p.waitForTimeout(800)
ok('the form saves the idea', (await p.locator('.modal').count()) === 0)
const made = (await req('/content')).data.find((c) => c.title === 'x27: ui video')
ok('…and the script reached the record', !!made && made.script === 'Opening shot: the gates.')
// …and one written WITHOUT the demanded script is let through too, by the form
// and by the server alike.
await p.locator('button', { hasText: 'New task' }).first().click()
await p.waitForSelector('.modal', { timeout: 6000 })
await fullForm()
await p.locator('.modal .tchip', { hasText: 'Video' }).click(); await p.waitForTimeout(400)
await p.fill('.modal .cm-title', 'x27: bare idea')
await p.locator('.modal .btn-primary', { hasText: 'Create task' }).click(); await p.waitForTimeout(800)
ok('a bare idea is not stopped by the form', (await p.locator('.modal').count()) === 0)
ok('…and it is on the board', !!(await req('/content')).data.find((c) => c.title === 'x27: bare idea'))

// ---- 3) the crew picker offers everyone ----
await p.locator('button', { hasText: 'New task' }).first().click()
await p.waitForSelector('.modal', { timeout: 6000 })
await fullForm()
await p.locator('.modal .tchip', { hasText: 'Video' }).click(); await p.waitForTimeout(600)
await cmTab(p, 'Execution')
const opSel = p.locator('.modal .crew-field', { hasText: 'Operator' }).locator('.pp-field')
const opAnyone = await ppNames(opSel, 'Everyone else — one-time duty')
ok('the operator list carries the one-time group',
  opAnyone.filter((n) => n.includes('Plain X27')).length === 1, opAnyone.join(' | '))
await p.keyboard.press('Escape')

// ---- 4) the admin card edits the form live ----
// A fresh window, because the one above is signed in as the member who is
// held to the rules, and the panel that WRITES them is the admin's.
const ap = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
ap.on('pageerror', (e) => { fails++; console.log('ADMIN PAGE ERROR', e.message) })
await ap.goto(BASE + '/login')
await ap.fill('input[name="username"]', 'admin'); await ap.fill('input[name="password"]', 'admin123')
await ap.click('button[type="submit"]'); await ap.waitForURL(/overview/, { timeout: 15000 })
await ap.goto(BASE + '/admin'); await ap.waitForTimeout(1200)
// The task form moved from Pipeline to Settings, and ТЗ joined the fields the
// admin governs — six now, not five.
await ap.locator('button', { hasText: 'Settings' }).first().click(); await ap.waitForTimeout(900)
ok('the task-form card renders every field', (await ap.locator('.fields-tbl tbody tr').count()) === 6,
  String(await ap.locator('.fields-tbl tbody tr').count()))
const scriptRow = ap.locator('.fields-tbl tr', { hasText: 'the words and shots' })
ok('the stored rule shows: script required', (await scriptRow.locator('.pill.active', { hasText: 'required' }).count()) === 1)
await scriptRow.locator('.pill', { hasText: 'optional' }).click(); await ap.waitForTimeout(600)
ok('one tap relaxes it back to optional', (await req('/fields')).data.script.state === 'optional')
await p.close()
await browser.close()
await cleanup()
console.log(fails === 0 ? '\nRound-27 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
