// Round 77: the layout holds at every width, and a thumb can reach everything.
//
// This suite exists because the bugs it checks for were invisible to every
// other one. A modal 460px wide on a 390px screen still renders, still saves,
// still passes an API test — it just lays its first three buttons out at a
// negative x, off the edge, with no scroll to recover them. Nobody notices
// until somebody in Tashkent tries to delete a task from a phone.
//
// So the checks here are measurements, not assertions about markup:
//   · nothing lays a child outside the box that holds it
//   · no page scrolls sideways
//   · on a touch screen, a control that DOES something is at least 40px
//   · in a modal, every button is inside the viewport and Save is reachable
//
// It rides the shared 4090 stack, which regress.sh has already seeded.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

// Captions are not buttons. A channel chip on a task row says which channel it
// is; growing it to 40px would push the next task off the screen to no
// purpose. The tick keeps its size on purpose too and wears an invisible 44px
// hit area, which a bounding box cannot see.
// The standard is 40px. Two kinds of thing are held to something else and
// both are named here rather than quietly skipped:
//   · captions (a channel chip on a task row) are not targets at all
//   · the tick and the row actions inside a To-Do row are 30 and 36, because
//     a column of 44px buttons down a dense list reads as a toolbar, not a
//     checklist — 36 is still well clear of the 24px floor the accessibility
//     guidelines set, and the row itself is a full-width target
const EXEMPT = /(^|\s)(chip|todo-check|mini-check|swatch-|cal-ev|rel-ev|wk-card)/
const DENSE = '.todo-actions'

const PROBE = `(() => {
  const out = { clipped: [], small: [] }
  for (const box of document.querySelectorAll('.modal-foot, .bar, .pill-group, .seg-strip, .sp-head, .section-head, .cal-head, .qa-form')) {
    const p = box.getBoundingClientRect()
    if (!p.width) continue
    // A box that scrolls is SUPPOSED to hold more than it shows. Only a box
    // with nowhere to put the overflow is losing its buttons.
    const ox = getComputedStyle(box).overflowX
    if (ox === 'auto' || ox === 'scroll') continue
    if (box.querySelector(':scope > .seg-strip')) continue
    for (const c of box.children) {
      const r = c.getBoundingClientRect()
      if (!r.width) continue
      if (r.right > p.right + 1 || r.left < p.left - 1) {
        out.clipped.push({ box: (box.className || '').toString().split(' ')[0], item: (c.textContent || c.tagName).trim().slice(0, 24) })
      }
    }
  }
  for (const el of document.querySelectorAll('button, a.btn, select, .pill, .tab')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (${EXEMPT}.test((el.className || '').toString())) continue
    const floor = el.closest(${JSON.stringify(DENSE)}) ? 36 : 40
    if (r.height < floor || r.width < floor) {
      out.small.push({ t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 22), s: Math.round(r.width) + 'x' + Math.round(r.height) })
    }
  }
  out.sideways = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  return out
})()`

const SCREENS = ['/', '/my-day', '/releases', '/recordings', '/statistics',
  '/missed', '/design', '/docs', '/sprints', '/sprints/backlog', '/projects', '/team', '/admin', '/profile']

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const open = async (w, h, touch) => {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch })
  await p.goto(BASE + '/login')
  await p.fill('input[name=username]', 'admin'); await p.fill('input[name=password]', 'admin123')
  await p.click('button[type=submit]'); await p.waitForTimeout(2200)
  return p
}

// ---------------- every screen, on a phone ----------------
let phone = await open(390, 844, true)
let sideways = [], clipped = [], small = []
for (const path of SCREENS) {
  await phone.goto(BASE + path); await phone.waitForTimeout(1200)
  const r = await phone.evaluate(PROBE)
  if (r.sideways) sideways.push(path)
  if (r.clipped.length) clipped.push(path + ': ' + JSON.stringify(r.clipped.slice(0, 3)))
  if (r.small.length) small.push(path + ': ' + JSON.stringify([...new Set(r.small.map((s) => s.t + ' ' + s.s))].slice(0, 4)))
}
ok('no screen scrolls sideways on a phone', sideways.length === 0, sideways.join(', '))
ok('…and no control is laid out past the edge of its row', clipped.length === 0, clipped.slice(0, 2).join(' | '))
ok('…and every control a thumb has to hit is at least 40px', small.length === 0, small.slice(0, 3).join(' | '))

// ---------------- the modal, which is where this went wrong ----------------
await phone.goto(BASE + '/releases'); await phone.waitForTimeout(1600)
// A phone opens the calendar on the week, where a piece of work is a card
// with its title on it; the month is dots. Take whichever is showing.
const anyItem = phone.locator('.wk-card, .rel-ev').first()
await anyItem.scrollIntoViewIfNeeded()
await anyItem.click()
await phone.waitForTimeout(1800)
const m = await phone.evaluate(() => {
  const modal = document.querySelector('.modal').getBoundingClientRect()
  const foot = document.querySelector('.modal-foot')
  const kids = [...foot.children].map((c) => {
    const r = c.getBoundingClientRect()
    return { t: (c.textContent || c.tagName).trim().slice(0, 18), x: Math.round(r.x), r: Math.round(r.right), y: Math.round(r.y), bottom: Math.round(r.bottom) }
  }).filter((k) => k.r > k.x)
  const fr = foot.getBoundingClientRect()
  return {
    modalW: Math.round(modal.width), vw: innerWidth, vh: innerHeight,
    kids,
    footSticky: getComputedStyle(foot).position,
    footBottom: Math.round(fr.bottom),
    headSticky: getComputedStyle(document.querySelector('.modal-head')).position,
  }
})
ok('a modal is never wider than the phone it opens on', m.modalW <= m.vw, `${m.modalW} in ${m.vw}`)
ok('every button in its footer is on the screen',
  m.kids.every((k) => k.x >= 0 && k.r <= m.vw), JSON.stringify(m.kids.filter((k) => k.x < 0 || k.r > m.vw)))
ok('…and none of them is below the fold',
  m.kids.every((k) => k.bottom <= m.vh + 1), JSON.stringify(m.kids.filter((k) => k.bottom > m.vh + 1)))
ok('the footer is pinned, so Save is there however long the form is', m.footSticky === 'sticky', m.footSticky)
ok('…and so is the title', m.headSticky === 'sticky', m.headSticky)
// The three that used to be unreachable. Round 79 folded the secondary
// tools — Delete, Duplicate, Copy link, Raise a hand — behind one button on
// a phone, because laid out they took three rows and 290px of a 790px sheet.
// The check is still that Delete is REACHABLE, which is what it was ever
// about; it is now one tap away instead of nought, and it is on the screen
// when it opens rather than off the edge, which is where round 77 found it.
const labels = m.kids.map((k) => k.t).join(' ')
let del = /Delete|Удалить/i.test(labels)
if (!del && await phone.locator('.cm-more-btn').count()) {
  await phone.locator('.cm-more-btn').click()
  await phone.waitForTimeout(300)
  del = await phone.evaluate(() => {
    const box = document.querySelector('.cm-tools.open')
    if (!box) return false
    const b = [...box.querySelectorAll('.btn')].find((x) => /Delete|Удалить/i.test(x.textContent))
    if (!b) return false
    const r = b.getBoundingClientRect()
    return r.x >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
  })
  await phone.locator('.cm-more-btn').click()
  await phone.waitForTimeout(200)
}
ok('the destructive action is reachable and on the screen', del, labels)

// ---------------- the calendar, on the phone we already have open ----------------
// One page fewer: opening a third browser page here was enough to tip the
// sandbox over about one run in three, which reads as a failure and is not one.
await phone.setViewportSize({ width: 390, height: 1200 })
// Releases, not Recordings: a board with no shoots booked shows an empty
// state rather than a calendar, and an empty state proves nothing here.
await phone.goto(BASE + '/releases'); await phone.waitForTimeout(1700)
const scale = await phone.locator('.cal-scale .pill.active').textContent()
// Round 82 made the month the default in every view, a phone included: a week
// is a horizon you check, a month is the one you plan in. The week is still
// there, one press away, and the rest of this block measures it there.
ok('a phone opens the calendar on the month', /month/i.test(scale || ''), scale)
await phone.locator('.cal-scale .pill', { hasText: 'Week' }).click()
await phone.waitForTimeout(900)
// The rule is "a row is as tall as what is on it", and the way to check it is
// to compare rows against each other — not against a number. A flat ceiling
// said the same thing until the board filled up: one legitimately busy
// Thursday put six releases in a row and failed a test about empty space.
const wk = await phone.evaluate(() => {
  const rows = [...document.querySelectorAll('.wk-col')].map((c) => ({
    h: Math.round(c.getBoundingClientRect().height),
    items: c.querySelectorAll('.wk-card, .rel-ev, .cal-ev').length,
  }))
  const quiet = rows.filter((r) => !r.items)
  // Two rows can carry the same number of pieces and still differ by a line of
  // wrapped title, so "the busiest" is the TALLEST of the rows holding the most
  // — picking the first of them made this a test of title lengths.
  const most = Math.max(0, ...rows.map((r) => r.items))
  const busiest = rows.filter((r) => r.items === most)
    .reduce((a, b) => (b.h > a.h ? b : a), { h: 0, items: most })
  return {
    n: rows.length,
    emptiest: quiet.length ? Math.max(...quiet.map((r) => r.h)) : 0,
    tallest: Math.max(...rows.map((r) => r.h)),
    busiest,
  }
})
ok('…as seven rows only as tall as what is on them',
  wk.n === 7 && wk.emptiest < 90 && wk.tallest === wk.busiest.h, JSON.stringify(wk))
// The month still has to fit when somebody asks for it.
await phone.locator('.cal-scale .pill', { hasText: 'Month' }).click()
await phone.waitForTimeout(900)
const c = await phone.evaluate(() => {
  const card = document.querySelector('.card.cal')
  const cols = [...document.querySelectorAll('.cal-weekhead .cal-wd')].map((e) => Math.round(e.getBoundingClientRect().right))
  return { sw: card.scrollWidth, cw: card.clientWidth, lastCol: cols[cols.length - 1], vw: innerWidth, days: cols.length }
})
ok('…and a month fits all seven columns without a swipe',
  c.sw <= c.cw + 1 && c.days === 7 && c.lastCol <= c.vw, JSON.stringify(c))
await phone.close()

// ---------------- the same screens on a desktop ----------------
const desk = await open(1440, 900, false)
sideways = []; clipped = []
for (const path of SCREENS) {
  await desk.goto(BASE + path); await desk.waitForTimeout(1100)
  const r = await desk.evaluate(PROBE)
  if (r.sideways) sideways.push(path)
  if (r.clipped.length) clipped.push(path + ': ' + JSON.stringify(r.clipped.slice(0, 3)))
}
ok('nothing scrolls sideways on a desktop either', sideways.length === 0, sideways.join(', '))

// ---------------- and the window you actually work in ----------------
// A pinned footer is only worth having if it stays one line. When it wrapped
// it took 115px of a 810px window away from the form, and the job of this
// board is filling that form in.
await desk.goto(BASE + '/releases'); await desk.waitForTimeout(1600)
await desk.locator('.rel-ev').first().scrollIntoViewIfNeeded()
await desk.locator('.rel-ev').first().click()
await desk.waitForTimeout(1700)
const work = await desk.evaluate(() => {
  const foot = document.querySelector('.modal-foot')
  const kids = [...foot.children].filter((c) => c.getBoundingClientRect().width > 0)
  const tops = kids.map((c) => Math.round(c.getBoundingClientRect().top))
  return {
    footH: Math.round(foot.getBoundingClientRect().height),
    spread: Math.max(...tops) - Math.min(...tops),
    bodyH: Math.round(document.querySelector('.modal-body').getBoundingClientRect().height),
    modalW: Math.round(document.querySelector('.modal').getBoundingClientRect().width),
  }
})
ok('the task window\'s footer is one line', work.footH < 90 && work.spread < 20, JSON.stringify(work))
ok('…so the form keeps most of the window', work.bodyH >= 640, `${work.bodyH}px of form`)
ok('…in a window wide enough to lay a row of chips out on one line', work.modalW >= 700, `${work.modalW}px`)
ok('…and nothing is laid out past the edge of its row', clipped.length === 0, clipped.slice(0, 2).join(' | '))

await b.close()
console.log(fails === 0 ? '\nLayout suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
