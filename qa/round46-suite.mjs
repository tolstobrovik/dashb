// Round 46: weight. A photo is already-compressed bytes, so its base64 rides
// the wire whole — twenty photographed tasks put a third of a megabyte into
// every /content answer, on every page, on every ten-second poll. Only one
// view ever draws those thumbnails: the kanban board. So the list carries a
// flag by default and the picture only where a picture is shown. These pins
// hold both halves: the lists stay light, and the board keeps its photos.
import { chromium } from 'playwright'
import { randomBytes } from 'crypto'
const BASE = 'http://localhost:4090'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const T = (await (await fetch(B + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
})).json()).token
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }
const req = async (p, m = 'GET', b) => (await fetch(B + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })).json()
const bytesOf = async (p) => (await (await fetch(B + p, { headers: H })).text()).length
const cleanup = async () => {
  for (const c of (await req('/content')).filter((c) => /^x46:/.test(c.title))) await req(`/content/${c.id}`, 'DELETE')
}
await cleanup()

// A real photo does not compress — random bytes stand in for one honestly.
const jpeg = (kb) => 'data:image/jpeg;base64,' + randomBytes(kb * 1024).toString('base64')
const sid = (await req('/statuses')).find((s) => /editing/i.test(s.label)).id
const made = []
for (let i = 0; i < 6; i++) {
  made.push(await req('/content', 'POST', {
    title: `x46: photographed ${i}`, channels: ['youtube'], type: 'post', status_id: sid,
    photo: jpeg(120), photo_thumb: jpeg(16),
  }))
}

// ---- the lists every page reads ----
const plain = await req('/content')
const mine = plain.filter((c) => /^x46:/.test(c.title))
ok('the plain list carries no thumbnails', mine.length === 6 && mine.every((c) => c.photo_thumb === undefined))
ok('…but says which tasks have one', mine.every((c) => c.has_thumb === 1))
ok('…and still never carries the full photo', mine.every((c) => c.photo === undefined && c.has_photo === 1))

// ---- the one view that draws them asks for them ----
const withThumbs = (await req('/content?thumbs=1')).filter((c) => /^x46:/.test(c.title))
ok('the board’s list carries the thumbnails', withThumbs.length === 6 && withThumbs.every((c) => typeof c.photo_thumb === 'string'))

// ---- the weight, measured ----
const light = await bytesOf('/content')
const heavy = await bytesOf('/content?thumbs=1')
ok('six photographed tasks cost the lists nothing', heavy - light > 100000 && light * 2 < heavy,
  `${(light / 1024).toFixed(0)} KB vs ${(heavy / 1024).toFixed(0)} KB`)

// ---- a write still answers with the thumbnail, so a board card updates ----
const saved = await req(`/content/${made[0].id}`, 'PATCH', { title: 'x46: photographed 0' })
ok('a saved task answers with its thumbnail', typeof saved.photo_thumb === 'string')

// ---- and the board really shows them ----
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
await ctx.addInitScript(() => localStorage.setItem('satashkent_dept_view', 'board'))
const p = await ctx.newPage()
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(BASE + '/login')
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 15000 })
await p.goto(BASE + '/dept/youtube'); await p.waitForTimeout(2200)
ok('the board still wears its photographs', (await p.locator('.tcard-photo').count()) >= 6,
  `${await p.locator('.tcard-photo').count()} cards with a photo`)
await p.goto(BASE + '/brief'); await p.waitForTimeout(1500)
ok('a page that never drew them is unharmed', (await p.locator('.brief-hero').count()) === 1)
await p.close()
await browser.close()

await cleanup()
console.log(fails === 0 ? '\nRound-46 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
