ROOT="${DASHB_ROOT:-/home/user/dashb}"
cd /tmp/claude-0/-home-user-dashb/e1e8e6e3-0252-58c0-8ecc-a3edec104fdd/scratchpad && cat > pc-suite.mjs <<'EOF'
const BASE = 'http://localhost:4081/api'
const req = async (p, m = 'GET', b, t) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const T = (await req('/auth/login', 'POST', { username: 'admin', password: 'admin123' })).data.token

const projects = (await req('/projects', 'GET', null, T)).data
ok('3 reclassified projects exist', projects.length === 3, projects.map((p) => p.name).join(', '))
ok('projects sorted red-first', projects.every((p) => p.health === 'red'), projects.map((p) => p.health).join(','))
const camps = (await req('/campaigns', 'GET', null, T)).data
ok('YouTube row deleted', !camps.find((c) => c.name === 'YouTube'))
ok('remaining campaigns are Ideas with missing fields', camps.length > 0 && camps.every((c) => c.status === 'idea' && c.missing.length > 0))
const kaz = projects.find((p) => p.name === 'Kazakh Online Campaign')
const kazDetail = (await req(`/projects/${kaz.id}`, 'GET', null, T)).data
ok('imported note preserved old prose', kazDetail.notes.length === 1 && kazDetail.notes[0].text.includes('Imported'))

const gate = await req('/campaigns', 'POST', { name: 'Gate test', stage: 'accepted' }, T)
ok('Create refuses incomplete form, names the gaps', gate.status === 400 && gate.data.missing?.length >= 6)
const idea = await req('/campaigns', 'POST', { name: 'Gate test', stage: 'idea' }, T)
ok('Save as Idea accepts the same form', idea.status === 201 && idea.data.status === 'idea')

const users = (await req('/users', 'GET', null, T)).data
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const add = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const live = await req('/campaigns', 'POST', {
  name: 'Launch push', stage: 'accepted', project_id: kaz.id, owner_id: users[0].id,
  start_date: add(today, -3), end_date: add(today, 10), channels: ['youtube'],
  metric: 'Views', target: 1000, actual: 200,
}, T)
ok('fully specified campaign is Live', live.status === 201 && live.data.status === 'live', JSON.stringify(live.data.error || live.data.status))
ok('pace computed', live.data.pace && typeof live.data.pace.behind === 'boolean', JSON.stringify(live.data.pace))
ok('days left computed', live.data.days_left === 10, String(live.data.days_left))

const blocked = await req(`/campaigns/${live.data.id}`, 'PATCH', { checklist: [{ text: 'Hire the editor', due: add(today, -1), done: false }] }, T)
ok('overdue checklist item sets Blocked', blocked.data.status === 'blocked', blocked.data.status)
ok('blocking item is named', blocked.data.blocking?.text === 'Hire the editor')
const unblocked = await req(`/campaigns/${live.data.id}`, 'PATCH', { checklist: [{ text: 'Hire the editor', due: add(today, -1), done: true }] }, T)
ok('ticking it returns the campaign to Live', unblocked.data.status === 'live')

let p2 = (await req('/projects', 'GET', null, T)).data.find((p) => p.id === kaz.id)
ok('project counts its live campaign', p2.live_campaigns === 1)
ok('ownerless project is red (spec)', p2.health === 'red', p2.health)
await req(`/projects/${kaz.id}`, 'PATCH', { owner_id: users[0].id }, T)
p2 = (await req('/projects', 'GET', null, T)).data.find((p) => p.id === kaz.id)
ok('owner + live campaign + activity → not red', p2.health !== 'red', p2.health)

// upcoming campaign computes Incoming
const inc = await req('/campaigns', 'POST', {
  name: 'Autumn push', stage: 'accepted', project_id: kaz.id, owner_id: users[0].id,
  start_date: add(today, 5), end_date: add(today, 20), channels: ['youtube'], metric: 'Reach', target: 500,
}, T)
ok('future campaign is Incoming', inc.data.status === 'incoming', inc.data.status)

const closed = await req(`/campaigns/${live.data.id}`, 'PATCH', { stage: 'closed' }, T)
ok('manual close → Done', closed.data.status === 'done')
const noBlocked = await req(`/campaigns/${live.data.id}`, 'PATCH', { stage: 'blocked' }, T)
ok('Blocked cannot be typed', noBlocked.status === 400)

const note = await req(`/projects/${kaz.id}/notes`, 'POST', { text: 'Weekly sync done' }, T)
ok('project note records author automatically', note.status === 201 && note.data.author_name === 'Admin')
const cnote = await req(`/campaigns/${live.data.id}/notes`, 'POST', { text: 'Editor hired' }, T)
ok('campaign notes work', cnote.status === 201)

const task = await req('/content', 'POST', { title: 'Post the launch reel', channels: ['youtube'], type: 'reel', campaign_id: live.data.id }, T)
ok('kanban card takes a campaign tag', task.status === 201 && task.data.campaign_id === live.data.id)

// owner permissions: member owner can edit their campaign, not others
const member = (await req('/users', 'POST', { name: 'Owner', username: 'powner', password: 'o1234', departments: ['youtube'] }, T)).data
const MT = (await req('/auth/login', 'POST', { username: 'powner', password: 'o1234' })).data.token
ok('member sees projects', (await req('/projects', 'GET', null, MT)).status === 200)
ok('member cannot create projects', (await req('/projects', 'POST', { name: 'X' }, MT)).status === 403)
await req(`/campaigns/${inc.data.id}`, 'PATCH', { owner_id: member.id }, T)
const ownEdit = await req(`/campaigns/${inc.data.id}`, 'PATCH', { actual: 42 }, MT)
ok('campaign owner types the weekly actual', ownEdit.status === 200 && ownEdit.data.actual === 42)
ok('non-owner member cannot edit others', (await req(`/campaigns/${live.data.id}`, 'PATCH', { actual: 1 }, MT)).status === 403)

// weekly actual on a project by its owner
await req(`/projects/${kaz.id}`, 'PATCH', { owner_id: member.id }, T)
const pAct = await req(`/projects/${kaz.id}`, 'PATCH', { actual: 7 }, MT)
ok('project owner types the weekly actual', pAct.status === 200 && pAct.data.actual === 7)

console.log(fails === 0 ? '\nServer model clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)
EOF
fuser -k 4081/tcp 2>/dev/null; sleep 0.3; rm -rf /tmp/pctest
PORT=4081 DATA_DIR=/tmp/pctest node $ROOT/server/index.js > pc.log 2>&1 &
sleep 2 && node pc-suite.mjs; EX=$?; fuser -k 4081/tcp 2>/dev/null; exit $EX