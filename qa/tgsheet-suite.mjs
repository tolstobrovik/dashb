// The sheet for work that is written, not filmed.
//
// Telegram work is typed. Nobody books a shooter for it, nobody hands over
// footage, and there is no reference reel to look at — so the sheet stops
// asking: no Reference block, no Operator seat, no Recording delivery row.
// The title, the words and the attachment stay, which is the whole job for a
// text admin.
//
// Every channel on the task has to be a written one: a piece cross-posted to
// Instagram is still filmed, and hiding the shooter there would hide a seat
// somebody has to fill. That case is pinned below.
//
// Wants a seeded stack (TG_BASE, default http://localhost:4093).
import { chromium } from 'playwright'
const BASE=process.env.TG_BASE || 'http://localhost:4093', API=BASE+'/api'
let fails=0; const ok=(c,m,x)=>{console.log((c?'✔ ':'✘ ')+m+(x!==undefined?' — '+JSON.stringify(x):''));if(!c)fails++}
const login=async(u,p)=>(await(await fetch(API+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})})).json()).token
const T=await login('admin','admin123')
const req=async(p,m='GET',b)=>(await(await fetch(API+p,{method:m,headers:{'Content-Type':'application/json',Authorization:`Bearer ${T}`},body:b?JSON.stringify(b):undefined})).json())
const tg  = await req('/content','POST',{title:'tg text task',channels:['telegram_main'],type:'post'})
await req(`/content/${tg.id}`,'PATCH',{shot_link:'https://drive.google.com/file/d/tgraw/view'})
const ig  = await req('/content','POST',{title:'ig filmed task',channels:['instagram_main'],type:'reel'})
// A STORED recording link bypasses the show-flag that hides empty delivery
// rows, so this measures the row itself rather than the progressive reveal.
await req(`/content/${ig.id}`,'PATCH',{shot_link:'https://drive.google.com/file/d/igraw/view'})
const both= await req('/content','POST',{title:'cross-posted',channels:['telegram_main','instagram_main'],type:'reel'})
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
const page=await(await b.newContext({viewport:{width:1500,height:1000}})).newPage()
page.on('pageerror',e=>{fails++;console.log('PAGE ERROR',e.message)})
await page.goto(BASE+'/login'); await page.fill('input[name="username"]','admin'); await page.fill('input[name="password"]','admin123')
await page.click('button[type="submit"]'); await page.waitForURL(x=>!/\/login/.test(x.pathname),{timeout:20000})
const look = async (id) => {
  await page.goto(`${BASE}/brief?task=${id}`); await page.waitForSelector('.modal',{timeout:20000}); await page.waitForTimeout(1000)
  const txt = await page.locator('.modal').textContent()
  return {
    reference: await page.locator('.modal [data-field="reference"], .modal .cm-ref').count(),
    operator:  /Operator/.test(txt) ? 1 : 0,
    recording: /Recording/.test(txt) ? 1 : 0,
    title:     await page.locator('.modal input').first().count(),
    description: await page.locator('.modal [data-field="description"] textarea').count(),
  }
}
const a = await look(tg.id)
console.log('telegram sheet:', JSON.stringify(a))
ok(a.reference === 0, 'Telegram: no Reference block')
ok(a.operator === 0,  'Telegram: no Shooter/Operator seat')
ok(a.recording === 0, 'Telegram: no Recording row even with a stored link')
ok(a.title === 1,     'Telegram: the title is still there')
ok(a.description === 1,'Telegram: the words are still there')
const c = await look(ig.id)
console.log('instagram sheet:', JSON.stringify(c))
ok(c.operator === 1,  'Instagram keeps its Shooter')
ok(c.recording === 1, 'Instagram keeps its Recording row (it has a stored link)')
ok(c.reference === 1, 'Instagram keeps its Reference block')
const d = await look(both.id)
console.log('cross-posted sheet:', JSON.stringify(d))
ok(d.operator === 1,  'cross-posted to Instagram still asks for a shooter')
await b.close()
console.log(fails?`\nFAILED ${fails}`:'\nTelegram sheet check clean.')
process.exit(fails?1:0)
