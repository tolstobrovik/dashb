// Reading somebody else's ТЗ.
//
// The team writes briefs in three languages and reads them in three. A
// shooter who reads Uzbek gets a script written in Russian, decides it is
// roughly about a courtyard, and films the wrong thing — and the board, which
// has been strict about whether a script EXISTS, has never once cared whether
// the person holding it can read it.
//
// Two jobs, and they are different:
//
//   translate  the same words, in the reader's language
//   simplify   the same instructions, in plainer words — for a brief that is
//              in your language and still impenetrable, which is most of them
//
// WHO DOES THE WORK. Whatever is available, best first. A real model if the
// board has a key for one; a free translation service if not; and for
// simplify, when there is no model at all, a deterministic plain-language
// pass that is honest about being one. Every answer says which of them
// produced it, and the client shows that, because "an AI wrote this" and "a
// regular expression split your sentences" should never look the same.
//
// NOTHING IS GUESSED ABOUT COST. A key is used only if somebody put it there.
// No key, no charge, and the free path still works.

import { createHash } from 'crypto'
import { all, get, run } from './db.js'
import * as cfg from './config.js'

// Where a key comes from, in order.
//
// The environment always wins, because whoever sets one there meant it. Then
// what an admin typed into the panel, then config.js. The panel exists
// because on this deployment nobody can set an environment variable: the
// board runs on a host somebody else administers, so "no key" was a dead end
// with no door out of it.
//
// Kept in memory because secret() is called on every request and reading the
// database for it would be silly. Filled at boot and again on every save.
let typedKeys = {}
export function useTypedKeys(map) { typedKeys = map || {} }

const secret = (name) => {
  if (process.env[name] !== undefined) return process.env[name] || ''
  if (typedKeys[name]) return typedKeys[name]
  return cfg[name] || ''
}

// The five, named once so the panel, the loader and the reader agree.
export const MODEL_KEYS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}
// Where a key came from, for the panel to say so plainly. An admin who typed
// one into a box and still sees "no key" needs to know the environment is
// overriding them.
export const keySource = (name) => {
  if (process.env[name]) return 'environment'
  if (typedKeys[name]) return 'typed in'
  if (cfg[name]) return 'config file'
  return null
}

export const LANG_NAME = { en: 'English', ru: 'Russian', uz: 'Uzbek' }
const KNOWN = Object.keys(LANG_NAME)

// ---- what language is this, roughly ----------------------------------------
// Not a linguist: enough to answer "does this need translating for you?"
// Cyrillic is Russian; Latin splits Uzbek from English on the letters and
// words Uzbek has and English does not. Wrong answers cost a pointless
// Translate button, never a wrong translation — the model is told to detect
// the source itself.
const UZ_MARKS = /[ʻʼ‘’]|\b(va|bilan|uchun|kerak|bo['ʻ‘’]?l\w*|qil\w*|kun|ish|yang\w*|bo['ʻ‘’]?yicha|hamda|lekin)\b/i
export function guessLang(text) {
  // A link is not a language. Neither is a bare @handle or a date. Strip the
  // things that are Latin in every language before counting, or a description
  // holding one Drive URL is "English" and a Russian reader is offered a
  // Translate button that would do nothing.
  const s = String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, ' ')
    .replace(/@[\w.]+/g, ' ')
    .replace(/\d/g, ' ')
  const cyr = (s.match(/[Ѐ-ӿ]/g) || []).length
  const lat = (s.match(/[A-Za-z]/g) || []).length
  // Below a handful of letters there is nothing to go on, and guessing wrong
  // costs a button that does nothing.
  if (cyr + lat < 8) return null
  if (cyr > lat) return 'ru'
  return UZ_MARKS.test(s) ? 'uz' : 'en'
}

// ---- the providers ---------------------------------------------------------
// Each returns a string or throws. The cascade below catches and moves on, so
// a provider that is down, rate-limited or simply not configured costs one
// timeout and nothing else.

const TIMEOUT = 20000
async function post(url, body, headers = {}, timeout = TIMEOUT) {
  const ctrl = new AbortController()
  const bell = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`)
    return JSON.parse(text)
  } finally { clearTimeout(bell) }
}
async function getJSON(url, timeout = TIMEOUT) {
  const ctrl = new AbortController()
  const bell = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'satashkent-board/1.0' } })
    const text = await r.text()
    if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 120)}`)
    return JSON.parse(text)
  } finally { clearTimeout(bell) }
}

// The instruction both jobs are asked with. Deliberately narrow: this text is
// a work order, and a model that decides to be helpful about the CONTENT
// instead of the WORDS has broken the brief rather than translated it.
// Where each provider lives. Overridable for the same reason the Telegram
// bridge's base is: none of these can be called from a test — two want money,
// three want an account, and the free pair are somebody else's unofficial
// endpoint that may be up or down on the day. What IS ours is the order they
// are tried in, what a failure costs, and whether the answer is kept; all of
// that is testable the moment the addresses can be pointed somewhere else.
const base = (name, fallback) => secret(name) || fallback
const AT = {
  anthropic: () => `${base('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')}/v1/messages`,
  openai: () => `${base('OPENAI_BASE_URL', 'https://api.openai.com/v1')}/chat/completions`,
  groq: () => `${base('GROQ_BASE_URL', 'https://api.groq.com/openai/v1')}/chat/completions`,
  openrouter: () => `${base('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1')}/chat/completions`,
  gemini: (model, key) => `${base('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')}`
    + `/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
  google: () => `${base('GOOGLE_TRANSLATE_BASE', 'https://translate.googleapis.com')}/translate_a/single`,
  mymemory: () => `${base('MYMEMORY_BASE', 'https://api.mymemory.translated.net')}/get`,
}

const RULES = 'Keep every name, date, time, number, link and @handle exactly as written. '
  + 'Do not add advice, do not answer the brief, do not comment. Return only the text.'

const ask = {
  anthropic: async (prompt, text) => {
    const key = secret('ANTHROPIC_API_KEY')
    if (!key) throw new Error('no key')
    const d = await post(AT.anthropic(), {
      model: secret('ANTHROPIC_MODEL') || 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: prompt,
      messages: [{ role: 'user', content: text }],
    }, { 'x-api-key': key, 'anthropic-version': '2023-06-01' })
    const out = (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim()
    if (!out) throw new Error('empty reply')
    return out
  },
  openai: async (prompt, text) => {
    const key = secret('OPENAI_API_KEY')
    if (!key) throw new Error('no key')
    const d = await post(AT.openai(), {
      model: secret('OPENAI_MODEL') || 'gpt-4o-mini',
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }],
    }, { Authorization: `Bearer ${key}` })
    const out = d.choices?.[0]?.message?.content?.trim()
    if (!out) throw new Error('empty reply')
    return out
  },
  // Groq and OpenRouter both have genuinely free tiers and speak the OpenAI
  // shape, which is why they are worth the twenty lines.
  groq: async (prompt, text) => {
    const key = secret('GROQ_API_KEY')
    if (!key) throw new Error('no key')
    const d = await post(AT.groq(), {
      model: secret('GROQ_MODEL') || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }],
    }, { Authorization: `Bearer ${key}` })
    const out = d.choices?.[0]?.message?.content?.trim()
    if (!out) throw new Error('empty reply')
    return out
  },
  openrouter: async (prompt, text) => {
    const key = secret('OPENROUTER_API_KEY')
    if (!key) throw new Error('no key')
    const d = await post(AT.openrouter(), {
      model: secret('OPENROUTER_MODEL') || 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }],
    }, { Authorization: `Bearer ${key}` })
    const out = d.choices?.[0]?.message?.content?.trim()
    if (!out) throw new Error('empty reply')
    return out
  },
  gemini: async (prompt, text) => {
    const key = secret('GEMINI_API_KEY')
    if (!key) throw new Error('no key')
    const model = secret('GEMINI_MODEL') || 'gemini-2.0-flash'
    const d = await post(AT.gemini(model, key),
      { systemInstruction: { parts: [{ text: prompt }] }, contents: [{ parts: [{ text }] }] })
    const out = d.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim()
    if (!out) throw new Error('empty reply')
    return out
  },
}

// The order they are tried in. A model the board pays for beats a free one;
// a free model beats a translation service; a translation service beats
// nothing. Overridable, because whoever pays the bill decides.
export const MODEL_ORDER = ['anthropic', 'openai', 'gemini', 'groq', 'openrouter']
const orderFromEnv = () => {
  const raw = secret('AI_ORDER')
  if (!raw) return MODEL_ORDER
  const want = raw.split(/[,\s]+/).filter((n) => ask[n])
  return want.length ? want : MODEL_ORDER
}

// ---- free translation, no key at all ---------------------------------------
// Two of them, because both are somebody's unofficial endpoint and either can
// vanish. Neither is asked for anything but translation.
const freeTranslate = {
  // Google's own web endpoint. No key, no account, and it is what every
  // "free translate" library on npm is wrapping.
  google: async (text, to, from) => {
    const url = `${AT.google()}?client=gtx`
      + `&sl=${encodeURIComponent(from || 'auto')}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`
    const d = await getJSON(url, 15000)
    const out = (d?.[0] || []).map((seg) => seg?.[0] || '').join('')
    if (!out.trim()) throw new Error('empty reply')
    return out
  },
  // A translation memory with a documented free tier and no key.
  mymemory: async (text, to, from) => {
    const pair = `${from && from !== 'auto' ? from : 'en'}|${to}`
    const d = await getJSON(`${AT.mymemory()}`
      + `?langpair=${encodeURIComponent(pair)}&q=${encodeURIComponent(text)}`, 15000)
    const out = d?.responseData?.translatedText
    if (!out || /^MYMEMORY WARNING/i.test(out)) throw new Error(out || 'empty reply')
    return out
  },
}
export const FREE_ORDER = ['google', 'mymemory']

// MyMemory takes 500 bytes at a time and Google's URL cannot grow for ever, so
// long scripts go over in pieces. Split on blank lines first — a brief is
// paragraphs — and only cut mid-paragraph when one paragraph is itself too
// long. Order is preserved, so the pieces reassemble into the same document.
export function chunk(text, size = 1200) {
  const out = []
  let buf = ''
  for (const para of String(text).split(/\n{2,}/)) {
    if ((buf + '\n\n' + para).length > size && buf) { out.push(buf); buf = '' }
    if (para.length <= size) { buf = buf ? `${buf}\n\n${para}` : para; continue }
    if (buf) { out.push(buf); buf = '' }
    let rest = para
    while (rest.length > size) {
      let at = rest.lastIndexOf('. ', size)
      if (at < size * 0.5) at = rest.lastIndexOf(' ', size)
      if (at <= 0) at = size
      out.push(rest.slice(0, at + 1).trim())
      rest = rest.slice(at + 1)
    }
    buf = rest
  }
  if (buf.trim()) out.push(buf)
  return out.filter(Boolean)
}

// ---- the plain-language pass ------------------------------------------------
// What "simplify" means when there is no model anywhere: not a paraphrase —
// nothing keyless can paraphrase — but the mechanical part of readability,
// done honestly and labelled as such.
//
//   one instruction per line, numbered, so a shot list stops being a wall
//   the team's own shorthand spelled out once
//   the dates, times, links and names pulled out where they cannot be missed
//
// It never invents a word that was not in the text. That is the whole reason
// it is safe to run without asking anybody.
// A word boundary in JavaScript is an ASCII boundary: \bТЗ\b never matches,
// because Cyrillic letters are not \w. Every one of these terms is Cyrillic
// half the time, so the boundary is spelled out with letter lookarounds.
const edge = (body, flags = 'gu') => new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, flags)
const GLOSSARY = {
  en: [[edge('ТЗ', 'gui'), 'ТЗ (the brief)'], [edge('правк\\p{L}*', 'gui'), (m) => `${m} (changes to make)`],
    [edge('реф', 'gui'), 'реф (reference)'], [edge('хронометраж\\p{L}*', 'gui'), (m) => `${m} (length)`]],
  ru: [[edge('ТЗ'), 'ТЗ (техзадание)'], [edge('reels?', 'gui'), (m) => `${m} (вертикальное видео)`],
    [edge('cut', 'gui'), 'cut (смонтированное видео)'], [edge('brief', 'gui'), 'brief (ТЗ)']],
  uz: [[edge('ТЗ'), 'ТЗ (texnik topshiriq)'], [edge('правк\\p{L}*', 'gui'), (m) => `${m} (tuzatishlar)`],
    [edge('reels?', 'gui'), (m) => `${m} (vertikal video)`]],
}
const PLAIN_HEADS = {
  en: { steps: 'Step by step', facts: 'Do not miss' },
  ru: { steps: 'По шагам', facts: 'Не пропустить' },
  uz: { steps: 'Bosqichma-bosqich', facts: 'E’tibordan qochmasin' },
}
export function plainVersion(text, lang = 'en') {
  const src = String(text || '').trim()
  if (!src) return ''
  const head = PLAIN_HEADS[lang] || PLAIN_HEADS.en

  let body = src
  for (const [re, to] of (GLOSSARY[lang] || [])) body = body.replace(re, to)

  // One instruction per line. A sentence end, a semicolon, or a bullet the
  // writer already used.
  const steps = body
    .split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}0-9])|;\s*/u)
    .map((x) => x.replace(/^\s*[-–—•*\d.)\s]+/, '').trim())
    // A step cut out of the middle of a sentence starts in lower case and
    // reads like a fragment. It is one line of its own now, so it starts
    // like one.
    .map((x) => (x ? x[0].toUpperCase() + x.slice(1) : x))
    .filter((x) => x.length > 1)

  // The things that are expensive to miss, lifted out verbatim.
  const facts = [
    ...new Set([
      ...(src.match(/https?:\/\/\S+/g) || []),
      ...(src.match(/@[\w.]+/g) || []),
      ...(src.match(/\b\d{1,2}[:.]\d{2}\b/g) || []),
      ...(src.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []),
      ...(src.match(/\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b/g) || []),
    ]),
  ]

  const lines = [`${head.steps}:`, ...steps.map((s, i) => `${i + 1}. ${s}`)]
  if (facts.length) lines.push('', `${head.facts}: ${facts.join(' · ')}`)
  return lines.join('\n')
}

// ---- the cache -------------------------------------------------------------
// The same brief is opened by the shooter, the editor and whoever is checking
// on them, and it does not change between openings. Translating it once and
// keeping the answer is the difference between a feature that costs money
// every time somebody reads a task and one that costs money once.
const keyOf = (kind, to, text) =>
  createHash('sha256').update(`${kind}|${to}|${text}`).digest('hex').slice(0, 40)

async function cached(kind, to, text) {
  const row = await get('SELECT out, provider FROM ai_cache WHERE k = ?', keyOf(kind, to, text))
  return row ? { text: row.out, provider: row.provider, cached: true } : null
}
async function remember(kind, to, text, out, provider) {
  try {
    await run(`INSERT INTO ai_cache (k, kind, target, out, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      keyOf(kind, to, text), kind, to, out, provider, new Date().toISOString())
  } catch { /* a cache that cannot write is still a working feature */ }
}

// ---- the two jobs -----------------------------------------------------------

export async function translate(text, to, { from = null, useCache = true } = {}) {
  const src = String(text || '').trim()
  if (!src) return { text: '', provider: 'none' }
  if (!KNOWN.includes(to)) throw Object.assign(new Error('Unknown language'), { status: 400 })
  if (useCache) { const hit = await cached('t', to, src); if (hit) return hit }

  const tried = []
  const prompt = `Translate the text into ${LANG_NAME[to]}. ${RULES}`
  for (const name of orderFromEnv()) {
    try {
      const out = await ask[name](prompt, src)
      await remember('t', to, src, out, name)
      return { text: out, provider: name, cached: false }
    } catch (e) { tried.push(`${name}: ${e.message}`) }
  }
  // No model. The free services do translation and only translation.
  for (const name of FREE_ORDER) {
    try {
      const parts = []
      for (const piece of chunk(src, name === 'mymemory' ? 480 : 1200)) {
        parts.push(await freeTranslate[name](piece, to, from || guessLang(src) || 'auto'))
      }
      const out = parts.join('\n\n')
      await remember('t', to, src, out, name)
      return { text: out, provider: name, cached: false, free: true }
    } catch (e) { tried.push(`${name}: ${e.message}`) }
  }
  throw Object.assign(new Error('No translator could be reached just now — the original is still here'),
    { status: 503, tried })
}

export async function simplify(text, lang = 'en', { useCache = true } = {}) {
  const src = String(text || '').trim()
  if (!src) return { text: '', provider: 'none' }
  if (!KNOWN.includes(lang)) lang = 'en'
  if (useCache) { const hit = await cached(`s:${lang}`, lang, src); if (hit) return hit }

  const tried = []
  const prompt = `Rewrite this work brief in ${LANG_NAME[lang]} so a busy person can follow it. `
    + 'Short sentences. One instruction per line, numbered. Plainer words for jargon. '
    + `Same instructions — add nothing, drop nothing, decide nothing. ${RULES}`
  for (const name of orderFromEnv()) {
    try {
      const out = await ask[name](prompt, src)
      await remember(`s:${lang}`, lang, src, out, name)
      return { text: out, provider: name, cached: false }
    } catch (e) { tried.push(`${name}: ${e.message}`) }
  }
  // No model anywhere. Say so plainly rather than pretending: this is the
  // mechanical part of readability, and the client labels it as such.
  return { text: plainVersion(src, lang), provider: 'plain', cached: false, tried }
}

// ---- what is actually available --------------------------------------------
// An admin should not have to read the source to find out whether this costs
// anything, or whether the free path is reachable from wherever the board is
// deployed. `probe` really calls each one with two words.
export function configured() {
  const models = orderFromEnv().filter((n) => {
    try { return !!secret(MODEL_KEYS[n]) } catch { return false }
  })
  // Every provider, whether it has a key or not, with where the key came
  // from. The panel used to work this out from two lists and could not say
  // why a key it had just been given was being ignored.
  const providers = Object.entries(MODEL_KEYS).map(([name, env]) => ({
    name, env, set: !!secret(env), source: keySource(env),
  }))
  return { models, providers, free: FREE_ORDER, canSimplifyWithModel: models.length > 0 }
}

export async function probe() {
  const out = []
  for (const name of orderFromEnv()) {
    const started = Date.now()
    try {
      await ask[name]('Translate the text into Russian. Return only the text.', 'good morning')
      out.push({ name, kind: 'model', ok: true, ms: Date.now() - started })
    } catch (e) { out.push({ name, kind: 'model', ok: false, why: e.message.slice(0, 120) }) }
  }
  for (const name of FREE_ORDER) {
    const started = Date.now()
    try {
      const got = await freeTranslate[name]('good morning', 'ru', 'en')
      out.push({ name, kind: 'free', ok: !!got, ms: Date.now() - started, sample: got.slice(0, 40) })
    } catch (e) { out.push({ name, kind: 'free', ok: false, why: e.message.slice(0, 120) }) }
  }
  return out
}

export async function cacheSize() {
  const r = await get('SELECT COUNT(*) AS n FROM ai_cache')
  return r?.n || 0
}
export async function clearCache() {
  await run('DELETE FROM ai_cache')
}
export const _internals = { freeTranslate, ask, secret }
