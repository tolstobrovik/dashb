// Vercel serverless entry: every /api/* request lands here (see vercel.json)
// and runs through the same Express app as everywhere else. The database is
// initialized once per instance; requests just await that first init.
import { app, ready } from '../server/app.js'

export default async function handler(req, res) {
  await ready
  return app(req, res)
}
