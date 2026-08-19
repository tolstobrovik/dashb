// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 65: filmed work is BOOKED, and an answer is an answer.
//
// THE SHOOTER. A shoot needs somebody holding the camera, and needs them from
// the moment it is BOOKED: the day it was booked for passes whether or not
// anyone turns up. Which types count as filmed is the admin's existing crew
// rule (Admin → Pipeline) — the same list the gap counts already read — so a
// post is never asked, and a type added there is demanded here with nothing
// else to wire up. Editing and design are asked one stage later, when the
// footage exists and the answer is real rather than a guess. (Round 66 moved
// the demand from creation to the shooting stage, so an idea stays cheap to
// jot down; every fixture here books its shoot on purpose.)
//
// THE THREE DAYS. Booked filmed work carries a shoot day, a day the cut is due
// and a release day, all three — they are the promises the whole board
// measures. Only filmed work, and only once booked: a post, a story or an idea
// can still be jotted down with a title alone.
//
// AND THE PROMISE HOLDS. A date that HAS a day may only be moved by an admin.
// Filling an empty one still belongs to whoever may move tasks, so unscheduled
// work can still be scheduled — it is moving a promise that is restricted, not
// making one.
//
// AN ANSWER IS AN ANSWER. "." and "N/A" are what people type to get past a
// required field without answering it, and a brief that reads "." is worse
// than an empty one: the empty one still looks like a question. A reference
// points somewhere, so text standing alone has to carry a link.
// Self-contained: 4104.
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4104'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
boot([ROOT + '/server/index.js'], { DATA_DIR: SP + 'r65-' + Date.now(), PORT: '4104' })
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
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const ch = (await req('/channels')).data[0].key
const me = (await req('/auth/me')).data.user
const shooter = (await req('/users', 'POST', {
  name: 'R65 Shooter', username: 'r65op', password: 'probe123', role: 'operator', departments: [ch],
})).data
// Somebody who may move tasks but is not an admin — the person the lock is for.
const smm = (await req('/users', 'POST', {
  name: 'R65 SMM', username: 'r65smm', password: 'probe123', role: 'member', departments: [ch],
})).data
const smmT = await login('r65smm', 'probe123')

// The shooting stage — where a filmed piece stops being an idea and becomes a
// booking. Everything filmed in this suite is created straight into it.
const shootId = (await req('/statuses')).data.find((s) => /to shoot/i.test(s.label)).id
const booked = {
  recording_date: day(1), edit_ready_date: day(3), release_date: day(5),
  status_id: shootId, reference_links: ['https://example.com/reference'],
}
const mk = (over) => req('/content', 'POST', { channels: [ch], ...over })

// ===================== the shooter =====================
let r = await mk({ title: 'r65 no shooter', type: 'video', ...booked })
ok('a video cannot be created with nobody filming it', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…and the refusal says what to do', /filming/i.test(r.data.error || ''), r.data.error)

r = await mk({ title: 'r65 shooter named', type: 'video', operator_id: shooter.id, ...booked })
ok('…naming one lets it through', r.status === 201, `${r.status} ${r.data.error || ''}`)
const vid = r.data

r = await mk({ title: 'r65 reel no shooter', type: 'reel', ...booked })
ok('a reel is filmed too, so it is asked as well', r.status === 400, String(r.status))

// A post is written, not filmed — and an idea has to stay cheap to make.
r = await mk({ title: 'r65 a post with nothing on it', type: 'post' })
ok('a post is created with a title and nothing else', r.status === 201, `${r.status} ${r.data.error || ''}`)
const post = r.data
ok('…which is what keeps the Idea stage and quick-add working', !!post.id)

// The EDITOR is deliberately not demanded — named later, often after filming.
r = await mk({ title: 'r65 no editor is fine', type: 'video', operator_id: shooter.id, ...booked })
ok('an editor is NOT demanded — that hat is filled later', r.status === 201, `${r.status} ${r.data.error || ''}`)

// ===================== the three days =====================
for (const [drop, label] of [['recording_date', 'the shoot day'], ['edit_ready_date', 'the cut'], ['release_date', 'the release']]) {
  const body = { title: `r65 missing ${drop}`, type: 'video', operator_id: shooter.id, ...booked }
  delete body[drop]
  const rr = await mk(body)
  ok(`filmed work without ${label} is refused`, rr.status === 400, `${rr.status} ${rr.data.error || ''}`)
}

// ===================== the promise holds =====================
r = await req(`/content/${vid.id}`, 'PATCH', { release_date: day(9) }, smmT)
ok('somebody who is not an admin cannot move a day already promised', r.status === 403,
  `${r.status} ${r.data.error || ''}`)
ok('…and is told why, not just refused', /promised|admin/i.test(r.data.error || ''), r.data.error)
ok('…and the day did not move', (await req(`/content/${vid.id}`)).data.release_date === booked.release_date)

r = await req(`/content/${vid.id}`, 'PATCH', { release_date: day(9) })
ok('an admin can move it', r.status === 200 && r.data.release_date === day(9), `${r.status} ${r.data.release_date}`)

// Clearing is moving.
r = await req(`/content/${vid.id}`, 'PATCH', { release_date: null }, smmT)
ok('…and clearing a promised day is the same act, so it is refused too', r.status === 403, String(r.status))

// Filling an EMPTY day is not moving a promise — it is making one, and that is
// how unscheduled work gets scheduled at all.
r = await req(`/content/${post.id}`, 'PATCH', { release_date: day(4) }, smmT)
ok('filling an empty day is still allowed without being an admin', r.status === 200,
  `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${post.id}`, 'PATCH', { release_date: day(6) }, smmT)
ok('…but once it is set, it is a promise like any other', r.status === 403, String(r.status))

// ===================== an answer is an answer =====================
// The admin demands a description and a reference for posts, then tries the
// gestures people use to get past them.
// POST, and it REPLACES the whole set — so every key this suite relies on is
// sent together rather than one at a time.
await req('/fields', 'POST', {
  description: { state: 'required', types: ['post'] },
  reference: { state: 'required', types: ['post'] },
  script: { state: 'optional', types: ['post'] },
  format: { state: 'optional', types: ['post'] },
  rubrika: { state: 'optional', types: ['post'] },
})
for (const junk of ['.', '...', 'N/A', '-', 'нет', 'тз']) {
  const rr = await mk({ title: `r65 junk ${junk}`, type: 'post', description: junk, reference_text: 'https://ok.example.com/x' })
  ok(`a description of “${junk}” is refused`, rr.status === 400, `${rr.status} ${rr.data.error || ''}`)
}
r = await mk({ title: 'r65 real brief', type: 'post', description: 'Снять интервью с деканом', reference_text: 'https://example.com/ref' })
ok('a real description is accepted', r.status === 201, `${r.status} ${r.data.error || ''}`)
const written = r.data

// A reference points somewhere.
r = await mk({ title: 'r65 wordy ref', type: 'post', description: 'A proper brief here', reference_text: 'like the last one' })
ok('a reference that is only words is refused — it points nowhere', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…and says what would fix it', /link|attach/i.test(r.data.error || ''), r.data.error)
r = await mk({ title: 'r65 linked ref', type: 'post', description: 'A proper brief here', reference_text: 'like this one www.example.com/reel/7' })
ok('…the same words WITH a link are fine', r.status === 201, `${r.status} ${r.data.error || ''}`)
r = await mk({ title: 'r65 linked list ref', type: 'post', description: 'A proper brief here', reference_links: ['https://example.com/a'] })
ok('…and a link on its own needs no prose', r.status === 201, `${r.status} ${r.data.error || ''}`)

// The same standard on edit — otherwise the rule lasts until somebody reopens
// the task and types a dot.
r = await req(`/content/${written.id}`, 'PATCH', { description: '.' })
ok('a task cannot be EDITED into a placeholder either', r.status === 400, `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${written.id}`, 'PATCH', { reference_text: 'ask me' })
ok('…nor its reference edited into words that point nowhere', r.status === 400, `${r.status} ${r.data.error || ''}`)

// An OPTIONAL field is not worth an error — but junk is not worth storing
// either, because it reaches the card and reads as content.
r = await mk({ title: 'r65 optional junk', type: 'post', description: 'A proper brief here', reference_text: 'https://example.com/z', script: '-' })
ok('junk in an OPTIONAL field is accepted', r.status === 201, `${r.status} ${r.data.error || ''}`)
ok('…but comes to rest empty rather than reaching the card', !r.data.script, JSON.stringify(r.data.script))

stop()
console.log(fails === 0 ? '\nRound-65 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
