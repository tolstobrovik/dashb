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
    // Some storage failures pass; one never does. A token GitHub refuses is
    // not a blip — waiting cannot mend it, and saying "try again in a moment"
    // sends a blocked team in circles. So a refusal states itself and asks
    // not to be retried; everything else keeps the patient, retryable answer.
    const refused = / GitHub refused the storage token[^]*/.exec(e.message || '')
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    if (!refused) res.setHeader('Retry-After', '2')
    // The retryable answer is sent BEFORE the app ever sees the request, so
    // nothing was read, written or half-done — the client may safely send it
    // again, turning a blip into a pause instead of a lost task.
    res.end(JSON.stringify({
      error: refused
        ? `Storage is locked out:${refused[0].replace(' — GitHub', ' GitHub')}`
        : 'The data store is briefly unreachable — try again in a moment',
      reason: e.message,
      retryable: !refused,
    }))
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
