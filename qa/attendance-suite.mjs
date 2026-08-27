// The attendance register: nobody is late unless somebody says so.
//
// The rule that shapes it is the one worth pinning: a day with no row says
// NOTHING. It does not mean on time. That is why marking somebody on time
// keeps a row, and why clearing a day goes back to silence rather than to a
// different claim.
//
// Self-contained: port 4128, its own data directory.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
import { spawn } from 'child_process'
const SP = new URL('.', import.meta.url).pathname
const DATA = SP + 'at-' + Date.now()
const procs = []
process.on('exit', () => procs.forEach((p) => { try { p.kill('SIGKILL') } catch {} }))
procs.push(spawn(process.execPath, [ROOT + '/server/index.js'],
  { env: { ...process.env, DATA_DIR: DATA, PORT: '4128' }, stdio: 'ignore' }))
for (let i = 0; i < 90; i++) {
  try { if ((await fetch('http://localhost:4128/api/health')).ok) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 250))
}
const B = 'http://localhost:4128/api'
const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t || T}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
let bad = 0
const ok = (n, c, x = '') => { if (!c) bad++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
// A bare board has only the admin on it, and marking the admin's own
// attendance is a poor test of a register about other people.
await req('/users', 'POST', { name: 'Nodira Tashkent', username: 'nodira', password: 'pass1234', role: 'member' })
const users = (await req('/users')).data
const u = users.find((x) => x.username === 'nodira')
const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10)
const back = (n) => new Date(Date.now() + 5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10)

ok('a fresh register says nothing about anybody', (await req('/attendance')).data.rows.length === 0)
ok('…so nobody has a late count', Object.keys((await req('/attendance')).data.tally).length === 0)

let r = await req(`/attendance/${u.id}/${today}`, 'PUT', { status: 'late', arrived_at: '09:47' })
ok('an admin can mark somebody late', r.status === 200 && r.data.status === 'late' && r.data.arrived_at === '09:47',
  JSON.stringify(r.data))
let reg = (await req('/attendance')).data
ok('…and it is counted', reg.tally[u.id].late === 1, JSON.stringify(reg.tally[u.id]))

ok('marking on time keeps a row, because it is a different fact from silence',
  (await req(`/attendance/${u.id}/${back(1)}`, 'PUT', { status: 'on_time' })).data.status === 'on_time')
ok('…and away is its own state',
  (await req(`/attendance/${u.id}/${back(2)}`, 'PUT', { status: 'away' })).data.status === 'away')
reg = (await req('/attendance')).data
ok('the tally separates the three', JSON.stringify(reg.tally[u.id]) === JSON.stringify({ late: 1, away: 1, on_time: 1, marked: 3 }),
  JSON.stringify(reg.tally[u.id]))

ok('a second mark on the same day replaces the first, it does not stack',
  (await req(`/attendance/${u.id}/${today}`, 'PUT', { status: 'on_time' })).data.status === 'on_time'
  && (await req('/attendance')).data.rows.filter((x) => x.user_id === u.id && x.day === today).length === 1)
ok('…and the arrival time goes with the lateness that is no longer claimed',
  (await req('/attendance')).data.rows.find((x) => x.day === today).arrived_at === null)

ok('clearing a day takes it back to nothing written down',
  (await req(`/attendance/${u.id}/${today}`, 'PUT', {})).data.cleared === true
  && !(await req('/attendance')).data.rows.some((x) => x.day === today))

ok('a day that has not happened is refused',
  (await req(`/attendance/${u.id}/${back(-3)}`, 'PUT', { status: 'late', arrived_at: '09:00' })).status === 400)
ok('a state nobody has heard of is refused',
  (await req(`/attendance/${u.id}/${today}`, 'PUT', { status: 'hungover' })).status === 400)
ok('a day that is not a date is refused',
  (await req(`/attendance/${u.id}/last-tuesday`, 'PUT', { status: 'late' })).status === 400)
ok('somebody who does not exist is a 404',
  (await req(`/attendance/999999/${today}`, 'PUT', { status: 'late', arrived_at: '09:00' })).status === 404)

await req('/users', 'POST', { name: 'Jasmina', username: 'jas', password: 'j1234', role: 'member' })
const member = await login('jas', 'j1234').catch(() => null)
if (member) {
  ok('a member can read the register', (await req('/attendance', 'GET', null, member)).status === 200)
  ok('…but cannot write to it',
    (await req(`/attendance/${u.id}/${today}`, 'PUT', { status: 'late', arrived_at: '09:00' }, member)).status === 403)
}
console.log(bad === 0 ? '\nAttendance clean.' : `\n${bad} PROBLEMS`)
process.exit(bad ? 1 : 0)
