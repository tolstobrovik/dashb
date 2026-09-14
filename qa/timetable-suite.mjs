// Somebody's week: study time, and the hour a shoot is actually booked at.
//
// Two rules this file holds, and both are about the same failure — a board
// that thinks it knows when a person is free when it does not:
//
//   STUDY TIME IS NOT FREE TIME. Working hours say when somebody is at work.
//   They do not say the operator is in lectures every Tuesday afternoon, and
//   on a team where half the crew are students that is most of the difference.
//   A picker that offers a slot running into a seminar books a shoot nobody
//   turns up to, and the board finds out on the day.
//
//   A DAY IS NOT A TIME. A named operator with a shoot day and no hour is
//   somebody told "you are filming Thursday" and left to guess. Section C.
//
// Self-contained: port 4130.
import { spawn } from 'child_process'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = new URL('.', import.meta.url).pathname
const PORT = 4130
const B = `http://localhost:${PORT}`

let fails = 0
const found = []
const ok = (id, n, c, x = '') => {
  if (!c) { fails++; found.push(`${id} ${n}${x ? ` — ${x}` : ''}`) }
  console.log(`${c ? '✔' : '✘ FAIL'} [${id}] ${n}${x ? ` — ${x}` : ''}`)
}
const procs = []
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })
procs.push(spawn(process.execPath, [ROOT + '/server/index.js'],
  { env: { ...process.env, DATA_DIR: SP + 'tt-' + Date.now(), PORT: String(PORT) }, stdio: 'ignore' }))
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(B + '/api/health')).ok) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500))
}

const login = async (u, p) => (await (await fetch(B + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (path, method = 'GET', body, tok = T) => {
  const r = await fetch(B + '/api' + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (n) => {
  const d = new Date(Date.now() + 5 * 3600e3)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const stamp = Date.now().toString().slice(-6)
const stages = (await req('/statuses')).data
const shootStage = stages.find((s) => /shoot/i.test(s.label))
const ch = (await req('/channels')).data.find((c) => c.format === 'social').key

// A working week that starts NEXT Monday, so nothing here trips over today.
const nextMonday = (() => {
  let d = day(1)
  for (let i = 0; i < 8; i++) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 1) return d
    d = day(1 + i + 1)
  }
  return d
})()
const plus = (n) => new Date(Date.parse(`${nextMonday}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

const op = (await req('/users', 'POST', {
  name: `Mirabbos ${stamp}`, username: `mir${stamp}`, password: 'probe-only-123', role: 'operator' })).data
await req(`/users/${op.id}`, 'PATCH', { work_start: '09:00', work_end: '18:00', work_days: [1, 2, 3, 4, 5] })
const weekOf = async (mins = 120) =>
  (await req(`/users/${op.id}/slots?from=${nextMonday}&days=7&mins=${mins}`)).data

console.log('\n=== A. a person says when they are not there ===')
let cal = await weekOf()
ok('A1', 'nobody starts with a study timetable', (cal.study || []).length === 0, JSON.stringify(cal.study))
const set = await req(`/users/${op.id}`, 'PATCH', {
  study_blocks: [
    { d: 2, from: '14:00', to: '17:30', label: 'University' },
    { d: 4, from: '13:00', to: '16:00', label: 'Seminar' },
  ] })
ok('A2', 'a repeating week can be set', set.status === 200 && set.data.study_blocks.length === 2,
  JSON.stringify(set.data.study_blocks))
ok('A3', '…and comes back with the label it was given',
  set.data.study_blocks[0].label === 'University', JSON.stringify(set.data.study_blocks[0]))
// Nothing here is trusted: this is drawn on every booking screen, and one bad
// row must not take the picker down with it.
const junk = await req(`/users/${op.id}`, 'PATCH', {
  study_blocks: [
    { d: 2, from: '14:00', to: '17:30', label: 'Good' },
    { d: 9, from: '10:00', to: '11:00' },            // not a day of the week
    { d: 3, from: '16:00', to: '15:00' },            // ends before it starts
    { d: 3, from: 'lunchtime', to: '15:00' },        // not a time
    'nonsense',
  ] })
ok('A4', 'a timetable full of nonsense keeps only the rows that are rows',
  junk.data.study_blocks.length === 1 && junk.data.study_blocks[0].label === 'Good',
  JSON.stringify(junk.data.study_blocks))
await req(`/users/${op.id}`, 'PATCH', {
  study_blocks: [
    { d: 2, from: '14:00', to: '17:30', label: 'University' },
    { d: 4, from: '13:00', to: '16:00', label: 'Seminar' },
  ] })

console.log('\n=== B. study time is not free time ===')
cal = await weekOf()
const tue = cal.calendar.find((d) => d.weekday === 2)
const wed = cal.calendar.find((d) => d.weekday === 3)
ok('B1', 'the week says where the lectures are',
  tue.study.length === 1 && tue.study[0].from === '14:00' && tue.study[0].to === '17:30',
  JSON.stringify(tue.study))
ok('B2', 'a day with no lectures says so rather than nothing',
  Array.isArray(wed.study) && wed.study.length === 0, JSON.stringify(wed.study))
// The rule that matters: not one offered slot may run into the lecture.
ok('B3', 'no offered time runs into the lecture',
  tue.slots.every((s) => s.to <= '14:00' || s.from >= '17:30'),
  JSON.stringify(tue.slots.map((s) => `${s.from}-${s.to}`)))
ok('B4', '…and the hours around it are still offered',
  tue.slots.some((s) => s.from === '09:00'), JSON.stringify(tue.slots.map((s) => s.from)))
ok('B5', 'a day with nothing on it is offered whole',
  wed.slots.length > tue.slots.length, `${wed.slots.length} vs ${tue.slots.length}`)
// A shorter shoot fits in gaps a longer one cannot.
const short = await weekOf(30)
const shortTue = short.calendar.find((d) => d.weekday === 2)
ok('B6', 'a shorter shoot fits where a longer one does not',
  shortTue.slots.length > tue.slots.length, `${shortTue.slots.length} at 30m vs ${tue.slots.length} at 2h`)
ok('B7', '…and still never runs into the lecture',
  shortTue.slots.every((s) => s.to <= '14:00' || s.from >= '17:30'),
  JSON.stringify(shortTue.slots.filter((s) => s.from >= '13:00' && s.from < '18:00').map((s) => s.from)))

console.log('\n=== C. a day is not a time ===')
const me = (await req('/users', 'POST', {
  name: `Jasmina ${stamp}`, username: `jas${stamp}`, password: 'probe-only-123', role: 'member' })).data
await req(`/users/${me.id}`, 'PATCH', { departments: [ch] })
const M = await login(`jas${stamp}`, 'probe-only-123')
const book = (extra, n) => req('/content', 'POST', {
  title: `tt ${stamp} ${n}`, channels: [ch], type: 'reel', status_id: shootStage.id,
  operator_id: op.id, recording_date: plus(2), edit_ready_date: plus(4), release_date: plus(6),
  script: 'Open on the campus gate, walk to the library, three lines to camera about the course.',
  reference_text: 'https://example.com/moodboard', ...extra }, M)
const noHour = await book({}, 1)
ok('C1', 'naming the operator and the day but no hour is refused',
  noHour.status === 400 && /hour/i.test(noHour.data.error || ''),
  `${noHour.status} ${JSON.stringify((noHour.data.error || '').slice(0, 60))}`)
const withHour = await book({ recording_time: '10:00' }, 2)
ok('C2', '…and with the hour it books', withHour.status === 201,
  `${withHour.status} ${JSON.stringify(withHour.data.error || '')}`)
// The rule belongs to the booking gate, not to every save: an idea owes
// nobody an hour, and nagging a jotted thought is how a board teaches people
// to stop writing things down.
const idea = stages.find((s) => /^idea/i.test(s.label))
const asIdea = await req('/content', 'POST', {
  title: `tt ${stamp} idea`, channels: [ch], type: 'reel', status_id: idea.id, operator_id: op.id }, M)
ok('C3', 'an idea still owes nobody an hour', asIdea.status === 201,
  `${asIdea.status} ${JSON.stringify(asIdea.data.error || '')}`)

console.log('\n=== D. the hour that is taken is taken ===')
// The booking above at 10:00 has to disappear from what is offered.
const after = await weekOf()
const booked = after.calendar.find((d) => d.day === plus(2))
ok('D1', 'a booked shoot shows in the week', (booked.busy || []).some((b) => b.from === '10:00'),
  JSON.stringify(booked.busy))
ok('D2', '…and no offered time overlaps it',
  booked.slots.every((s) => s.to <= '10:00' || s.from >= '12:00'),
  JSON.stringify(booked.slots.map((s) => `${s.from}-${s.to}`)))
// Editing the shoot that is already there must not have it clash with itself.
const self = (await req(`/users/${op.id}/slots?from=${nextMonday}&days=7&mins=120&exclude=${withHour.data.id}`)).data
const selfDay = self.calendar.find((d) => d.day === plus(2))
ok('D3', 'a shoot does not block its own hour when it is the one being moved',
  selfDay.slots.some((s) => s.from === '10:00'),
  JSON.stringify(selfDay.slots.map((s) => s.from)))

console.log(`\n${'='.repeat(58)}`)
if (found.length) {
  console.log(`${found.length} FINDING(S):`)
  found.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
} else {
  console.log('Timetable suite clean.')
}
process.exit(fails ? 1 : 0)
