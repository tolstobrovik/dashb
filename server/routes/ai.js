import { Router } from 'express'
import { authRequired, adminOnly, wrap } from '../auth.js'
import { translate, simplify, guessLang, configured, probe, cacheSize, clearCache, LANG_NAME } from '../ai.js'

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

export default router
