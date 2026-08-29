// Round 43: (1) WHO must be on a task is the admin's call — /fields carries
// crew rules (operator/editor/designer × types), the Admin → Pipeline card
// edits them, and the Unassigned page stops shouting for hats the admin
// unticked; (2) the post-prod lanes tell the files apart — the operator's
// FOOTAGE (source, outlined) vs the editor's own CUT (brand) — and the
// modal's delivery fields say whose file each one is; (3) the minimal pass
// landed (section titles read as quiet caps labels). Runs on the main 4090.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const cleanup = async () => {
  for (const c of (await req('/content')).data.filter((c) => /x43:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
  for (const u of (await req('/users')).data.filter((u) => u.username === 'x43ed')) await req(`/users/${u.id}`, 'DELETE')
  await req('/fields', 'POST', { crew: { operator: ['reel', 'video'], editor: ['reel', 'video'], designer: ['post'] } })
}
await cleanup()

// ---- the crew rules live on /fields ----
let f = (await req('/fields')).data
ok('/fields carries the crew rules with sane defaults',
  JSON.stringify(f.crew) === JSON.stringify({ operator: ['reel', 'video'], editor: ['reel', 'video'], designer: ['post'] }), JSON.stringify(f.crew))
f = (await req('/fields', 'POST', { crew: { designer: [] } })).data
ok('a partial update touches only the sent hat', f.crew.designer.length === 0 && f.crew.operator.includes('video'))
ok('restoring the rule round-trips', (await req('/fields', 'POST', { crew: { designer: ['post'] } })).status === 200)

// ---- the task honors them ----
const sts = (await req('/statuses')).data
const sid = (re) => sts.find((s) => re.test(s.label)).id
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const admin = (await req('/users')).data.find((u) => u.username === 'admin')
// owner + release set → the designer is this post's ONLY possible gap
const post = (await req('/content', 'POST', {
  title: 'x43: bare post', channels: ['youtube'], type: 'post',
  assignee_ids: [admin.id], release_date: today, status_id: sid(/^editing$/i),
})).data

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
const openPost = async () => {
  await p.goto(`${BASE}/brief?task=${post.id}`)
  await p.waitForSelector('.modal .cm-title', { timeout: 10000 })
  await p.waitForTimeout(700)
}
await openPost()
ok('by default a bare post begs for its designer',
  (await p.locator('.cm-gaps .chip-gap', { hasText: 'needs a designer' }).count()) === 1)
await req('/fields', 'POST', { crew: { designer: [] } })
await openPost()
ok('…untick the rule and the begging stops', (await p.locator('.cm-gaps .chip-gap', { hasText: 'needs a designer' }).count()) === 0)
ok('…and with its last hole filled the task owes nothing at all', (await p.locator('.cm-gaps').count()) === 0)
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
await req('/fields', 'POST', { crew: { designer: ['post'] } })

// ---- the Admin card edits the rules ----
await p.goto(BASE + '/admin'); await p.waitForTimeout(900)
await p.locator('.tab', { hasText: 'Pipeline' }).click(); await p.waitForTimeout(900)
ok('Pipeline shows "Who must be on a task"', (await p.locator('.section-head', { hasText: 'Who must be on a task' }).count()) === 1)
const dRow = p.locator('.crew-tbl tr', { hasText: 'who draws the artwork' })
ok('the Designer row wears its Post pill', (await dRow.locator('.pill.active', { hasText: 'Post' }).count()) === 1)
await dRow.locator('.pill', { hasText: 'Post' }).click()
await p.waitForTimeout(700)
ok('one click switches the rule off for real', ((await req('/fields')).data.crew.designer || []).length === 0)
await dRow.locator('.pill', { hasText: 'Post' }).click()
await p.waitForTimeout(700)
ok('…and back on', ((await req('/fields')).data.crew.designer || []).includes('post'))
await p.close()

// ---- post-prod: the files told apart ----
const ed = (await req('/users', 'POST', { name: 'X43 Editor', username: 'x43ed', password: 'probe123', role: 'editor', departments: ['youtube'] })).data
const vid = (await req('/content', 'POST', {
  title: 'x43: cut me', channels: ['youtube'], type: 'video', editor_id: ed.id,
  edit_ready_date: today, status_id: sid(/editing/i),
  shot_link: 'https://drive.google.com/x43raw', ready_link: 'https://drive.google.com/x43cut',
})).data
const p2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage()
p2.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p2.goto(BASE + '/login')
await p2.fill('input[name="username"]', 'x43ed'); await p2.fill('input[name="password"]', 'probe123')
await p2.click('button[type="submit"]'); await p2.waitForTimeout(1800)
await p2.goto(BASE + '/brief'); await p2.waitForTimeout(1500)
const row = p2.locator('.cb-row', { hasText: 'x43: cut me' })
if ((await row.count()) === 0) { await p2.reload(); await p2.waitForTimeout(1800) } // sandbox-flake reload
ok('the editor’s desk shows the task', (await row.count()) === 1)
if (await row.count()) {
  const src = row.locator('a.cb-link-src', { hasText: 'Footage' })
  const mine = row.locator('a.cb-link-mine', { hasText: 'Cut' })
  ok('the FOOTAGE chip is the operator’s source', (await src.count()) === 1 && (await src.getAttribute('href')) === 'https://drive.google.com/x43raw')
  ok('the CUT chip is the editor’s own file', (await mine.count()) === 1 && (await mine.getAttribute('href')) === 'https://drive.google.com/x43cut')
  ok('…and they dress differently', (await src.evaluate((el) => getComputedStyle(el).borderColor)) !== (await mine.evaluate((el) => getComputedStyle(el).borderColor)))
  // the modal says whose file each one is
  await row.click(); await p2.waitForTimeout(1000)
  ok('the modal names the raw material', (await p2.locator('.crew-label', { hasText: 'the operator’s raw material' }).count()) === 1)
  ok('…and the finished cut', (await p2.locator('.crew-label', { hasText: 'the editor’s finished cut' }).count()) === 1)
} else { fails += 5 }
await p2.close()

// ---- the minimal pass: section titles are quiet caps labels ----
const p3 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage()
await p3.goto(BASE + '/login')
await p3.fill('input[name="username"]', 'admin'); await p3.fill('input[name="password"]', 'admin123')
await p3.click('button[type="submit"]'); await p3.waitForURL(/overview/, { timeout: 15000 })
await p3.waitForTimeout(800)
const h2 = p3.locator('.section-head h2').first()
ok('section titles read as small caps labels', (await h2.evaluate((el) => {
  const s = getComputedStyle(el)
  return `${s.textTransform}|${Math.round(parseFloat(s.fontSize))}`
})) === 'uppercase|13')
await p3.close()
await browser.close()

await cleanup()
console.log(fails === 0 ? '\nRound-43 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
