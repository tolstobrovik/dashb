// A day on an idea is not a promise.
//
// The board has always said an idea may be shoved along by anybody: no
// move_tasks ticket, no waiting on whoever's name is on it, because a thought
// nobody has committed to is not work anybody is holding. That was true of an
// idea's STAGE and false of its DAYS, and nothing in the code said why — the
// same request computed `wasAnIdea`, used it for the stage, and then ran the
// date rules straight past it. So a member dragging a thought from one square
// of the calendar to another was told to go and ask an admin.
//
// Both date gates step aside while it is an idea, and both come back the
// moment it stops being one. That second half is the point: this is a
// carve-out for thoughts, not a hole in the schedule.
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
const stamp = Date.now()
const statuses = (await req('/statuses')).data
const idea = statuses.find((s) => /idea/i.test(s.label)).id
const shoot = statuses.find((s) => /to\s*shoot/i.test(s.label)).id
const published = statuses.find((s) => s.is_final && !/deleted/i.test(s.label)).id

// Somebody with no date rights at all, and somebody with the ordinary ones.
const plain = (await req('/users', 'POST', { name: 'Idea Plain', username: `ip${stamp}`, password: 'p1234', departments: ['youtube'] })).data
const P = await login(`ip${stamp}`, 'p1234')
const mover = (await req('/users', 'POST', { name: 'Idea Mover', username: `im${stamp}`, password: 'm1234', departments: ['youtube'], permissions: { manage_content: true } })).data
const M = await login(`im${stamp}`, 'm1234')

const make = async (status_id, extra = {}) => (await req('/content', 'POST', {
  title: `idea-date ${stamp} ${status_id}`, type: 'video', channels: ['youtube'],
  status_id, release_date: '2026-11-10', ...extra,
})).data
const dayOf = async (id) => (await req(`/content/${id}`)).data.release_date

// ===================== while it is a thought =====================
let t = await make(idea)
ok('a member moves an idea’s day', (await req(`/content/${t.id}`, 'PATCH', { release_date: '2026-11-17' }, M)).status === 200)
ok('…and it really moved', (await dayOf(t.id)) === '2026-11-17', await dayOf(t.id))

t = await make(idea)
ok('…so does somebody with no date rights at all — an idea needs no ticket',
  (await req(`/content/${t.id}`, 'PATCH', { release_date: '2026-11-18' }, P)).status === 200)
ok('…and that one moved too', (await dayOf(t.id)) === '2026-11-18', await dayOf(t.id))

t = await make(idea)
ok('a shoot day can be put on an idea as freely',
  (await req(`/content/${t.id}`, 'PATCH', { recording_date: '2026-11-20' }, M)).status === 200)

// ===================== the moment it stops being one =====================
t = await make(published)
let r = await req(`/content/${t.id}`, 'PATCH', { release_date: '2026-11-17' }, M)
ok('a day already promised still needs an admin', r.status === 403, `${r.status} ${r.data.error || ''}`)
ok('…and still offers the ask instead of a dead end', !!r.data.ask_to_move, JSON.stringify(r.data.ask_to_move))
ok('…and the day did not move', (await dayOf(t.id)) === '2026-11-10', await dayOf(t.id))

t = await make(shoot, { operator_id: mover.id, recording_date: '2026-11-12' })
r = await req(`/content/${t.id}`, 'PATCH', { release_date: '2026-11-17' }, M)
ok('work being made keeps its settled days', r.status === 403, `${r.status} ${r.data.error || ''}`)
ok('…and that day did not move either', (await dayOf(t.id)) === '2026-11-10', await dayOf(t.id))

t = await make(published)
ok('somebody with no date rights is still refused off an idea',
  (await req(`/content/${t.id}`, 'PATCH', { release_date: '2026-11-19' }, P)).status === 403)

// ===================== and the form has to agree =====================
// The server was opened first and the sheet was not, so a content maker
// opening an idea still met a read-only picker and the words "only an admin
// moves it" over a day the API would have taken. A form that refuses what the
// server accepts is a wall with nothing behind it, and it is invisible to
// every check that only ever talks to the API — which is why this half is
// asked in a browser.
const { chromium } = await import('playwright')
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', `im${stamp}`); await page.fill('input[name="password"]', 'm1234')
await page.click('button[type="submit"]'); await page.waitForTimeout(2400)

const releaseRow = async (id) => {
  await page.goto(`${BASE}/brief?task=${id}`); await page.waitForTimeout(2000)
  const more = page.locator('.cm-add-details')
  if (await more.count()) { await more.click(); await page.waitForTimeout(700) }
  return page.evaluate(() => {
    const row = [...document.querySelectorAll('.modal .drow, .modal .cm-row')].find((x) => /Release/i.test(x.textContent || ''))
    if (!row) return { found: false }
    const inp = row.querySelector('input[type="date"]')
    return { found: true, editable: !!inp && !inp.readOnly && !inp.disabled, promised: /promised|ask an admin/i.test(row.textContent || '') }
  })
}
const anIdea = await make(idea)
let ui = await releaseRow(anIdea.id)
ok('the sheet offers an idea’s day to a content maker', ui.found && ui.editable, JSON.stringify(ui))
ok('…and does not tell them to go and ask an admin', ui.found && !ui.promised, JSON.stringify(ui))

const promisedOne = await make(published)
ui = await releaseRow(promisedOne.id)
ok('a promised day is still read-only in the sheet', ui.found && !ui.editable, JSON.stringify(ui))
ok('…and still says who moves it', ui.found && ui.promised, JSON.stringify(ui))
await browser.close()

await req(`/users/${plain.id}`, 'DELETE')
await req(`/users/${mover.id}`, 'DELETE')
console.log(fails === 0 ? '\nIdea-date suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
