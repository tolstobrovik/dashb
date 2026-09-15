// Channel formats: what a task owes depends on where it is going.
//
// The board knew what a piece WAS and never where it was going, so one set of
// rules covered every surface at once. A team writing a Telegram announcement
// was told «Reference» is required for this type of task and STILL MISSING ·
// needs a designer, because somewhere a rule says a post needs those — and it
// does, on Instagram.
//
// Three things here are easy to get backwards and each has its own section:
//
//   C  ACROSS CHANNELS IT IS THE UNION, not the intersection. A piece
//      cross-posted to Instagram and Telegram is still going on Instagram, so
//      it still owes the artwork. Getting this the other way round would let
//      anybody skip every rule on the board by ticking Telegram as well.
//
//   D  A FORMAT ONLY EVER TAKES A QUESTION OFF THE TABLE. It cannot make the
//      board demand something the admin did not ask for.
//
//   E  NO CHANNEL MEANS NO OPINION, not "needs nothing".
//
// Self-contained: port 4128.
import { spawn } from 'child_process'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = new URL('.', import.meta.url).pathname
const PORT = 4128
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
  { env: { ...process.env, DATA_DIR: SP + 'fmt-' + Date.now(), PORT: String(PORT) }, stdio: 'ignore' }))
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
const stamp = Date.now().toString().slice(-6)
const stages = (await req('/statuses')).data
const published = stages.find((s) => /published/i.test(s.label))
const chans = () => req('/channels')

console.log('\n=== A. a board that already existed does not have to be re-taught ===')
// Every channel that predates formats gets the one it obviously is, from its
// own key and icon. A board should not have to go and tell the app what its
// Telegram channel is.
const seeded = Object.fromEntries((await chans()).data.map((c) => [c.key, c.format]))
ok('A1', 'Telegram channels are read as written channels',
  seeded.telegram_main === 'text' && seeded.telegram_uzb === 'text', JSON.stringify(seeded))
ok('A2', 'Instagram stays a social feed',
  seeded.instagram_main === 'social' && seeded.instagram_uzb === 'social', JSON.stringify(seeded))
ok('A3', 'YouTube is long video', seeded.youtube === 'video', String(seeded.youtube))
ok('A4', 'Target is paid promotion', seeded.target === 'ads', String(seeded.target))

console.log('\n=== B. the admin chooses, and the choice sticks ===')
const made = await req('/channels', 'POST', { label: `Probe TG ${stamp}`, icon: 'telegram', format: 'text' })
ok('B1', 'a channel can be created as a written one',
  made.status === 201 && made.data.format === 'text', `${made.status} ${made.data.format}`)
const flipped = await req(`/channels/${made.data.id}`, 'PATCH', { format: 'video' })
ok('B2', '…and changed afterwards', flipped.data.format === 'video', String(flipped.data.format))
const junk = await req(`/channels/${made.data.id}`, 'PATCH', { format: 'not-a-format' })
ok('B3', 'a format nobody has heard of does not become one',
  junk.data.format === 'video', `${junk.data.format} — kept what it had rather than storing nonsense`)
const bare = await req('/channels', 'POST', { label: `Probe bare ${stamp}`, icon: 'star' })
ok('B4', 'a channel made without saying is a social feed — how every channel behaved before this',
  bare.data.format === 'social', String(bare.data.format))
await req(`/channels/${made.data.id}`, 'PATCH', { format: 'text' })

// A content member, who is the person these rules are actually for: an admin
// is unfettered by the brief rules and would pass every check below.
const who = (await req('/users', 'POST', {
  name: `Jasmina ${stamp}`, username: `jas${stamp}`, password: 'probe-only-123', role: 'member' })).data
await req(`/users/${who.id}`, 'PATCH', {
  departments: ['telegram_main', 'instagram_main', 'youtube', 'target', made.data.key] })
const M = await login(`jas${stamp}`, 'probe-only-123')
// The setting that caused all of this: Reference demanded of every type.
const fields = (await req('/fields')).data
await req('/fields', 'POST', { ...fields, reference: { state: 'required', types: ['post', 'reel', 'story', 'video', 'target', 'other'] } })

let n = 0
const make = (channels, type = 'post', extra = {}) => req('/content', 'POST', {
  title: `fmt ${stamp} ${++n}`, channels, type, status_id: published.id,
  post_link: `https://example.com/${stamp}-${n}`, ...extra,
}, M)

console.log('\n=== C. where it is going decides what it owes ===')
const tg = await make(['telegram_main'])
ok('C1', 'a written channel is not asked for a Reference',
  tg.status === 201, `${tg.status} ${JSON.stringify(tg.data.error || '')}`)
const ig = await make(['instagram_main'])
ok('C2', '…while a social feed still is', ig.status === 400 && /Reference/.test(ig.data.error || ''),
  `${ig.status} ${JSON.stringify(ig.data.error || '')}`)
// The one that matters most. The intersection would let anybody skip every
// rule on this board by ticking Telegram as well.
const both = await make(['telegram_main', 'instagram_main'])
ok('C3', 'a cross-post owes what the STRICTEST of its channels owes',
  both.status === 400 && /Reference/.test(both.data.error || ''),
  `${both.status} — it is still going on Instagram, so it still owes the artwork`)
const yt = await make(['youtube'], 'video')
ok('C4', 'long video is asked too', yt.status === 400, String(yt.status))
const tgReel = await make(['telegram_main'], 'reel')
ok('C5', 'the channel decides, not the type — a reel on a written channel is not asked',
  tgReel.status === 201, `${tgReel.status} ${JSON.stringify(tgReel.data.error || '')}`)

console.log('\n=== D. a format only ever takes a question off the table ===')
// Reference is not asked for on a social feed unless the admin asks for it.
// The format allows the question; the admin's own setting decides it.
await req('/fields', 'POST', { ...fields, reference: { state: 'optional', types: ['post', 'reel', 'story', 'video', 'target', 'other'] } })
const relaxed = await make(['instagram_main'])
ok('D1', 'a field the admin made optional is not demanded because the format allows it',
  relaxed.status === 201, `${relaxed.status} ${JSON.stringify(relaxed.data.error || '')}`)
await req('/fields', 'POST', { ...fields, reference: { state: 'required', types: ['post', 'reel', 'story', 'video', 'target', 'other'] } })
// And the reverse: a written channel cannot be made to want one.
const stillNot = await make(['telegram_main'])
ok('D2', '…and a written channel is still not asked when it is required again',
  stillNot.status === 201, String(stillNot.status))

console.log('\n=== E. nobody has said where this is going ===')
// A task with no channel is judged by the type rules alone. The board makes
// channels mandatory, so this is asked of the rule directly rather than
// through a task the API would refuse for a different reason.
const noChannel = await req('/content', 'POST', {
  title: `fmt ${stamp} nowhere`, channels: [], type: 'post', status_id: published.id }, M)
ok('E1', 'a task still has to say where it is going',
  noChannel.status === 400 && /platform/i.test(noChannel.data.error || ''),
  `${noChannel.status} ${JSON.stringify(noChannel.data.error || '')}`)
const { formatsAllowField, formatsAllowCrew } = await import(`${ROOT}/server/db.js`)
ok('E2', '…and with none to go on, every question is still on the table',
  formatsAllowField([], 'reference') && formatsAllowCrew([], 'designer'),
  'no channel is "nobody has said yet", not "this needs nothing"')
ok('E3', 'a written channel wants no hats at all',
  !formatsAllowCrew(['text'], 'operator') && !formatsAllowCrew(['text'], 'editor')
  && !formatsAllowCrew(['text'], 'designer'), 'nothing is filmed, cut or drawn')
ok('E4', '…but it still wants the words',
  formatsAllowField(['text'], 'description'), 'a written post is its words')
ok('E5', 'the union is over the formats, not the intersection',
  formatsAllowCrew(['text', 'social'], 'designer'),
  'Telegram + Instagram still needs the designer Instagram needs')

console.log('\n=== F. what the browser is told matches what the server enforces ===')
// Two copies of a rule about what a Telegram post owes is two copies to
// disagree, and only one of them is on screen. The table is served.
const served = (await req('/fields')).data.channel_formats
ok('F1', 'the format table is served to the client', !!served && !!served.text,
  JSON.stringify(Object.keys(served || {})))
ok('F2', '…and says the same as the server enforces',
  !served.text.crew.includes('designer') && !served.text.fields.includes('reference'),
  JSON.stringify({ crew: served.text.crew, fields: served.text.fields }))
ok('F3', '…and every format it names is one a channel may be set to',
  (await req(`/channels/${bare.data.id}`, 'PATCH', { format: Object.keys(served)[1] })).data.format === Object.keys(served)[1])
ok('F4', 'every channel carries its format to the browser',
  (await chans()).data.every((c) => typeof c.format === 'string' && !!served[c.format]),
  JSON.stringify((await chans()).data.map((c) => c.format)))

console.log(`\n${'='.repeat(58)}`)
if (found.length) {
  console.log(`${found.length} FINDING(S):`)
  found.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
} else {
  console.log('Channel-format suite clean.')
}
process.exit(fails ? 1 : 0)
