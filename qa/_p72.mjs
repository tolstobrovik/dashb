import { spawn } from 'child_process'
const PORT='4202', MOCK='http://localhost:9971', BASE=`http://localhost:${PORT}`
const TOKEN='x72-token'
import { createHash } from 'crypto'
const SECRET=createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0,40)
const procs=[]
const boot=(a,e)=>{const p=spawn(process.execPath,a,{env:{...process.env,...e},stdio:'ignore'});procs.push(p);return p}
process.on('exit',()=>procs.forEach(p=>{try{p.kill('SIGKILL')}catch{}}))
boot(['mock-tg.mjs'],{MOCK_PORT:'9971'})
boot(['/home/user/dashb/server/index.js'],{DATA_DIR:'/tmp/p72-'+Date.now(),PORT,TELEGRAM_BOT_TOKEN:TOKEN,TELEGRAM_API_BASE:MOCK})
const up=async u=>{for(let i=0;i<60;i++){try{if((await fetch(u)).ok)return true}catch{}await new Promise(r=>setTimeout(r,500))}return false}
await up(MOCK+'/__sent'); await up(BASE+'/api/health')
const api=async(p,m='GET',b,t)=>{const r=await fetch(BASE+'/api'+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});return{status:r.status,data:await r.json().catch(()=>({}))}}
const T=(await api('/auth/login','POST',{username:'admin',password:'admin123'})).data.token
const st=(await api('/statuses','GET',null,T)).data
const sid=re=>st.find(s=>re.test(s.label)).id
const ch=(await api('/channels','GET',null,T)).data[0].key
const ed=(await api('/users','POST',{name:'Eldor',username:'p72ed',password:'probe123',role:'editor',departments:[ch]},T)).data
const op=(await api('/users','POST',{name:'Olim',username:'p72op',password:'probe123',role:'operator',departments:[ch]},T)).data
// link the editor to telegram so the digest reaches them
const edT=(await api('/auth/login','POST',{username:'p72ed',password:'probe123'})).data.token
const l=(await api('/telegram/link','POST',{},edT)).data
await fetch(BASE+'/api/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':SECRET},body:JSON.stringify({message:{chat:{id:721},text:'/start '+l.code}})})
const day=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}
// EXACTLY the reported shape: shot 19 days ago, cut due 17 days ago, work is
// finished — the piece is sitting in review.
const t=(await api('/content','POST',{channels:[ch],title:'Bahrom student result',type:'reel',status_id:sid(/to shoot/i),operator_id:op.id,editor_id:ed.id,recording_date:day(-19),edit_ready_date:day(-17),release_date:day(3),reference_links:['https://example.com/r']},T)).data
await api(`/content/${t.id}`,'PATCH',{milestone:'shot'},(await api('/auth/login','POST',{username:'p72op',password:'probe123'})).data.token)
await api(`/content/${t.id}`,'PATCH',{milestone:'edited',ready_link:'https://drive.google.com/the-cut'},edT)
const now=(await api(`/content/${t.id}`,'GET',null,T)).data
console.log('piece is at stage:', st.find(s=>s.id===now.status_id).label, '| shot_at:', !!now.shot_at, '| edited_at:', !!now.edited_at)
await fetch(MOCK+'/__reset',{method:'POST'})
const cron=await api('/cron/daily','GET',null,T)
const sent=await (await fetch(MOCK+'/__sent')).json()
const msg=sent.filter(m=>String(m.chat_id)==='721').map(m=>m.text).join('\n')
console.log('--- what the digest now says to the editor ---')
console.log(msg||'(nothing sent)')
console.log('---')
console.log('says the cut is late?', /the cut,.*late/.test(msg), '(false expected)')
console.log('says the shoot is late?', /the shoot,.*late/.test(msg), '(false expected)')
console.log('editor late list:', (await api('/content/late/mine','GET',null,edT)).data.length, '(0 expected)')
