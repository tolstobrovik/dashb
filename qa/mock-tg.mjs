// A tiny Telegram Bot API stand-in for the QA gate: records every call and
// answers like the real thing. GET /__sent returns the record, POST /__reset
// clears it — the suite asserts against what "Telegram" actually received.
import http from 'http'

const PORT = Number(process.env.MOCK_PORT || 9979)
const sent = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/__sent') return res.end(JSON.stringify(sent))
    if (req.url === '/__reset') { sent.length = 0; return res.end('{}') }
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/)
    let payload = {}
    try { payload = JSON.parse(body || '{}') } catch { payload = {} }
    if (m) sent.push({ token: m[1], method: m[2], ...payload })
    if (m && m[2] === 'getMe') return res.end(JSON.stringify({ ok: true, result: { username: 'SatashkentBot' } }))
    if (m && m[2] === 'setWebhook') { server.hookUrl = payload.url || ''; return res.end(JSON.stringify({ ok: true, result: true })) }
    if (m && m[2] === 'getWebhookInfo')
      return res.end(JSON.stringify({ ok: true, result: { url: server.hookUrl || '', pending_update_count: 0 } }))
    res.end(JSON.stringify({ ok: true, result: {} }))
  })
})
server.listen(PORT, () => console.log(`mock-tg on ${PORT}`))
