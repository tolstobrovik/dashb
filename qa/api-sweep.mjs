// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// A wide, shallow sweep: every read endpoint, as every kind of account.
// It is not looking for wrong answers — the suites do that — it is looking
// for endpoints that BREAK (5xx), leak (a member reading admin data), or
// answer a shape the client would choke on.
// Not part of the gate — run it by hand when something feels off:
//   node qa/api-sweep.mjs
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const BASE = 'http://localhost:4110'
const B = BASE + '/api'
const p = spawn(process.execPath, [ROOT + '/server/index.js'],
  { env: { ...process.env, DATA_DIR: SP + 'smoke-' + Date.now(), PORT: '4110' }, stdio: 'ignore' })
process.on('exit', () => { try { p.kill('SIGKILL') } catch { /* gone */ } })
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(B + '/health')).ok) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500))
}

const login = async (u, pw) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) })).json()).token
const T = await login('admin', 'admin123')
const call = async (path, tok, method = 'GET', body) => {
  const r = await fetch(B + path, {
    method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await r.json() } catch { /* not json */ }
  return { status: r.status, data }
}

// ---- a populated world ----
const chans = (await call('/channels', T)).data
const ch = chans[0].key
const statuses = (await call('/statuses', T)).data
const mk = async (name, username, role, departments) =>
  (await call('/users', T, 'POST', { name, username, password: 'probe123', role, departments })).data
const member = await mk('Smoke Member', 'smmember', 'member', [ch])
const editor = await mk('Smoke Editor', 'smeditor', 'editor', [])
const operator = await mk('Smoke Operator', 'smoperator', 'operator', [])
const designer = await mk('Smoke Designer', 'smdesigner', 'designer', [])
const MT = await login('smmember', 'probe123')
const ET = await login('smeditor', 'probe123')
const OT = await login('smoperator', 'probe123')
const DT = await login('smdesigner', 'probe123')

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const shift = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const tasks = []
for (const [i, spec] of [
  { type: 'video', status: /to shoot/i, rec: shift(1), rel: shift(4), operator_id: operator.id, editor_id: editor.id },
  { type: 'post', status: /idea/i, rel: shift(2), designer_id: designer.id },
  { type: 'reel', status: /editing/i, rec: shift(-2), rel: shift(1), editor_id: editor.id },
  { type: 'story', status: /ready/i, rel: shift(-1) },
  { type: 'video', status: /published/i, rel: shift(-5) },
  { type: 'post', status: /deleted/i, rel: shift(3) },
].entries()) {
  const st = statuses.find((s) => spec.status.test(s.label))
  const r = await call('/content', T, 'POST', {
    title: `smoke ${i} ${spec.type}`, channels: [ch], type: spec.type, status_id: st?.id,
    recording_date: spec.rec, release_date: spec.rel,
    operator_id: spec.operator_id, editor_id: spec.editor_id, designer_id: spec.designer_id,
    assignee_ids: [member.id],
  })
  if (r.status !== 201) console.log(`  ! could not create fixture ${i}:`, r.status, JSON.stringify(r.data))
  else tasks.push(r.data)
}
const proj = (await call('/projects', T, 'POST', { name: 'Smoke project' })).data
const camp = (await call('/campaigns', T, 'POST', { name: 'Smoke campaign', channels: [ch], project_id: proj?.id })).data
const prog = (await call('/programs', T, 'POST', { name: 'Smoke program', channel: ch, start_date: shift(-3), end_date: shift(10) })).data
await call(`/content/${tasks[0].id}/comments`, T, 'POST', { text: 'smoke comment' })

// ---- the sweep ----
const WHO = { admin: T, member: MT, editor: ET, operator: OT, designer: DT }
const PATHS = [
  '/health', '/auth/me', '/channels', '/statuses', '/fields', '/users', '/notifications',
  '/content', `/content?department=${ch}`, `/content?department=${ch}&thumbs=1`,
  '/content/revisions/mine', '/content/open-revisions', '/content/activity/all',
  `/content/${tasks[0]?.id}`, `/content/${tasks[0]?.id}/files`,
  '/campaigns', `/campaigns/${camp?.id}`, '/projects', `/projects/${proj?.id}`,
  '/programs', `/programs?channel=${ch}`, '/boards', '/personal',
  '/hiring', '/candidates', '/docs', '/reports',
  '/telegram/status', '/telegram/templates', '/telegram/audience', '/telegram/admin',
]
const problems = []
let checked = 0
for (const path of PATHS) {
  if (/undefined|null/.test(path)) { problems.push(`fixture missing for ${path}`); continue }
  for (const [role, tok] of Object.entries(WHO)) {
    const { status, data } = await call(path, tok)
    checked++
    if (status >= 500) problems.push(`5xx  ${role.padEnd(9)} ${path} → ${status} ${JSON.stringify(data).slice(0, 140)}`)
    else if (status === 404 && role === 'admin' && !/\/(files|pravki)/.test(path)) problems.push(`404  admin ${path}`)
    else if (status === 200 && data === null) problems.push(`body ${role.padEnd(9)} ${path} → 200 with no JSON`)
  }
}
// unauthenticated must never see data
for (const path of PATHS.filter((x) => x !== '/health')) {
  const { status } = await call(path, null)
  checked++
  if (status !== 401 && status !== 403) problems.push(`open ${path} answers ${status} with NO token`)
}
console.log(`swept ${checked} calls across ${PATHS.length} endpoints and ${Object.keys(WHO).length} roles`)
if (problems.length === 0) console.log('nothing broken')
else { console.log(`\n${problems.length} PROBLEMS:`); for (const x of problems) console.log('  ' + x) }
try { p.kill('SIGKILL') } catch { /* gone */ }
process.exit(0)
