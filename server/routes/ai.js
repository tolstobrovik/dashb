import { Router } from 'express'
import { authRequired, adminOnly, wrap } from '../auth.js'
import { translate, simplify, review, insight, guessLang, configured, probe, cacheSize, clearCache, LANG_NAME, MODEL_KEYS } from '../ai.js'
import { saveAiKey, loadAiKeys } from '../db.js'

const router = Router()
router.use(authRequired)

// A brief is long, and a person who taps Translate twice should not pay for
// it twice. Per account, not per address: the limit is about the bill, and
// everybody on this board is a known person.
const RECENT = new Map()
const PER_MINUTE = 20
const gate = (req, res, next) => {
  const now = Date.now()
  const mine = (RECENT.get(req.user.id) || []).filter((t) => now - t < 60000)
  if (mine.length >= PER_MINUTE) {
    return res.status(429).json({ error: 'That is a lot of translating in one minute — give it a moment' })
  }
  mine.push(now)
  RECENT.set(req.user.id, mine)
  next()
}

// 20k characters is the longest script this board has ever held. Past that
// something has gone wrong upstream and a translator is not the fix.
const MAX = 20000
const readText = (req, res) => {
  const text = String(req.body?.text ?? '')
  if (!text.trim()) { res.status(400).json({ error: 'Nothing to work on' }); return null }
  if (text.length > MAX) { res.status(413).json({ error: `That is longer than ${MAX} characters` }); return null }
  return text
}

// What language is this, and does the reader need it changed? Asked by the
// client before it offers a Translate button, so nobody is invited to
// translate English into English.
router.post('/detect', wrap(async (req, res) => {
  const text = String(req.body?.text ?? '')
  res.json({ lang: guessLang(text), known: Object.keys(LANG_NAME) })
}))

router.post('/translate', gate, wrap(async (req, res) => {
  const text = readText(req, res)
  if (text === null) return
  const to = String(req.body?.to || '')
  try {
    res.json(await translate(text, to, { from: req.body?.from || null }))
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message, tried: e.tried || [] })
  }
}))

router.post('/simplify', gate, wrap(async (req, res) => {
  const text = readText(req, res)
  if (text === null) return
  try {
    res.json(await simplify(text, String(req.body?.lang || 'en')))
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message })
  }
}))

// ---- is this brief usable? ----
// Asked by the task sheet as somebody types, and by nothing else. It ADVISES:
// there is no status code here that means "refused", because a board that
// rejects work on a reading is a board that stops working when the reading
// does.
//
// Not rate-limited by the translation gate. The mechanical half costs nothing
// and runs with no key at all, so a person typing a brief must never be told
// to come back in a minute — the client is what decides when to ask, and it
// asks when they stop typing.
router.post('/review', wrap(async (req, res) => {
  const text = String(req.body?.text ?? '')
  if (text.length > MAX) return res.status(413).json({ error: `That is longer than ${MAX} characters` })
  const kind = /^[a-z_]{1,20}$/.test(String(req.body?.kind || '')) ? String(req.body.kind) : 'video'
  try {
    // `tried` names every provider and whether it holds a key. That is the
    // admin's business (GET /status answers it) and nobody else's, so it is
    // dropped here rather than handed to every person typing a brief.
    const { tried: _t, ...out } = await review(text, { lang: String(req.body?.lang || 'en'), kind })
    res.json(out)
  } catch (e) {
    // A reader that fails is not an error the person typing should see.
    res.json({ verdict: 'ok', flags: [], missing: [], say: '', provider: 'none', error: e.message })
  }
}))

// ---- what do these numbers say? ----
// The digest is built by the server that already computed it and handed
// straight through, so nothing here decides what the model gets to see.
router.post('/insight', gate, wrap(async (req, res) => {
  const digest = req.body?.digest
  if (!digest || typeof digest !== 'object') return res.status(400).json({ error: 'Nothing to read' })
  if (JSON.stringify(digest).length > 8000) return res.status(413).json({ error: 'That digest is too big to read' })
  try {
    const { tried: _t, ...out } = await insight(digest, { lang: String(req.body?.lang || 'en') })
    res.json(out)
  } catch (e) {
    res.json({ points: [], provider: 'none', error: e.message })
  }
}))

// ---- the admin's view of what this costs ----
router.get('/status', adminOnly, wrap(async (_req, res) => {
  res.json({ ...configured(), cached: await cacheSize() })
}))
// Really calls each one with two words, because "is a key set" and "does it
// work from here" are different questions and only the second one matters.
router.post('/probe', adminOnly, wrap(async (_req, res) => {
  res.json({ results: await probe() })
}))
router.delete('/cache', adminOnly, wrap(async (_req, res) => {
  await clearCache()
  res.json({ ok: true })
}))

// ---- keys an admin can type in ----
// The board runs on a host somebody else administers, so "set an environment
// variable" was advice nobody could take and every provider read "no key"
// forever. A key typed here is stored and used; the environment still wins
// over it, and the value is never sent back to any browser.
router.put('/keys/:provider', adminOnly, wrap(async (req, res) => {
  const env = MODEL_KEYS[req.params.provider]
  if (!env) return res.status(404).json({ error: 'No such provider' })
  const value = String(req.body?.key ?? '').trim()
  if (value) {
    // A key with spaces or newlines in it is a paste accident, and the error
    // it causes later reads as "the provider is down".
    if (/\s/.test(value)) return res.status(400).json({ error: 'That key has a space in it — check the paste' })
    if (value.length < 12) return res.status(400).json({ error: 'That is too short to be a key' })
    await saveAiKey(env, value)
  } else {
    await saveAiKey(env, null)
  }
  await loadAiKeys()
  res.json({ ...configured(), cached: await cacheSize() })
}))

export default router
