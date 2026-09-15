// Two rules about where a task stands.
//
// IDEA is a thought nobody has promised anything about, so anybody who can see
// it may shove it along — no move_tasks ticket, no waiting on whoever's name
// happens to be on it.
//
// TO SHOOT and EDITING are the opposite: a morning is held, a cut is due, and
// the days on the task are other people's plans. So the deadlines freeze there
// for everyone but an admin — the set ones (already true) and the empty ones
// (new: bolting a fresh deadline onto work in progress is the same disruption
// as moving one).
//
// Wants a seeded stack on 4090 (qa/seed.mjs).
const BASE = 'http://localhost:4090/api'
let fails = 0
const ok = (c, m, x) => { console.log((c ? '✔ ' : '✘ ') + m + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); if (!c) fails++ }

const login = async (u, p) => (await (await fetch(BASE + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const call = async (p, tok, m = 'GET', b) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const req = async (p, m = 'GET', b) => (await call(p, T, m, b)).data

const statuses = await req('/statuses')
const S = (re) => statuses.find((s) => re.test(s.label))
const idea = S(/idea/i), toShoot = S(/to shoot/i), editing = S(/editing/i)
const ready = S(/^ready$/i), published = statuses.find((s) => s.is_final)
ok(!!(idea && toShoot && editing && ready && published), 'the pipeline is the shipped six', statuses.map((s) => s.label))

// ---- three people, none of them an admin ----------------------------------
// Make the account, or bring an existing one back to the state this suite
// needs — a run that inherits last run's permissions is a run that proves
// whatever those happened to be.
const mkUser = async (b) => {
  const made = await req('/users', 'POST', b)
  if (made?.id) return made
  const all = await req('/users')
  const found = (Array.isArray(all) ? all : []).find((u) => u.username === b.username)
  if (!found) return {}
  return await req(`/users/${found.id}`, 'PATCH',
    { role: b.role, crew_roles: b.crew_roles, departments: b.departments, permissions: b.permissions })
}
const ch = 'instagram_main'
// A plain member with NO move_tasks: the person the old rule shut out of the
// idea column entirely.
// A member inherits DEFAULT_PERMS, move_tasks among them, so "no rights" has
// to be said out loud or this proves nothing.
const nobody = await mkUser({ name: 'Nadia Nomover', username: 'st_nobody', password: 'n1234', role: 'member', departments: [ch], permissions: { move_tasks: false, manage_content: false } })
// A member who may move tasks — the one the date rules bite on.
const mover = await mkUser({ name: 'Mansur Mover', username: 'st_mover', password: 'm1234', role: 'member', departments: [ch], permissions: { move_tasks: true } })
// Somebody else's operator, to prove an idea is not "held" by them.
const shooter = await mkUser({ name: 'Sardor Shooter', username: 'st_shoot', password: 's1234', role: 'operator', crew_roles: ['operator'] })
ok(!!(nobody.id && mover.id && shooter.id), 'a member with no rights, a mover, and an operator')
const NOBODY = await login('st_nobody', 'n1234')
const MOVER = await login('st_mover', 'm1234')

const stamp = Date.now()
const mk = (b) => req('/content', 'POST', { channels: [ch], type: 'post', ...b })

// ---- IDEA moves freely ----------------------------------------------------
{
  const t = await mk({ title: `st idea free ${stamp}`, status_id: idea.id })
  const r = await call(`/content/${t.id}`, NOBODY, 'PATCH', { status_id: editing.id })
  ok(r.status === 200, 'a member with no move_tasks moves a task OUT of Idea', r.status || r.data)
  const after = await req(`/content/${t.id}`)
  ok(after.status_id === editing.id, '…and it really landed', after.status_id)
}
{
  // The same person, on a task that has already left Idea: still refused.
  const t = await mk({ title: `st past idea ${stamp}`, status_id: editing.id })
  const r = await call(`/content/${t.id}`, NOBODY, 'PATCH', { status_id: ready.id })
  ok(r.status === 403, 'but past Idea they still cannot', r.status)
  ok(/can’t move it|isn’t your step|permission/i.test(r.data?.error || ''), '…and are told why', r.data?.error)
}
{
  // An idea with somebody else's name on it is still not THEIRS to hold.
  // Note the destination: moving INTO a gated stage still has to satisfy that
  // stage's own demands (name the shooter, set the days). Those are about the
  // work being ready, not about who is allowed — so this checks the holder
  // rule alone, by moving somewhere ungated.
  const t = await mk({ title: `st held idea ${stamp}`, status_id: idea.id, operator_id: shooter.id })
  const r = await call(`/content/${t.id}`, NOBODY, 'PATCH', { status_id: null })
  ok(r.status === 200, 'an idea with a shooter named on it is still anybody’s to move', r.status || r.data?.error)
}

// ---- the days freeze while the work is being made --------------------------
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

for (const [name, st] of [['To shoot', toShoot], ['Editing', editing]]) {
  // An EMPTY deadline can no longer be filled in — the new half of the rule.
  const a = await mk({ title: `st ${name} empty ${stamp}`, status_id: st.id })
  const r1 = await call(`/content/${a.id}`, MOVER, 'PATCH', { release_date: day(5) })
  ok(r1.status === 403, `${name}: a mover cannot put a fresh deadline on work in progress`, r1.status)
  ok(/being made/i.test(r1.data?.error || ''), '…and the refusal says why', r1.data?.error)
  ok(!r1.data?.ask_to_move, '…with no ask offered, because there is no promise to move')

  // A SET deadline still does not move (this was already true; it must stay).
  const b = await mk({ title: `st ${name} set ${stamp}`, status_id: st.id, release_date: day(3) })
  const r2 = await call(`/content/${b.id}`, MOVER, 'PATCH', { release_date: day(9) })
  ok(r2.status === 403, `${name}: nor move one that is set`, r2.status)
  ok(!!r2.data?.ask_to_move, '…and here the ask IS offered', r2.data?.ask_to_move)

  // The admin is not frozen — somebody has to be able to fix it.
  const r3 = await call(`/content/${b.id}`, T, 'PATCH', { release_date: day(11) })
  ok(r3.status === 200, `${name}: an admin still moves the day`, r3.status)
}

// ---- and NOT frozen on either side of that band ---------------------------
{
  const t = await mk({ title: `st idea dates ${stamp}`, status_id: idea.id })
  const r = await call(`/content/${t.id}`, MOVER, 'PATCH', { release_date: day(6) })
  ok(r.status === 200, 'an idea still takes its first day from anybody who may move tasks', r.status || r.data)
}
{
  const t = await mk({ title: `st ready dates ${stamp}`, status_id: ready.id })
  const r = await call(`/content/${t.id}`, MOVER, 'PATCH', { release_date: day(6) })
  ok(r.status === 200, 'and so does work that has reached Ready', r.status || r.data)
}

// ---- the ask still reaches an admin, and the admin's yes still lands -------
{
  const t = await mk({ title: `st ask ${stamp}`, status_id: editing.id, release_date: day(4) })
  const asked = await call(`/content/${t.id}/date-requests`, MOVER, 'POST',
    { field: 'release_date', to_date: day(8), reason: 'The interview moved to Thursday, so the cut lands later.' })
  ok(asked.status === 201, 'a frozen day can still be ASKED about', asked.status || asked.data)
  const decided = await call(`/content/date-requests/${asked.data.id}/decide`, T, 'POST', { approve: true })
  ok(decided.status === 200, '…and an admin saying yes still moves it', decided.status || decided.data)
  const after = await req(`/content/${t.id}`)
  ok(after.release_date === day(8), '…all the way to the task', after.release_date)
}

console.log(fails ? `\nFAILED ${fails}` : '\nStage-rules suite clean.')
process.exit(fails ? 1 : 0)
