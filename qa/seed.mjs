// Seed a realistic dataset on the audit server so every page has content.
const BASE = 'http://localhost:4090/api'
const login = async (u, p) => (await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined })
  const data = await r.json().catch(() => ({}))
  if (r.status >= 400) console.log('SEED ERR', m, p, r.status, JSON.stringify(data).slice(0, 120))
  return data
}
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
const today = fmt.format(new Date())
const add = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// --- team ---
const jas = await req('/users', 'POST', { name: 'Jasmina Karimova', username: 'jas', password: 'j1234', departments: ['instagram_main', 'instagram_uzb'], permissions: { manage_content: true }, color: '#2a78d6' })
const mir = await req('/users', 'POST', { name: 'Mirabbos Tashkentov', username: 'mir', password: 'm1234', departments: ['youtube'], permissions: { manage_content: true }, color: '#1D9E75' })
const azi = await req('/users', 'POST', { name: 'Aziza Yusupova', username: 'azi', password: 'a1234', departments: ['telegram_uzb', 'telegram_main'], color: '#BA7517' })

// --- content: mix of stages, dates, types ---
const mk = (b) => req('/content', 'POST', b)
const c1 = await mk({ title: 'Admissions week reel — campus tour with the dean', channels: ['instagram_main'], type: 'reel', assignee_id: jas.id, shoot_date: add(1), release_date: add(3), status: 'idea' })
await mk({ title: 'SAT bootcamp announcement post', channels: ['instagram_main', 'telegram_main'], type: 'post', assignee_id: jas.id, release_date: today, status: 'ready' })
await mk({ title: 'Overdue: dorm life story series', channels: ['instagram_uzb'], type: 'story', assignee_id: jas.id, release_date: add(-4), status: 'shot' })
const vid = await mk({ title: 'Alumni interview: from Tashkent to MIT', channels: ['youtube'], type: 'video', assignee_id: mir.id, operator_id: mir.id, editor_id: jas.id, shoot_date: add(-2), release_date: add(6), status: 'editing' })
await mk({ title: 'Telegram digest — weekly college prep tips', channels: ['telegram_uzb'], type: 'post', assignee_id: azi.id, release_date: add(1) })
const doneA = await mk({ title: 'IELTS webinar recap post', channels: ['instagram_main'], type: 'post', assignee_id: jas.id, release_date: add(-1) })
const doneB = await mk({ title: 'Campus vlog #12', channels: ['youtube'], type: 'video', assignee_id: mir.id, operator_id: mir.id, editor_id: jas.id, release_date: add(-2) })
for (const d of [doneA, doneB]) await req(`/content/${d.id}`, 'PATCH', { done: true })
await req(`/content/${c1.id}`, 'PATCH', { pinned: true })

// --- projects & campaigns (3 projects exist from migration) ---
const projects = await req('/projects')
const kaz = projects.find((p) => p.name.includes('Kazakh'))
const amb = projects.find((p) => p.name.includes('Ambassador'))
await req(`/projects/${kaz.id}`, 'PATCH', { owner_id: jas.id, metric: 'Leads', target: 400, actual: 120, deadline: add(40), description: 'Recruit students from Kazakhstan through online funnels.' })
await req(`/projects/${amb.id}`, 'PATCH', { owner_id: mir.id, metric: 'Applications', target: 60, actual: 58, deadline: add(15) })
const live = await req('/campaigns', 'POST', { name: 'July enrollment sprint', stage: 'accepted', project_id: kaz.id, owner_id: jas.id, start_date: add(-6), end_date: add(8), channels: ['instagram_main', 'telegram_main'], metric: 'Leads', target: 150, actual: 40, description: 'Two-week push before the August intake closes.' })
await req('/campaigns', 'POST', { name: 'Autumn open day', stage: 'accepted', project_id: amb.id, owner_id: mir.id, start_date: add(9), end_date: add(24), channels: ['youtube'], metric: 'Sign-ups', target: 200 })
const blocked = await req('/campaigns', 'POST', { name: 'Scholarship stories', stage: 'accepted', project_id: kaz.id, owner_id: jas.id, start_date: add(-3), end_date: add(12), channels: ['instagram_uzb'], metric: 'Reach', target: 5000, actual: 900 })
await req(`/campaigns/${blocked.id}`, 'PATCH', { checklist: [{ text: 'Sign consent forms with 3 scholars', due: add(-1), done: false, owner_id: jas.id }, { text: 'Book studio', due: add(2), done: true }] })
await req(`/campaigns/${live.id}/notes`, 'POST', { text: 'Week 1 retro: CTR is fine, landing page converts poorly.' })
await req(`/content/${vid.id}`, 'PATCH', { campaign_id: live.id })

// --- personal tasks ---
await req('/personal', 'POST', { title: 'Prepare board slides for Friday' })
await req('/personal', 'POST', { title: 'Review Q3 ad budget' })
await req('/personal', 'POST', { title: 'Call the print shop about banners', user_id: jas.id })

// --- metrics: update a few tracker values ---
const trackers = await req('/trackers')
for (const [i, t] of trackers.slice(0, 4).entries()) await req(`/trackers/${t.id}`, 'PATCH', { value: 1200 * (i + 1) + 34 })

console.log('seeded:', { jas: jas.id, mir: mir.id, azi: azi.id, live: live.id, blocked: blocked.id, kaz: kaz.id })
