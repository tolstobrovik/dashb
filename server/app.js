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
import { initDb, dayISO, storageStatus, squashData } from './db.js'
import { wrap } from './auth.js'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import channelRoutes from './routes/channels.js'
import statusRoutes from './routes/statuses.js'
import fieldRoutes from './routes/fields.js'
import notificationRoutes from './routes/notifications.js'
import contentRoutes, { autoFlagSilentlyLate } from './routes/content.js'
import reportRoutes from './routes/reports.js'
import rewardRoutes from './routes/rewards.js'
import aiRoutes from './routes/ai.js'
import sprintRoutes from './routes/sprints.js'
import campaignRoutes from './routes/campaigns.js'
import projectRoutes from './routes/projects.js'
import boardRoutes from './routes/boards.js'
import personalRoutes from './routes/personal.js'
import programRoutes from './routes/programs.js'
import hiringRoutes from './routes/hiring.js'
import candidateRoutes from './routes/candidates.js'
import telegramRoutes from './routes/telegram.js'
import { docsRouter } from './routes/docs.js'
import warningRoutes from './routes/warnings.js'
import ambassadorRoutes from './routes/ambassadors.js'
import usageRoutes from './routes/usage.js'
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
  // The morning half of the bell, delivered instead of waited for: deadline
  // reminders pushed to every Telegram-linked member.
  let reminded = 0
  try { reminded = await tgDailyReminders() } catch (e) { console.error('telegram reminders failed:', e.message) }
  // The admin's scheduled nudges get a nightly backstop here; in practice they
  // leave earlier, the moment somebody opens the dashboard past their hour.
  try { await tgRunSchedules() } catch (e) { console.error('telegram schedules failed:', e.message) }
  // In GitHub-storage mode, also compact the data branch to one commit.
  let squashed = false
  // Work that has gone days past its day with nobody saying anything raises
  // its own hand, so it stops being invisible to everyone but the strip.
  let flagged = 0
  try { flagged = await autoFlagSilentlyLate() } catch (e) { console.error('auto-flag failed:', e.message) }
  try { await squashData(); squashed = true } catch (e) { console.error('squash failed:', e.message) }
  res.json({ ok: true, day: dayISO(), reminded, flagged, squashed })
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
app.use('/api/content', contentRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/rewards', rewardRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/sprints', sprintRoutes)
app.use('/api/campaigns', campaignRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/boards', boardRoutes)
app.use('/api/personal', personalRoutes)
app.use('/api/programs', programRoutes)
app.use('/api/hiring', hiringRoutes)
app.use('/api/candidates', candidateRoutes)
app.use('/api/telegram', telegramRoutes)
app.use('/api/docs', docsRouter)
app.use('/api/warnings', warningRoutes)
app.use('/api/ambassadors', ambassadorRoutes)
app.use('/api/usage', usageRoutes)

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
  // A body bigger than the parser will take never reaches its route, so the
  // route's own size rule never gets to speak and the person is told "Server
  // error" about a file they could see was enormous. The parser knows exactly
  // what went wrong; this passes that on instead of burying it.
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That file is too big to send — keep it under 5 MB' })
  }
  console.error(err)
  res.status(500).json({ error: 'Server error' })
})
