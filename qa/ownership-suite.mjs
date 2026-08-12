// Ownership and regret: shared review, the hand-over lock, and the ten
// seconds in which a move can still be taken back.
//   node qa/ownership-suite.mjs           (expects a server on :4090)
const BASE = process.env.BASE || 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
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
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
  .format(new Date(Date.now() + off * 86400000))

const sfx = Date.now().toString(36).slice(-5)
const mk = async (u, name) => (await req('/users', 'POST', {
  name, username: u + sfx, password: 'pw123456', role: 'member',
  departments: ['instagram_main'], permissions: {},
})).data.id
const shooter = await mk('sh', 'Sardor Shooter')
const editor = await mk('ed', 'Eldor Editor')
const rev1 = await mk('r1', 'Rustam Reviewer')
const rev2 = await mk('r2', 'Rano Reviewer')
const shooterT = await login('sh' + sfx, 'pw123456')
const editorT = await login('ed' + sfx, 'pw123456')
const rev1T = await login('r1' + sfx, 'pw123456')
const rev2T = await login('r2' + sfx, 'pw123456')
ok('accounts created', !!(shooter && editor && rev1 && rev2 && rev2T))

const newTask = async (over = {}) => (await req('/content', 'POST', {
  title: 'Own ' + Math.random().toString(36).slice(2, 7),
  channels: ['instagram_main'], type: 'reel', status_id: S['Idea'],
  recording_date: day(2), edit_ready_date: day(4), release_date: day(6), ...over,
})).data

// ---- review can be shared ----------------------------------------------
{
  const t = await newTask({ reviewer_ids: [rev1, rev2] })
  ok('a task can be created with two reviewers', t.reviewer_id === rev1, `${t.reviewer_id}`)
  const { data: full } = await req(`/content/${t.id}`)
  const list = JSON.parse(full.reviewers || '[]')
  ok('  both are stored', list.length === 2 && list.includes(rev1) && list.includes(rev2), JSON.stringify(list))
  const review = (full.phases || []).find((p) => p.phase === 'review')
  ok('  the review phase names both owners', review?.owner_ids?.length === 2, JSON.stringify(review?.owner_ids))

  // A missed review is charged to each of them. The cut reaches review today,
  // so the reviewers only really own the date once it has been re-promised —
  // otherwise they are excused, which is the rule working, not a miss.
  const late = await newTask({ reviewer_ids: [rev1, rev2], release_date: day(-3), edit_ready_date: day(-5) })
  await req(`/content/${late.id}`, 'PATCH', { editor_id: editor, shot_link: 'https://drive.google.com/a', status_id: S['Editing'] })
  await req(`/content/${late.id}`, 'PATCH', { ready_link: 'https://drive.google.com/b', status_id: S['Ready'] })
  // Without a re-promise the delay is upstream and neither reviewer carries it.
  const excused = await req('/warnings/me', 'GET', null, rev1T)
  ok('an un-repromised late handover excuses BOTH reviewers', excused.data.count === 0, `${excused.data.count}`)
  // Re-promised to a date that has itself now gone: now it is theirs.
  await req(`/content/${late.id}`, 'PATCH', { review_due_revised: day(-1) })
  const one = await req('/warnings/me', 'GET', null, rev1T)
  const two = await req('/warnings/me', 'GET', null, rev2T)
  ok('both reviewers carry the missed review', one.data.count >= 1 && two.data.count >= 1,
    `rev1:${one.data.count} rev2:${two.data.count}`)
  ok('  each is told it is shared', (one.data.warnings.find((w) => w.phase === 'review')?.shared_with || []).includes(rev2), '')
}

// ---- handing over hands over the right to move --------------------------
{
  const t = await newTask({ operator_id: shooter })
  await req(`/content/${t.id}`, 'PATCH', { status_id: S['To shoot'] }, shooterT)

  // While it is the shooter's, the editor cannot move it.
  let r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Shot'] }, editorT)
  ok('a non-owner cannot move work in someone else’s hands', r.status === 403, `${r.status}`)
  ok('  and is told who has it', Array.isArray(r.data.held_by) && r.data.held_by.includes(shooter), JSON.stringify(r.data.held_by))

  // The shooter hands it to the editor…
  r = await req(`/content/${t.id}`, 'PATCH', {
    status_id: S['Editing'], editor_id: editor, shot_link: 'https://drive.google.com/raw',
  }, shooterT)
  ok('the owner hands it on', r.status === 200, `${r.status} ${r.data.error || ''}`)

  // …and loses the right to move it.
  r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Shot'] }, shooterT)
  ok('the previous owner can no longer drag it back', r.status === 403, `${r.status}`)
  ok('  the message names the new holder', /Eldor/.test(r.data.error || ''), r.data.error || '')

  // The new owner can.
  r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Shot'] }, editorT)
  ok('the new owner can move it', r.status === 200, `${r.status} ${r.data.error || ''}`)

  // An admin is never locked out.
  r = await req(`/content/${t.id}`, 'PATCH', { status_id: S['Editing'] })
  ok('an admin is never locked out', r.status === 200, `${r.status} ${r.data.error || ''}`)
}

// ---- ten seconds of regret ----------------------------------------------
{
  const t = await newTask({ operator_id: shooter })
  const planBefore = (await req('/trackers?department=instagram_main')).data
  const reelBefore = (planBefore.find?.((x) => x.content_type === 'reel') || {}).current ?? 0

  // A move that completes the task also moves the numbers.
  await req(`/content/${t.id}`, 'PATCH', {
    status_id: S['Editing'], editor_id: editor, shot_link: 'https://drive.google.com/raw2',
  }, shooterT)
  let { data: mid } = await req(`/content/${t.id}`)
  ok('the handover stamped the clock', !!mid.shot_at, String(mid.shot_at))

  const un = await req(`/content/${t.id}/undo`, 'POST', {}, shooterT)
  ok('the move can be undone', un.status === 200, `${un.status} ${un.data.error || ''}`)

  const { data: back } = await req(`/content/${t.id}`)
  ok('  the stage is back', back.status_id === S['To shoot'] || back.status_id === S['Idea'], String(back.status_id))
  ok('  the handover clock is cleared', !back.shot_at, String(back.shot_at))
  ok('  the editor it forced you to name is cleared', !back.editor_id, String(back.editor_id))
  const undoneLog = (back.activity || []).find((a) => a.field === 'stage undone')
  ok('  the undo is itself on the record', !!undoneLog, undoneLog ? `${undoneLog.old_value} → ${undoneLog.new_value}` : 'missing')

  // A second undo has nothing left to take back.
  const again = await req(`/content/${t.id}/undo`, 'POST', {}, shooterT)
  ok('there is only one move to take back', again.status === 404, `${again.status}`)
}

// ---- the statistics are walked back too ---------------------------------
{
  const t = await newTask({ operator_id: shooter, editor_id: editor, reviewer_ids: [rev1] })
  const cur = async () => {
    const { data } = await req('/trackers?department=instagram_main')
    return (data.find?.((x) => x.content_type === 'reel') || {}).current ?? 0
  }
  const before = await cur()
  await req(`/content/${t.id}`, 'PATCH', { status_id: S['Published'] })
  const after = await cur()
  ok('publishing fills the plan', after === before + 1, `${before} → ${after}`)

  const un = await req(`/content/${t.id}/undo`, 'POST', {})
  ok('an admin can undo it', un.status === 200, `${un.status} ${un.data.error || ''}`)
  const restored = await cur()
  ok('undoing empties it again', restored === before, `${after} → ${restored} (expected ${before})`)
  const { data: back } = await req(`/content/${t.id}`)
  ok('  and the completion is cleared', !back.done_at, String(back.done_at))
}

// ---- the window really closes -------------------------------------------
{
  const t = await newTask({ operator_id: shooter })
  await req(`/content/${t.id}`, 'PATCH', { status_id: S['To shoot'] }, shooterT)
  console.log('   (waiting out the undo window…)')
  await sleep(11000)
  const un = await req(`/content/${t.id}/undo`, 'POST', {}, shooterT)
  ok('after ten seconds the move is final', un.status === 409, `${un.status} ${un.data.error || ''}`)
}

// ---- somebody else's regret is not yours --------------------------------
{
  const t = await newTask({ operator_id: shooter })
  await req(`/content/${t.id}`, 'PATCH', { status_id: S['To shoot'] }, shooterT)
  const un = await req(`/content/${t.id}/undo`, 'POST', {}, editorT)
  ok('you cannot undo somebody else’s move', un.status === 403, `${un.status}`)
}

console.log(`\n${fails ? `✘ ${fails} FAILED` : '✔ ownership suite passed'}`)
process.exit(fails ? 1 : 0)
