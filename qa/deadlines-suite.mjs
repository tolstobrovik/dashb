// Deadline accountability: the handover gates, the clocks, the excuse rule
// and the warnings each of them produces.
//
// API-only on purpose — it runs anywhere Node runs, with no browser driver,
// so the pipeline's rules stay checkable on a laptop.
//   node qa/deadlines-suite.mjs           (expects a server on :4090)
const BASE = process.env.BASE || 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

const { data: statuses } = await req('/statuses')
const S = Object.fromEntries(statuses.map((s) => [s.label, s.id]))

// A day helper on the team's clock, so "yesterday" means yesterday in Tashkent.
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
  .format(new Date(Date.now() + off * 86400000))

const suffix = Date.now().toString(36).slice(-5)
const mkUser = async (uname, name, role, crew) => {
  const { data } = await req('/users', 'POST', {
    name, username: uname + suffix, password: 'pw123456', role, crew_roles: crew,
    departments: ['instagram_main'], permissions: {},
  })
  return data.id
}
// Members hold the crew hats here: the stage RULES (who may leave a stage) are
// a separate, admin-tuned axis, and this suite is about the GATES.
const shooter = await mkUser('shoot', 'Sardor Shooter', 'member', [])
const editor = await mkUser('edit', 'Eldor Editor', 'member', [])
const reviewer = await mkUser('rev', 'Rustam Reviewer', 'member', [])
const shooterT = await login('shoot' + suffix, 'pw123456')
const editorT = await login('edit' + suffix, 'pw123456')
ok('crew accounts created', !!(shooter && editor && reviewer && shooterT))

const newTask = async (over = {}) => {
  const { data } = await req('/content', 'POST', {
    title: 'Gate test ' + Math.random().toString(36).slice(2, 7),
    channels: ['instagram_main'], type: 'reel', status_id: S['Idea'],
    recording_date: day(2), edit_ready_date: day(4), release_date: day(6),
    ...over,
  })
  return data
}

// ---- gate 1: naming the shooter ----------------------------------------
{
  const t = await newTask()
  let r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['To shoot'] }, shooterT)
  ok('→ To shoot is refused with no shooter', r.status === 400, `${r.status} ${r.data.error || ''}`)
  ok('  refusal names the missing field', r.data.missing === 'operator_id', String(r.data.missing))

  r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['To shoot'], operator_id: shooter }, shooterT)
  ok('→ To shoot passes once a shooter is named', r.status === 200, `${r.status} ${r.data.error || ''}`)
}

// ---- gate 2: the editor and the footage --------------------------------
{
  const t = await newTask({ operator_id: shooter })
  await req(`/content/${t.id}`, 'PATCH', { status_id: S['Shot'] }, shooterT)

  let r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'] }, shooterT)
  ok('→ Editing is refused with no editor', r.status === 400, `${r.status}`)
  ok('  refusal names the editor', r.data.missing === 'editor_id', String(r.data.missing))

  r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'], editor_id: editor }, shooterT)
  ok('→ Editing is refused with an editor but no footage', r.status === 400, `${r.status}`)
  ok('  refusal names the footage', r.data.missing === 'shot_link', String(r.data.missing))

  r = await req(`/content/${t.id}`, 'PATCH', {
    status_id: S['Editing'], editor_id: editor, shot_link: 'https://drive.google.com/raw-1',
  }, shooterT)
  ok('→ Editing passes with editor + footage', r.status === 200, `${r.status} ${r.data.error || ''}`)

  const { data: full } = await req(`/content/${t.id}`)
  ok('shot_at stamped at the handover', !!full.shot_at, String(full.shot_at))
  ok('editor recorded as owner', full.editor_id === editor)
}

// ---- gate 3: the reviewer and the cut ----------------------------------
{
  const t = await newTask({ operator_id: shooter, editor_id: editor, shot_link: 'https://drive.google.com/raw-2' })
  await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'] }, shooterT)

  let r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Ready'] }, editorT)
  ok('→ Ready is refused with no reviewer', r.status === 400, `${r.status}`)
  ok('  refusal names the reviewer', r.data.missing === 'reviewer_id', String(r.data.missing))

  r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Ready'], reviewer_id: reviewer }, editorT)
  ok('→ Ready is refused without the cut', r.status === 400, `${r.status}`)

  r = await req(`/content/${t.id}`, 'PATCH', {
    status_id: S['Ready'], reviewer_id: reviewer, ready_link: 'https://drive.google.com/cut-1',
  }, editorT)
  ok('→ Ready passes with reviewer + cut', r.status === 200, `${r.status} ${r.data.error || ''}`)
  const { data: full } = await req(`/content/${t.id}`)
  ok('edited_at stamped at the handover', !!full.edited_at, String(full.edited_at))
}

// ---- gates are cumulative: no jumping the queue -------------------------
{
  const t = await newTask()
  const r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Ready'] }, shooterT)
  ok('Idea → Ready in one drag is refused', r.status === 400, `${r.status}`)
  ok('  and it stops at the FIRST unmet gate', r.data.gate === 'shoot', String(r.data.gate))
}

// ---- going backwards is never gated ------------------------------------
{
  const t = await newTask({ operator_id: shooter, editor_id: editor, shot_link: 'https://drive.google.com/raw-3' })
  await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'] }, shooterT)
  const r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Idea'] }, editorT)
  ok('sending work back for fixes stays free', r.status === 200, `${r.status} ${r.data.error || ''}`)
}

// ---- the late handover forces a new promise ----------------------------
{
  // The shoot was due two days ago and is only being handed over now.
  const t = await newTask({ operator_id: shooter, editor_id: editor, recording_date: day(-2), edit_ready_date: day(-1) })
  await req(`/content/${t.id}`, 'PATCH', { shot_link: 'https://drive.google.com/raw-4' })

  let r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'] }, shooterT)
  ok('a late handover is refused without a new deadline', r.status === 400, `${r.status}`)
  ok('  refusal asks for the revised date', r.data.missing === 'edit_due_revised', String(r.data.missing))
  ok('  refusal states what was missed', r.data.was_due === day(-2), String(r.data.was_due))

  r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'], edit_due_revised: day(3) }, shooterT)
  ok('the move lands once a new deadline is set', r.status === 200, `${r.status} ${r.data.error || ''}`)

  const { data: full } = await req(`/content/${t.id}`)
  ok('the ORIGINAL deadline is kept', full.edit_ready_date === day(-1), String(full.edit_ready_date))
  ok('the revised deadline is stored beside it', full.edit_due_revised === day(3), String(full.edit_due_revised))
  const revLog = (full.activity || []).find((a) => a.field === 'edit_due_revised')
  ok('the re-promise is in the paper trail', !!revLog, revLog ? `${revLog.user_name}: → ${revLog.new_value}` : 'missing')

  // The editor now answers to the NEW date, and is not late yet.
  const edit = (full.phases || []).find((p) => p.phase === 'edit')
  ok('editor judged against the revised date', edit?.due === day(3), String(edit?.due))
  ok('editor is not late', edit?.state === 'pending', String(edit?.state))
  // The shooter, however, is.
  const shoot = (full.phases || []).find((p) => p.phase === 'shoot')
  ok('shooter is marked late', shoot?.state === 'late', String(shoot?.state))
  ok('shooter lateness is measured', shoot?.days_late >= 1, String(shoot?.days_late))
}

// ---- the excuse: upstream ate the whole window --------------------------
{
  // The shoot is not late, so the gate does not demand a new promise — but the
  // editing deadline was set BEFORE the shooting one and has already gone. The
  // editor inherits a date that was dead on arrival, through nobody's fault of
  // their own, and must not be charged for it.
  const t = await newTask({ operator_id: shooter, editor_id: editor, recording_date: day(1), edit_ready_date: day(-1) })
  const r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'], shot_link: 'https://drive.google.com/raw-5' })
  ok('an on-time handover needs no re-promise', r.status === 200, `${r.status} ${r.data.error || ''}`)

  const { data: full } = await req(`/content/${t.id}`)
  const edit = (full.phases || []).find((p) => p.phase === 'edit')
  ok('editor is EXCUSED when the work arrived after their own deadline', edit?.state === 'excused', String(edit?.state))
  const shoot = (full.phases || []).find((p) => p.phase === 'shoot')
  ok('the shooter, who delivered inside their own date, is clean', shoot?.state === 'ok', String(shoot?.state))
}

// ---- the account record -------------------------------------------------
{
  const { data: mine } = await req('/warnings/me', 'GET', null, shooterT)
  ok('a worker sees their own warnings', mine.count >= 1, `${mine.count} warnings`)
  ok('  each names the task and the phase', mine.warnings.every((w) => w.title && w.phase), '')
  ok('  each says how late', mine.warnings.every((w) => typeof w.days_late === 'number'), '')

  const { data: theirs } = await req('/warnings/me', 'GET', null, editorT)
  ok('the excused editor carries no warning for it', theirs.warnings.every((w) => w.phase !== 'edit' || w.days_late > 0), `${theirs.count}`)

  // Not editable, and not visible across accounts.
  const r = await req('/warnings', 'GET', null, shooterT)
  ok('a worker cannot read the whole team’s record', r.status === 403, `${r.status}`)
  const del = await req(`/warnings/me`, 'DELETE', null, shooterT)
  ok('warnings cannot be deleted', del.status === 404 || del.status === 405, `${del.status}`)
}

// ---- the report ---------------------------------------------------------
{
  const { data: rep, status } = await req('/warnings/report')
  ok('admin gets the pipeline report', status === 200, `${status}`)
  ok('  it splits by phase', Array.isArray(rep.phases) && rep.phases.length === 3, JSON.stringify(rep.phases?.map((p) => p.phase)))
  ok('  it counts excused separately from late', rep.phases.some((p) => p.excused > 0), JSON.stringify(rep.phases?.map((p) => `${p.phase}:${p.late}L/${p.excused}E`)))
  ok('  it names the people', Array.isArray(rep.people) && rep.people.some((p) => p.name), '')
  ok('  it names the worst stage', !!rep.worst?.phase, String(rep.worst?.phase))
}

console.log(`\n${fails ? `✘ ${fails} FAILED` : '✔ deadlines suite passed'}`)
process.exit(fails ? 1 : 0)
