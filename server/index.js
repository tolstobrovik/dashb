// The long-running server (local dev, Render, any VPS). Serverless
// deployments skip this file and wrap the app via api/index.js instead.
import { app } from './app.js'
import { initDb, closeDb, flushPending } from './db.js'

await initDb()

const PORT = process.env.PORT || 4000
const server = app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`))

// In GitHub-storage mode, journaled writes are pushed out on a short interval
// (flushPending is a no-op on the other backends).
const flusher = setInterval(() => flushPending().catch(() => {}), 3000)
flusher.unref?.()

// Graceful shutdown: hosts send SIGTERM on every deploy. Stop taking new
// connections, let in-flight requests finish, flush pending writes, close the
// database, exit — with a hard 8s ceiling so a stuck request can't block it.
let stopping = false
function shutdown(reason) {
  if (stopping) return
  stopping = true
  console.log(`${reason} — shutting down`)
  clearInterval(flusher)
  const bye = () => flushPending().catch(() => {}).finally(() => { closeDb(); process.exit(0) })
  server.close(bye)
  setTimeout(bye, 8000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e))
process.on('uncaughtException', (e) => { console.error('Uncaught exception:', e); shutdown('uncaught exception') })
