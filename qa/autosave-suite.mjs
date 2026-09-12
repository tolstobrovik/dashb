// The copy that survives the tab dying.
//
// Typing into a task sheet is the one place on this board where minutes of
// somebody's work exist ONLY in the browser. This pins the whole contract:
// the sheet writes a private copy every five seconds, sends NOTHING to the
// server on that timer, offers the copy back when a tab that died is reopened,
// and forgets it once the words are actually stored.
//
// Wants a seeded stack on 4093.
import { chromium } from 'playwright'
const BASE=process.env.AS_BASE || 'http://localhost:4093', API=BASE+'/api'
let fails=0; const ok=(c,m,x)=>{console.log((c?'✔ ':'✘ ')+m+(x!==undefined?' — '+JSON.stringify(x):''));if(!c)fails++}
const login=async(u,p)=>(await(await fetch(API+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})})).json()).token
const T=await login('admin','admin123')
const req=async(p,m='GET',b)=>(await(await fetch(API+p,{method:m,headers:{'Content-Type':'application/json',Authorization:`Bearer ${T}`},body:b?JSON.stringify(b):undefined})).json())
const t=await req('/content','POST',{title:'autosave probe',channels:['instagram_main'],type:'post'})
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
const ctx=await b.newContext({viewport:{width:1500,height:1000}})
const page=await ctx.newPage()
page.on('pageerror',e=>{fails++;console.log('PAGE ERROR',e.message)})
await page.goto(BASE+'/login'); await page.fill('input[name="username"]','admin'); await page.fill('input[name="password"]','admin123')
await page.click('button[type="submit"]'); await page.waitForURL(x=>!/\/login/.test(x.pathname),{timeout:20000})

// --- type into the sheet, then kill the tab without saving ---
await page.goto(`${BASE}/brief?task=${t.id}`); await page.waitForSelector('.modal',{timeout:20000}); await page.waitForTimeout(800)
const WORDS='five minutes of writing nobody wants to lose'
await page.locator('.modal [data-field="description"] textarea').first().fill(WORDS)
ok(true,'typed into the sheet')
const key = await page.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('satashkent_draft_')) || null)
ok(!key,'nothing written yet — the interval has not come round')
await page.waitForTimeout(6000)   // one tick of the 5s interval
const saved = await page.evaluate(() => {
  const k = Object.keys(localStorage).find(x => x.startsWith('satashkent_draft_'))
  return k ? JSON.parse(localStorage.getItem(k)) : null
})
ok(!!saved,'after five seconds a draft exists', saved && Object.keys(saved))
ok(saved?.form?.description === WORDS,'…and it holds exactly what was typed', saved?.form?.description)
ok(typeof saved?.at === 'number','…stamped with a time')
// nothing reached the server
const onServer = await req(`/content/${t.id}`)
ok((onServer.description||'') !== WORDS,'and NOTHING was sent to the server', onServer.description||'(empty)')

// --- the tab dies. a new one opens the same task ---
await page.close()   // really close it: an open tab keeps writing its own draft, correctly
const page2 = await ctx.newPage()
await page2.goto(`${BASE}/brief?task=${t.id}`); await page2.waitForSelector('.modal',{timeout:20000}); await page2.waitForTimeout(1200)
ok(await page2.locator('.cm-rescue').count() === 1,'the new tab offers the rescued words')
await page2.locator('.cm-rescue button.btn-primary').click()
await page2.waitForTimeout(600)
const back = await page2.locator('.modal [data-field="description"] textarea').first().inputValue()
ok(back === WORDS,'pressing Restore puts them back', back)
// saving clears the draft
await page2.locator('.modal button.btn-primary').filter({hasText:/save/i}).first().click()
await page2.waitForTimeout(1800)
const gone = await page2.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('satashkent_draft_')).length)
ok(gone === 0,'a landed save clears the copy', gone)
ok((await req(`/content/${t.id}`)).description === WORDS,'…and the words are on the server now')
await b.close()
console.log(fails?`\nFAILED ${fails}`:'\nAuto-save check clean.')
process.exit(fails?1:0)
