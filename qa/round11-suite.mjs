// This round: a post is designed, not shot — post-type tasks carry a single
// Designer hat (a designer-role person), judged by the design-ready date,
// everywhere: modal, to-do chips, Missed attribution, their own My Day.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
const yesterday = fmt.format(new Date(Date.now() - 864e5))

for (const c of (await req('/content')).data.filter((c) => /r11:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
const oldDez = (await req('/users')).data.find((u) => u.username === 'r11dez')
if (oldDez) await req(`/users/${oldDez.id}`, 'DELETE')

const dez = (await req('/users', 'POST', { name: 'Dana Designer', username: 'r11dez', password: 'd1234', role: 'designer' })).data
ok('designer account in place', !!dez.id && (dez.crew_roles || []).includes('designer'))

// The designer is set here rather than through the form: since round 78 the
// form does not offer that hat, and what this suite is about is that the
// COLUMN still works — the person is stored, judged by the design-ready date,
// shown the post, and kept through a save made by somebody else.
const p1 = await req('/content', 'POST', { title: 'r11: designed post', channels: ['instagram_main'], type: 'post', designer_id: dez.id })
ok('post fixture created with its designer', p1.status === 201 && p1.data.designer_id === dez.id)
const p2 = await req('/content', 'POST', {
  title: 'r11: late artwork', channels: ['instagram_main'], type: 'post',
  designer_id: dez.id, design_ready_date: yesterday,
})
ok('post stores its designer + design deadline', p2.status === 201 && p2.data.designer_id === dez.id && p2.data.design_ready_date === yesterday)
ok('bogus designer rejected', (await req(`/content/${p2.data.id}`, 'PATCH', { designer_id: 9999 })).status === 400)

const tokD = await login('r11dez', 'd1234')
const dezSees = (await req('/content', 'GET', null, tokD)).data
ok('designer sees their post without holding the channel', dezSees.some((c) => c.id === p2.data.id))
const doneOn = await req(`/content/${p1.data.id}`, 'PATCH', { done: true }, tokD)
ok('…but not posts they are not the designer of', doneOn.status === 403)
const p3 = await req('/content', 'POST', { title: 'r11: crew right probe', channels: ['instagram_main'], type: 'post', designer_id: dez.id })
const readySt11 = (await req('/statuses')).data.find((s) => /^ready$/i.test(s.label))
// The artwork rides along with the tick since round 69 — a stage that says
// finished with nothing attached is one the reviewer has to chase.
const p3bare = await req(`/content/${p3.data.id}`, 'PATCH', { milestone: 'designed' }, tokD)
ok('the tick without the artwork is refused', p3bare.status === 400, `${p3bare.status} ${p3bare.data.error || ''}`)
const p3done = await req(`/content/${p3.data.id}`, 'PATCH', { milestone: 'designed', design_link: 'https://drive.google.com/r11-art' }, tokD)
ok('the designer marks their post designed → Ready (crew tick)', p3done.status === 200 && p3done.data.status_id === readySt11.id)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => { fails++; console.log(`✘ PAGE ERROR: ${e.message}`) })
page.on('dialog', (d) => d.accept())
await page.goto(BASE + '/login')
await page.fill('input[name="username"]', 'admin')
await page.fill('input[name="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForURL(/overview/, { timeout: 15000 })

await page.goto(BASE + '/todo')
await page.waitForSelector('.todo-row', { timeout: 10000 })
await page.locator('.todo-row', { hasText: 'r11: designed post' }).locator('.todo-main').click()
await page.waitForSelector('.modal .crew-field', { timeout: 8000 })
// The designer hat came off the picker in round 78: this board runs
// idea → shoot → edit and a designer has no stage in it, so the hat was
// offered on every task and picked on almost none. The COLUMN is untouched —
// everything above still stores a designer, judges them by the design-ready
// date, shows them the post and lets them tick it done — it is simply not
// offered in the form any more, and every type carries the same two hats.
const crewLabels = await page.locator('.modal .crew-field .crew-label').allTextContents()
ok('a post carries the two hats with a stage', crewLabels.length === 2, crewLabels.join(' | '))
ok('…and neither of them is the Designer', !crewLabels.some((l) => /Designer/i.test(l)), crewLabels.join(' | '))
ok('the ready deadline is still labeled for design', /Design ready/.test(await page.locator('.modal .dates-block').textContent()))
// Round 27: specialists lead their own group; everyone else may still take
// a one-time duty from the group below.
const opSel = page.locator('.modal .crew-field select').first()
const opSpecial = await opSel.locator('optgroup[label="Operators"] option').allTextContents()
const opAnyone = await opSel.locator('optgroup[label*="Everyone"] option').allTextContents()
ok('the operator list leads with operator-role people', opSpecial.length > 0, opSpecial.join(' | '))
ok('…and a designer waits in the one-time group', !opSpecial.some((o) => o.includes('Dana Designer'))
  && opAnyone.some((o) => o.includes('Dana Designer')), opAnyone.join(' | '))
await page.locator('.modal .tchip', { hasText: 'Video' }).click()
ok('a video carries the same two hats', (await page.locator('.modal .crew-field').count()) === 2)
await page.locator('.modal .tchip', { hasText: 'Post' }).click()
ok('…and so does a post — the hats no longer depend on the type', (await page.locator('.modal .crew-field').count()) === 2)

await page.screenshot({ path: 'r11-modal.png' })
await page.locator('.modal').getByRole('button', { name: 'Save changes' }).click()
await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 })
await page.locator('.toast', { hasText: 'synced' }).waitFor({ timeout: 6000 })
await page.waitForTimeout(300)
const savedP1 = (await req('/content')).data.find((c) => c.id === p1.data.id)
ok('the designer the API set is kept through a form save', savedP1.designer_id === dez.id)

const rowTxt = await page.locator('.todo-row', { hasText: 'r11: designed post' }).textContent()
ok('to-do row shows the designer chip', rowTxt.includes('Dana'))

await page.goto(BASE + '/missed')
await page.waitForSelector('.ov-row', { timeout: 10000 })
const missRow = page.locator('.ov-row', { hasText: 'r11: late artwork' })
await missRow.waitFor({ timeout: 8000 })
const missTxt = await missRow.textContent()
ok('missed chip reads design deadline', /design deadline/.test(missTxt))
ok('the miss is attributed to the designer', missTxt.includes('Dana'))
await page.screenshot({ path: 'r11-missed.png' })

const page2 = await (await browser.newContext({ viewport: { width: 1500, height: 980 } })).newPage()
page2.on('pageerror', (e) => { fails++; console.log(`✘ PAGE2 ERROR: ${e.message}`) })
await page2.goto(BASE + '/login')
await page2.fill('input[name="username"]', 'r11dez')
await page2.fill('input[name="password"]', 'd1234')
await page2.click('button[type="submit"]')
await page2.waitForURL(/brief|overview/, { timeout: 15000 })
await page2.goto(BASE + '/brief')
await page2.waitForSelector('.ov-row', { timeout: 10000 })
const myRow = page2.locator('.ov-row', { hasText: 'r11: late artwork' })
await myRow.waitFor({ timeout: 8000 })
ok('the designer sees the post on their My Day', true)
ok('…tagged as Design work', /Design/.test(await myRow.textContent()))
await page2.screenshot({ path: 'r11-myday.png' })
await browser.close()

for (const c of (await req('/content')).data.filter((c) => /r11:/.test(c.title)))
  await req(`/content/${c.id}`, 'DELETE')
await req(`/users/${dez.id}`, 'DELETE')

console.log(fails === 0 ? '\nRound-11 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
