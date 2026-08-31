// Round 84: what the work actually got.
//
// The board knew what went out and when, and nothing about whether anybody
// watched it — a month of twenty pieces and a month of three were the same
// month to a delivery report. Views are typed in by hand (nobody here is
// plugged into Instagram's API), so the questions worth asking are about who
// may type them, what an empty box means, and whether the sums that follow —
// including somebody's pay — can be trusted.
//
// Brings its own server on 4134 so it can be run alone.
import { spawn } from 'child_process'
import { chromium } from 'playwright'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const PORT = 4134
const BASE = `http://localhost:${PORT}`
const A = `${BASE}/api`
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const dir = mkdtempSync(join(tmpdir(), 'r84-'))
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const srv = spawn('node', [join(ROOT, 'server/index.js')],
  { env: { ...process.env, DATA_DIR: dir, PORT: String(PORT) }, stdio: 'ignore' })
const wait = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${A}/health`)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}
if (!(await wait())) { console.log('server never answered'); srv.kill(); process.exit(1) }

const login = async (u, p) => (await (await fetch(`${A}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(A + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (n) => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const month = { from: day(0).slice(0, 8) + '01', to: day(0) }

const ch = (await req('/channels')).data[0]?.key
const maker = (await req('/users', 'POST', {
  name: 'View Maker', username: 'vmaker', password: 'pass1234', role: 'member',
  departments: [ch], permissions: { manage_content: true },
})).data
const other = (await req('/users', 'POST', {
  name: 'Other Person', username: 'vother', password: 'pass1234', role: 'member', departments: [ch],
})).data
const MT = await login('vmaker', 'pass1234')
const OT = await login('vother', 'pass1234')
const finalId = (await req('/statuses')).data.find((s) => s.is_final).id

const make = async (title, type) => (await req('/content', 'POST', {
  title, channels: [ch], type, assignee_ids: [maker.id], release_date: day(-1),
})).data
const publish = (id) => req(`/content/${id}`, 'PATCH', { status_id: finalId })

const vid = await make('v84: the reel', 'reel')
const vid2 = await make('v84: the video', 'video')
const post = await make('v84: the post', 'post')
for (const t of [vid, vid2, post]) await publish(t.id)

// ---- 1) who may write the number ----------------------------------------
ok('the maker records the views on their own piece',
  (await req(`/content/${vid.id}`, 'PATCH', { views: 12000 }, MT)).status === 200)
ok('an admin records them too',
  (await req(`/content/${vid2.id}`, 'PATCH', { views: 3500 })).status === 200)
const nosy = await req(`/content/${post.id}`, 'PATCH', { views: 999 }, OT)
ok('somebody the piece is not for cannot', nosy.status === 403, String(nosy.status))
ok('…and the number did not move', (await req(`/content/${post.id}`)).data.views === null)

// ---- 2) what a number is -------------------------------------------------
for (const [what, v] of [['a negative count', -5], ['a fraction', 1.5], ['a word', 'lots'], ['more than the internet has', 1e11]]) {
  ok(`${what} is refused`, (await req(`/content/${vid.id}`, 'PATCH', { views: v })).status === 400)
}
ok('zero is a real answer', (await req(`/content/${post.id}`, 'PATCH', { views: 0 })).status === 200)
ok('…and is stored as zero, not as nothing', (await req(`/content/${post.id}`)).data.views === 0)
ok('clearing it means nobody has counted',
  (await req(`/content/${post.id}`, 'PATCH', { views: null })).status === 200
  && (await req(`/content/${post.id}`)).data.views === null)
const stamped = (await req(`/content/${vid.id}`)).data
ok('the board records who counted it and when', stamped.views_by === maker.id && !!stamped.views_at,
  JSON.stringify({ by: stamped.views_by, at: stamped.views_at }))

// ---- 3) the sums ---------------------------------------------------------
await req(`/content/${post.id}`, 'PATCH', { views: 0 })
const rep = (await req(`/reports/views?from=${month.from}&to=${month.to}`)).data
ok('the total is the sum of what was counted', rep.totals.views === 15500, String(rep.totals.views))
ok('…over three pieces, all of them counted', rep.totals.pieces === 3 && rep.totals.counted === 3,
  JSON.stringify(rep.totals))
ok('…with an average per counted piece', rep.totals.avg === Math.round(15500 / 3), String(rep.totals.avg))
ok('by type splits reel from video from post',
  rep.byType.find((t) => t.key === 'reel')?.views === 12000
  && rep.byType.find((t) => t.key === 'video')?.views === 3500
  && rep.byType.find((t) => t.key === 'post')?.views === 0,
  JSON.stringify(rep.byType))
ok('by channel names the channel it went out on', rep.byChannel[0]?.key === ch && rep.byChannel[0]?.views === 15500,
  JSON.stringify(rep.byChannel[0]))
ok('by content maker credits the person it was for',
  rep.byPerson.length === 1 && rep.byPerson[0].id === maker.id && rep.byPerson[0].views === 15500,
  JSON.stringify(rep.byPerson))
ok('the best piece leads the list', rep.top[0]?.title === 'v84: the reel' && rep.top[0]?.views === 12000)

// An uncounted piece is not a zero — the total has to say so rather than
// quietly reading as the whole month.
await req(`/content/${post.id}`, 'PATCH', { views: null })
const partial = (await req(`/reports/views?from=${month.from}&to=${month.to}`)).data
ok('an uncounted piece is counted as uncounted, not as nothing',
  partial.totals.views === 15500 && partial.totals.counted === 2 && partial.uncounted === 1,
  JSON.stringify({ ...partial.totals, uncounted: partial.uncounted }))
await req(`/content/${post.id}`, 'PATCH', { views: 0 })

// A month with nothing in it says nothing rather than zero.
const empty = (await req('/reports/views?from=2020-01-01&to=2020-01-31')).data
ok('a month with no work reports no work', empty.totals.pieces === 0 && empty.totals.avg === null)

// ---- 4) the KPI ----------------------------------------------------------
const CARD = { base: 0, per_shoot: 0, per_edit: 0, per_publish: 0, per_review: 0, ontime_target: 90,
  per_1k_views: 10000, views_target: 20000, views_bonus: 500000 }
ok('a card can pay on views', [200, 201].includes((await req('/reports/pay/rules/default', 'PUT', CARD)).status))
let mine = (await req(`/reports/pay/mine?from=${month.from}&to=${month.to}`, 'GET', null, MT)).data
ok('the maker sees their own sum', mine.views === 15500, String(mine.views))
ok('…paid by the thousand', mine.viewsPay === Math.round((15500 / 1000) * 10000), String(mine.viewsPay))
ok('…short of the target, so no bonus', mine.viewsMet === false && mine.viewsBonus === 0)
ok('…and told how far off it is', mine.viewsLeft === 4500, String(mine.viewsLeft))
ok('…and how much of the month is actually counted', mine.viewsCounted === 3, String(mine.viewsCounted))

await req(`/content/${vid.id}`, 'PATCH', { views: 20000 })
mine = (await req(`/reports/pay/mine?from=${month.from}&to=${month.to}`, 'GET', null, MT)).data
ok('crossing the target pays the bonus whole', mine.viewsMet === true && mine.viewsBonus === 500000,
  JSON.stringify({ met: mine.viewsMet, bonus: mine.viewsBonus }))
ok('…and the total adds up', mine.total === mine.piecework + mine.viewsPay + mine.bonus - mine.penalty,
  JSON.stringify({ total: mine.total, piece: mine.piecework, views: mine.viewsPay, bonus: mine.bonus }))
// The views belong to the maker, not to everybody who touched the piece.
const theirs = (await req(`/reports/pay/mine?from=${month.from}&to=${month.to}`, 'GET', null, OT)).data
ok('somebody who did not make it earns nothing on its views', (theirs?.views || 0) === 0, String(theirs?.views))

// ---- 5) the report, in the panel -----------------------------------------
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
p.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
await p.goto(`${BASE}/login`)
await p.fill('input[name="username"]', 'admin'); await p.fill('input[name="password"]', 'admin123')
await p.click('button[type="submit"]'); await p.waitForURL(/overview/, { timeout: 20000 })
await p.goto(`${BASE}/admin`); await p.waitForTimeout(1100)
await p.locator('.tab', { hasText: 'Reports' }).click(); await p.waitForTimeout(1600)
ok('Reports opens on the month', (await p.locator('.pill.active', { hasText: 'This month' }).count()) === 1)
ok('…and carries the views block', (await p.locator('.vw-card').count()) === 1)
const tiles = await p.locator('.vw-tile b').allTextContents()
ok('…leading with the total', tiles[0].replace(/[^0-9]/g, '') === '23500', tiles.join(' | '))
ok('…splitting it by type and by channel', (await p.locator('.vw-col h3', { hasText: 'By type' }).count()) === 1
  && (await p.locator('.vw-col h3', { hasText: 'By channel' }).count()) === 1)
ok('…and naming the makers', (await p.locator('.vw-col h3', { hasText: 'By content maker' }).count()) === 1)

// the box on the task itself
await p.goto(`${BASE}/brief?task=${vid.id}`)
await p.waitForSelector('.modal .cm-title', { timeout: 10000 })
await p.waitForTimeout(700)
ok('the task carries a views box', (await p.locator('.cm-views').count()) === 1)
ok('…holding the number that was entered', (await p.locator('.views-input').inputValue()) === '20000')
await p.locator('.views-input').fill('21000')
await p.locator('.modal').getByRole('button', { name: 'Save changes' }).click()
await p.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await p.waitForTimeout(600)
ok('…and saving it lands on the server', (await req(`/content/${vid.id}`)).data.views === 21000,
  String((await req(`/content/${vid.id}`)).data.views))

await browser.close()
srv.kill()
try { rmSync(dir, { recursive: true, force: true }) } catch { /* fine */ }
console.log(fails === 0 ? '\nViews suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
