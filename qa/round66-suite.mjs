// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 66: the demand lands where the work does, and an answer is an answer.
//
// AN IDEA OWES NOTHING. Round 65 demanded a shooter and three days of every
// filmed piece the moment it was created, which made the cheapest and
// most-used thing on the board — jotting an idea down — the most expensive.
// The demand now lands at the stage where the promise is actually made: from
// "To shoot" onward a filmed piece is a BOOKING and carries its shooter, its
// three days and a brief the crew can work from. Before that it is a title
// and a maybe, and is asked for none of it.
//
// AND THE EDITOR LANDS ONE STAGE LATER. Naming who cuts a video before the
// footage exists is a guess; naming one when the shoot is done is an answer.
// So the editor is demanded on the way out of the shooting stage, not before —
// and until then the Unassigned page stops calling its absence a gap.
//
// A CARELESS WORD IS NOT A SCRIPT. "халатно" has letters in it, so it cleared
// the placeholder check and went through as a shot list. A required script is
// something the crew can film FROM, which is more than one word.
//
// AND THE SAME SCRIPT TWICE IS ONE SHOOT BOOKED TWICE. Pasting the last
// task's script into a new one makes two cards waiting for the same footage.
// Duplicate still carries a brief across, because that is what it is for.
// Self-contained: 4105.
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4105'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
boot([ROOT + '/server/index.js'], { DATA_DIR: SP + 'r66-' + Date.now(), PORT: '4105' })
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(B + '/health')).ok) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500))
}

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
// Who the calls below are made AS. It starts as the admin, because building
// the fixtures — accounts, channels — is admin work. It becomes the planner
// the moment the rules start being tested: round 80 made the admin a
// superuser, never asked for a field and never stopped at a booking wall, so
// a refusal asked of the admin proves nothing.
let AS = T
const req = async (p, m = 'GET', b, tok = null) => {
  const auth = tok || AS
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (n) => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) } // Tashkent day, like the server
const ch = (await req('/channels')).data[0].key
const stages = (await req('/statuses')).data
const sid = (re) => stages.find((s) => re.test(s.label))?.id
const ideaId = sid(/^idea$/i)
const shootId = sid(/to shoot/i)
const shotId = sid(/^editing$/i)
// Shot folded into Editing in round 82; this needs a SECOND stage.
const editId = sid(/^ready$/i)
const shooter = (await req('/users', 'POST', {
  name: 'R66 Shooter', username: 'r66op', password: 'probe123', role: 'operator', departments: [ch],
})).data
const cutter = (await req('/users', 'POST', {
  name: 'R66 Cutter', username: 'r66ed', password: 'probe123', role: 'editor', departments: [ch],
})).data
// The planner these rules are for. Round 80 made the admin a superuser —
// never asked for a field, never stopped at a booking wall — so a refusal
// asked of the admin would prove nothing.
const planner = (await req('/users', 'POST', {
  name: 'R66 Planner', username: 'r66pl', password: 'probe123', role: 'member', departments: [ch],
  permissions: { manage_content: true, move_tasks: true },
})).data
const plannerT = await login('r66pl', 'probe123')
AS = plannerT // everything from here is the planner's doing
const mk = (over) => req('/content', 'POST', { channels: [ch], ...over })
const booking = {
  operator_id: shooter.id,
  recording_date: day(1), edit_ready_date: day(3), release_date: day(5),
  reference_links: ['https://example.com/reference'],
  // Since the shoot also demands the words to film from, a COMPLETE booking
  // carries a script. `noBrief` below takes both away, because a script is a
  // brief in its own right and leaving one in would answer the question the
  // brief check is asking.
  script: 'Open on the main gate, then three students saying why they chose us.',
}

// ===================== an idea owes nothing =====================
let r = await mk({ title: 'r66 just an idea', type: 'video', status_id: ideaId })
ok('a filmed piece can be jotted down as an idea, with nothing on it', r.status === 201,
  `${r.status} ${r.data.error || ''}`)
const idea = r.data
ok('…and it really is an idea, with no crew and no days',
  !idea.operator_id && !idea.recording_date && !idea.release_date, JSON.stringify(idea.operator_id))

// The default stage is the first one, which is Idea — so the quick-add box
// and every "type a title, press Enter" path keeps working untouched.
r = await mk({ title: 'r66 quick add', type: 'reel' })
ok('…and a reel added with only a title lands there too, not on a refusal', r.status === 201,
  `${r.status} ${r.data.error || ''}`)

// An idea is not on the Unassigned page at all, so its missing crew is not a
// gap anybody is asked to close.
const gapTitles = (await req('/content')).data
  .filter((t) => t.status_id === ideaId).map((t) => t.title)
ok('…ideas sit in the Idea stage, which the gaps page skips whole',
  gapTitles.includes('r66 just an idea'), gapTitles.join(' / '))

// Editing an idea's own fields is not a booking either — the demand does not
// reach back and lock a task that never made the promise.
r = await req(`/content/${idea.id}`, 'PATCH', { title: 'r66 just an idea, renamed' })
ok('an idea can still be edited without being asked for a crew', r.status === 200,
  `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${idea.id}`, 'PATCH', { operator_id: null })
ok('…and clearing a hat it never had is not a refusal', r.status === 200, `${r.status} ${r.data.error || ''}`)

// ===================== booking one IS the promise =====================
// Each wall stands at the stage it is ABOUT and refuses a move that LANDS
// there. A card thrown further along than that is not making either promise —
// it is a record of work that happened elsewhere, and a shoot day in its
// future would be a day that has been and gone.
const leaper = await mk({ title: 'r66 shot on a phone, logged after', type: 'video', status_id: ideaId })
r = await req(`/content/${leaper.data.id}`, 'PATCH', { status_id: editId })
ok('a card dragged past the shoot to catch the board up is left alone', r.status === 200,
  `${r.status} ${r.data.error || ''}`)

r = await mk({ title: 'r66 booked with nothing', type: 'video', status_id: shootId })
ok('a shoot booked with nobody holding it is refused', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…and the refusal says what to do', /filming/i.test(r.data.error || ''), r.data.error)

for (const [drop, label] of [['recording_date', 'the shoot day'], ['edit_ready_date', 'the cut'], ['release_date', 'the release']]) {
  const body = { title: `r66 booked without ${drop}`, type: 'video', status_id: shootId, ...booking }
  delete body[drop]
  const rr = await mk(body)
  ok(`a shoot booked without ${label} is refused`, rr.status === 400, `${rr.status} ${rr.data.error || ''}`)
}

// The brief. A shoot booked with nothing for the crew to work from is a crew
// standing in a room deciding what to film.
const noBrief = { ...booking }
delete noBrief.reference_links
delete noBrief.script
r = await mk({ title: 'r66 booked with no brief', type: 'video', status_id: shootId, ...noBrief })
ok('a shoot booked with no reference and no TZ is refused', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…and it names what would fix it', /reference|TZ|brief|script/i.test(r.data.error || ''), r.data.error)

r = await mk({ title: 'r66 booked properly', type: 'video', status_id: shootId, ...booking })
ok('a shoot with a shooter, three days and a reference goes through', r.status === 201,
  `${r.status} ${r.data.error || ''}`)
const booked = r.data

// A script the crew can film from counts as the brief on its own.
r = await mk({
  title: 'r66 booked on a script', type: 'video', status_id: shootId, ...noBrief,
  script: 'Открывающий кадр во дворе, затем интервью с деканом на третьем этаже',
})
ok('…and a real script is a brief in its own right', r.status === 201, `${r.status} ${r.data.error || ''}`)

// Work that already HAPPENED is a record, not a promise. A piece created
// further along than the booking stage is backfilled history — demanding a
// future shoot day of it would be nonsense — and nothing escapes that way,
// because MOVING into or through the gate is walled below whatever stage the
// move aims at.
r = await mk({ title: 'r66 filmed last week, logged now', type: 'video', status_id: editId })
ok('a piece created straight into Editing is a record being backfilled', r.status === 201,
  `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${r.data.id}`, 'PATCH', { status_id: sid(/^ready$/i) })
ok('…and it keeps moving, because its shoot is behind it, not ahead', r.status === 200,
  `${r.status} ${r.data.error || ''}`)

// ===================== MOVING an idea into the shoot =====================
// This is the path people actually use: the idea is agreed, and somebody drags
// it onto the shooting column. The promise is made at that moment.
r = await req(`/content/${idea.id}`, 'PATCH', { status_id: shootId })
ok('dragging a bare idea onto the shooting stage is refused', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…starting with who is holding the camera', /filming/i.test(r.data.error || ''), r.data.error)

await req(`/content/${idea.id}`, 'PATCH', { operator_id: shooter.id })
r = await req(`/content/${idea.id}`, 'PATCH', { status_id: shootId })
ok('…a shooter alone is not the whole booking', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…the days are asked for next', /dates|day/i.test(r.data.error || ''), r.data.error)

await req(`/content/${idea.id}`, 'PATCH', {
  recording_date: day(2), edit_ready_date: day(4), release_date: day(6),
})
r = await req(`/content/${idea.id}`, 'PATCH', { status_id: shootId })
ok('…and the crew still has nothing to film from', r.status === 400, `${r.status} ${r.data.error || ''}`)

await req(`/content/${idea.id}`, 'PATCH', { reference_links: ['https://example.com/the-reference'] })
r = await req(`/content/${idea.id}`, 'PATCH', { status_id: shootId })
ok('…and the words they film from are asked for as well', r.status === 400 && /script/i.test(r.data.error || ''),
  `${r.status} ${r.data.error || ''}`)

await req(`/content/${idea.id}`, 'PATCH', {
  script: 'Open in the courtyard, then the dean on the third floor, two questions.',
})
r = await req(`/content/${idea.id}`, 'PATCH', { status_id: shootId })
ok('…with all of it in hand, the move lands', r.status === 200, `${r.status} ${r.data.error || ''}`)

// ===================== the editor, one stage later =====================
r = await req(`/content/${booked.id}`, 'PATCH', { status_id: shotId })
ok('filmed work cannot leave the shooting stage with nobody cutting it', r.status === 400,
  `${r.status} ${r.data.error || ''}`)
ok('…and says so in those words', /cut|editor/i.test(r.data.error || ''), r.data.error)

r = await req(`/content/${booked.id}`, 'PATCH', { editor_id: cutter.id })
ok('naming the editor is an ordinary edit', r.status === 200, `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${booked.id}`, 'PATCH', { status_id: shotId })
ok('…and then the footage moves on', r.status === 200, `${r.status} ${r.data.error || ''}`)

// A written post is not filmed, so none of this ever reaches it: it keeps the
// advisory gates it has always had.
r = await mk({ title: 'r66 a written post', type: 'post', status_id: shootId })
ok('a post is never asked for a shooter, wherever it sits', r.status === 201, `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${r.data.id}`, 'PATCH', { status_id: editId })
ok('…and moves through the stages with nobody named', r.status === 200, `${r.status} ${r.data.error || ''}`)

// Ticking work OFF a list is not booking a shoot. A card landing in the final
// stage is finished, and asking it to promise a shoot day asks about a day
// that has been and gone — publishing has its own guard and never was this
// rule's business.
const ticked = await mk({ title: 'r66 filmed before the board existed', type: 'video', status_id: ideaId })
r = await req(`/content/${ticked.data.id}`, 'PATCH', { done: true, post_link: 'https://instagram.com/p/qa' })
ok('ticking a bare video complete is not asked for a booking', r.status === 200,
  `${r.status} ${r.data.error || ''}`)

// ===================== a careless word is not a script =====================
// POST replaces the whole rule set, so every key is sent together.
await req('/fields', 'POST', {
  script: { state: 'required', types: ['post'] },
  description: { state: 'optional', types: ['post'] },
  reference: { state: 'optional', types: ['post'] },
  format: { state: 'optional', types: ['post'] },
  rubrika: { state: 'optional', types: ['post'] },
}, T) // writing the rules is the admin's job, whoever is being tested against them
// A brand-new task with no stage is an IDEA, and an idea owes nothing but a
// description — that was round 86's point, and asking a thought for a shot
// list is what it removed. This rule is about work in production, so it is
// asked of a piece that has left the brainstorm.
for (const lazy of ['халатно', 'готово', 'norm']) {
  const rr = await mk({ title: `r66 lazy ${lazy}`, type: 'post', status_id: shootId, script: lazy })
  ok(`a “script” of “${lazy}” is refused — it has letters, not a shot list`, rr.status === 400,
    `${rr.status} ${rr.data.error || ''}`)
}
r = await mk({ title: 'r66 real script', type: 'post', status_id: shootId, script: 'Интервью с деканом, два вопроса, съёмка у входа' })
ok('a script the crew can film from is accepted', r.status === 201, `${r.status} ${r.data.error || ''}`)
const scripted = r.data

// The same standard on edit — otherwise the rule lasts until somebody reopens
// the task and types one word.
r = await req(`/content/${scripted.id}`, 'PATCH', { script: 'халатно' })
ok('…and a task cannot be EDITED down to one careless word either', r.status === 400,
  `${r.status} ${r.data.error || ''}`)

// ===================== the same script twice =====================
r = await mk({ title: 'r66 the twin', type: 'post', script: 'Интервью с деканом, два вопроса, съёмка у входа' })
ok('the same script pasted onto a second task is refused', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…and it names the task that already has it', /r66 real script/.test(r.data.error || ''), r.data.error)

// Whitespace and case are not a difference.
r = await mk({ title: 'r66 the retyped twin', type: 'post', script: '  ИНТЕРВЬЮ  с деканом, два вопроса, съёмка у входа ' })
ok('…retyping it in capitals is the same script', r.status === 400, `${r.status} ${r.data.error || ''}`)

r = await mk({ title: 'r66 its own script', type: 'post', script: 'Совсем другой сюжет: съёмка в библиотеке, один вопрос' })
ok('a genuinely different script is fine', r.status === 201, `${r.status} ${r.data.error || ''}`)

// Duplicate exists to carry a brief across, and says so.
r = await mk({
  title: 'r66 real script (copy)', type: 'post',
  script: 'Интервью с деканом, два вопроса, съёмка у входа', allow_duplicate_script: true,
})
ok('…and Duplicate still carries the brief, because that is what it is for',
  r.status === 201, `${r.status} ${r.data.error || ''}`)

// Saving a task without touching its script is not "repeating" it.
r = await req(`/content/${scripted.id}`, 'PATCH', { script: 'Интервью с деканом, два вопроса, съёмка у входа' })
ok('a task keeping its OWN script is never called a duplicate', r.status === 200,
  `${r.status} ${r.data.error || ''}`)

// ===================== the Pravki screenshot =====================
// A note about a frame travels with the frame.
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const readyId = sid(/^ready$/i)
// Its own words, for the same reason the section below tests: the same script
// on two tasks is a duplicate, and a fixture should not be one.
const shot = await mk({
  title: 'r66 needs a fix', type: 'video', status_id: shootId, ...booking, editor_id: cutter.id,
  script: 'Three shots of the library at dusk, then the librarian on what students ask for.',
})
await req(`/content/${shot.data.id}`, 'PATCH', { status_id: readyId })
r = await req(`/content/${shot.data.id}/revisions`, 'POST', { note: 'The third shot is out of focus', target: 'editor', photo: PX, photo_thumb: PX })
ok('a Pravki note takes the screenshot that shows what is wrong', r.status === 201 || r.status === 200,
  `${r.status} ${r.data.error || ''}`)
const full = (await req(`/content/${shot.data.id}`)).data
ok('…and the crew can see it on the revision, not just read about it',
  (full.revisions || []).some((v) => v.photo === PX), JSON.stringify((full.revisions || []).map((v) => !!v.photo)))

stop()
console.log(fails === 0 ? '\nRound-66 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
