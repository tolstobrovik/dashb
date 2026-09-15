// The log reads across the sheet.
//
// Every other row in the task sheet is "label, then one value", so the 86px +
// 1fr grid is right for them. A log is not one value: it is many lines of
// prose, each with a time, a name and a sentence, and squeezing it into the
// value column wrapped every entry two or three times over.
//
// Wants a stack with a login (LOG_BASE, default 4094).
import { chromium } from 'playwright'
const BASE=process.env.LOG_BASE || 'http://localhost:4094', API=BASE+'/api'
let fails=0; const ok=(c,m,x)=>{console.log((c?'✔ ':'✘ ')+m+(x!==undefined?' — '+JSON.stringify(x):''));if(!c)fails++}
const T=(await (await fetch(API+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'adam',password:'probe-only-123'})})).json()).token
const req=async(p,m='GET',b)=>(await(await fetch(API+p,{method:m,headers:{'Content-Type':'application/json',Authorization:`Bearer ${T}`},body:b?JSON.stringify(b):undefined})).json())
const chans = await req('/channels')
const t = await req('/content','POST',{title:'log width probe',channels:[chans[0].key],type:'post'})
// make some history worth reading
for (const d of ['first note that is quite long so it would wrap in a narrow column','second','third']) await req(`/content/${t.id}`,'PATCH',{description:d})
const full = await req(`/content/${t.id}`)
console.log('activity entries:', (full.activity||[]).length)
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
const page=await(await b.newContext({viewport:{width:1500,height:1000}})).newPage()
page.on('pageerror',e=>{fails++;console.log('PAGE ERROR',e.message)})
await page.goto(BASE+'/login'); await page.fill('input[name="username"]','adam'); await page.fill('input[name="password"]','probe-only-123')
await page.click('button[type="submit"]'); await page.waitForURL(x=>!/\/login/.test(x.pathname),{timeout:20000})
await page.goto(`${BASE}/brief?task=${t.id}`); await page.waitForSelector('.modal',{timeout:20000}); await page.waitForTimeout(1600)
// History lives on the Talk page; an undisplayed page measures zero.
const talk = page.locator('.modal .cm-page-tab').filter({ hasText: /talk/i }).first()
if (await talk.count()) { await talk.click(); await page.waitForTimeout(700) }
const m = await page.evaluate(() => {
  const row = document.querySelector('.cm-history'); if (!row) return null
  const list = [...row.children].find(c => c.tagName === 'DIV')
  return { rowW: Math.round(row.getBoundingClientRect().width), listW: Math.round(list.getBoundingClientRect().width),
           cols: getComputedStyle(row).gridTemplateColumns }
})
console.log('history block:', JSON.stringify(m))
ok(!!m, 'the history block is on screen')
if (m) {
  ok(m.listW / m.rowW > 0.9, 'the log spans its row rather than an 86px-offset column', +(m.listW/m.rowW).toFixed(2))
  ok(!/^86px/.test(m.cols), 'the two-column label grid is gone from this row', m.cols)
}
await b.close()
console.log(fails?`\nFAILED ${fails}`:'\nLog width clean.')
process.exit(fails?1:0)
