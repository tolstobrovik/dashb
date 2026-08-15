// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 52: a task carries real paperwork. A ТЗ in Word or a reference deck
// as PDF is attached to the task, listed by name and size, downloaded on a
// click and removed by whoever put it there. The bytes live apart from the
// task on purpose: no list, poll or board payload ever drags a brief along.
// Self-contained: its own stack on 4102, its own fixtures.
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4102'
const B = BASE + '/api'

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

boot([ROOT + '/server/index.js'], { DATA_DIR: SP + 'd52-' + Date.now(), PORT: '4102' })
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('stack is up', await up(B + '/health'))

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

const chKey = (await req('/channels')).data[0].key
const other = (await req('/channels')).data.find((c) => c.key !== chKey).key
const crew = (await req('/users', 'POST', { name: 'D52 Editor', username: 'd52ed', password: 'probe123', role: 'editor', departments: [] })).data
const outsider = (await req('/users', 'POST', { name: 'D52 Outsider', username: 'd52out', password: 'probe123', role: 'member', departments: [other] })).data
const CT = await login('d52ed', 'probe123')
const OT = await login('d52out', 'probe123')

const task = (await req('/content', 'POST', { title: 'd52: the briefed one', channels: [chKey], type: 'video', editor_id: crew.id, operator_id: 1, recording_date: '2031-03-03', edit_ready_date: '2031-03-05', release_date: '2031-03-07' })).data
const bare = (await req('/content', 'POST', { title: 'd52: no paperwork', channels: [chKey], type: 'post' })).data
ok('two fixtures exist', !!task?.id && !!bare?.id)

// A real .docx: the ZIP magic bytes are enough to prove bytes survive the trip.
const DOCX = Buffer.from('PK\x03\x04tz-for-d52-\x00\x01binary\xff', 'binary').toString('base64')
const PDF = Buffer.from('%PDF-1.7\nreference deck\n%%EOF', 'binary').toString('base64')

// ---- what is allowed through the door ----
let r = await req(`/content/${task.id}/files`, 'POST', { name: 'brief.exe', data: 'AAAA' })
ok('an executable is refused', r.status === 400 && /isn’t a document/.test(r.data.error), JSON.stringify(r.data))
r = await req(`/content/${task.id}/files`, 'POST', { name: 'tz.docx', data: '' })
ok('an empty file is refused', r.status === 400, JSON.stringify(r.data))
r = await req(`/content/${task.id}/files`, 'POST', { name: '', data: `data:application/pdf;base64,${PDF}` })
ok('a nameless file is refused', r.status === 400, JSON.stringify(r.data))
const big = 'A'.repeat(Math.ceil(4.5 * 1024 * 1024 * 4 / 3))
r = await req(`/content/${task.id}/files`, 'POST', { name: 'huge.pdf', data: `data:application/pdf;base64,${big}` })
ok('a 4.5 MB file is refused, and says its size', r.status === 413 && /4\.5 MB/.test(r.data.error), JSON.stringify(r.data).slice(0, 120))

// ---- the happy path ----
r = await req(`/content/${task.id}/files`, 'POST', { name: 'ТЗ ролик.docx', data: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${DOCX}` })
const tz = r.data
ok('a Word brief is accepted', r.status === 201 && tz.name === 'ТЗ ролик.docx', JSON.stringify(r.data).slice(0, 120))
ok('…its type is worked out from the name',
  tz.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', tz.mime)
ok('…its real size is recorded, not the base64 length',
  Math.abs(tz.size - Buffer.from(DOCX, 'base64').length) <= 2, `${tz.size}`)
ok('…and who attached it', tz.uploader === 'Admin' && tz.uploaded_by)
ok('…but the listing never carries the bytes', tz.data === undefined)

const deck = (await req(`/content/${task.id}/files`, 'POST', { name: 'refs.pdf', data: `data:application/pdf;base64,${PDF}` })).data
ok('a PDF deck lands beside it', deck.name === 'refs.pdf' && deck.mime === 'application/pdf')

// ---- where the bytes are, and where they are NOT ----
const list = (await req(`/content/${task.id}/files`)).data
ok('the task lists both documents', list.length === 2 && list.every((d) => d.data === undefined))

// Opening one hands back a ticket, not the bytes — and the ticket is what
// lets the BROWSER fetch them, so the server can name the saved file.
const opened = (await req(`/content/files/${tz.id}`)).data
ok('opening a document hands back a short-lived link, not the bytes',
  /^\/api\/content\/files\/\d+\/raw\?e=\d+&k=[0-9a-f]{32}$/.test(opened.url || '') && opened.data === undefined, opened.url)
let raw = await fetch(BASE + opened.url)
ok('…which fetches without a session, since a download carries no headers', raw.status === 200)
ok('…and returns the file whole and unchanged',
  Buffer.from(await raw.arrayBuffer()).equals(Buffer.from(DOCX, 'base64')))
const cd = raw.headers.get('content-disposition')
ok('…named by the SERVER, in Russian, the way RFC 5987 spells it',
  cd.includes(`filename*=UTF-8''${encodeURIComponent('ТЗ ролик.docx')}`), cd)
ok('…with a READABLE Latin spelling behind it, not a row of underscores',
  /filename="TZ rolik\.docx"/.test(cd), cd)
ok('…and the right content type, so Word opens it', raw.headers.get('content-type') === tz.mime)
raw = await fetch(BASE + opened.url.replace(/k=./, 'k=0'))
ok('a tampered ticket is refused', raw.status === 403)
raw = await fetch(`${BASE}/api/content/files/${tz.id}/raw?e=${Date.now() - 1000}&k=${'0'.repeat(32)}`)
ok('an expired ticket is refused', raw.status === 403)
raw = await fetch(`${BASE}/api/content/files/${tz.id}/raw`)
ok('and no ticket at all gets nothing', raw.status === 403)

const detail = (await req(`/content/${task.id}`)).data
ok('opening the task brings the paperwork with it', (detail.documents || []).length === 2)
ok('…still without the bytes', (detail.documents || []).every((d) => d.data === undefined))
const listPayload = JSON.stringify((await req(`/content?department=${chKey}`)).data)
ok('the board’s payload carries no trace of a document', !listPayload.includes(DOCX) && !listPayload.includes(PDF))
ok('…and does not even name them', !listPayload.includes('ТЗ ролик.docx'))

// ---- who may read, add and remove ----
ok('the editor on the task can read its brief', (await req(`/content/${task.id}/files`, 'GET', null, CT)).data.length === 2)
const crewDoc = (await req(`/content/${task.id}/files`, 'POST', { name: 'subs.txt', data: 'data:text/plain;base64,' + Buffer.from('00:01 hello').toString('base64') }, CT)).data
ok('…and add one of their own', crewDoc.name === 'subs.txt' && crewDoc.uploader === 'D52 Editor')
ok('a stranger to the task cannot even list them',
  (await req(`/content/${task.id}/files`, 'GET', null, OT)).status === 404)
ok('…nor reach the bytes by guessing an id',
  (await req(`/content/files/${tz.id}`, 'GET', null, OT)).status === 404)
ok('the editor cannot remove the ADMIN’s brief',
  (await req(`/content/files/${tz.id}`, 'DELETE', null, CT)).status === 403)
ok('…but can take back their own', (await req(`/content/files/${crewDoc.id}`, 'DELETE', null, CT)).status === 200)
ok('an admin can remove anybody’s', (await req(`/content/files/${deck.id}`, 'DELETE')).status === 200)
ok('what is left is exactly the brief', (await req(`/content/${task.id}/files`)).data.map((d) => d.name).join() === 'ТЗ ролик.docx')

// ---- the paper trail says it in words ----
const log = (await req(`/content/${task.id}`)).data.activity || []
ok('attaching and removing are written into the task’s history',
  log.some((a) => a.field === 'document' && a.new_value === 'ТЗ ролик.docx')
  && log.some((a) => a.field === 'document' && a.old_value === 'refs.pdf'), JSON.stringify(log.slice(0, 3)))

// ---- deleting the task takes its paperwork with it ----
const doomed = (await req('/content', 'POST', { title: 'd52: doomed', channels: [chKey], type: 'post' })).data
const doomedDoc = (await req(`/content/${doomed.id}/files`, 'POST', { name: 'x.pdf', data: `data:application/pdf;base64,${PDF}` })).data
await req(`/content/${doomed.id}`, 'DELETE')
ok('deleting a task removes its documents too', (await req(`/content/files/${doomedDoc.id}`)).status === 404)

// ---- and now with hands ----
// One plainly-named document alongside the Russian one, so the click-to-disk
// path can be checked for its name as well as its bytes.
await req(`/content/${task.id}/files`, 'POST', { name: 'refs.pdf', data: `data:application/pdf;base64,${PDF}` })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, acceptDownloads: true })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto(BASE + '/login')
await page.fill('input[autocomplete="username"], input[name="username"]', 'admin')
await page.fill('input[type="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 25000 })
await page.goto(`${BASE}/dept/${chKey}`)
await page.waitForSelector('.tcard', { timeout: 20000 })

await page.locator('.tcard-title', { hasText: 'd52: the briefed one' }).click()
await page.waitForSelector('.cm-row', { timeout: 15000 })
await page.waitForTimeout(600)
ok('the modal shows the brief that is already there',
  (await page.locator('.doc-name').allTextContents()).includes('ТЗ ролик.docx'),
  (await page.locator('.doc-name').allTextContents()).join(' / '))
ok('…with its size beside it', /KB|MB/.test(await page.locator('.doc-meta').first().textContent()))
ok('…and a Word file is coloured as a Word file', await page.locator('.doc-row.dk-doc').count() === 1)

// download it for real: click → ticket → the browser fetches it itself
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('.doc-name').first().click(),
])
const saved = readFileSync(await dl.path())
ok('clicking the name really downloads the document, byte for byte',
  saved.equals(Buffer.from(DOCX, 'base64')), `${saved.length} bytes`)
// The saved NAME is the browser's call, from the header pinned above. This
// headless build has no Unicode filename support and lands on "download";
// every shipping browser reads filename* and writes «ТЗ ролик.docx». What is
// checked here is that an ASCII name survives the whole click-to-disk path.
const [dl2] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('.doc-name', { hasText: 'refs.pdf' }).click(),
])
ok('…under the name the server states', dl2.suggestedFilename() === 'refs.pdf', dl2.suggestedFilename())

// attach a second one through the picker
await page.setInputFiles('.doc-pick input[type=file]', {
  name: 'plan.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: Buffer.from('PK\x03\x04slots', 'binary'),
})
await page.waitForTimeout(1200)
const names = await page.locator('.doc-name').allTextContents()
ok('a spreadsheet attaches from the picker and appears at once', names.includes('plan.xlsx'), names.join(' / '))
ok('…wearing the spreadsheet colour', await page.locator('.doc-row.dk-xls').count() === 1)
ok('every document on the task is listed', names.length === 3, names.join(' / '))

// the server agrees
const after = (await req(`/content/${task.id}/files`)).data.map((d) => d.name)
ok('the server holds what the screen shows', after.length === 3 && after.includes('plan.xlsx'), after.join())

// a task with no paperwork keeps the row folded away until asked
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.locator('.tcard-title', { hasText: 'd52: no paperwork' }).click()
await page.waitForTimeout(700)
ok('an empty task shows no Documents row', await page.locator('.doc-block').count() === 0)
const openBtn = page.locator('.extra-btn', { hasText: 'Documents' })
ok('…but offers to start one', await openBtn.count() === 1)
await openBtn.click()
await page.waitForTimeout(300)
ok('…and asking opens the picker with its limits spelled out',
  await page.locator('.doc-pick').count() === 1
  && /4 MB/.test(await page.locator('.doc-hint').textContent()))
ok('no page errors anywhere in the run', errs.length === 0, errs.join(' | '))

// ---- the phone: a document row must not widen the modal ----
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const mp = await m.newPage()
await mp.goto(BASE + '/login')
await mp.fill('input[autocomplete="username"], input[name="username"]', 'admin')
await mp.fill('input[type="password"]', 'admin123')
await mp.click('button[type="submit"]')
await mp.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 25000 })
await mp.goto(`${BASE}/dept/${chKey}`)
await mp.waitForSelector('.tcard', { timeout: 20000 })
await mp.locator('.tcard-title', { hasText: 'd52: the briefed one' }).click()
await mp.waitForTimeout(900)
const fit = await mp.evaluate(() => {
  const el = document.querySelector('.modal-body') || document.querySelector('.modal')
  return { over: el.scrollWidth - el.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth }
})
ok('on a phone the documents fit the modal instead of widening it', fit.over <= 0, JSON.stringify(fit))
ok('…and the page still never scrolls sideways', fit.page <= 1, JSON.stringify(fit))
ok('…the name is still there to tap', await mp.locator('.doc-name').count() >= 2)
await m.close()

await ctx.close()
await browser.close()
stop()
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-52 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
