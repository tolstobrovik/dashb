// Round 80: the admin is not made to fill in a form, the register has a door,
// and booked time is answered by the person who has to be there.
//
// Three asks, one suite, because they are one idea: the board was making the
// wrong people do the typing. The rules that stop half-briefed work going out
// were being applied to the person who wrote them; the lateness register was
// built and then hidden as tab eight of eleven; and a shoot day was a fact the
// moment somebody typed it, with the camera operator finding out on the day.
//
// Brings its own server on 4131 so it can be run alone.
import { spawn } from 'child_process'
import { chromium } from 'playwright'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const PORT = 4131
const BASE = `http://localhost:${PORT}`
const A = `${BASE}/api`
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const dir = mkdtempSync(join(tmpdir(), 'r80-'))
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const srv = spawn('node', [join(ROOT, 'server/index.js')],
  { env: { ...process.env, DATA_DIR: dir, PORT: String(PORT) }, stdio: 'ignore' })
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
const shootSt = statuses.find((s) => /shoot/i.test(s.label))
const readySt = statuses.find((s) => /ready/i.test(s.label))

// ============================ 1) the superuser ============================
// Demand every brief field of a video, then make one with none of them.
const demand = {}
for (const f of ['format', 'rubrika', 'script', 'reference', 'description']) demand[f] = { state: 'required', types: ['video', 'post'] }
await req('/fields', 'POST', demand)
const eff = (await req('/fields')).data
ok('every brief field is demanded of a video',
  ['format', 'rubrika', 'script', 'reference', 'description'].every((f) => eff[f]?.state === 'required'))

const bare = await req('/content', 'POST', { title: 'r80: nothing filled in', channels: [chan], type: 'video' })
ok('an admin makes a task with none of them', bare.status === 201, `${bare.status} ${bare.data?.error || ''}`)
const booked = await req('/content', 'POST', { title: 'r80: booked with nothing', channels: [chan], type: 'video', status_id: shootSt?.id })
ok('…and books a shoot with no shooter, no dates and no brief', booked.status === 201, `${booked.status} ${booked.data?.error || ''}`)
const moved = await req(`/content/${bare.data.id}`, 'PATCH', { status_id: readySt?.id })
ok('…and drags it to Ready past both walls', moved.status === 200, `${moved.status} ${moved.data?.error || ''}`)
ok('…and is asked nothing at the handover',
  ((await req(`/content/${bare.data.id}/handover?to=${readySt?.id}`)).data?.gates || []).length === 0)
ok('…and can empty a field the rules demand',
  (await req(`/content/${bare.data.id}`, 'PATCH', { script: '', format: '' })).status === 200)

// The rules still exist. They are for everybody else.
const mem = (await req('/users', 'POST', {
  name: 'Malika Member', username: 'r80mem', password: 'm1234',
  departments: [chan], permissions: { manage_content: true, move_tasks: true },
})).data
const TM = await login('r80mem', 'm1234')
const theirs = await req('/content', 'POST', { title: 'r80: a member tries it', channels: [chan], type: 'video' }, TM)
ok('a member is still asked for the brief', theirs.status === 400, `${theirs.status} ${theirs.data?.error || ''}`)
// put the rules back so the rest of the suite is not fighting them
await req('/fields', 'POST', Object.fromEntries(Object.keys(demand).map((f) => [f, { state: 'optional', types: ['video', 'post'] }])))

// ======================= 2) booked time, answered ========================
const op = (await req('/users', 'POST', { name: 'Olim Operator', username: 'r80op', password: 'o1234', role: 'operator', crew_roles: ['operator'] })).data
const ed = (await req('/users', 'POST', { name: 'Elyor Editor', username: 'r80ed', password: 'e1234', role: 'operator', crew_roles: ['editor'] })).data
const TO = await login('r80op', 'o1234')
const TE = await login('r80ed', 'e1234')

const t = (await req('/content', 'POST', {
  title: 'r80: campus tour', channels: [chan], type: 'video',
  operator_id: op.id, recording_date: iso(3), recording_time: '14:00', recording_end: '16:00',
  editor_id: ed.id, edit_ready_date: iso(6), release_date: iso(8),
})).data
ok('a fresh booking is waiting on an answer', t.shoot_ack === '' && t.edit_ack === '', `shoot=${t.shoot_ack} edit=${t.edit_ack}`)
ok('the editor cannot answer for the shoot',
  (await req(`/content/${t.id}/confirm`, 'POST', { which: 'shoot', ok: true }, TE)).status === 403)
ok('nor can an admin answer on the operator’s behalf',
  (await req(`/content/${t.id}/confirm`, 'POST', { which: 'shoot', ok: true })).status === 403)

const yes = await req(`/content/${t.id}/confirm`, 'POST', { which: 'shoot', ok: true }, TO)
ok('the operator confirms the shoot', yes.status === 200 && yes.data.shoot_ack === 'yes', `${yes.status}`)
ok('…stamped with who said so and when', !!yes.data.shoot_ack_at && yes.data.shoot_ack_by === op.id)

ok('a planner cannot move a slot that was agreed to',
  (await req(`/content/${t.id}`, 'PATCH', { recording_time: '09:00' }, TM)).status === 409)
const adminMove = await req(`/content/${t.id}`, 'PATCH', { recording_time: '09:00' })
ok('an admin can move it', adminMove.status === 200, `${adminMove.status} ${adminMove.data?.error || ''}`)
ok('…and the tick does not survive the move', adminMove.data.shoot_ack === '', `ack=${adminMove.data.shoot_ack}`)
ok('…and the operator is asked again',
  ((await req('/notifications', 'GET', null, TO)).data?.events || []).some((n) => /Can you make/.test(n.text || '')))

ok('a no with no reason is refused',
  (await req(`/content/${t.id}/confirm`, 'POST', { which: 'edit', ok: false }, TE)).status === 400)
const no = await req(`/content/${t.id}/confirm`, 'POST', { which: 'edit', ok: false, note: 'Two cuts due the same day' }, TE)
ok('the editor declines, with the reason kept',
  no.status === 200 && no.data.edit_ack === 'no' && /Two cuts/.test(no.data.edit_ack_note || ''), `${no.status}`)
ok('whoever booked it hears the no',
  ((await req('/notifications')).data?.events || []).some((n) => /can.t make/i.test(n.text || '')))
const idea = (await req('/content', 'POST', { title: 'r80: just an idea', channels: [chan], type: 'video' })).data
ok('an unbooked task owes nobody an answer',
  (await req(`/content/${idea.id}/confirm`, 'POST', { which: 'shoot', ok: true }, TO)).status === 400)

// ===================== 3) the register has a door ========================
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const errs = []
const signIn = async (pg, u, p) => {
  await pg.goto(`${BASE}/login`)
  await pg.fill('input[name=username]', u)
  await pg.fill('input[name=password]', p)
  await pg.click('button[type=submit]')
  await pg.waitForTimeout(2500)
}
const admin = await browser.newPage({ viewport: { width: 1400, height: 900 } })
admin.on('pageerror', (e) => errs.push(`admin: ${e.message}`))
await signIn(admin, 'admin', 'admin123')
ok('the register has a door in the sidebar',
  (await admin.locator('.sidebar .nav-item', { hasText: /Attendance|Посещаемость|Davomat/ }).count()) === 1)
await admin.goto(`${BASE}/attendance`)
await admin.waitForTimeout(1800)
ok('…which opens a page of people', (await admin.locator('table.tbl tbody tr').count()) > 0)
ok('…where an admin marks who was late', (await admin.locator('.at-states .pill').count()) > 0)

const member = await browser.newPage({ viewport: { width: 1400, height: 900 } })
member.on('pageerror', (e) => errs.push(`member: ${e.message}`))
await signIn(member, 'r80mem', 'm1234')
await member.goto(`${BASE}/attendance`)
await member.waitForTimeout(1800)
ok('the team can read the register', (await member.locator('table.tbl tbody tr').count()) > 0)
ok('…and cannot write to it', (await member.locator('.at-states .pill').count()) === 0)

// ---- and the crew see what they owe an answer on, where they already look --
const crew = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
crew.on('pageerror', (e) => errs.push(`crew: ${e.message}`))
await signIn(crew, 'r80op', 'o1234')
await crew.waitForTimeout(1200)
ok('the operator is asked on My Day, not in their inbox',
  (await crew.locator('.ask-tray-row').count()) >= 1, `${await crew.locator('.ask-tray-row').count()} rows`)
await crew.locator('.ask-tray-row').first().click()
await crew.waitForTimeout(2000)
// Two slots on this task — the shoot they hold and the edit somebody else
// does — so two cards. Theirs is the first, and it is the one with buttons.
ok('…and the row opens the task it is about', (await crew.locator('.modal .bk').count()) >= 1,
  `${await crew.locator('.modal .bk').count()} cards`)
const words = (await crew.locator('.bk').first().textContent()).replace(/\s+/g, ' ')
ok('…showing the slot, its length and who it is waiting on',
  /\d\d:\d\d/.test(words) && /Waiting|Ждём|kutil/i.test(words), words.slice(0, 90))
ok('…with the two answers on it, and only on their own slot',
  (await crew.locator('.bk').first().locator('.btn').count()) === 2
  && (await crew.locator('.bk').nth(1).locator('.btn').count()) === 0)

ok('no page threw', errs.length === 0, errs.slice(0, 3).join(' | '))
await browser.close()
srv.kill()
try { rmSync(dir, { recursive: true, force: true }) } catch { /* gone already */ }
console.log(fails ? `\n${fails} PROBLEMS` : '\nRound-80 suite clean.')
process.exit(fails ? 1 : 0)
