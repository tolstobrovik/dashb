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
  const { data } = await req('/content', 'POST', { title: 'Gate test ' + Math.random().toString(36).slice(2, 7),
    channels: ['instagram_main'], type: 'reel', status_id: S['Idea'],
    recording_date: day(2), edit_ready_date: day(4), release_date: day(6),
    operator_id: shooter, ...over, })
  return data
}

// ---- gate 1: naming the shooter ----------------------------------------
{
  const t = await newTask()
  // The gates ADVISE rather than refuse (the owner's call: ordinary work was
  // being blocked — a written post has no cut, and footage handed over on a
  // drive never becomes a link). What a stage is missing is still worked out
  // and still shown on the card; the move itself is accepted.
  let r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['To shoot'] }, shooterT)
  ok('→ To shoot is accepted even with no shooter named', r.status === 200, `${r.status} ${r.data.error || ''}`)
  ok('  and the card really moved', r.data.status_id === S['To shoot'], String(r.data.status_id))

  r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['To shoot'], operator_id: shooter }, shooterT)
  ok('→ To shoot passes once a shooter is named', r.status === 200, `${r.status} ${r.data.error || ''}`)
}

// ---- gate 2: advice for every type, filmed work included ---------------
// A reel really does have an editor and a file somewhere, so asking for them
// is fair — but refusing the move does not create the missing editor. The
// team plans here and works elsewhere (footage on a drive, an editor agreed
// in a voice note), so a refusal only leaves the board lying about where the
// work is. The gap is worked out and shown; the move goes through.
{
  const t = await newTask({ operator_id: shooter })   // a reel
  await req(`/content/${t.id}`, 'PATCH', { status_id: S['Shot'] }, shooterT)

  // The card knows what the move is missing BEFORE it is made — this is the
  // question the board asks to decide whether to open the handover panel.
  const ask = await req(`/content/${t.id}/handover?to=${S['Editing']}`, 'GET', null, shooterT)
  ok('the board is told the editing gate has a gap', (ask.data.gates || []).some((g) => g.key === 'edit'),
    JSON.stringify(ask.data.gates || []).slice(0, 200))

  let r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'] }, shooterT)
  ok('…and a REEL still moves to Editing with no editor named', r.status === 200, `${r.status} ${r.data.error || ''}`)
  ok('  and it really moved', r.data.status_id === S['Editing'], String(r.data.status_id))

  r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'], editor_id: editor }, shooterT)
  ok('naming the editor is accepted too', r.status === 200, `${r.status} ${r.data.error || ''}`)

  r = await req(`/content/${t.id}`, 'PATCH', {
    status_id: S['Editing'], editor_id: editor, shot_link: 'https://drive.google.com/raw-1',
  }, shooterT)
  ok('→ Editing passes with editor + footage', r.status === 200, `${r.status} ${r.data.error || ''}`)

  const { data: full } = await req(`/content/${t.id}`)
  ok('shot_at stamped at the handover', !!full.shot_at, String(full.shot_at))
  ok('editor recorded as owner', full.editor_id === editor)
}

// A written post carries none of that and must not be stopped for it.
{
  const t = await newTask({ type: 'post', operator_id: shooter })
  const r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'] }, shooterT)
  ok('a POST moves on with no editor and nothing attached', r.status === 200, `${r.status} ${r.data.error || ''}`)
  ok('  and the clock still stamps', !!(await req(`/content/${t.id}`)).data.shot_at)
}

// ---- gate 3: the reviewer and the cut ----------------------------------
{
  const t = await newTask({ operator_id: shooter, editor_id: editor, shot_link: 'https://drive.google.com/raw-2' })
  await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'] }, shooterT)

  let r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Ready'] }, editorT)
  ok('→ Ready is accepted with no reviewer named', r.status === 200, `${r.status} ${r.data.error || ''}`)
  ok('  the edit clock still stamps', !!(await req(`/content/${t.id}`)).data.edited_at)

  r = await req(`/content/${t.id}`, 'PATCH', {
    status_id: S['Ready'], reviewer_id: reviewer, ready_link: 'https://drive.google.com/cut-1',
  }, editorT)
  ok('→ Ready passes with reviewer + cut', r.status === 200, `${r.status} ${r.data.error || ''}`)
  const { data: full } = await req(`/content/${t.id}`)
  ok('edited_at stamped at the handover', !!full.edited_at, String(full.edited_at))
}

// ---- gates are cumulative: no jumping the queue -------------------------
{
  // A post sails past — nothing it crosses is a wall for its type.
  const p = await newTask({ type: 'post' })
  let r = await req(`/content/${p.id}`, 'PATCH', { status_id: S['Ready'] }, shooterT)
  ok('a POST dragged Idea → Ready lands where it was dropped', r.status === 200, `${r.status} ${r.data.error || ''}`)
  ok('  and it really is there', r.data.status_id === S['Ready'], String(r.data.status_id))

  // A reel dragged the same way lands the same way — and the stages it
  // skipped still stamp their clocks, so the record shows the jump.
  const v = await newTask()
  r = await req(`/content/${v.id}`, 'PATCH', { status_id: S['Ready'] }, shooterT)
  ok('a REEL dragged Idea → Ready lands there too', r.status === 200, `${r.status} ${r.data.error || ''}`)
  const { data: jumped } = await req(`/content/${v.id}`)
  ok('  and the gates it crossed still stamped their clocks',
    !!jumped.shot_at && !!jumped.edited_at, `shot_at=${jumped.shot_at} edited_at=${jumped.edited_at}`)
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
  ok('a late handover goes through without anyone being stopped', r.status === 200, `${r.status} ${r.data.error || ''}`)
  ok('  and the new deadline writes itself — today, when the work arrived',
    r.data.edit_due_revised === day(0), String(r.data.edit_due_revised))
  ok('  with the missed date untouched beside it', r.data.edit_ready_date === day(-1), String(r.data.edit_ready_date))

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
