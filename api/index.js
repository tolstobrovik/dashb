// Vercel serverless entry: every /api/* request lands here (see vercel.json)
// and runs through the same Express app as everywhere else. The database is
// initialized once per instance; after each response any journaled writes are
// flushed to the durable store before the instance is allowed to freeze.
//
// Failure discipline: a storage blip must never crash the function. A failed
// init answers 503 with a human message (and the NEXT request retries the
// boot — initDb never caches a rejection); a failed post-response flush is
// logged and retried on the next request's flush.
import { app } from '../server/app.js'
import { initDb, flushPending } from '../server/db.js'

export default async function handler(req, res) {
  try {
    await initDb()
  } catch (e) {
    console.error('DB boot failed:', e)
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'The data store is briefly unreachable — try again in a moment' }))
    return
  }
  await new Promise((resolve) => {
    res.on('close', resolve)
    app(req, res)
  })
  try {
    await flushPending()
  } catch (e) {
    console.error('Post-response flush failed:', e)
  }
}
