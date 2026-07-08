import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { initSchema, seedIfEmpty, seedCampaignsIfEmpty } from './db.js'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import channelRoutes from './routes/channels.js'
import statusRoutes from './routes/statuses.js'
import trackerRoutes from './routes/trackers.js'
import contentRoutes from './routes/content.js'
import reportRoutes from './routes/reports.js'
import campaignRoutes from './routes/campaigns.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

initSchema()
seedIfEmpty()
seedCampaignsIfEmpty()

const app = express()
app.use(cors())
app.use(express.json({ limit: '8mb' })) // room for photo attachments (data URLs)

app.get('/api/health', (req, res) => res.json({ ok: true }))
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/channels', channelRoutes)
app.use('/api/statuses', statusRoutes)
app.use('/api/trackers', trackerRoutes)
app.use('/api/content', contentRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/campaigns', campaignRoutes)

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))

const dist = join(__dirname, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (req, res) => res.sendFile(join(dist, 'index.html')))
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Server error' })
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`))
