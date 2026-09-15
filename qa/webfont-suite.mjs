// The board opens when Google does not.
//
// The two brand faces are fetched from fonts.googleapis.com by a <link> in the
// head. A stylesheet in the head is render-blocking, and — because a module
// script follows it — it blocks that script too, and therefore DOMContentLoaded,
// and therefore React, and therefore everything. Measured with the font host
// black-holed, the board did not reach a painted DOM within 25 seconds: a white
// screen for as long as Google is slow, filtered or down, for a team whose
// network is none of Google's concern.
//
// Both CSS stacks name real system fallbacks, so there was never anything to
// wait for. The sheet is now requested at media="print" — fetched, but not
// applied and not blocking — and promoted to media="all" on load, where
// display=swap does the changeover. This suite holds that arrangement:
//   · with the font host answering nothing, the board still paints, fast
//   · when the sheet does land, it is actually promoted and actually applied
//   · a reader with no JavaScript still gets the faces, via <noscript>
//
// It rides the shared 4090 stack.
import { chromium } from 'playwright'
const BASE = 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

// ---- 1. Google never answers ------------------------------------------------
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
  // Not "fails" — HANGS. A refusal is the easy case; the one that took the
  // board down is the request that stays open.
  await ctx.route('**fonts.googleapis.com**', () => {})
  await ctx.route('**fonts.gstatic.com**', () => {})
  const p = await ctx.newPage()
  const t0 = Date.now()
  let reached = true
  try {
    await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 15000 })
    await p.waitForSelector('.login-word', { timeout: 8000 })
  } catch { reached = false }
  const ms = Date.now() - t0
  ok('the board paints while the font host hangs', reached, `gave up after ${ms}ms`)
  if (reached) {
    ok('…and it paints quickly, not eventually', ms < 6000, `${ms}ms`)
    const w = await p.evaluate(() => {
      const el = document.querySelector('.login-word')
      const r = el.getBoundingClientRect()
      return { text: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }
    })
    ok('…and the wordmark is drawn at a real size in the fallback face',
      w.text === 'SATashkent' && w.w > 60 && w.h > 12, JSON.stringify(w))
  }
  await ctx.close()
}

// ---- 2. Google answers ------------------------------------------------------
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  let asked = 0
  await ctx.route('**fonts.googleapis.com**', (r) => {
    asked++
    r.fulfill({ status: 200, contentType: 'text/css',
      body: '.qa-webfont-probe{outline:3px solid rgb(1, 2, 3)}' })
  })
  const p = await ctx.newPage()
  await p.goto(BASE + '/login', { waitUntil: 'load', timeout: 25000 })
  await p.waitForTimeout(600)
  ok('the sheet is still fetched', asked > 0, `${asked} requests`)
  const media = await p.evaluate(() =>
    document.querySelector('link[href*="fonts.googleapis"][onload]')?.media)
  ok('…and promoted from print to all once it lands', media === 'all', String(media))
  // Promoted is not the same as applied. Prove the rules actually take effect.
  const applied = await p.evaluate(() => {
    const d = document.createElement('div')
    d.className = 'qa-webfont-probe'
    document.body.appendChild(d)
    const c = getComputedStyle(d).outlineColor
    d.remove()
    return c
  })
  ok('…and its rules apply to the page', applied === 'rgb(1, 2, 3)', applied)
  await ctx.close()
}

// ---- 3. no JavaScript -------------------------------------------------------
{
  const ctx = await b.newContext({ javaScriptEnabled: false })
  const p = await ctx.newPage()
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 25000 })
  const n = await p.locator('noscript').count()
  const html = await p.content()
  ok('a reader without JavaScript is still served the faces',
    n > 0 && /noscript[\s\S]{0,200}fonts\.googleapis/.test(html), `${n} noscript blocks`)
  await ctx.close()
}

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)
