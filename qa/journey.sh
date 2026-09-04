ROOT="${DASHB_ROOT:-/home/user/dashb}"
SP=${SP:-/tmp/claude-0/-home-user-dashb/e1e8e6e3-0252-58c0-8ecc-a3edec104fdd/scratchpad}
cat > $SP/journey.mjs <<'EOF'
const BASE = 'http://localhost:4081/api'
let bugs = 0
const ok = (n, c, x = '') => { if (!c) bugs++; console.log(`${c ? '✔' : '✘ BUG'} ${n}${x ? ` — ${x}` : ''}`) }
const req = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let data = {}; try { data = await res.json() } catch {}
  return { status: res.status, data }
}
const login = async (u, p) => (await req('/auth/login', { method: 'POST', body: { username: u, password: p } })).data.token
const T = await login('admin', 'admin123')
const jas = (await req('/users', { method: 'POST', token: T, body: { name: 'Jasmina', username: 'jas', password: 'j1234', departments: ['instagram_main', 'instagram_uzb'] } })).data
const mir = (await req('/users', { method: 'POST', token: T, body: { name: 'Mirabbos', username: 'mir', password: 'm1234', departments: ['instagram_uzb'] } })).data
const chans = (await req('/channels', { token: T })).data
const ig = chans.find((c) => c.key === 'instagram_main')
const headSet = await req(`/channels/${ig.id}`, { method: 'PATCH', token: T, body: { head_id: jas.id } })
ok('assign head to channel', headSet.status === 200 && headSet.data.head_id === jas.id)
const chans2 = (await req('/channels', { token: T })).data
ok('head name rides along in GET /channels', chans2.find((c) => c.key === 'instagram_main').head_name === 'Jasmina')
const nw = await req('/channels', { method: 'POST', token: T, body: { label: 'TikTok', icon: 'music', head_id: mir.id } })
ok('create channel with head', nw.status === 201 && nw.data.head_id === mir.id)
ok('bogus head rejected', (await req(`/channels/${ig.id}`, { method: 'PATCH', token: T, body: { head_id: 9999 } })).status === 400)
const MT = await login('jas', 'j1234')
ok('member cannot edit channels', (await req(`/channels/${ig.id}`, { method: 'PATCH', token: MT, body: { head_id: null } })).status === 403)
const task = (await req('/content', { method: 'POST', token: MT, body: { title: 'A'.repeat(200), channels: ['instagram_main'], type: 'reel', release_date: '2026-07-20' } })).data
ok('member creates task with long title', !!task.id)
const statuses = (await req('/statuses', { token: MT })).data
const toShoot = statuses.find((s) => s.label === 'To shoot')
// Booking a shoot is a promise now, so it carries one: who is filming, the
// three days, and something for them to work from. A member may still make
// that promise — the rule is about the booking being complete, not about who
// is allowed to make it.
const bare = await req(`/content/${task.id}`, { method: 'PATCH', token: MT, body: { status_id: toShoot.id } })
ok('a bare reel cannot be booked onto To shoot', bare.status === 400, `${bare.status} ${bare.data.error || ''}`)
await req(`/content/${task.id}`, { method: 'PATCH', token: MT, body: {
  operator_id: jas.id, recording_date: '2026-07-14', edit_ready_date: '2026-07-17',
  reference_links: ['https://example.com/reference'],
  // …and the words they film from, which is part of what makes the promise
  // complete: a crew turning up without a script is a day spent working out
  // what to shoot.
  script: 'Open on the main gate, then three students saying why they chose us.',
} })
const moved = await req(`/content/${task.id}`, { method: 'PATCH', token: MT, body: { status_id: toShoot.id } })
ok('member books the shoot and moves it to To shoot', moved.status === 200 && moved.data.status_id === toShoot.id,
  `${moved.status} ${moved.data.error || ''}`)
ok('member blocked from admin user PATCH', (await req(`/users/${mir.id}`, { method: 'PATCH', token: MT, body: { name: 'hack' } })).status === 403)
const MT2 = await login('mir', 'm1234')
const mirView = (await req('/content', { token: MT2 })).data
ok('other member does not see foreign-channel task', !mirView.find((c) => c.id === task.id))
ok('other member cannot open it directly', (await req(`/content/${task.id}`, { token: MT2 })).status === 404)
ok('empty title rejected', (await req('/content', { method: 'POST', token: T, body: { title: '   ', channels: ['youtube'], type: 'post' } })).status === 400)
ok('unknown channel rejected', (await req('/content', { method: 'POST', token: T, body: { title: 'X', channels: ['nope'], type: 'post' } })).status === 400)
await req(`/users/${mir.id}`, { method: 'DELETE', token: T })
const afterDel = (await req('/channels', { token: T })).data.find((c) => c.key === nw.data.key)
ok('deleting head user clears headship', afterDel.head_id === null)
const sts = (await req('/statuses', { token: T })).data
let blocked = false
for (let i = 0; i < sts.length; i++) {
  const r = await req(`/statuses/${sts[i].id}`, { method: 'DELETE', token: T })
  if (r.status === 400) { blocked = true; break }
}
ok('cannot delete the last pipeline stage', blocked)
const cl = await req('/campaigns', { token: T })
ok('campaign list returns computed statuses', cl.status === 200 && cl.data.every((c) => ['idea', 'incoming', 'live', 'blocked', 'done'].includes(c.status)))
const emoji = (await req('/content', { method: 'POST', token: T, body: { title: 'Съёмка 🎬 в 15:00 — тест', channels: ['youtube'], type: 'video' } })).data
ok('unicode & emoji titles survive', (await req(`/content/${emoji.id}`, { token: T })).data.title === 'Съёмка 🎬 в 15:00 — тест')
await req(`/content/${emoji.id}`, { method: 'DELETE', token: T })
await req(`/content/${task.id}`, { method: 'DELETE', token: T })
await req(`/channels/${nw.data.id}`, { method: 'DELETE', token: T })
await req(`/users/${jas.id}`, { method: 'DELETE', token: T })
console.log(bugs === 0 ? '\nJourney clean.' : `\n${bugs} PROBLEMS FOUND`)
process.exit(bugs === 0 ? 0 : 1)
EOF
cd $SP && fuser -k 4081/tcp 2>/dev/null; sleep 1; rm -rf /tmp/regpc
PORT=4081 DATA_DIR=/tmp/regpc node $ROOT/server/index.js > rpc.log 2>&1 &
# Wait for the server to actually answer rather than sleeping a guessed
# interval: a flat `sleep 2` lost the race on a loaded sandbox and the whole
# journey died on ECONNREFUSED — which, before the exit code was read, was
# indistinguishable from a clean pass.
for i in $(seq 1 40); do curl -s http://localhost:4081/api/health >/dev/null 2>&1 && break; sleep 0.5; done
# The whole output, and the REAL exit code.
#
# This used to be `node journey.mjs 2>&1 | tail -2`, and the gate decided
# pass/fail by grepping the log for "BUG". journey.mjs prints "✘ BUG ..." per
# failure and then a summary line — so `tail -2` kept exactly the blank line
# and "N PROBLEMS FOUND", and neither contains the word being grepped for. A
# failing journey could not produce a failing gate entry: measured with two
# deliberate regressions, it still reported PASS. The suite's own exit code is
# the thing that cannot be fooled, so that is what the gate reads now.
#
# pc-suite.mjs used to be run again down here and its result thrown away;
# pc-suite.sh runs it properly against its own server, so this no longer does.
node journey.mjs 2>&1; EX=$?
fuser -k 4081/tcp 2>/dev/null
exit $EX
