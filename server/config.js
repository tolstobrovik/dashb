// Fixed app configuration — the single place that points the app at its
// database. Paste a Postgres connection string between the quotes and push:
// every deployment (Vercel, Render, anywhere) picks it up automatically.
// No environment variables, no dashboard settings.
//
// Keep this repository PRIVATE — this string grants access to your data.
// While it stays empty, the app runs in demo mode (data resets on deploys).
export const DATABASE_URL = ''
