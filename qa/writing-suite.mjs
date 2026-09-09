// A channel where the work is written, not filmed.
//
// Telegram is that channel: nothing is shot for it, nothing is handed to an
// editor, nothing waits on a cut. So its board is Idea → Writing → Published
// and it has no Recording calendar. Everything else — YouTube, Instagram —
// keeps the full pipeline and the Recording tab, which is the half of this
// that is easiest to break by accident.
//
// The stages underneath do not change: a Telegram post in "Editing" is the
// same row in the same table, shown under the word the work actually has.
//
// Wants a seeded stack on 4090 (qa/seed.mjs).
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
const API = BASE + '/api'
let fails = 0
const ok = (c, m, x) => { console.log((c ? '✔ ' : '✘ ') + m + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); if (!c) fails++ }

const login = async (u, p) => (await (await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b) => {
  const r = await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: b ? JSON.stringify(b) : undefined })
  const d = await r.json().catch(() => ({}))
  if (r.status >= 400) console.log('  ERR', m, p, r.status, JSON.stringify(d).slice(0, 160))
  return d
}

const statuses = await req('/statuses')
const byLabel = (re) => statuses.find((s) => re.test(s.label))
const idea = byLabel(/idea/i), toShoot = byLabel(/to shoot/i), editing = byLabel(/editing/i)
const ready = byLabel(/^ready$/i), published = statuses.find((s) => s.is_final)
ok(!!(idea && toShoot && editing && ready && published), 'the shipped pipeline is six rows',
  statuses.map((s) => s.label))

// Put one Telegram task in every stage, including the two the board folds —
// the whole point is that none of them falls off.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const mk = (title, status_id) => req('/content', 'POST',
  { title, channels: ['telegram_main'], type: 'post', release_date: today, status_id })
const made = {}
for (const [name, st] of [['idea', idea], ['toshoot', toShoot], ['editing', editing], ['ready', ready], ['published', published]]) {
  made[name] = await mk(`w-suite ${name} ${Date.now()}`, st.id)
}
ok(Object.values(made).every((t) => t.id), 'a Telegram task in each of the five working stages')

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
const p = await ctx.newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin')
await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]')
await p.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20000 })

// Leave the Recording calendar open somewhere it exists, so the fallback on a
// written channel is actually exercised rather than assumed.
await p.goto(BASE + '/dept/youtube')
await p.waitForSelector('.pill-group', { timeout: 20000 })
await p.waitForTimeout(900)
const ytPills = await p.locator('.pill-group').first().textContent()
ok(/Recording/.test(ytPills), 'YouTube keeps its Recording tab', ytPills.trim())
await p.locator('.pill-group .pill', { hasText: 'Recording' }).first().click()
await p.waitForTimeout(900)
ok(await p.evaluate(() => localStorage.getItem('satashkent_dept_view')) === 'recording',
  'and the browser remembers it')

// ---------- the written channel ----------
await p.goto(BASE + '/dept/telegram_main')
await p.waitForSelector('.pill-group', { timeout: 20000 })
await p.waitForTimeout(1200)
const tgPills = await p.locator('.pill-group').first().textContent()
ok(!/Recording/.test(tgPills), 'Telegram has no Recording tab', tgPills.trim())
ok(/Board/.test(tgPills) && /Release/.test(tgPills), 'and still has Board and Releases', tgPills.trim())
ok(!p.url().includes('recording'), 'a remembered Recording view does not strand it')
const shown = await p.locator('.pill-group .pill.active').first().textContent()
ok(!/Recording/.test(shown), 'the active tab is not Recording', shown.trim())

// The board itself.
await p.locator('.pill-group .pill', { hasText: 'Board' }).first().click()
await p.waitForTimeout(1200)
const heads = await p.locator('.board-col-head').allTextContents()
const words = heads.map((h) => h.replace(/\d+$/, '').trim())
ok(words.some((w) => /^Idea/.test(w)), 'the board opens on Idea', words)
ok(words.some((w) => /^Writing/.test(w)), '…then Writing', words)
ok(words.some((w) => /^Published/.test(w)), '…then Published', words)
ok(!words.some((w) => /To shoot/i.test(w)), 'no To shoot column', words)
ok(!words.some((w) => /^Ready/i.test(w)), 'no Ready column', words)
ok(!words.some((w) => /^Editing/i.test(w)), 'and Editing is called Writing here, not both', words)
ok(words.filter((w) => !/Deleted/i.test(w)).length === 3, 'three working columns, and the graveyard', words)

// Nothing fell off: every one of the five tasks is on the board somewhere.
const board = await p.locator('.board').textContent()
for (const [name, t] of Object.entries(made)) {
  ok(board.includes(t.title), `the ${name} task is still on the board`)
}
// …and the two folded stages sit under Writing.
const writingCol = p.locator('.board-col').filter({ has: p.locator('.board-col-head', { hasText: 'Writing' }) }).first()
const writingText = await writingCol.textContent()
ok(writingText.includes(made.toshoot.title), 'the To shoot task shows under Writing')
ok(writingText.includes(made.ready.title), 'and so does the Ready one')
ok(writingText.includes(made.editing.title), 'along with the one actually in Editing')
const ideaCol = p.locator('.board-col').filter({ has: p.locator('.board-col-head', { hasText: 'Idea' }) }).first()
ok((await ideaCol.textContent()).includes(made.idea.title), 'Idea keeps its own')

// The stage filter offers the three this channel runs on, under the same
// words — and picking Writing finds everything the Writing column showed,
// including the pieces absorbed into it.
const stageSel = p.locator('.cf-sel').last()
const opts = (await stageSel.locator('option').allTextContents()).map((o) => o.trim())
ok(!opts.some((o) => /Editing|To shoot|^Ready$/i.test(o)), 'the stage filter drops the stages this board has not got', opts)
ok(opts.some((o) => /Writing/i.test(o)), '…and offers Writing', opts)
await stageSel.selectOption({ label: opts.find((o) => /Writing/i.test(o)) })
await p.waitForTimeout(1100)
const filtered = await p.locator('.board').textContent()
ok(filtered.includes(made.editing.title) && filtered.includes(made.toshoot.title) && filtered.includes(made.ready.title),
  'filtering by Writing keeps everything the Writing column had')
ok(!filtered.includes(made.idea.title), '…and drops what it did not')
await stageSel.selectOption('')
await p.waitForTimeout(900)

// The word is the same everywhere on the page, not just on the board.
await p.locator('.pill-group .pill', { hasText: 'Release' }).first().click()
await p.waitForTimeout(1200)
const legend = (await p.locator('.cal-legend').first().textContent()).trim()
ok(/Writing/.test(legend), 'the calendar legend says Writing too', legend.slice(0, 140))
ok(!/Editing/.test(legend), '…and does not also say Editing', legend.slice(0, 140))
// The pills on the month itself carry the stage word as well.
const cal = await p.locator('.content').textContent()
ok(!/\bEditing\b/.test(cal.replace(legend, '')), 'nor does anything else on this channel page', 'ok')

// ---------- nothing changed underneath ----------
const after = await req(`/content/${made.editing.id}`)
ok(after.status_id === editing.id, 'the task is still in the Editing stage in the database', after.status_id)
const stillSix = await req('/statuses')
ok(stillSix.length === statuses.length && stillSix.every((s, i) => s.label === statuses[i].label),
  'and the pipeline itself was not renamed', stillSix.map((s) => s.label))

// ---------- the rest of the board is untouched ----------
await p.goto(BASE + '/dept/youtube')
await p.waitForSelector('.pill-group', { timeout: 20000 })
await p.waitForTimeout(1200)
await p.locator('.pill-group .pill', { hasText: 'Board' }).first().click()
await p.waitForTimeout(1200)
const ytHeads = (await p.locator('.board-col-head').allTextContents()).map((h) => h.replace(/\d+$/, '').trim())
ok(ytHeads.some((w) => /To shoot/i.test(w)) && ytHeads.some((w) => /Editing/i.test(w)) && ytHeads.some((w) => /Ready/i.test(w)),
  'YouTube still has the full pipeline', ytHeads)
ok(!ytHeads.some((w) => /Writing/i.test(w)), 'and nobody renamed Editing there', ytHeads)

await ctx.close()
await browser.close()
// tidy up after ourselves
for (const t of Object.values(made)) await req(`/content/${t.id}`, 'DELETE').catch(() => {})
console.log(fails ? `\nFAILED ${fails}` : '\nWriting-channel suite clean.')
process.exit(fails ? 1 : 0)
