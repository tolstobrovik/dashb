// Counts as dots, everywhere a count sat in a sentence.
//
// Channel rows, the missed register and the crew deck each said the same
// thing three different ways — "3 open · 2 overdue · 5 done", "2 late",
// "3 overdue" — three short sentences where three marks would do. Read at a
// glance you are not reading them at all: you are looking for whether the red
// one is there.
//
// So the digit stays and the noun moves into the tooltip, which is where a
// legend belongs: on the thing itself, when you ask it, rather than printed
// beside every instance for ever. This suite holds the three properties that
// make that readable rather than merely shorter —
//
//   the count survives   a dot still carries its number, or it is decoration
//   zero is not drawn    a row that owes nothing looks like a row that owes
//                        nothing; "0 overdue" is a reassurance nobody asked
//                        for, taking the space that matters when it becomes 1
//   the word is reachable the noun is gone from the row, so it has to be on
//                        the mark — for the tooltip and for a screen reader
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

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin'); await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]'); await page.waitForTimeout(2200)

// ===================== the channel register =====================
await page.goto(BASE + '/admin')
// Scoped to the page: the sidebar has a "Channels" hub whose heading is a
// button too, so a bare name matches two controls.
await page.getByRole('main').getByRole('button', { name: 'Channels' }).click()
await page.waitForSelector('.chan-stats', { timeout: 10000 })
await page.waitForTimeout(400)
const stats = page.locator('.chan-stats').first()
const statsTxt = (await stats.textContent()).replace(/\s+/g, ' ')
ok('a channel row counts without saying the words',
  !/\bopen\b|\boverdue\b|\bdone\b/i.test(statsTxt.replace(/Report.*/i, '')), statsTxt.slice(0, 80))

const dots = page.locator('.chan-stats .cdot')
const n = await dots.count()
ok('…it counts with dots instead', n >= 1, `${n} dots`)
if (n) {
  const digits = (await dots.allTextContents()).map((s) => s.trim())
  ok('…each dot keeps its number', digits.every((d) => /^\d+$/.test(d)), JSON.stringify(digits))
  ok('…and none of them is a zero', digits.every((d) => d !== '0'), JSON.stringify(digits))
  const tip = await dots.first().getAttribute('data-tip')
  const aria = await dots.first().getAttribute('aria-label')
  ok('…the word the row dropped is on the mark, for a pointer', !!tip && tip.length > 2, String(tip))
  ok('…and for a screen reader, with the number in it', /^\d+\s+\S/.test(aria || ''), String(aria))
}

// ===================== a channel with nothing owed =====================
// Every count zero: the row should carry no marks at all, rather than three
// noughts explaining that nothing is wrong.
const made = await req('/channels', 'POST', { label: 'Dots Empty' })
if (made.status < 300) {
  await page.reload()
  await page.getByRole('main').getByRole('button', { name: 'Channels' }).click()
  await page.waitForSelector('.chan-stats', { timeout: 10000 }); await page.waitForTimeout(500)
  const row = page.locator('.chan-row').filter({ hasText: 'Dots Empty' }).last()
  const empty = await row.locator('.cdot').count()
  ok('a channel owing nothing wears no marks at all', empty === 0, `${empty} dots`)
  await req(`/channels/${made.data.id}`, 'DELETE')
} else {
  ok('a channel owing nothing wears no marks at all', false, `could not make one: ${made.status}`)
}

// ===================== the same vocabulary elsewhere =====================
// The point of one vocabulary is that it is one: the missed register uses the
// same mark as the channel register, not a second dialect of its own.
await page.goto(BASE + '/missed')
await page.waitForTimeout(1500)
if (await page.locator('.miss-person-split').count()) {
  const mTxt = (await page.locator('.miss-person-split').first().textContent()).replace(/\s+/g, ' ')
  ok('the missed register speaks the same way', !/\blate\b|\bopen\b/i.test(mTxt), mTxt.slice(0, 60))
  const md = await page.locator('.miss-person-split .cdot').count()
  ok('…with the same mark', md >= 1, `${md} dots`)
}

await browser.close()
console.log(fails === 0 ? '\nDots suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
