import { Router } from 'express'
import { all, get, run } from '../db.js'
import { authRequired, wrap, isFullAdmin } from '../auth.js'

// The ambassador programme.
//
// ISOLATION. This router owns three tables — ambassadors, ambassador_cards,
// ambassador_payouts — and reads exactly one thing outside them: the users
// table, for a name. It writes to nothing else. An ambassador card is not a
// content task: it never reaches a channel board, is counted in no company
// total, and its money is not Finance. Delete these three tables and the rest
// of the dashboard is unchanged.
//
// PERMISSION. Two audiences and no third. An ambassador sees their own cards
// and nothing else; whoever RUNS THE PROGRAMME sees everyone.
//
// Running it used to mean being an admin of the whole board, which made the
// job impossible to hand to the person actually doing it: checking students'
// posts and signing new ones up does not need the power to delete a channel
// or rewrite the pipeline. It is a permission now — `manage_ambassadors`,
// off by default — so an admin can give exactly this job away and nothing
// else with it. A full admin still has it by virtue of being one.
//
// The refusal that keeps an ambassador out of the rest of the dashboard is in
// auth.js, at the one place every authenticated request passes through — not
// here, and not in a sidebar.
const router = Router()
router.use(authRequired)

const now = () => new Date().toISOString()
const isAdmin = (user) => isFullAdmin(user) || !!(user?.permissions && user.permissions.manage_ambassadors)

// The five states, and the only moves between them. A card that is paid is
// finished for ever: there is no way back and no route that offers one.
const STATES = ['waiting', 'can_film', 'needs_changes', 'posted', 'done', 'paid']

// Tashkent, like every other date on this board. A month is what somebody in
// the office would call today, not what UTC would.
const TZ_OFFSET = 5 * 3600e3
const monthNow = () => new Date(Date.now() + TZ_OFFSET).toISOString().slice(0, 7)
const dayNow = () => new Date(Date.now() + TZ_OFFSET).toISOString().slice(0, 10)

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))
const clean = (v, max) => String(v ?? '').trim().slice(0, max)
// A reference is optional, but a reference that is not a link is not a
// reference — it is a word somebody typed into the wrong box.
const linkProblem = (v) => {
  try {
    const u = new URL(String(v))
    return u.protocol === 'http:' || u.protocol === 'https:' ? null : 'A link has to start with http:// or https://'
  } catch { return 'A link has to start with http:// or https://' }
}

// ---- who is asking -----------------------------------------------------------
const meAsAmbassador = (userId) => get('SELECT * FROM ambassadors WHERE user_id = ?', userId)

const cardOut = (c) => ({
  id: c.id,
  ambassador_id: c.ambassador_id,
  format: c.format,
  script: c.script,
  reference_url: c.reference_url,
  planned_date: c.planned_date,
  state: c.state,
  version: c.version,
  we_edit: !!c.we_edit,
  posts_own: !!c.posts_own,
  collaborator: !!c.collaborator,
  terms_other: c.terms_other || '',
  amount: c.amount == null ? null : Number(c.amount),
  approved_by: c.approved_by,
  approved_at: c.approved_at,
  feedback: c.feedback,
  main_video_url: c.main_video_url,
  story_clip_url: c.story_clip_url,
  posted_at: c.posted_at,
  checked_at: c.checked_at,
  paid_month: c.paid_month,
  created_at: c.created_at,
  updated_at: c.updated_at,
})

const personOut = (a, user) => ({
  id: a.id,
  user_id: a.user_id,
  name: user?.name || 'Someone who left',
  university: a.university,
  telegram: a.telegram,
  status: a.status,
  default_we_edit: !!a.default_we_edit,
  default_posts_own: !!a.default_posts_own,
  default_collaborator: !!a.default_collaborator,
  default_terms_other: a.default_terms_other || '',
  // The bytes are never sent with a list. The file is fetched by its own
  // route when somebody actually opens it.
  contract_name: a.contract_name || '',
  has_contract: !!a.contract_data,
  created_at: a.created_at,
})

// The month a card counts for, and the money in it. Both sides read this so
// the two numbers on the ambassador's page and the admin's arithmetic can
// never disagree.
const inMonth = (cards, month) => cards.filter((c) => String(c.paid_month || '') === month)
const earned = (cards) => cards.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)

// ---- the ambassador's own page -----------------------------------------------
// One request builds their whole screen: their two numbers, their cards, and
// their details. Nobody else's anything.
router.get('/me', wrap(async (req, res) => {
  const me = await meAsAmbassador(req.user.id)
  if (!me) return res.status(404).json({ error: 'You are not set up as an ambassador yet' })
  const cards = (await all(
    'SELECT * FROM ambassador_cards WHERE ambassador_id = ? ORDER BY created_at DESC, id DESC', me.id)).map(cardOut)
  const month = monthNow()
  const posted = cards.filter((c) => ['posted', 'done', 'paid'].includes(c.state) && String(c.paid_month || month) === month)
  res.json({
    person: personOut(me, req.user),
    month,
    posted_this_month: cards.filter((c) => ['done', 'paid'].includes(c.state) && c.paid_month === month).length,
    earned_this_month: earned(inMonth(cards, month)),
    cards,
    // Unused by the page, kept so the shape does not change under step two.
    open_posted: posted.length,
  })
}))

// Sending an idea. Four fields, one of which is optional.
router.post('/me/cards', wrap(async (req, res) => {
  const me = await meAsAmbassador(req.user.id)
  if (!me) return res.status(403).json({ error: 'You are not set up as an ambassador yet' })
  if (me.status !== 'active') return res.status(403).json({ error: 'Your account is paused' })
  const b = req.body || {}
  const format = clean(b.format, 60)
  const script = clean(b.script, 20000)
  const reference = clean(b.reference_url, 500)
  const planned = clean(b.planned_date, 10)
  if (!format) return res.status(400).json({ error: 'Say what kind of video this is' })
  if (script.length < 40) return res.status(400).json({ error: 'Tell us what happens in the video — a few sentences' })
  if (reference) { const bad = linkProblem(reference); if (bad) return res.status(400).json({ error: bad }) }
  if (planned && !isDay(planned)) return res.status(400).json({ error: 'A date is YYYY-MM-DD' })
  const stamp = now()
  await run(`
    INSERT INTO ambassador_cards (ambassador_id, format, script, reference_url, planned_date, state, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'waiting', 1, ?, ?)
  `, me.id, format, script, reference || '', planned || null, stamp, stamp)
  res.status(201).json({ ok: true })
}))

// Sending it again after a change was asked for. The SAME card: version goes
// up and it returns to waiting, so the whole argument stays in one place
// instead of leaving a trail of abandoned rows nobody can line up afterwards.
router.patch('/me/cards/:id', wrap(async (req, res) => {
  const me = await meAsAmbassador(req.user.id)
  if (!me) return res.status(403).json({ error: 'You are not set up as an ambassador yet' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card || card.ambassador_id !== me.id) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'needs_changes')
    return res.status(409).json({ error: 'This one is not waiting on you' })
  const b = req.body || {}
  const format = clean(b.format ?? card.format, 60)
  const script = clean(b.script ?? card.script, 20000)
  const reference = clean(b.reference_url ?? card.reference_url, 500)
  const planned = clean(b.planned_date ?? card.planned_date ?? '', 10)
  if (!format) return res.status(400).json({ error: 'Say what kind of video this is' })
  if (script.length < 40) return res.status(400).json({ error: 'Tell us what happens in the video — a few sentences' })
  if (reference) { const bad = linkProblem(reference); if (bad) return res.status(400).json({ error: bad }) }
  if (planned && !isDay(planned)) return res.status(400).json({ error: 'A date is YYYY-MM-DD' })
  await run(`
    UPDATE ambassador_cards
       SET format = ?, script = ?, reference_url = ?, planned_date = ?,
           state = 'waiting', version = version + 1, feedback = '', updated_at = ?
     WHERE id = ?
  `, format, script, reference || '', planned || null, now(), card.id)
  res.json({ ok: true })
}))

// ---- "I filmed it and it is live" --------------------------------------------
// The half of this flow that was never built. A card was approved and then
// stopped: the ambassador had nowhere to say they had done it, so the only
// thing they could do next was ask for ANOTHER video, and the states after
// can_film were unreachable in a programme that is entirely about them.
//
// The link is the work. It is what gets checked, and it is what the money is
// for, so it is required and it has to be a link.
router.post('/me/cards/:id(\\d+)/posted', wrap(async (req, res) => {
  const me = await meAsAmbassador(req.user.id)
  if (!me) return res.status(403).json({ error: 'You are not set up as an ambassador yet' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card || card.ambassador_id !== me.id) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'can_film')
    return res.status(409).json({ error: 'This one is not one you have been told you can film' })
  const main = clean(req.body?.main_video_url, 500)
  const story = clean(req.body?.story_clip_url, 500)
  if (!main) return res.status(400).json({ error: 'Paste the link to the post — that is what we check' })
  const bad = linkProblem(main)
  if (bad) return res.status(400).json({ error: bad })
  if (story) { const b2 = linkProblem(story); if (b2) return res.status(400).json({ error: b2 }) }
  const stamp = now()
  await run(`
    UPDATE ambassador_cards
       SET state = 'posted', main_video_url = ?, story_clip_url = ?, posted_at = ?, feedback = '', updated_at = ?
     WHERE id = ?
  `, main, story, stamp, stamp, card.id)
  res.json({ ok: true })
}))

// ---- checking it, and paying for it ------------------------------------------
// DONE. Somebody opened the link and it is really there. This is the moment
// the card counts for a month and for somebody's money, so the month is
// stamped HERE and never moves again — a card checked in September belongs to
// September however long the payment takes.
router.post('/cards/:id(\\d+)/done', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'posted') return res.status(409).json({ error: 'This card has not been posted yet' })
  const stamp = now()
  await run(`
    UPDATE ambassador_cards
       SET state = 'done', checked_by = ?, checked_at = ?, paid_month = COALESCE(paid_month, ?), updated_at = ?
     WHERE id = ?
  `, req.user.id, stamp, monthNow(), stamp, card.id)
  res.json({ ok: true })
}))

// NOT RIGHT. The post is up but it is not what was agreed — the wrong cut, the
// wrong tag, the wrong account. Back to can_film with a reason, because they
// already have permission to film it; what they need is to fix and re-post.
router.post('/cards/:id(\\d+)/repost', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'posted') return res.status(409).json({ error: 'This card has not been posted yet' })
  const feedback = clean(req.body?.feedback, 2000)
  if (!feedback) return res.status(400).json({ error: 'Say what is wrong with it' })
  await run(`
    UPDATE ambassador_cards SET state = 'can_film', feedback = ?, updated_at = ? WHERE id = ?
  `, feedback, now(), card.id)
  res.json({ ok: true })
}))

// PAID. Paying happens outside this system; this records that somebody said it
// had been. There is no way back from here, on purpose.
router.post('/cards/:id(\\d+)/paid', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'done') return res.status(409).json({ error: 'Only a checked video can be marked paid' })
  await run("UPDATE ambassador_cards SET state = 'paid', updated_at = ? WHERE id = ?", now(), card.id)
  res.json({ ok: true })
}))

// ---- one person, whole ---------------------------------------------------------
// Everything about one ambassador in one request: their details and every card
// they have ever sent. This is what "let me look at their account" means here
// — the same rows they see, read-only, without anybody having to log in as
// somebody else. Signing in as another person is a thing that should not be
// buildable on a board that records who did what.
router.get('/person/:userId(\\d+)/cards', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const a = await get('SELECT * FROM ambassadors WHERE user_id = ?', req.params.userId)
  if (!a) return res.status(404).json({ error: 'That person is not set up yet' })
  const u = await get('SELECT id, name FROM users WHERE id = ?', a.user_id)
  const cards = (await all(
    'SELECT * FROM ambassador_cards WHERE ambassador_id = ? ORDER BY created_at DESC, id DESC', a.id)).map(cardOut)
  const month = monthNow()
  res.json({
    person: personOut(a, u),
    month,
    cards,
    // The two numbers their own page shows them, worked out the same way, so
    // the admin and the ambassador are never looking at different totals.
    posted_this_month: cards.filter((c) => ['done', 'paid'].includes(c.state) && c.paid_month === month).length,
    earned_this_month: earned(inMonth(cards, month)),
    earned_all_time: earned(cards.filter((c) => ['done', 'paid'].includes(c.state))),
    done_all_time: cards.filter((c) => ['done', 'paid'].includes(c.state)).length,
  })
}))

// ---- the contract --------------------------------------------------------------
// Uploaded as a data URL, the way person_docs does it. A contract is the one
// piece of paper this programme actually has, and there was no way to put it
// anywhere.
const CONTRACT_MAX = 8 * 1024 * 1024   // 8MB of base64, about 6MB of file
router.put('/person/:userId(\\d+)/contract', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const a = await get('SELECT * FROM ambassadors WHERE user_id = ?', req.params.userId)
  if (!a) return res.status(404).json({ error: 'Set this person up first' })
  const name = clean(req.body?.name, 200)
  const data = String(req.body?.data || '')
  if (!name || !data) return res.status(400).json({ error: 'Pick a file' })
  if (!/^data:[^;]*;base64,/.test(data)) return res.status(400).json({ error: 'That file did not come through' })
  if (data.length > CONTRACT_MAX) return res.status(413).json({ error: 'That file is too big — 6MB is the limit' })
  const mime = clean(req.body?.mime, 120) || (data.match(/^data:([^;]*);/) || [])[1] || ''
  await run(`
    UPDATE ambassadors SET contract_name = ?, contract_mime = ?, contract_data = ?,
           contract_size = ?, contract_at = ?, updated_at = ? WHERE id = ?
  `, name, mime, data, data.length, now(), now(), a.id)
  res.json({ ok: true })
}))

router.delete('/person/:userId(\\d+)/contract', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const a = await get('SELECT * FROM ambassadors WHERE user_id = ?', req.params.userId)
  if (!a) return res.status(404).json({ error: 'No such ambassador' })
  await run(`
    UPDATE ambassadors SET contract_name = '', contract_mime = '', contract_data = NULL,
           contract_size = 0, contract_at = NULL, updated_at = ? WHERE id = ?
  `, now(), a.id)
  res.json({ ok: true })
}))

// Their contract, opened in a new tab. An ambassador may fetch their own; an
// admin may fetch anybody's. Nobody may fetch somebody else's.
router.get('/:id(\\d+)/contract', wrap(async (req, res) => {
  const a = await get('SELECT * FROM ambassadors WHERE id = ?', req.params.id)
  if (!a) return res.status(404).json({ error: 'No such ambassador' })
  if (!isAdmin(req.user) && a.user_id !== req.user.id)
    return res.status(403).json({ error: 'That is not yours' })
  if (!a.contract_data) return res.status(404).json({ error: 'No contract has been uploaded yet' })
  res.json({ name: a.contract_name, mime: a.contract_mime, data: a.contract_data })
}))

// ---- the admin's render ------------------------------------------------------
// Everything the admin page needs, in one request: the people, and the inbox.
router.get('/', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const people = await all('SELECT * FROM ambassadors ORDER BY id')
  const users = await all("SELECT id, name, role FROM users WHERE role = 'ambassador' ORDER BY name")
  const byId = Object.fromEntries(users.map((u) => [u.id, u]))
  const cards = (await all('SELECT * FROM ambassador_cards ORDER BY created_at, id')).map(cardOut)

  const month = monthNow()
  const perPerson = {}
  for (const c of cards) (perPerson[c.ambassador_id] ||= []).push(c)

  // Waiting on US, oldest first: how long somebody has been waiting is the
  // only thing that decides what to open next.
  //
  // TWO kinds wait on us, not one. An idea waiting for a yes, and a video
  // somebody has already filmed and posted, waiting for us to look at it. The
  // second kind was invisible here — which is why the programme appeared to
  // end at "you can film this" and the work nobody had checked simply piled
  // up where nobody was looking.
  const inbox = cards
    .filter((c) => c.state === 'waiting' || c.state === 'posted')
    .map((c) => {
      const a = people.find((p) => p.id === c.ambassador_id)
      return {
        ...c,
        kind: c.state === 'posted' ? 'posted' : 'idea',
        name: byId[a?.user_id]?.name || 'Someone who left',
        university: a?.university || '',
        defaults: {
          we_edit: !!a?.default_we_edit,
          posts_own: !!a?.default_posts_own,
          collaborator: !!a?.default_collaborator,
          terms_other: a?.default_terms_other || '',
        },
        // The last three amounts this person was paid, as plain text beside
        // the box. Never pre-filled: a number that fills itself in is a number
        // nobody decided.
        recent_amounts: (perPerson[c.ambassador_id] || [])
          .filter((x) => x.amount != null)
          .sort((x, y) => String(y.approved_at || '').localeCompare(String(x.approved_at || '')))
          .slice(0, 3)
          .map((x) => x.amount),
        waiting_since: c.state === 'posted' ? (c.posted_at || c.updated_at) : c.updated_at,
      }
    })
    .sort((a, b) => String(a.waiting_since).localeCompare(String(b.waiting_since)))

  res.json({
    month,
    today: dayNow(),
    people: people.map((a) => {
      const mine = perPerson[a.id] || []
      return {
        ...personOut(a, byId[a.user_id]),
        sent: mine.filter((c) => String(c.created_at).slice(0, 7) === month).length,
        approved: mine.filter((c) => String(c.approved_at || '').slice(0, 7) === month).length,
        posted: mine.filter((c) => ['done', 'paid'].includes(c.state) && c.paid_month === month).length,
      }
    }),
    // Accounts made in user management that nobody has set up yet. They are
    // not ambassadors until somebody says which university they are at.
    unset: users.filter((u) => !people.some((a) => a.user_id === u.id)).map((u) => ({ user_id: u.id, name: u.name })),
    inbox,
  })
}))

// Setting somebody up, and changing their details afterwards. University,
// contract and status live here rather than in the user form: the user form
// makes an account, and an account is not a programme.
router.put('/person/:userId(\\d+)', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const userId = Number(req.params.userId)
  const u = await get('SELECT id, role FROM users WHERE id = ?', userId)
  if (!u) return res.status(404).json({ error: 'No such person' })
  if (u.role !== 'ambassador')
    return res.status(400).json({ error: 'That account is not an ambassador — change their role first' })
  const b = req.body || {}
  const status = ['active', 'paused', 'ended'].includes(b.status) ? b.status : 'active'
  const university = clean(b.university, 120)
  const telegram = clean(b.telegram, 80)
  const flags = [b.default_we_edit ? 1 : 0, b.default_posts_own ? 1 : 0, b.default_collaborator ? 1 : 0]
  const termsOther = clean(b.default_terms_other, 400)
  const existing = await get('SELECT id FROM ambassadors WHERE user_id = ?', userId)
  const stamp = now()
  if (existing) {
    await run(`
      UPDATE ambassadors SET university = ?, telegram = ?, default_we_edit = ?, default_posts_own = ?,
             default_collaborator = ?, default_terms_other = ?, status = ?, updated_at = ? WHERE id = ?
    `, university, telegram, ...flags, termsOther, status, stamp, existing.id)
  } else {
    await run(`
      INSERT INTO ambassadors (user_id, university, telegram, default_we_edit, default_posts_own,
                               default_collaborator, default_terms_other, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, userId, university, telegram, ...flags, termsOther, status, stamp, stamp)
  }
  res.json({ ok: true })
}))

// ---- the two decisions -------------------------------------------------------
// APPROVE. This is the moment the promise is made, so this is the moment the
// terms stop being editable. The amount and the three flags are COPIED onto
// the card; the ambassador record can be changed afterwards a hundred times
// and this card will still say what it said.
//
// There is no rate table and no arithmetic. The amount is typed by a person,
// every time, because a number a machine worked out is a number nobody has
// agreed to.
router.post('/cards/:id(\\d+)/approve', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'waiting') return res.status(409).json({ error: 'This card is not waiting for an answer' })
  const b = req.body || {}
  const amount = Number(b.amount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9)
    return res.status(400).json({ error: 'Type the amount for this video' })
  await run(`
    UPDATE ambassador_cards
       SET state = 'can_film', we_edit = ?, posts_own = ?, collaborator = ?, terms_other = ?, amount = ?,
           approved_by = ?, approved_at = ?, feedback = '', updated_at = ?
     WHERE id = ?
  `, b.we_edit ? 1 : 0, b.posts_own ? 1 : 0, b.collaborator ? 1 : 0, clean(b.terms_other, 400), Math.round(amount),
  req.user.id, now(), now(), card.id)
  res.json({ ok: true })
}))

// NEEDS CHANGES. The feedback is the whole point — a refusal with nothing
// behind it is a person left guessing — so the server asks for it too, and
// not just the form.
router.post('/cards/:id(\\d+)/changes', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'waiting') return res.status(409).json({ error: 'This card is not waiting for an answer' })
  const feedback = clean(req.body?.feedback, 2000)
  if (!feedback) return res.status(400).json({ error: 'Say what needs changing' })
  await run(`
    UPDATE ambassador_cards SET state = 'needs_changes', feedback = ?, updated_at = ? WHERE id = ?
  `, feedback, now(), card.id)
  res.json({ ok: true })
}))

export default router
