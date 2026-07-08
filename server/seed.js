// Reset the database to a fresh seeded state: `npm run seed`.
import { rmSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbFile = join(__dirname, '..', 'data', 'dashboard.db')
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  const f = dbFile + suffix
  if (existsSync(f)) rmSync(f)
}

const { initSchema, seedIfEmpty, seedCampaignsIfEmpty } = await import('./db.js')
initSchema()
seedIfEmpty()
seedCampaignsIfEmpty()
console.log('✔ Database reset and seeded with sample users, metrics, tasks and the campaign plan.')
process.exit(0)
