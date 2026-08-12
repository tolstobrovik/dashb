// Fixed app configuration — everything the app needs lives in this file.
// No environment variables, no dashboard settings. Keep this repository
// PRIVATE: these values grant access to your data.

// Option A (default): the database lives INSIDE this GitHub repository.
// The app stores its SQLite database on the branch below and syncs every
// change through the GitHub API — data survives deploys, restarts and cold
// starts with zero external services. The token needs Contents read/write
// on this repository (fine-grained tokens expire — when this one does,
// generate a new one and update it here; a classic token with "repo" scope
// and No expiration never needs replacing).
export const GITHUB_DATA = {
  token: 'REPLACE_WITH_YOUR_GITHUB_TOKEN',
  repo: 'tolstobrovik/marketing-dashboard', // owner/name of THIS repository
  branch: 'appdata',                        // data lives on its own branch
  path: 'data/dashboard.db',
}

// Option B (upgrade for heavier use): a real Postgres database. Paste a
// connection string between the quotes and push — it takes precedence over
// the GitHub storage automatically.
export const DATABASE_URL = ''
