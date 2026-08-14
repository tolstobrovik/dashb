// Round 58: two rules that stopped standing in the way, and one that started
// speaking up.
//
// THE LATE HANDOVER re-promises itself. Handing work over after its deadline
// used to be refused until somebody typed a new date. The work had already
// moved on in real life; the form was the only thing holding it. The new date
// now writes itself — today, the day it actually arrived — with the missed
// one untouched beside it, so the pair still shows what the delay cost.
//
// THE SHIPPED PASSWORD says so. This app creates an admin account with a
// documented password on an empty database, and the source is public. Signing
// in with it is the shortest way into a dashboard that lives on a public URL.
// Nobody is locked out; the account is told, on every page, until it picks
// its own — at which point the warning goes away by itself.
// Runs against the shared 4090 stack.
const BASE = process.env.BASE || 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})).json())
const T = (await login('admin', 'admin123')).token
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
  .format(new Date(Date.now() + off * 86400000))

// ---- the shipped password ----------------------------------------------
const fresh = await login('admin', 'admin123')
ok('signing in with the password this app ships with is allowed',
  !!fresh.token && fresh.user?.role === 'admin')
ok('…and the account is told, on the user the app carries everywhere',
  fresh.user.weak_password === 1, String(fresh.user.weak_password))
ok('…and it keeps saying so on every page load, not just at sign-in',
  (await req('/auth/me')).data.user.weak_password === 1)

const suffix = Date.now().toString(36).slice(-5)
const own = (await req('/users', 'POST', {
  name: 'R58 Own Password', username: 'r58own' + suffix, password: 'a-password-of-my-own',
  role: 'member', departments: ['instagram_main'],
})).data
const ownLogin = await login('r58own' + suffix, 'a-password-of-my-own')
ok('somebody who chose their own password is not nagged',
  ownLogin.user.weak_password === 0, String(ownLogin.user.weak_password))

// changing it away clears the warning, without signing in again
const weakUser = (await req('/users', 'POST', {
  name: 'R58 Shipped', username: 'r58weak' + suffix, password: 'admin123',
  role: 'member', departments: ['instagram_main'],
})).data
const weakLogin = await login('r58weak' + suffix, 'admin123')
ok('a second account on the shipped password is flagged too', weakLogin.user.weak_password === 1)
const changed = await req('/users/me', 'PATCH', {
  current_password: 'admin123', new_password: 'something-nobody-published',
}, weakLogin.token)
ok('changing it is accepted', changed.status === 200, JSON.stringify(changed.data).slice(0, 120))
const after = await login('r58weak' + suffix, 'something-nobody-published')
ok('…and the warning is gone', after.user.weak_password === 0, String(after.user.weak_password))
ok('…the old password no longer works at all',
  (await login('r58weak' + suffix, 'admin123')).token === undefined)

// ---- the late handover re-promises itself -------------------------------
const { data: statuses } = await req('/statuses')
const S = Object.fromEntries(statuses.map((s) => [s.label, s.id]))
const crew = (await req('/users', 'POST', {
  name: 'R58 Shooter', username: 'r58shoot' + suffix, password: 'pw123456',
  role: 'member', departments: ['instagram_main'],
})).data
const crewT = (await login('r58shoot' + suffix, 'pw123456')).token

const late = (await req('/content', 'POST', {
  title: 'r58 handed over late', channels: ['instagram_main'], type: 'reel',
  status_id: S['Idea'], operator_id: crew.id, editor_id: crew.id,
  recording_date: day(-3), edit_ready_date: day(-1), release_date: day(4),
  shot_link: 'https://drive.google.com/r58-raw',
})).data
const moved = await req(`/content/${late.id}`, 'PATCH', { status_id: S['Editing'] }, crewT)
ok('a late handover is not refused any more', moved.status === 200,
  `${moved.status} ${moved.data.error || ''}`)
ok('…the new deadline writes itself, dated the day the work arrived',
  moved.data.edit_due_revised === day(0), String(moved.data.edit_due_revised))
ok('…the deadline that was missed is left untouched beside it',
  moved.data.edit_ready_date === day(-1), String(moved.data.edit_ready_date))
const trail = ((await req(`/content/${late.id}`)).data.activity || [])
  .find((a) => a.field === 'edit_due_revised')
ok('…and the re-promise is in the paper trail like any other change',
  !!trail && trail.new_value === day(0), trail ? `${trail.user_name}: → ${trail.new_value}` : 'missing')

// a handover that is ON time invents nothing
const onTime = (await req('/content', 'POST', {
  title: 'r58 handed over on time', channels: ['instagram_main'], type: 'reel',
  status_id: S['Idea'], operator_id: crew.id, editor_id: crew.id,
  recording_date: day(1), edit_ready_date: day(3), release_date: day(5),
  shot_link: 'https://drive.google.com/r58-raw2',
})).data
const fine = await req(`/content/${onTime.id}`, 'PATCH', { status_id: S['Editing'] }, crewT)
ok('a handover that is on time gets no invented deadline',
  fine.status === 200 && !fine.data.edit_due_revised, String(fine.data.edit_due_revised))

// naming a date by hand still wins over the automatic one
const chosen = (await req('/content', 'POST', {
  title: 'r58 late, date named by hand', channels: ['instagram_main'], type: 'reel',
  status_id: S['Idea'], operator_id: crew.id, editor_id: crew.id,
  recording_date: day(-3), edit_ready_date: day(-1), release_date: day(6),
  shot_link: 'https://drive.google.com/r58-raw3',
})).data
const byHand = await req(`/content/${chosen.id}`, 'PATCH',
  { status_id: S['Editing'], edit_due_revised: day(5) }, crewT)
ok('a date named by hand still wins', byHand.data.edit_due_revised === day(5), String(byHand.data.edit_due_revised))

console.log(fails === 0 ? '\nRound-58 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
