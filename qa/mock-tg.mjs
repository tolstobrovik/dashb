// A tiny Telegram Bot API stand-in for the QA gate: records every call and
// answers like the real thing. GET /__sent returns the record, POST /__reset
// clears it — the suite asserts against what "Telegram" actually received.
import http from 'http'

const PORT = Number(process.env.MOCK_PORT || 9979)
const sent = []
// Two things the real API does that a permissive mock hides: it refuses
// messages to a chat that blocked the bot (403), and it refuses HTML whose
// tags do not balance (400) — the shape a clipped message takes.
let blocked = new Set()
const badHtml = (text) => {
  const stack = []
  for (const [, close, name] of String(text).matchAll(/<(\/?)(b|i|a|code|pre|u|s)\b[^>]*>/g)) {
    if (close) { if (stack.pop() !== name) return true } else stack.push(name)
  }
  return stack.length > 0 || /<a href="[^"]*$/.test(String(text))
}
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/__sent') return res.end(JSON.stringify(sent))
    if (req.url === '/__reset') { sent.length = 0; return res.end('{}') }
    if (req.url === '/__block') { blocked = new Set(JSON.parse(body || '[]').map(String)); return res.end('{}') }
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/)
    let payload = {}
    try { payload = JSON.parse(body || '{}') } catch { payload = {} }
    if (m && m[2] === 'sendMessage') {
      if (blocked.has(String(payload.chat_id))) {
        sent.push({ token: m[1], method: m[2], ...payload, rejected: 'blocked' })
        res.writeHead(403)
        return res.end(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }))
      }
      if (payload.parse_mode === 'HTML' && badHtml(payload.text)) {
        sent.push({ token: m[1], method: m[2], ...payload, rejected: 'bad-html' })
        res.writeHead(400)
        return res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }))
      }
    }
    if (m) sent.push({ token: m[1], method: m[2], ...payload })
    if (m && m[2] === 'getMe') return res.end(JSON.stringify({ ok: true, result: { username: 'SatashkentBot' } }))
    if (m && m[2] === 'setWebhook') { server.hookUrl = payload.url || ''; return res.end(JSON.stringify({ ok: true, result: true })) }
    if (m && m[2] === 'getWebhookInfo')
      return res.end(JSON.stringify({ ok: true, result: { url: server.hookUrl || '', pending_update_count: 0 } }))
    res.end(JSON.stringify({ ok: true, result: {} }))
  })
})
server.listen(PORT, () => console.log(`mock-tg on ${PORT}`))
