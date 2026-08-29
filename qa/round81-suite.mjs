// Round 81: a finished piece stops saying it is late.
//
// (This round also made the attendance register a month grid. The register
// was removed in round 82; the checks that outlived it are still here.)
//
// Two bugs, one shape between them: something raised and never lowered. A
// hand goes up while a piece is running late — by a person, or by the board
// itself — and NOTHING ever put it down. The piece then went out, and the
// finished card still read "says this will be late", with the same hand
// sitting in the planners' queue of open problems for ever. Publishing is the
// answer to "will this be late"; the answer just was not being written down.
//
// Brings its own server on 4132 so it can be run alone.
import { spawn } from 'child_process'
import { chromium } from 'playwright'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const PORT = 4132
const BASE = `http://localhost:${PORT}`
const A = `${BASE}/api`
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const dir = mkdtempSync(join(tmpdir(), 'r81-'))
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const srv = spawn('node', [join(ROOT, 'server/index.js')],
  { env: { ...process.env, DATA_DIR: dir, PORT: String(PORT) }, stdio: 'ignore' })
// A suite that throws half way through must not leave its server holding the
// port: the next run would then talk to the last run's data and fail for a
// reason that has nothing to do with the code.
process.on('exit', () => { try { srv.kill('SIGKILL') } catch { /* gone */ } })
const wait = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${A}/health`)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}
if (!(await wait())) { console.log('server never answered'); srv.kill(); process.exit(1) }

const login = async (u, p) => (await (await fetch(`${A}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (path, m = 'GET', b, t = T) => {
  const r = await fetch(A + path, {
    method: m,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => null) }
}
const iso = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10) }

const chan = ((await req('/channels')).data.channels || (await req('/channels')).data)[0]?.key
const statuses = (await req('/statuses')).data
const finalSt = statuses.find((s) => s.is_final) || statuses[statuses.length - 1]
const firstSt = statuses[0]

// ================== 1) publishing answers every hand =====================
// A person's hand: somebody on the piece saying early that it will be late.
const one = (await req('/content', 'POST', {
  title: 'r81: the hand goes down', channels: [chan], type: 'video', release_date: iso(-9),
})).data
const raised = await req(`/content/${one.id}/flags`, 'POST', {
  kind: 'at_risk', reason: 'The venue moved us to next week and I cannot get the footage before then.',
})
ok('a hand goes up on a piece that is running late', raised.status === 201, `${raised.status}`)
ok('…and the planners see it in their queue',
  ((await req('/content/flags/open')).data || []).some((f) => f.content_id === one.id))

const pub = await req(`/content/${one.id}`, 'PATCH', { status_id: finalSt.id })
ok('the piece is published', pub.status === 200 && !!pub.data.done_at, `${pub.status} done_at=${pub.data?.done_at}`)
const after = (await req(`/content/${one.id}`)).data
ok('…and the hand comes down with it',
  (after.flags || []).length === 1 && !!after.flags[0].cleared_at, JSON.stringify(after.flags?.[0]))
ok('…crediting the finishing rather than whoever pressed the button',
  /finish/i.test(after.flags?.[0]?.cleared_name || ''), after.flags?.[0]?.cleared_name)
ok('…and it leaves the planners’ queue',
  !((await req('/content/flags/open')).data || []).some((f) => f.content_id === one.id))

// The board's own hand — raised_by NULL — is the one the bug was really about,
// because nobody is watching for it and nobody thinks to put it down.
const quiet = (await req('/content', 'POST', {
  title: 'r81: nobody said anything', channels: [chan], type: 'video', release_date: iso(-11),
})).data
await req(`/content/${quiet.id}`, 'PATCH', { assignee_id: 1 })
const swept = await fetch(`${BASE}/api/cron/daily`)
ok('the nightly sweep runs', swept.ok)
const boardHand = ((await req(`/content/${quiet.id}`)).data.flags || []).find((f) => !f.raised_by)
ok('…and the board raises its own hand on silently late work', !!boardHand, boardHand?.reason)
await req(`/content/${quiet.id}`, 'PATCH', { status_id: finalSt.id })
const quietAfter = (await req(`/content/${quiet.id}`)).data
ok('publishing puts the board’s hand down too',
  (quietAfter.flags || []).every((f) => !!f.cleared_at), JSON.stringify(quietAfter.flags))
ok('…so a finished piece is nowhere in the queue of open problems',
  !((await req('/content/flags/open')).data || []).some((f) => f.content_id === quiet.id))

// Everything else is left alone: this clears the hands on the piece that was
// finished, not every hand on the board.
const other = (await req('/content', 'POST', {
  title: 'r81: still going', channels: [chan], type: 'video', release_date: iso(-3),
})).data
await req(`/content/${other.id}/flags`, 'POST', {
  kind: 'cant_take', reason: 'I am on the conference shoot all week and cannot take this one on.',
})
await req(`/content/${one.id}`, 'PATCH', { title: 'r81: the hand goes down (edited)' })
ok('an unfinished piece keeps its hand up',
  ((await req('/content/flags/open')).data || []).some((f) => f.content_id === other.id))
ok('…and an ordinary edit to a finished piece clears nothing new',
  ((await req(`/content/${other.id}`)).data.flags || []).every((f) => !f.cleared_at))

// Sending it back out of the final stage does not resurrect an answered hand.
await req(`/content/${one.id}`, 'PATCH', { status_id: firstSt.id })
ok('un-publishing leaves the hand down', (await req(`/content/${one.id}`)).data.done_at === null)
ok('…and does not put it back up',
  ((await req(`/content/${one.id}`)).data.flags || []).every((f) => !!f.cleared_at))
// It can go up again, though — and should. The piece is back on the board,
// still past its day, and the earlier hand was answered by a publication that
// has been taken back. That is a new silence, not the old one.
await fetch(`${BASE}/api/cron/daily`)
const again = ((await req(`/content/${one.id}`)).data.flags || []).filter((f) => !f.cleared_at)
ok('…but a piece pulled back and still late is asked about afresh',
  again.length === 1 && !again[0].raised_by, JSON.stringify(again))

// =============== 1b) the same shape, in the other queues =================
// A queue that never empties is the bug, wherever it is kept. Two more had it.
const delSt = statuses.find((st) => /^deleted$/i.test(st.label))
const binned = (await req('/content', 'POST', {
  title: 'r81: binned with a hand up', channels: [chan], type: 'video', release_date: iso(-4),
})).data
await req(`/content/${binned.id}/flags`, 'POST', {
  kind: 'at_risk', reason: 'The interviewee cancelled and there is nothing to cut from yet.',
})
ok('a hand up on a live piece is in the queue',
  ((await req('/content/flags/open')).data || []).some((f) => f.content_id === binned.id))
await req(`/content/${binned.id}`, 'PATCH', { status_id: delSt.id })
ok('…and a piece dragged to the bin takes its hand with it',
  !((await req('/content/flags/open')).data || []).some((f) => f.content_id === binned.id))

// A task can end up with NO stage at all — status_id is nullable, and a
// deleted stage sets it null. It is not in the graveyard, so its hand must
// still be up: written as NOT IN, the filter would have dropped it silently.
const stageless = (await req('/content', 'POST', {
  title: 'r81: no stage at all', channels: [chan], type: 'video', release_date: iso(-4),
})).data
await req(`/content/${stageless.id}/flags`, 'POST', {
  kind: 'at_risk', reason: 'The kit is booked out all week and I cannot film this one.',
})
await req(`/content/${stageless.id}`, 'PATCH', { status_id: null })
const noStage = (await req(`/content/${stageless.id}`)).data
ok('a task can sit with no stage on it', noStage.status_id === null, `status_id=${noStage.status_id}`)
ok('…but not on a stage that does not exist',
  (await req(`/content/${stageless.id}`, 'PATCH', { status_id: 999999 })).status === 400)
ok('…and its hand is still up, not lost to a null',
  ((await req('/content/flags/open')).data || []).some((f) => f.content_id === stageless.id))

// The same for a day nobody answered about.
const planner = (await req('/users', 'POST', {
  name: 'Pulat Planner', username: 'r81plan', password: 'p1234',
  departments: [chan], permissions: { manage_content: true, move_tasks: true },
})).data
const TP = await login('r81plan', 'p1234')
const asked = (await req('/content', 'POST', {
  title: 'r81: asked then binned', channels: [chan], type: 'video', release_date: iso(5),
})).data
const why = 'The sponsor needs another week to approve the copy before we can run it.'
ok('a planner asks for the day to move',
  (await req(`/content/${asked.id}/date-requests`, 'POST', { field: 'release_date', to_date: iso(9), reason: why }, TP)).status === 201)
ok('…and an admin is asked to decide it',
  ((await req('/content/date-requests/open')).data || []).some((d) => d.content_id === asked.id))
await req(`/content/${asked.id}`, 'PATCH', { status_id: delSt.id })
ok('…and binning the piece takes the question away too',
  !((await req('/content/date-requests/open')).data || []).some((d) => d.content_id === asked.id))

// And publishing answers a day question the same way it answers a hand.
const ranAnyway = (await req('/content', 'POST', {
  title: 'r81: asked then published', channels: [chan], type: 'video', release_date: iso(5),
})).data
await req(`/content/${ranAnyway.id}/date-requests`, 'POST', { field: 'release_date', to_date: iso(9), reason: why }, TP)
await req(`/content/${ranAnyway.id}`, 'PATCH', { status_id: finalSt.id })
ok('a piece that went out stops asking an admin to move its day',
  !((await req('/content/date-requests/open')).data || []).some((d) => d.content_id === ranAnyway.id))
const dropped = ((await req(`/content/${ranAnyway.id}`)).data.date_requests || [])[0]
ok('…and the ask says why it was never decided',
  dropped?.state === 'stale' && /went out/.test(dropped?.decided_note || ''), JSON.stringify(dropped))

// ============ 1c) a booked day that has already gone by ==================
const shooter = (await req('/users', 'POST', {
  name: 'Otabek Operator', username: 'r81op', password: 'o1234', role: 'operator', crew_roles: ['operator'],
})).data
const TSH = await login('r81op', 'o1234')
await req('/content', 'POST', {
  title: 'r81: a Tuesday three weeks gone', channels: [chan], type: 'video',
  operator_id: shooter.id, recording_date: iso(-21), recording_time: '10:00', recording_end: '12:00',
})
await req('/content', 'POST', {
  title: 'r81: a day still ahead', channels: [chan], type: 'video',
  operator_id: shooter.id, recording_date: iso(4), recording_time: '10:00', recording_end: '12:00',
})

// ==================== 2) the rest, in the browser =========================
// This suite also covered the attendance register becoming a month grid. The
// register was removed in round 82; what follows is the half that still
// stands — the tray, a booked day that has gone by, and a person's rows going
// with them when they leave.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const errs = []
const signIn = async (pg, u, p) => {
  await pg.goto(`${BASE}/login`)
  await pg.fill('input[name=username]', u)
  await pg.fill('input[name=password]', p)
  await pg.click('button[type=submit]')
  await pg.waitForTimeout(2500)
}
await req('/users', 'POST', {
  name: 'Nodira Nobody', username: 'r81mem', password: 'n1234', departments: [chan],
})

// The tray asks about days still ahead, and stops nagging about days gone.
const crew = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
crew.on('pageerror', (e) => errs.push(`crew: ${e.message}`))
await signIn(crew, 'r81op', 'o1234')
await crew.waitForTimeout(1500)
const trayRows = await crew.locator('.ask-tray-row').count()
ok('the crew are asked about the day still ahead, and only that one', trayRows === 1, `${trayRows} rows`)
await crew.locator('.ask-tray-row').first().click()
await crew.waitForTimeout(2000)
ok('…and that one still offers both answers',
  (await crew.locator('.bk').first().locator('.btn').count()) === 2)
await crew.keyboard.press('Escape')
await crew.waitForTimeout(600)

// The day that went by is still on its task — it just stops asking.
const past = await browser.newPage({ viewport: { width: 1400, height: 900 } })
past.on('pageerror', (e) => errs.push(`past: ${e.message}`))
await signIn(past, 'admin', 'admin123')
await past.goto(`${BASE}/dept/${chan}`)
await past.waitForTimeout(3000)
await past.locator('.tcard', { hasText: 'three weeks gone' }).first().click()
await past.waitForTimeout(2000)
const goneCard = past.locator('.bk-gone').first()
ok('a booking whose day has passed says so instead of waiting', (await goneCard.count()) >= 1)
ok('…and offers nobody a yes to a day that is over',
  (await past.locator('.bk').first().locator('.btn').count()) === 0)

// A person who is gone takes their rows with them. The attendance half of
// this went with the register in round 82; the papers are the part that
// still matters — the Docs page reads person_docs with no join, so a document
// left behind goes on being listed under a name that no longer resolves.
const ghost = (await req('/users', 'POST', {
  name: 'Gulnora Gone', username: 'r81gone', password: 'g1234', departments: [chan],
})).data
await req('/docs', 'POST', {
  user_id: ghost.id, kind: 'sop', title: 'r81: their contract', file_name: 'contract.pdf',
  mime: 'application/pdf', data: 'data:application/pdf;base64,JVBERi0xLjQK', size: 12,
})
ok('their contract is on the shelf', ((await req('/docs?all')).data || []).some((d) => d.user_id === ghost.id))
ok('the person is removed', (await req(`/users/${ghost.id}`, 'DELETE')).status === 200)
ok('…and their papers go with them, rather than being listed under a name that no longer resolves',
  !((await req('/docs?all')).data || []).some((d) => d.user_id === ghost.id))

ok('no page threw', errs.length === 0, errs.slice(0, 3).join(' | '))
await browser.close()
srv.kill()
try { rmSync(dir, { recursive: true, force: true }) } catch { /* gone already */ }
console.log(fails ? `\n${fails} PROBLEMS` : '\nRound-81 suite clean.')
process.exit(fails ? 1 : 0)
