// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 68: the board learns to tell a link from a sentence, and people can
// say things out loud.
//
// A LINK POINTS, A SENTENCE SAYS. The form asks for both kinds of thing and
// checked both with the same blunt rule — "does this have letters in it". So
// a script of
//
//     https://drive.google.com/file/d/1a2b3c
//
// went through as a shot list, because a URL is three "words" once you split
// on spaces; and a reference of "халатно" went through as a brief. One reader
// now says which a value IS, and each question asks for the kind it needs.
//
// VOICE NOTES. A Pravki that takes four minutes to type takes fifteen seconds
// to say, and half of what a reviewer means is in the tone. A clip rides on a
// comment or a revision; the bytes are fetched by the press that plays them,
// never dragged along with a task.
//
// NAMING SOMEBODY REACHES THEM. "@Dilnoza, can you shoot this?" was reaching
// nobody, because Dilnoza was not on the task yet — which is exactly when you
// name somebody. Matched against the real roster, because this team writes
// first names in Cyrillic and nobody types an @handle they have to look up.
// Self-contained: 4107.
import { spawn } from 'child_process'
import { DatabaseSync } from 'node:sqlite'
import { readText, isSentence, hasLink, isBareLink, hasSubstance } from '../server/text.js'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4107'
const B = BASE + '/api'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)
const DATA_DIR = SP + 'r68-' + Date.now()
boot([ROOT + '/server/index.js'], { DATA_DIR, PORT: '4107' })
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

// Reading the database itself, for the one question the API cannot answer
// honestly: whether a row is GONE, or merely unreachable because the thing
// that pointed at it was deleted. Those look identical from outside and are
// very different on disk — one of them is a blob that never goes away.
const openDb = () => new DatabaseSync(`${DATA_DIR}/dashboard.db`, { readOnly: true })
const rowsLeft = (table, contentId) => {
  const db = openDb()
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE content_id = ?`).get(contentId).n
  } finally { db.close() }
}

// ===================== the reader, on its own =====================
// A URL is not a sentence however many slashes it has.
for (const link of [
  'https://drive.google.com/file/d/1a2b3c',
  'www.instagram.com/reel/abc',
  'instagram.com/reel/abc',
]) {
  ok(`“${link}” reads as a link`, hasLink(link) && !isSentence(link) && isBareLink(link), readText(link).kind)
}
// Words are not a link however earnest they are.
for (const words of ['Интервью с деканом, два вопроса', 'The location cancelled on us']) {
  ok(`“${words.slice(0, 24)}…” reads as a sentence`, isSentence(words) && !hasLink(words), readText(words).kind)
}
// Both at once is the best answer to most questions this board asks.
ok('words WITH a link are both', (() => {
  const v = 'shoot it like this one https://example.com/reel/7'
  return isSentence(v) && hasLink(v) && !isBareLink(v)
})(), readText('shoot it like this one https://example.com/reel/7').kind)
// And the shrugs are still shrugs.
for (const junk of ['.', '...', 'N/A', 'нет', 'ok', '—']) {
  ok(`“${junk}” is a placeholder, not an answer`, !hasSubstance(junk), readText(junk).kind)
}
// A real but useless word is a FRAGMENT: it has substance, and it is still
// not something anyone can work from.
ok('“халатно” has letters and is not an answer', hasSubstance('халатно') && !isSentence('халатно'),
  readText('халатно').kind)

// ===================== applied where it is needed =====================
// POST replaces the whole rule set, so every key is sent together.
await req('/fields', 'POST', {
  script: { state: 'required', types: ['post'] },
  description: { state: 'optional', types: ['post'] },
  reference: { state: 'optional', types: ['post'] },
  format: { state: 'optional', types: ['post'] },
  rubrika: { state: 'optional', types: ['post'] },
})
// The person these rules are for. Round 80 made the admin a superuser —
// never asked for a field, never told a placeholder is not a brief — so the
// reader below has to be tested on somebody it still speaks to.
const writer = (await req('/users', 'POST', {
  name: 'R68 Writer', username: 'r68wr', password: 'probe123', role: 'member', departments: [ch],
  permissions: { manage_content: true, move_tasks: true },
})).data
const writerT = await login('r68wr', 'probe123')
const mk = (over) => req('/content', 'POST', { channels: [ch], ...over }, writerT)

// A script is what the crew films FROM. A link is where they get the file.
let r = await mk({ title: 'r68 a link as a script', type: 'post', script: 'https://drive.google.com/file/d/1a2b3c' })
ok('a bare link is refused as a script', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…and the refusal says it wants the WORDS', /words/i.test(r.data.error || ''), r.data.error)

r = await mk({ title: 'r68 a fragment as a script', type: 'post', script: 'халатно' })
ok('a one-word shrug is refused as a script', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…and is told apart from a placeholder', /work from/i.test(r.data.error || ''), r.data.error)

r = await mk({ title: 'r68 a real script', type: 'post', script: 'Открывающий кадр во дворе, затем интервью' })
ok('a sentence is accepted as a script', r.status === 201, `${r.status} ${r.data.error || ''}`)
const post = r.data

// A script that is a link PLUS the words is fine — that is the good answer.
r = await mk({ title: 'r68 script with a link', type: 'post', script: 'Follow this shot list https://docs.google.com/document/d/9' })
ok('…and so is a sentence carrying a link', r.status === 201, `${r.status} ${r.data.error || ''}`)

// A reference POINTS. Words alone do not, and are told so differently.
r = await mk({ title: 'r68 wordy ref', type: 'post', script: 'A script that is a real one', reference_text: 'like the last one we shot' })
ok('a reference of words alone still has to point somewhere', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…and asks for a link, not for more words', /point somewhere/i.test(r.data.error || ''), r.data.error)

// A delivery box wants a link and NOTHING else — a sentence in it is a
// misread box, and saying "should be a URL" does not tell anyone that.
r = await req(`/content/${post.id}`, 'PATCH', { ready_link: 'I sent it to you on Telegram yesterday' })
ok('a sentence in the delivery box is refused', r.status === 400, `${r.status} ${r.data.error || ''}`)
ok('…and names what was actually written', /reads like a sentence/i.test(r.data.error || ''), r.data.error)
r = await req(`/content/${post.id}`, 'PATCH', { ready_link: 'drive.google.com/file/d/7' })
ok('…a link missing its https:// is told exactly that', r.status === 400 && /https:\/\//.test(r.data.error || ''), r.data.error)
r = await req(`/content/${post.id}`, 'PATCH', { ready_link: 'https://drive.google.com/file/d/7' })
ok('…and a real link goes in', r.status === 200, `${r.status} ${r.data.error || ''}`)

// A reason for moving a day is a sentence. A URL is not a reason.
const shootId = (await req('/statuses')).data.find((s) => /to shoot/i.test(s.label)).id
const shooter = (await req('/users', 'POST', {
  name: 'R68 Shooter', username: 'r68op', password: 'probe123', role: 'operator', departments: [ch],
})).data
const smm = (await req('/users', 'POST', {
  name: 'Dilnoza Karimova', username: 'r68smm', password: 'probe123', role: 'member', departments: [ch],
  permissions: { manage_content: true, move_tasks: true },
})).data
const smmT = await login('r68smm', 'probe123')
const filmed = (await mk({
  title: 'r68 the filmed piece', type: 'video', status_id: shootId, operator_id: shooter.id,
  recording_date: day(1), edit_ready_date: day(3), release_date: day(5),
  reference_links: ['https://example.com/reference'],
})).data
r = await req(`/content/${filmed.id}/date-requests`, 'POST',
  { field: 'release_date', to_date: day(9), reason: 'https://t.me/c/123/456' }, smmT)
ok('a link is not a reason for moving a day', r.status === 400, `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${filmed.id}/date-requests`, 'POST',
  { field: 'release_date', to_date: day(9), reason: 'The location cancelled on us this morning' }, smmT)
ok('…and a sentence is', r.status === 201, `${r.status} ${r.data.error || ''}`)

// ===================== voice notes =====================
// A one-frame silent webm is enough to prove the plumbing: what is tested
// here is the storing, the reach and the caps, not the codec.
const CLIP = 'data:audio/webm;base64,' + Buffer.from('not really audio, but it is bytes').toString('base64')
r = await req(`/content/${post.id}/comments`, 'POST', { text: '', voice: CLIP, voice_secs: 12 })
ok('a comment can be a voice note with no words at all', r.status === 201, `${r.status} ${r.data.error || ''}`)
const spoken = r.data
ok('…and it carries how long it runs, for the bubble to show', spoken.voice_secs === 12, String(spoken.voice_secs))
ok('…and an id rather than the bytes, so no list drags audio along',
  !!spoken.voice_id && !JSON.stringify(spoken).includes('base64'), JSON.stringify(spoken).slice(0, 120))

r = await req(`/content/${post.id}/comments`, 'POST', { text: '' })
ok('an empty comment with no clip is still refused', r.status === 400, `${r.status} ${r.data.error || ''}`)

r = await req(`/content/voice/${spoken.voice_id}`)
ok('the clip plays back on request', r.status === 200 && r.data.data === CLIP, String(r.status))
ok('…with the length and the speaker beside it', r.data.secs === 12 && /Admin/.test(r.data.author || ''),
  JSON.stringify({ secs: r.data.secs, author: r.data.author }))

// Not audio, and not endless.
r = await req(`/content/${post.id}/comments`, 'POST', { text: 'x', voice: 'data:image/png;base64,AAAA', voice_secs: 3 })
ok('a picture posted as a voice note is refused', r.status === 400, `${r.status} ${r.data.error || ''}`)
const HUGE = 'data:audio/webm;base64,' + 'A'.repeat(5 * 1024 * 1024)
r = await req(`/content/${post.id}/comments`, 'POST', { text: '', voice: HUGE, voice_secs: 600 })
ok('a recording past the cap is refused', r.status === 400, `${r.status} ${r.data.error || ''}`)

// Somebody with no reach on the task cannot listen in.
const outsider = (await req('/users', 'POST', {
  name: 'R68 Outsider', username: 'r68out', password: 'probe123', role: 'member', departments: [],
})).data
const outT = await login('r68out', 'probe123')
r = await req(`/content/voice/${spoken.voice_id}`, 'GET', null, outT)
ok('a clip is only as reachable as the task it is on', r.status === 404, String(r.status))

// A Pravki can be spoken — and still has to be written, so it can be skimmed.
const readyId = (await req('/statuses')).data.find((s) => /^ready$/i.test(s.label)).id
await req(`/content/${filmed.id}`, 'PATCH', { editor_id: smm.id })
await req(`/content/${filmed.id}`, 'PATCH', { status_id: readyId })
r = await req(`/content/${filmed.id}/revisions`, 'POST', { note: '', voice: CLIP, voice_secs: 9 })
ok('a Pravki with only a clip is refused — a note has to be skimmable', r.status === 400,
  `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${filmed.id}/revisions`, 'POST',
  { note: 'The third shot is too slow', target: 'editor', voice: CLIP, voice_secs: 9 })
ok('…and a written note WITH a clip is the good case', r.status === 201 || r.status === 200,
  `${r.status} ${r.data.error || ''}`)
const withVoice = (await req(`/content/${filmed.id}`)).data.revisions?.find((v) => v.voice_id)
ok('…the crew see the clip on the revision', !!withVoice && withVoice.voice_secs === 9, JSON.stringify(withVoice))

// ===================== naming somebody =====================
const bell = async (tok) => ((await req('/notifications', 'GET', null, tok)).data.events || [])
const before = (await bell(smmT)).length
// Dilnoza is on NOTHING here — which is exactly when you name her.
r = await req(`/content/${post.id}/comments`, 'POST', { text: '@Dilnoza can you shoot this on Thursday?' })
ok('naming somebody in the thread is accepted', r.status === 201, String(r.status))
let mine = await bell(smmT)
ok('…and reaches them even though the task is none of their business',
  mine.length > before && mine.some((n) => /named you/i.test(n.text || '')),
  JSON.stringify(mine.slice(0, 2).map((n) => n.text)))
ok('…and is marked as a naming, not an ordinary comment',
  mine.some((n) => n.kind === 'mention'), JSON.stringify(mine.slice(0, 1)))

// The full name works as well as the first.
const n1 = (await bell(smmT)).length
await req(`/content/${post.id}/comments`, 'POST', { text: 'ping @Dilnoza Karimova about the cut' })
ok('the full name reaches them too', (await bell(smmT)).length > n1)

// A word that is not a name is just a word.
const n2 = (await bell(smmT)).length
await req(`/content/${post.id}/comments`, 'POST', { text: 'let us meet @2pm by the gates' })
ok('“@2pm” rings nobody', (await bell(smmT)).length === n2)

// And naming yourself does not ring you.
const meBefore = (await bell(T)).length
await req(`/content/${post.id}/comments`, 'POST', { text: '@Admin noting this for myself' })
ok('naming yourself is not a notification', (await bell(T)).length === meBefore)

// ===================== waiting on an admin, in one place =====================
// The asking mechanism is only as good as the answering. Without a list of
// what is waiting, it depends on an admin happening to open the right task —
// and a request nobody sees is a deadline that quietly stays wrong.
let open = await req('/content/date-requests/open')
ok('an admin can see everything waiting on them', open.status === 200 && open.data.length >= 1,
  `${open.status} ${JSON.stringify(open.data).slice(0, 120)}`)
ok('…with the task, the move and the reason all on the row', (() => {
  const a = open.data[0]
  return a && a.title && a.field && a.from_date && a.reason && a.asked_name
})(), JSON.stringify(open.data[0]))
const waiting = open.data[0]

// Somebody who cannot answer is not shown a queue they cannot act on.
open = await req('/content/date-requests/open', 'GET', null, smmT)
ok('…and somebody who cannot answer sees no queue', open.status === 200 && open.data.length === 0,
  JSON.stringify(open.data))

await req(`/content/date-requests/${waiting.id}/decide`, 'POST', { approve: true })
open = await req('/content/date-requests/open')
ok('an answered ask leaves the queue', !open.data.some((a) => a.id === waiting.id),
  JSON.stringify(open.data.map((a) => a.id)))

// A crew account cannot ask, so the form must not offer them the button — and
// the server is the one that decides. The SHOOTER is used deliberately: they
// hold the task and are on its channel, so this reaches the dates rule itself
// rather than stopping at "not your channel" and proving nothing.
const shooterT = await login('r68op', 'probe123')
r = await req(`/content/${filmed.id}/date-requests`, 'POST',
  { field: 'recording_date', to_date: day(4), reason: 'I would rather shoot on the Friday' }, shooterT)
ok('the crew hold the task and still have no say over its days', r.status === 403,
  `${r.status} ${r.data.error || ''}`)
ok('…refused for THAT reason, not for the channel', /permission to move dates/i.test(r.data.error || ''),
  r.data.error)

// ===================== the repeat check does not read the board =============
// The fingerprint is stored and indexed rather than recomputed from every
// script in the database. What matters here is that it still CATCHES — the
// speed is the point, but a fast check that misses is worthless.
const twin = 'Сцена в библиотеке, один вопрос, съёмка у окна'
r = await mk({ title: 'r68 the first one', type: 'post', script: twin })
ok('a script goes in', r.status === 201, `${r.status} ${r.data.error || ''}`)
r = await mk({ title: 'r68 the twin', type: 'post', script: twin })
ok('…and the same one on a second task is still caught', r.status === 400, `${r.status} ${r.data.error || ''}`)
r = await mk({ title: 'r68 the retyped twin', type: 'post', script: `  ${twin.toUpperCase()}  ` })
ok('…however it is retyped', r.status === 400, `${r.status} ${r.data.error || ''}`)
// Editing a script keeps the fingerprint in step — otherwise the check would
// go on answering about the words the task used to hold.
const moved = (await mk({ title: 'r68 changes its mind', type: 'post', script: 'A script it will not keep for long' })).data
await req(`/content/${moved.id}`, 'PATCH', { script: 'Совершенно другой сюжет, снятый во дворе' })
r = await mk({ title: 'r68 takes the old words', type: 'post', script: 'A script it will not keep for long' })
ok('a script somebody edited AWAY is free for another task to use', r.status === 201,
  `${r.status} ${r.data.error || ''}`)
r = await mk({ title: 'r68 takes the new words', type: 'post', script: 'Совершенно другой сюжет, снятый во дворе' })
ok('…and the words it edited TO are the ones now taken', r.status === 400, `${r.status} ${r.data.error || ''}`)

// ===================== nothing outlives its task =====================
// A voice note and a Pravki screenshot are base64 blobs — the heaviest rows
// in the database — and they were surviving the task they belonged to with
// nothing left to reach them by. Deleting a task takes everything it was
// carrying; the paper trail is the deliberate exception, because it is
// written to still read like a sentence once the task is gone.
{
  const doomed = (await mk({ title: 'r68 about to be deleted', type: 'post', script: 'A script that will not outlive its task' })).data
  const c = await req(`/content/${doomed.id}/comments`, 'POST', { text: 'said on a task that is about to go', voice: CLIP, voice_secs: 4 })
  const vid = c.data.voice_id
  ok('the doomed task has a clip on it', !!vid, JSON.stringify(c.data))
  ok('…and the clip plays while the task lives', (await req(`/content/voice/${vid}`)).status === 200)

  // Somebody else is told about it, so the bell has a line pointing at a task
  // that is about to stop existing.
  await req(`/content/${doomed.id}/comments`, 'POST', { text: '@Dilnoza look at this one before it goes' })
  ok('the bell carries a line for the doomed task',
    (await bell(smmT)).some((n) => n.content_id === doomed.id))

  const gone = await req(`/content/${doomed.id}`, 'DELETE')
  ok('the task is deleted', gone.status === 200, `${gone.status} ${gone.data.error || ''}`)

  // Asking the API whether the clip is reachable proves nothing: the 404 comes
  // from the deleted PARENT, and would arrive just the same with the clip row
  // sitting in the database for ever. So the database is asked directly.
  ok('the clip row is really gone, not merely unreachable', rowsLeft('voice_notes', doomed.id) === 0,
    `${rowsLeft('voice_notes', doomed.id)} left`)
  for (const t of ['comments', 'attachments', 'revisions', 'date_requests', 'undo_moves']) {
    ok(`…and so is its ${t.replace('_', ' ')}`, rowsLeft(t, doomed.id) === 0, `${rowsLeft(t, doomed.id)} left`)
  }
  ok('…and no bell line still points at a task nobody can open',
    !(await bell(smmT)).some((n) => n.content_id === doomed.id))
  // The paper trail is the deliberate exception: it is written to still read
  // like a sentence once the task is gone.
  ok('…but the paper trail stays, which is the point of it',
    rowsLeft('activity', doomed.id) > 0, `${rowsLeft('activity', doomed.id)} rows`)

  // The script it held is free again — the fingerprint went with the row.
  const reuse = await mk({ title: 'r68 takes the dead task’s words', type: 'post', script: 'A script that will not outlive its task' })
  ok('…and the words it held are free for another task', reuse.status === 201,
    `${reuse.status} ${reuse.data.error || ''}`)
}

stop()
console.log(fails === 0 ? '\nRound-68 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
