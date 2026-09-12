// A shelf you can read at a glance.
//
// A list of filenames tells you nothing: "SATASHKENT - Head of Main KPI
// (Jasmina) August_5" could be a scan, a spreadsheet or a one-line note, and
// the only way to find out was to open all nine. Each row draws the document
// itself now — the page for a PDF, the picture for an image, the file kind for
// anything a browser will not draw.
//
// Run against a copy of the real board (DOCS_BASE, default 4094): these nine
// documents ARE the test case.
import { chromium } from 'playwright'
const BASE=process.env.DOCS_BASE || 'http://localhost:4094'
let fails=0; const ok=(c,m,x)=>{console.log((c?'✔ ':'✘ ')+m+(x!==undefined?' — '+JSON.stringify(x):''));if(!c)fails++}
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
const page=await(await b.newContext({viewport:{width:1500,height:1000}})).newPage()
page.on('pageerror',e=>{fails++;console.log('PAGE ERROR',e.message)})
await page.goto(BASE+'/login'); await page.fill('input[name="username"]','adam'); await page.fill('input[name="password"]','probe-only-123')
await page.click('button[type="submit"]'); await page.waitForURL(x=>!/\/login/.test(x.pathname),{timeout:20000})
await page.goto(BASE+'/docs'); await page.waitForSelector('.docs-page',{timeout:20000}); await page.waitForTimeout(1500)
const rows = page.locator('.docs-shelf .kpi-doc-row')
ok(await rows.count() === 9, 'all nine documents listed', await rows.count())
ok(await page.locator('.doc-thumb').count() === 9, 'each one has a preview slot')
// scroll them into view so the lazy fetch fires
await page.evaluate(() => document.querySelector('.docs-shelf')?.scrollIntoView())
await page.mouse.wheel(0, 1200)
await page.waitForTimeout(3500)
const drawn = await page.locator('.doc-thumb img, .doc-thumb iframe').count()
const kinds = await page.locator('.doc-thumb-kind b').allTextContents()
ok(drawn > 0 || kinds.length === 9, 'previews resolved', { rendered: drawn, kinds })
ok(kinds.every(k => /^[A-Z0-9]{1,4}$/.test(k)) || kinds.length === 0, 'non-drawable files name their kind', kinds)
// the row's own buttons must still work through the preview
const before = page.url()
await rows.first().locator('button').first().click({ timeout: 5000 }).catch(e => { fails++; console.log('button unclickable:', e.message.slice(0,60)) })
await page.waitForTimeout(600)
ok(true, 'the row buttons are still reachable past the thumbnail')
// no horizontal overflow introduced
const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
ok(wide <= 1, 'the page does not scroll sideways', wide)
await b.close()
console.log(fails?`\nFAILED ${fails}`:'\nDocument previews clean.')
process.exit(fails?1:0)
