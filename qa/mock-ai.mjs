// A stand-in for every AI provider at once.
//
// The real ones cannot be called from a test: two need money, three need
// accounts, and the free two are somebody else's unofficial endpoint that may
// be up or down on the day. What CAN be tested is the part that is ours — the
// order they are tried in, what happens when one fails, that a failure costs
// nothing but a move to the next, that the answer is cached, and that a long
// script is cut up and comes back in one piece.
//
// So this speaks all their shapes on one port, and can be told to fail.
import { createServer } from 'http'

const PORT = Number(process.env.MOCK_AI_PORT || 9975)
let fail = new Set()          // provider names that should break
let calls = []                // everything that was asked, in order

const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => r(b)) })
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const raw = await body(req)
  let json = {}
  try { json = raw ? JSON.parse(raw) : {} } catch { /* form or query */ }

  if (url.pathname === '/__reset') { fail = new Set(); calls = []; return send(res, 200, { ok: true }) }
  if (url.pathname === '/__calls') return send(res, 200, calls)
  if (url.pathname === '/__fail') {
    fail = new Set((url.searchParams.get('who') || '').split(',').filter(Boolean))
    return send(res, 200, { failing: [...fail] })
  }

  const note = (who, text) => calls.push({ who, text, at: Date.now() })
  const broken = (who) => fail.has(who)

  // Anthropic
  if (url.pathname === '/v1/messages') {
    const text = json.messages?.[0]?.content || ''
    if (broken('anthropic')) return send(res, 500, { error: 'anthropic is down' })
    note('anthropic', text)
    return send(res, 200, { content: [{ type: 'text', text: `[anthropic] ${text}` }] })
  }
  // OpenAI, Groq and OpenRouter all speak this one
  if (url.pathname.endsWith('/chat/completions')) {
    const who = url.pathname.includes('groq') ? 'groq'
      : url.pathname.includes('openrouter') ? 'openrouter' : 'openai'
    const text = json.messages?.find((m) => m.role === 'user')?.content || ''
    if (broken(who)) return send(res, 429, { error: `${who} is rate limited` })
    note(who, text)
    return send(res, 200, { choices: [{ message: { content: `[${who}] ${text}` } }] })
  }
  // Gemini
  if (url.pathname.includes(':generateContent')) {
    const text = json.contents?.[0]?.parts?.[0]?.text || ''
    if (broken('gemini')) return send(res, 503, { error: 'gemini unavailable' })
    note('gemini', text)
    return send(res, 200, { candidates: [{ content: { parts: [{ text: `[gemini] ${text}` }] } }] })
  }
  // The free translation endpoints
  if (url.pathname === '/translate_a/single') {
    const q = url.searchParams.get('q') || ''
    if (broken('google')) return send(res, 403, { error: 'blocked' })
    note('google', q)
    return send(res, 200, [[[`[google] ${q}`, q]]])
  }
  if (url.pathname === '/get') {
    const q = url.searchParams.get('q') || ''
    if (broken('mymemory')) return send(res, 200, { responseData: { translatedText: 'MYMEMORY WARNING: LIMIT' } })
    note('mymemory', q)
    return send(res, 200, { responseData: { translatedText: `[mymemory] ${q}` } })
  }
  send(res, 404, { error: 'no such provider path' })
}).listen(PORT, () => console.log('mock-ai on ' + PORT))
