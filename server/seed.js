// Reset the database to a fresh seeded state: `npm run seed`.
// Works on every storage mode: deletes the local file, or drops every table
// on a remote (Postgres / Turso) database before reseeding.
import { rmSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const remote = process.env.DATABASE_URL || process.env.POSTGRES_URL ||
  process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL

if (!remote) {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const dbFile = join(process.env.DATA_DIR || join(__dirname, '..', 'data'), 'dashboard.db')
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const f = dbFile + suffix
    if (existsSync(f)) rmSync(f)
  }
}

const { exec, initDb, closeDb } = await import('./db.js')
if (remote) {
  await exec(`
    DROP TABLE IF EXISTS metric_history;
    DROP TABLE IF EXISTS content;
    DROP TABLE IF EXISTS trackers;
    DROP TABLE IF EXISTS statuses;
    DROP TABLE IF EXISTS channels;
    DROP TABLE IF EXISTS campaigns;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS meta;
  `)
}
await initDb()
closeDb()
console.log('✔ Database reset to a clean start: channels, pipeline stages, the campaign plan and the admin account.')
