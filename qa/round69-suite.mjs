// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 69: saying a thing is finished is a claim, and the claim is checkable.
//
// THE CUT HAS TO EXIST. "Mark as edited" sent a piece to review with nothing
// attached, and the reviewer discovered that instead of the editor. For the
// two stages that produce a FILE the claim is checkable, so it is checked.
// The shoot is deliberately exempt: footage goes over on a hard drive as
// often as not, and refusing the tick would not create the file — it would
// only leave the board saying the shoot has not happened.
//
// A FIX IS A NEW FILE. Sending the same cut back is how a whole revision
// round evaporates: the note is read, the tick is pressed, the reviewer opens
// the identical file and the round has cost a day for nothing.
//
// AN OPEN PRAVKI STOPS A RELEASE. Changes still outstanding means the piece
// is not finished, whoever presses publish.
//
// A HAND CAN GO UP EARLY. The crew could always deliver late; they had no way
// to say so in advance, so the first anybody knew was the deadline passing.
// Self-contained: 4108.
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4108'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
boot([ROOT + '/server/index.js'], { DATA_DIR: SP + 'r69-' + Date.now(), PORT: '4108' })
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
const ch = (await req('/channels')).data[0].key
const stages = (await req('/statuses')).data
const sid = (re) => stages.find((s) => re.test(s.label)).id

const op = (await req('/users', 'POST', {
  name: 'R69 Olim', username: 'r69op', password: 'probe123', role: 'operator', departments: [ch],
})).data
const ed = (await req('/users', 'POST', {
  name: 'R69 Eldor', username: 'r69ed', password: 'probe123', role: 'editor', departments: [ch],
})).data
const opT = await login('r69op', 'probe123')
const edT = await login('r69ed', 'probe123')

const booked = {
  status_id: sid(/to shoot/i), operator_id: op.id, editor_id: ed.id,
  recording_date: day(1), edit_ready_date: day(3), release_date: day(5),
  reference_links: ['https://example.com/reference'],
}
const mk = (over) => req('/content', 'POST', { channels: [ch], ...over })
const fresh = async (title) => {
  const t = (await mk({ title, type: 'reel', ...booked })).data
  await req(`/content/${t.id}`, 'PATCH', { status_id: sid(/^shot$/i) })
  return t
}

// ===================== the cut has to exist =====================
let t = await fresh('r69 the piece')
let r = await req(`/content/${t.id}`, 'PATCH', { milestone: 'edited' }, edT)
ok('“edited” with nothing attached is refused', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…and the refusal names the box to fill', r.data.needs_link === 'ready_link', JSON.stringify(r.data.needs_link))
ok('…and the piece did not move to review',
  (await req(`/content/${t.id}`)).data.status_id === sid(/^shot$/i))

r = await req(`/content/${t.id}`, 'PATCH', { milestone: 'edited', ready_link: 'https://drive.google.com/cut-1' }, edT)
ok('…the cut goes in with the tick, in one press', r.status === 200, `${r.status} ${r.data.error || ''}`)
ok('…and THAT is when it reaches review', (await req(`/content/${t.id}`)).data.status_id === sid(/^ready$/i))
ok('…with the cut on it', (await req(`/content/${t.id}`)).data.ready_link === 'https://drive.google.com/cut-1')

// The shoot is exempt, on purpose. Footage travels on a hard drive.
const t2 = (await mk({ title: 'r69 shot on a drive', type: 'reel', ...booked })).data
r = await req(`/content/${t2.id}`, 'PATCH', { milestone: 'shot' }, opT)
ok('the SHOOT is not asked for a link — the footage is on a drive', r.status === 200,
  `${r.status} ${r.data.error || ''}`)

// ===================== a fix is a new file =====================
r = await req(`/content/${t.id}/revisions`, 'POST', { note: 'The third shot is too slow', target: 'editor' })
ok('the reviewer sends it back', r.status === 201 || r.status === 200, String(r.status))
const rev = (await req(`/content/${t.id}`)).data.revisions.find((v) => !v.resolved_at)
ok('…and the revision is open', !!rev, JSON.stringify(rev))

r = await req(`/content/revisions/${rev.id}/resolve`, 'POST', { link: 'https://drive.google.com/cut-1' }, edT)
ok('delivering the SAME file back is refused', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…and says so in those words', /same file/i.test(r.data.error || ''), r.data.error)
ok('…and the revision is still open',
  !!(await req(`/content/${t.id}`)).data.revisions.find((v) => v.id === rev.id && !v.resolved_at))

r = await req(`/content/revisions/${rev.id}/resolve`, 'POST', {}, edT)
ok('pressing done with nothing new is the same act, so it is refused too', r.status === 400,
  `${r.status} ${r.data.error || ''}`)

r = await req(`/content/revisions/${rev.id}/resolve`, 'POST', { link: 'https://drive.google.com/cut-2' }, edT)
ok('a genuinely new file closes the round', r.status === 200, `${r.status} ${r.data.error || ''}`)
ok('…and the task carries the new cut', (await req(`/content/${t.id}`)).data.ready_link === 'https://drive.google.com/cut-2')

// ===================== an open Pravki stops a release =====================
await req(`/content/${t.id}/revisions`, 'POST', { note: 'One more pass on the captions', target: 'editor' })
r = await req(`/content/${t.id}`, 'PATCH', { status_id: sid(/published/i) })
ok('a piece with changes outstanding cannot be published', r.status === 409, `${r.status} ${r.data.error || ''}`)
ok('…and the refusal quotes what is outstanding', /captions/.test(r.data.error || ''), r.data.error)
ok('…even for an admin, because the piece is the piece',
  (await req(`/content/${t.id}`)).data.status_id !== sid(/published/i))
// The done tick is the same act by another name.
r = await req(`/content/${t.id}`, 'PATCH', { done: true })
ok('…and ticking it complete is the same act, so it is stopped too', r.status === 409, String(r.status))

const last = (await req(`/content/${t.id}`)).data.revisions.find((v) => !v.resolved_at)
await req(`/content/revisions/${last.id}/resolve`, 'POST', { link: 'https://drive.google.com/cut-3' }, edT)
r = await req(`/content/${t.id}`, 'PATCH', { status_id: sid(/published/i) })
ok('with the round closed, it goes out', r.status === 200, `${r.status} ${r.data.error || ''}`)

// ===================== a hand can go up early =====================
const t3 = await fresh('r69 the piece in trouble')
r = await req(`/content/${t3.id}/flags`, 'POST', { kind: 'at_risk', reason: 'late' }, edT)
ok('a heads-up with no reason is refused — it leaves the same guessing', r.status === 400,
  `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${t3.id}/flags`, 'POST',
  { kind: 'at_risk', reason: 'My other shoot overran and I need one more day' }, edT)
ok('the editor can say early that it will be late', r.status === 201, `${r.status} ${r.data.error || ''}`)
const flag = r.data

r = await req(`/content/${t3.id}/flags`, 'POST', { kind: 'at_risk', reason: 'Saying the very same thing again' }, edT)
ok('…and a second hand from the same person is the same conversation', r.status === 409, String(r.status))

const bell = async (tok) => ((await req('/notifications', 'GET', null, tok)).data.events || [])
ok('the people who plan hear it at once', (await bell(T)).some((n) => /will be late/i.test(n.text || '')),
  JSON.stringify((await bell(T)).slice(0, 2).map((n) => n.text)))

r = await req('/content/flags/open')
ok('every hand up is in one place for them', r.status === 200 && r.data.some((f) => f.id === flag.id),
  JSON.stringify(r.data.map((f) => f.title)))
ok('…with the reason on the row, which is the point of it',
  /overran/.test(r.data.find((f) => f.id === flag.id)?.reason || ''), '')
r = await req('/content/flags/open', 'GET', null, edT)
ok('…and the crew are not shown a queue they cannot act on', r.data.length === 0, JSON.stringify(r.data))

// Somebody with no part in the piece does not get to raise a hand on it.
// A crew account on the same channel but NOT on this task: a "member" would
// not test the rule, because a member plans work and may legitimately flag a
// piece they are not personally carrying.
const outsider = (await req('/users', 'POST', {
  name: 'R69 Bystander', username: 'r69out', password: 'probe123', role: 'operator', departments: [ch],
})).data
const outT = await login('r69out', 'probe123')
r = await req(`/content/${t3.id}/flags`, 'POST',
  { kind: 'cant_take', reason: 'Nothing to do with me at all' }, outT)
// 404, not 403, and that is the stronger answer: a crew account cannot SEE a
// task it is not on, so there is nothing to raise a hand about. (The rule in
// the handler still refuses somebody who can see a task without carrying any
// part of it — belt and braces for a shape only a member can reach, and a
// member planning the work may legitimately flag a piece they are not
// personally carrying.)
ok('somebody with no part in the piece cannot raise a hand on it', r.status === 404,
  `${r.status} ${r.data.error || ''}`)

r = await req(`/content/flags/${flag.id}/clear`, 'POST', {}, outT)
ok('…nor put somebody else’s hand down', r.status === 403, `${r.status} ${r.data.error || ''}`)
r = await req(`/content/flags/${flag.id}/clear`, 'POST', {}, edT)
ok('whoever raised it can put it down', r.status === 200, `${r.status} ${r.data.error || ''}`)
ok('…and the queue empties', !(await req('/content/flags/open')).data.some((f) => f.id === flag.id))
r = await req(`/content/flags/${flag.id}/clear`, 'POST', {}, edT)
ok('…and a hand already down is not lowered twice', r.status === 409, String(r.status))

stop()
console.log(fails === 0 ? '\nRound-69 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
