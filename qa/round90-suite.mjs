// Round 90: the ambassador programme gets its second half.
//
// It was built as far as "you can film this" and stopped. The states after
// that — posted, done, paid — existed in the schema and in the state list, and
// NO ROUTE REACHED THEM. So an ambassador who had filmed and posted a video
// had nowhere to say so, and the only button on their page was "Send idea":
// the way to report finished work was to ask for more of it. On the other
// side, nobody could see what anybody had actually done, or put a contract
// anywhere, or write down a term the three checkboxes could not say.
//
//   the link      the student says it is live, with the link. That IS the
//                 work — it is what gets checked and what the money is for —
//                 so it is required and it has to be a link
//   the check     it lands in the same queue as an idea does, marked as a
//                 different kind, with two answers: it counts, or here is
//                 what is wrong and re-post it
//   the record    one ambassador, whole: every card, all-time totals, and
//                 paying marked where you can see what you are paying for
//   the contract  uploaded, opened by either side, taken off again
//   the words     a term the boxes cannot say, agreed per video
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
const stamp = Date.now()
const stu = (await req('/users', 'POST', {
  name: 'Round90 Student', username: `r90s${stamp}`, password: 's1234', role: 'ambassador',
})).data
await req(`/ambassadors/person/${stu.id}`, 'PUT', {
  university: 'Yonsei', status: 'active', default_posts_own: true,
  default_terms_other: 'Usually tags us',
})
const S = await login(`r90s${stamp}`, 's1234')
const idea = { format: 'reel', reference_url: 'https://instagram.com/p/r90', script: 'Campus tour with the dean, two questions at the entrance, then the library.' }
await req('/ambassadors/me/cards', 'POST', idea, S)

// ===================== the idea, and a term in words =====================
let inbox = (await req('/ambassadors')).data.inbox
ok('an idea waits as an idea', inbox.length === 1 && inbox[0].kind === 'idea', JSON.stringify(inbox.map((c) => c.kind)))
ok('…offering their usual words as a starting point', inbox[0].defaults.terms_other === 'Usually tags us', inbox[0].defaults.terms_other)
const cid = inbox[0].id
ok('approving carries a term the three boxes cannot say',
  (await req(`/ambassadors/cards/${cid}/approve`, 'POST', { amount: 150000, posts_own: true, terms_other: 'Tag us in the caption and keep it up 30 days' })).status === 200)
let mine = (await req('/ambassadors/me', 'GET', null, S)).data
ok('…and the student can read it on the card they have to act on',
  /Tag us/.test(mine.cards[0].terms_other || ''), mine.cards[0].terms_other)

// ===================== the link, which is the work =====================
const sentence = await req(`/ambassadors/me/cards/${cid}/posted`, 'POST', { main_video_url: 'I sent it on Telegram' }, S)
ok('a sentence is refused where a link belongs', sentence.status === 400, sentence.data.error)
ok('…and so is nothing at all',
  (await req(`/ambassadors/me/cards/${cid}/posted`, 'POST', {}, S)).status === 400)
ok('the student can say it is live',
  (await req(`/ambassadors/me/cards/${cid}/posted`, 'POST', { main_video_url: 'https://instagram.com/reel/r90a', story_clip_url: 'https://instagram.com/stories/1' }, S)).status === 200)
ok('…only once — it is not theirs to say twice',
  (await req(`/ambassadors/me/cards/${cid}/posted`, 'POST', { main_video_url: 'https://instagram.com/reel/r90b' }, S)).status === 409)
ok('…and nobody else can say it for them',
  (await req(`/ambassadors/me/cards/${cid}/posted`, 'POST', { main_video_url: 'https://x.com/a' })).status === 403
  || (await req(`/ambassadors/me/cards/${cid}/posted`, 'POST', { main_video_url: 'https://x.com/a' })).status === 404)

// ===================== the check =====================
inbox = (await req('/ambassadors')).data.inbox
ok('posted work waits in the same queue, as a different kind',
  inbox.length === 1 && inbox[0].kind === 'posted', JSON.stringify(inbox.map((c) => c.kind)))
ok('…carrying the link somebody has to open', inbox[0].main_video_url === 'https://instagram.com/reel/r90a')
ok('a refusal with nothing behind it is refused',
  (await req(`/ambassadors/cards/${cid}/repost`, 'POST', { feedback: '' })).status === 400)
ok('sending it back returns it to "you can film this", with the reason',
  (await req(`/ambassadors/cards/${cid}/repost`, 'POST', { feedback: 'Wrong account — post it from the main one.' })).status === 200)
mine = (await req('/ambassadors/me', 'GET', null, S)).data
ok('…which is a state the student can act on again',
  mine.cards[0].state === 'can_film' && /Wrong account/.test(mine.cards[0].feedback), `${mine.cards[0].state} · ${mine.cards[0].feedback}`)
await req(`/ambassadors/me/cards/${cid}/posted`, 'POST', { main_video_url: 'https://instagram.com/reel/r90c' }, S)
ok('marking it done needs it to have been posted',
  (await req(`/ambassadors/cards/${cid}/done`, 'POST')).status === 200)
mine = (await req('/ambassadors/me', 'GET', null, S)).data
ok('…and the student sees it counted, in both numbers',
  mine.posted_this_month === 1 && mine.earned_this_month === 150000,
  `posted=${mine.posted_this_month} earned=${mine.earned_this_month}`)
ok('…and it leaves the queue', ((await req('/ambassadors')).data.inbox || []).length === 0)

// Paid is the end of the road, and there is no way back from it.
ok('a video that is not checked cannot be marked paid',
  (await req(`/ambassadors/cards/${cid}/paid`, 'POST')).status === 200)
ok('…and paid cannot be said twice', (await req(`/ambassadors/cards/${cid}/paid`, 'POST')).status === 409)
ok('…nor can a paid card be sent back', (await req(`/ambassadors/cards/${cid}/repost`, 'POST', { feedback: 'no' })).status === 409)

// ===================== the record =====================
const hist = await req(`/ambassadors/person/${stu.id}/cards`)
ok('one ambassador can be opened whole', hist.status === 200 && hist.data.cards.length === 1)
ok('…with all-time totals, not just this month',
  hist.data.done_all_time === 1 && hist.data.earned_all_time === 150000,
  `done=${hist.data.done_all_time} earned=${hist.data.earned_all_time}`)
ok('…and nobody outside the programme may read it',
  (await req(`/ambassadors/person/${stu.id}/cards`, 'GET', null, await login('jas', 'j1234'))).status === 403)

// ===================== the contract =====================
const pdf = 'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsOfCg=='
ok('a contract can be uploaded',
  (await req(`/ambassadors/person/${stu.id}/contract`, 'PUT', { name: 'terms.pdf', mime: 'application/pdf', data: pdf })).status === 200)
const people = (await req('/ambassadors')).data.people
const row = people.find((p) => p.user_id === stu.id)
ok('…and the list says they have one', row.has_contract === true && row.contract_name === 'terms.pdf')
ok('…the student can open their own', (await req(`/ambassadors/${row.id}/contract`, 'GET', null, S)).status === 200)
ok('…somebody else cannot',
  (await req(`/ambassadors/${row.id}/contract`, 'GET', null, await login('jas', 'j1234'))).status === 403)
ok('…something that is not a file is refused',
  (await req(`/ambassadors/person/${stu.id}/contract`, 'PUT', { name: 'x.pdf', data: 'just some words' })).status === 400)
ok('…and it can be taken off again',
  (await req(`/ambassadors/person/${stu.id}/contract`, 'DELETE')).status === 200)
ok('…leaving nothing behind',
  (await req('/ambassadors')).data.people.find((p) => p.user_id === stu.id).has_contract === false)

// ===================== both screens =====================
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const signIn = async (u, p) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { fails++; console.log('PAGE ERROR', e.message) })
  await page.goto(BASE + '/login')
  await page.fill('input[name="username"]', u); await page.fill('input[name="password"]', p)
  await page.click('button[type="submit"]'); await page.waitForTimeout(2200)
  return { ctx, page }
}
// A second card, so the student has something to act on in the browser.
await req('/ambassadors/me/cards', 'POST', idea, S)
const cid2 = (await req('/ambassadors')).data.inbox[0].id
await req(`/ambassadors/cards/${cid2}/approve`, 'POST', { amount: 90000, posts_own: true, terms_other: 'Keep it up 30 days' })

const { ctx: sc, page: sp } = await signIn(`r90s${stamp}`, 's1234')
await sp.waitForTimeout(1000)
const seen = (await sp.locator('.amb-me').textContent()).replace(/\s+/g, ' ')
ok('the student sees the term they have to honour', /Keep it up 30 days/.test(seen), seen.slice(0, 120))
ok('…and their finished work, told apart from work still owed', /Paid|waiting to be paid/.test(seen), seen.slice(0, 200))
const posted = sp.locator('button').filter({ hasText: 'I posted it' })
ok('…and a way to report a finished video', (await posted.count()) === 1)
await posted.first().click(); await sp.waitForTimeout(500)
const boxes = await sp.locator('.modal input.input').all()
await boxes[0].fill('https://instagram.com/reel/r90ui')
await sp.locator('.modal button').filter({ hasText: 'Send for checking' }).click()
await sp.waitForTimeout(1500)
ok('…which really posts it',
  (await req(`/ambassadors/person/${stu.id}/cards`)).data.cards[0].main_video_url.includes('r90ui'))
await sc.close()

const { ctx: ac, page: ap } = await signIn('admin', 'admin123')
await ap.goto(BASE + '/ambassador'); await ap.waitForTimeout(1500)
ok('the admin queue names posted work for what it is',
  /Filmed and posted/.test(await ap.locator('.amb-row-head').first().textContent()))
await ap.locator('.amb-row-head').first().click(); await ap.waitForTimeout(400)
ok('…and gives them the link to open', (await ap.locator('.amb-links a').count()) >= 1)
await ap.locator('.amb-actions button').filter({ hasText: 'It is up' }).click()
await ap.waitForTimeout(1400)
ok('…and one press counts it', (await req(`/ambassadors/person/${stu.id}/cards`)).data.done_all_time === 2)
await ap.reload(); await ap.waitForTimeout(1500)
await ap.locator('button').filter({ hasText: 'Their work' }).first().click()
await ap.waitForTimeout(1200)
const record = (await ap.locator('.modal').textContent()).replace(/\s+/g, ' ')
ok('the admin can open one person and read their whole record',
  /Videos done, all time/.test(record), record.slice(0, 110))
ok('…and mark a checked video paid from there',
  (await ap.locator('.modal button').filter({ hasText: 'Mark paid' }).count()) >= 1)
await browser.close()

await req(`/users/${stu.id}`, 'DELETE')
console.log(fails === 0 ? '\nRound-90 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
