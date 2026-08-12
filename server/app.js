// The Express app, shared by every way of running the server: the long-running
// process in index.js (local dev, Render, a VPS) and the serverless wrapper in
// api/index.js (Vercel). Callers await initDb() before serving requests — on
// purpose NOT at module load: a storage blip during import would cache a
// rejection for the life of the instance, turning every request into a 500.
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { initDb, all, snapshotTracker, dayISO, storageStatus, squashData } from './db.js'
import { wrap } from './auth.js'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import channelRoutes from './routes/channels.js'
import statusRoutes from './routes/statuses.js'
import fieldRoutes from './routes/fields.js'
import notificationRoutes from './routes/notifications.js'
import trackerRoutes from './routes/trackers.js'
import contentRoutes from './routes/content.js'
import reportRoutes from './routes/reports.js'
import campaignRoutes from './routes/campaigns.js'
import projectRoutes from './routes/projects.js'
import boardRoutes from './routes/boards.js'
import personalRoutes from './routes/personal.js'
import programRoutes from './routes/programs.js'
import hiringRoutes from './routes/hiring.js'
import candidateRoutes from './routes/candidates.js'
import telegramRoutes from './routes/telegram.js'
import { docsRouter, kpisRouter } from './routes/docs.js'
import warningRoutes from './routes/warnings.js'
import { tgDailyReminders, tgRunSchedules } from './telegram.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const app = express()
app.disable('x-powered-by')
app.use(cors())
app.use(compression()) // JSON with attachments shrinks ~5-10x over the wire
app.use(express.json({ limit: '8mb' })) // room for photo attachments (data URLs)

// Health must answer even when the data store is the thing that is ill —
// that is precisely when someone is looking at it. It reports what the
// storage layer knows (mode, size, unflushed writes, the last error) instead
// of failing with the rest.
app.get('/api/health', async (req, res) => {
  try {
    res.json({ ok: true, ...(await storageStatus()) })
  } catch (e) {
    res.status(503).json({ ok: false, storage: 'unreachable', error: e.message, retryable: true })
  }
})

// Nightly tick (vercel.json cron, 00:05 Tashkent): writes today's snapshot for
// every metric so the growth comparison always has a point per day, even on
// days nobody edits anything. Idempotent — safe to call any number of times.
app.get('/api/cron/daily', wrap(async (req, res) => {
  await initDb()
  const trackers = await all('SELECT id FROM trackers')
  for (const t of trackers) await snapshotTracker(t.id)
  // The morning half of the bell, delivered instead of waited for: deadline
  // reminders pushed to every Telegram-linked member.
  let reminded = 0
  try { reminded = await tgDailyReminders() } catch (e) { console.error('telegram reminders failed:', e.message) }
  // The admin's scheduled nudges get a nightly backstop here; in practice they
  // leave earlier, the moment somebody opens the dashboard past their hour.
  try { await tgRunSchedules() } catch (e) { console.error('telegram schedules failed:', e.message) }
  // In GitHub-storage mode, also compact the data branch to one commit.
  let squashed = false
  try { await squashData(); squashed = true } catch (e) { console.error('squash failed:', e.message) }
  res.json({ ok: true, day: dayISO(), snapped: trackers.length, reminded, squashed })
}))
// A Monday-morning nudge should not wait for midnight. The host's cron runs
// once a night, so the schedules are also checked as the team works: at most
// once every few minutes per instance, never awaited, never able to slow or
// break the request that happened to wake it.
let lastScheduleCheck = 0
app.use((req, res, next) => {
  if (Date.now() - lastScheduleCheck > 240000) {
    lastScheduleCheck = Date.now()
    tgRunSchedules().catch((e) => console.error('telegram schedules failed:', e.message))
  }
  next()
})

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/channels', channelRoutes)
app.use('/api/statuses', statusRoutes)
app.use('/api/fields', fieldRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/trackers', trackerRoutes)
app.use('/api/content', contentRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/campaigns', campaignRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/boards', boardRoutes)
app.use('/api/personal', personalRoutes)
app.use('/api/programs', programRoutes)
app.use('/api/hiring', hiringRoutes)
app.use('/api/candidates', candidateRoutes)
app.use('/api/telegram', telegramRoutes)
app.use('/api/docs', docsRouter)
app.use('/api/kpis', kpisRouter)
app.use('/api/warnings', warningRoutes)

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))

// Long-running mode serves the built client too; on Vercel the CDN does this.
const dist = join(__dirname, '..', 'dist')
if (existsSync(dist)) {
  // Hashed assets never change → cache forever; index.html revalidates so a
  // deploy is picked up on the next load.
  app.use(express.static(dist, { maxAge: '365d', immutable: true, index: false }))
  app.get('*', (req, res) => res.sendFile(join(dist, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }))
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Server error' })
})
