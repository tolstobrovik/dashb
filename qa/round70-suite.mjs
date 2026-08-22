// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 70: an admin runs the channels they actually run.
//
// "Admin" was all or nothing, which is the wrong shape for a team where one
// person runs YouTube and another runs the Instagram accounts. Giving the
// YouTube lead what they needed for YouTube — moving a promised day, deleting
// a piece, publishing — also handed them every one of those powers over
// Instagram, and over the accounts of the people running it.
//
// `admin_channels` scopes it. EMPTY MEANS EVERYWHERE, which is exactly what
// every admin was before this existed: nobody's reach changed when the column
// appeared, and the person who sets these up keeps theirs by leaving it empty.
//
// The line is content versus furniture. A channel admin has the full run of
// the WORK on their channels — the dates, the crew, the publishing, the
// deleting. They do not make accounts, add channels, or rewrite the pipeline
// rules, because those belong to the whole board rather than to one channel.
// Self-contained: 4109.
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4109'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
boot([ROOT + '/server/index.js'], { DATA_DIR: SP + 'r70-' + Date.now(), PORT: '4109' })
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(B + '/health')).ok) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500))
}

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (n) => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) } // Tashkent day, like the server
const keys = (await req('/channels')).data.map((c) => c.key)
const IG = keys.find((k) => /instagram_main/.test(k))
const YT = keys.find((k) => /youtube/.test(k))
const stages = (await req('/statuses')).data
const sid = (re) => stages.find((s) => re.test(s.label)).id

// The YouTube lead. Ticking a channel is the whole of the change.
let r = await req('/users', 'POST', {
  name: 'R70 Yulduz', username: 'r70yt', password: 'probe123', role: 'admin', admin_channels: [YT],
})
ok('an admin can be scoped to one channel', r.status === 201, `${r.status} ${r.data.error || ''}`)
ok('…and the scope comes back on the person', JSON.stringify(r.data.admin_channels) === JSON.stringify([YT]),
  JSON.stringify(r.data.admin_channels))
const ytT = await login('r70yt', 'probe123')

// Somebody who runs the whole board, made the ordinary way.
r = await req('/users', 'POST', {
  name: 'R70 Everything', username: 'r70all', password: 'probe123', role: 'admin',
})
ok('an admin with nothing ticked runs the whole board', (r.data.admin_channels || []).length === 0,
  JSON.stringify(r.data.admin_channels))
const allT = await login('r70all', 'probe123')

const op = (await req('/users', 'POST', {
  name: 'R70 Olim', username: 'r70op', password: 'probe123', role: 'operator', departments: [IG, YT],
})).data
const booked = (ch) => ({
  channels: [ch], type: 'reel', status_id: sid(/to shoot/i), operator_id: op.id,
  recording_date: day(1), edit_ready_date: day(3), release_date: day(5),
  reference_links: ['https://example.com/reference'],
})
const igTask = (await req('/content', 'POST', { title: 'r70 an Instagram piece', ...booked(IG) })).data
const ytTask = (await req('/content', 'POST', { title: 'r70 a YouTube piece', ...booked(YT) })).data

// ===================== what they can see =====================
const seen = (await req('/content', 'GET', null, ytT)).data.map((t) => t.title)
ok('a channel admin sees their own channel’s work', seen.includes('r70 a YouTube piece'), JSON.stringify(seen))
ok('…and not the other channel’s', !seen.includes('r70 an Instagram piece'), JSON.stringify(seen))
ok('an admin of the whole board still sees both',
  (await req('/content', 'GET', null, allT)).data.length >= 2)

// ===================== full run of their own work =====================
// A promised day is an admin's to move — on the channels they run.
r = await req(`/content/${ytTask.id}`, 'PATCH', { release_date: day(9) }, ytT)
ok('they move a promised day on their own channel', r.status === 200, `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${igTask.id}`, 'PATCH', { release_date: day(9) }, ytT)
ok('…and cannot touch one on a channel they do not run', r.status === 403, `${r.status} ${r.data.error || ''}`)

// A day-move request is answered by the admin of the channel it belongs to.
const smm = (await req('/users', 'POST', {
  name: 'R70 Sami', username: 'r70smm', password: 'probe123', role: 'member', departments: [IG, YT],
  permissions: { manage_content: true, move_tasks: true },
})).data
const smmT = await login('r70smm', 'probe123')
const askOn = async (task) => (await req(`/content/${task.id}/date-requests`, 'POST',
  { field: 'recording_date', to_date: day(4), reason: 'The location cancelled on us this morning' }, smmT)).data
const igAsk = await askOn(igTask)
const ytAsk = await askOn(ytTask)
ok('both channels have a day waiting on an admin', !!igAsk.id && !!ytAsk.id)

let queue = await req('/content/date-requests/open', 'GET', null, ytT)
ok('the queue shows a channel admin only their own channel',
  queue.data.some((a) => a.id === ytAsk.id) && !queue.data.some((a) => a.id === igAsk.id),
  JSON.stringify(queue.data.map((a) => a.title)))
queue = await req('/content/date-requests/open', 'GET', null, allT)
ok('…and shows the whole board’s admin both', queue.data.length >= 2, String(queue.data.length))

r = await req(`/content/date-requests/${igAsk.id}/decide`, 'POST', { approve: true }, ytT)
ok('they cannot answer for a channel they do not run', r.status === 403, `${r.status} ${r.data.error || ''}`)
ok('…and the day did not move', (await req(`/content/${igTask.id}`)).data.recording_date === day(1))
r = await req(`/content/date-requests/${ytAsk.id}/decide`, 'POST', { approve: true }, ytT)
ok('…and they DO answer for their own', r.status === 200, `${r.status} ${r.data.error || ''}`)
ok('…which moves the day', (await req(`/content/${ytTask.id}`)).data.recording_date === day(4))

// Deleting is the same shape.
r = await req(`/content/${igTask.id}`, 'DELETE', null, ytT)
ok('they cannot delete another channel’s piece', r.status === 403, `${r.status} ${r.data.error || ''}`)
ok('…and it is still there', !!(await req(`/content/${igTask.id}`)).data.id)
r = await req(`/content/${ytTask.id}`, 'DELETE', null, ytT)
ok('…and they can delete their own channel’s', r.status === 200, `${r.status} ${r.data.error || ''}`)

// ===================== the furniture is not theirs =====================
r = await req('/users', 'POST', { name: 'R70 Nope', username: 'r70nope', password: 'probe123', role: 'member' }, ytT)
ok('a channel admin does not make accounts', r.status === 403, `${r.status} ${r.data.error || ''}`)
ok('…and is told why, not just refused', /whole board/i.test(r.data.error || ''), r.data.error)
r = await req('/channels', 'POST', { label: 'R70 New', icon: 'star' }, ytT)
ok('…nor add channels', r.status === 403, String(r.status))
r = await req('/fields', 'POST', { script: { state: 'required', types: ['post'] } }, ytT)
ok('…nor rewrite the pipeline rules', r.status === 403, String(r.status))
r = await req(`/users/${op.id}`, 'PATCH', { name: 'Renamed by the wrong admin' }, ytT)
ok('…nor edit anybody’s account', r.status === 403, String(r.status))

// The whole board's admin still does all of it — nothing was taken away.
r = await req('/users', 'POST', { name: 'R70 Fine', username: 'r70fine', password: 'probe123', role: 'member' }, allT)
ok('an admin of the whole board still makes accounts', r.status === 201, `${r.status} ${r.data.error || ''}`)
r = await req('/channels', 'POST', { label: 'R70 Allowed', icon: 'star' }, allT)
ok('…and still adds channels', r.status === 201, `${r.status} ${r.data.error || ''}`)

// ===================== scoping is set by the board's admin =====================
r = await req(`/users/${(await req('/users')).data.find((u) => u.username === 'r70all').id}`, 'PATCH',
  { admin_channels: [IG] }, allT)
ok('an admin cannot quietly scope THEMSELVES to a channel', r.status === 400, `${r.status} ${r.data.error || ''}`)
const ytUser = (await req('/users')).data.find((u) => u.username === 'r70yt')
r = await req(`/users/${ytUser.id}`, 'PATCH', { admin_channels: [IG, YT] }, allT)
ok('…but the board’s admin widens somebody else’s reach', r.status === 200, `${r.status} ${r.data.error || ''}`)
ok('…and it takes effect', (await req('/users')).data.find((u) => u.username === 'r70yt').admin_channels.length === 2)
// Stepping down from admin drops the scope with it — a stale list on a member
// would be a quiet grant waiting to come back.
r = await req(`/users/${ytUser.id}`, 'PATCH', { role: 'member', departments: [YT] }, allT)
ok('dropping the admin role clears the channel scope with it',
  ((await req('/users')).data.find((u) => u.username === 'r70yt').admin_channels || []).length === 0,
  JSON.stringify((await req('/users')).data.find((u) => u.username === 'r70yt').admin_channels))

stop()
console.log(fails === 0 ? '\nRound-70 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
