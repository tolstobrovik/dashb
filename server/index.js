// The long-running server (local dev, Render, any VPS). Serverless
// deployments skip this file and wrap the app via api/index.js instead.
import { app, ready } from './app.js'
import { closeDb } from './db.js'

await ready

const PORT = process.env.PORT || 4000
const server = app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`))

// Graceful shutdown: hosts send SIGTERM on every deploy. Stop taking new
// connections, let in-flight requests finish, close the database, exit —
// with a hard 8s ceiling so a stuck request can't block the deploy.
let stopping = false
function shutdown(reason) {
  if (stopping) return
  stopping = true
  console.log(`${reason} — shutting down`)
  server.close(() => { closeDb(); process.exit(0) })
  setTimeout(() => { closeDb(); process.exit(0) }, 8000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e))
process.on('uncaughtException', (e) => { console.error('Uncaught exception:', e); shutdown('uncaught exception') })
