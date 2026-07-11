// Database layer on @libsql/client so the same code runs everywhere:
//  - remote:  set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) — pure-fetch client,
//             no native binaries, safe in any serverless runtime (Vercel).
//  - file:    local dev / Render / any VPS — a SQLite file under ./data
//             (override with DATA_DIR). On serverless hosts without a remote
//             URL it falls back to /tmp, which resets on cold starts.
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync } from 'fs'

const REMOTE_URL = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || ''
const AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined

const __dirname = dirname(fileURLToPath(import.meta.url))
const ON_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY)
const DATA_DIR = process.env.DATA_DIR || (ON_SERVERLESS ? '/tmp/satashkent-data' : join(__dirname, '..', 'data'))

async function createDbClient() {
  if (REMOTE_URL) {
    const { createClient } = await import('@libsql/client/web')
    return createClient({ url: REMOTE_URL, authToken: AUTH_TOKEN, intMode: 'number' })
  }
  const { createClient } = await import('@libsql/client')
  mkdirSync(DATA_DIR, { recursive: true })
  return createClient({ url: `file:${join(DATA_DIR, 'dashboard.db')}`, intMode: 'number' })
}
const clientPromise = createDbClient()

const cleanArgs = (args) => args.map((v) => (v === undefined ? null : v))
const rowsOf = (rs) => rs.rows.map((r) => {
  const o = {}
  rs.columns.forEach((c, i) => { o[c] = r[i] })
  return o
})

export async function all(sql, ...args) {
  const c = await clientPromise
  return rowsOf(await c.execute({ sql, args: cleanArgs(args) }))
}
export async function get(sql, ...args) {
  return (await all(sql, ...args))[0]
}
export async function run(sql, ...args) {
  const c = await clientPromise
  const rs = await c.execute({ sql, args: cleanArgs(args) })
  return {
    changes: rs.rowsAffected,
    lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid),
  }
}
// One transactional round-trip: statements as [sql, ...args]. Returns the
// rows of each statement (useful with INSERT ... RETURNING).
export async function batch(stmts) {
  const c = await clientPromise
  const results = await c.batch(stmts.map(([sql, ...args]) => ({ sql, args: cleanArgs(args) })), 'write')
  return results.map(rowsOf)
}
export async function exec(sql) {
  const c = await clientPromise
  await c.executeMultiple(sql)
}
export function closeDb() {
  clientPromise.then((c) => c.close()).catch(() => {})
}

// What a member may do unless the admin changes it (Telegram-style rights).
export const DEFAULT_PERMS = {
  edit_metrics: true,    // change metric values (+/-)
  manage_metrics: false, // add / rename / retarget / delete metrics
  manage_layout: false,  // reorder metrics, pin the main metric
  manage_content: true,  // create & edit content tasks, dates, details
  move_tasks: true,      // drag tasks between stages / days
}
export const PERM_KEYS = Object.keys(DEFAULT_PERMS)

export async function initSchema() {
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      username      TEXT    NOT NULL,
      email         TEXT,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'member',
      departments   TEXT    NOT NULL DEFAULT '[]',
      permissions   TEXT    NOT NULL DEFAULT '{}',
      color         TEXT    NOT NULL DEFAULT '#a32234',
      created_at    TEXT    NOT NULL
    );

    -- Sidebar channels are data, not code: the admin adds/renames/reorders them.
    CREATE TABLE IF NOT EXISTS channels (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      key   TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      icon  TEXT NOT NULL DEFAULT 'star',
      sort  INTEGER NOT NULL DEFAULT 0
    );

    -- content_type binds a metric to a task type (post/reel/story/video):
    -- creating a task of that type raises the plan (target +1), completing it
    -- fills it (current +1). NULL = a manual number (followers, reach, ...).
    CREATE TABLE IF NOT EXISTS trackers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      department   TEXT    NOT NULL,
      label        TEXT    NOT NULL,
      current      INTEGER NOT NULL DEFAULT 0,
      target       INTEGER NOT NULL DEFAULT 1,
      unit         TEXT    NOT NULL DEFAULT '',
      period       TEXT    NOT NULL DEFAULT 'monthly',
      content_type TEXT,
      is_primary   INTEGER NOT NULL DEFAULT 0,
      sort         INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT    NOT NULL
    );

    -- One snapshot per metric per day → powers the growth comparison.
    CREATE TABLE IF NOT EXISTS metric_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tracker_id INTEGER NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
      date       TEXT    NOT NULL,
      value      INTEGER NOT NULL,
      UNIQUE(tracker_id, date)
    );

    -- The content pipeline stages (editable by the admin).
    CREATE TABLE IF NOT EXISTS statuses (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      label    TEXT NOT NULL,
      color    TEXT NOT NULL DEFAULT '#8b8388',
      sort     INTEGER NOT NULL DEFAULT 0,
      is_final INTEGER NOT NULL DEFAULT 0
    );

    -- One content task = one card on the board, one pill on both calendars,
    -- one row in the to-do list. A task can live on several channels at once
    -- (channels = JSON array); its type binds it to each channel's plan metric.
    CREATE TABLE IF NOT EXISTS content (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT    NOT NULL,
      channels       TEXT    NOT NULL DEFAULT '[]',
      type           TEXT    NOT NULL DEFAULT 'post',
      assignee_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status_id      INTEGER REFERENCES statuses(id) ON DELETE SET NULL,
      recording_date TEXT,
      recording_time TEXT,
      release_date   TEXT,
      release_time   TEXT,
      description    TEXT    NOT NULL DEFAULT '',
      photo          TEXT,
      checklist      TEXT    NOT NULL DEFAULT '[]',
      todo_sort      INTEGER NOT NULL DEFAULT 0,
      done_at        TEXT,
      created_at     TEXT    NOT NULL
    );

    -- Campaign plan (admin): overview table, month calendar, project list.
    CREATE TABLE IF NOT EXISTS campaigns (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT NOT NULL,
      timing   TEXT NOT NULL DEFAULT '',
      channel  TEXT NOT NULL DEFAULT '',
      audience TEXT NOT NULL DEFAULT '',
      goal     TEXT NOT NULL DEFAULT '',
      notes    TEXT NOT NULL DEFAULT '',
      duration TEXT NOT NULL DEFAULT 'short',  -- short | long
      owner    TEXT NOT NULL DEFAULT '',
      status   TEXT NOT NULL DEFAULT '',
      ongoing  INTEGER NOT NULL DEFAULT 0,
      months   TEXT NOT NULL DEFAULT '[]',     -- ["2026-07", ...]
      sort     INTEGER NOT NULL DEFAULT 0
    );

    -- One-time flags (e.g. "campaigns seeded") so seed data never re-appears.
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `)

  await migrate()
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `)
}

async function hasColumn(table, col) {
  return (await all(`PRAGMA table_info(${table})`)).some((c) => c.name === col)
}

async function migrate() {
  // Legacy-shape upgrades for databases created by older versions. Fresh
  // databases (and remote ones that don't allow PRAGMA) skip through.
  try {
    if (!(await hasColumn('users', 'permissions'))) await exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'")
    if (!(await hasColumn('trackers', 'content_type'))) await exec('ALTER TABLE trackers ADD COLUMN content_type TEXT')
    // Older databases stored a single channel per task — rebuild to the new shape.
    if (await hasColumn('content', 'channel')) {
      await exec(`
        ALTER TABLE content RENAME TO content_legacy;
        CREATE TABLE content (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          title          TEXT    NOT NULL,
          channels       TEXT    NOT NULL DEFAULT '[]',
          type           TEXT    NOT NULL DEFAULT 'post',
          assignee_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
          status_id      INTEGER REFERENCES statuses(id) ON DELETE SET NULL,
          recording_date TEXT,
          recording_time TEXT,
          release_date   TEXT,
          release_time   TEXT,
          description    TEXT    NOT NULL DEFAULT '',
          photo          TEXT,
          checklist      TEXT    NOT NULL DEFAULT '[]',
          todo_sort      INTEGER NOT NULL DEFAULT 0,
          done_at        TEXT,
          created_at     TEXT    NOT NULL
        );
        INSERT INTO content (id, title, channels, type, assignee_id, created_by, status_id,
          recording_date, recording_time, release_date, release_time, description, photo, checklist, done_at, created_at)
        SELECT id, title, json_array(channel), 'post', assignee_id, created_by, status_id,
          recording_date, recording_time, release_date, release_time, description, photo, checklist, done_at, created_at
        FROM content_legacy;
        DROP TABLE content_legacy;
      `)
    }
    if (!(await hasColumn('content', 'todo_sort'))) await exec('ALTER TABLE content ADD COLUMN todo_sort INTEGER NOT NULL DEFAULT 0')
  } catch (e) {
    console.warn('Skipping legacy migrations:', e.message)
  }
}

export async function getChannelKeys() {
  return (await all('SELECT key FROM channels ORDER BY sort')).map((r) => r.key)
}

// Record today's value for a metric (upsert), so comparisons have data.
export async function snapshotTracker(trackerId) {
  const row = await get('SELECT current FROM trackers WHERE id = ?', trackerId)
  if (!row) return
  await run(`
    INSERT INTO metric_history (tracker_id, date, value) VALUES (?, ?, ?)
    ON CONFLICT(tracker_id, date) DO UPDATE SET value = excluded.value
  `, trackerId, dayISO(0), row.current)
}

// Task types that can bind to a channel's plan metric.
export const CONTENT_TYPES = ['post', 'reel', 'story', 'video', 'other']
export const TYPE_PLAN_LABELS = { post: 'Posts', reel: 'Reels', story: 'Stories', video: 'Videos' }

// The plan metric for (channel, type) — optionally created on first use, so a
// new task always has a plan to count toward.
export async function planTracker(channel, type, createIfMissing = false) {
  if (!TYPE_PLAN_LABELS[type]) return null
  let t = await get('SELECT * FROM trackers WHERE department = ? AND content_type = ? ORDER BY sort, id', channel, type)
  if (!t && createIfMissing) {
    const maxSort = (await get('SELECT COALESCE(MAX(sort), -1) AS m FROM trackers WHERE department = ?', channel)).m
    const info = await run(`
      INSERT INTO trackers (department, label, current, target, unit, period, content_type, sort, updated_at)
      VALUES (?, ?, 0, 0, ?, 'monthly', ?, ?, ?)
    `, channel, TYPE_PLAN_LABELS[type], `${type}s`, type, maxSort + 1, new Date().toISOString())
    t = await get('SELECT * FROM trackers WHERE id = ?', info.lastInsertRowid)
  }
  return t
}

// Move a channel plan: creating a task raises the plan (target +1), completing
// it fills it (current +1); deleting / un-completing walks both back.
export async function bumpPlan(channel, type, { target = 0, current = 0 }, createIfMissing = false) {
  const t = await planTracker(channel, type, createIfMissing)
  if (!t) return
  await run('UPDATE trackers SET target = ?, current = ?, updated_at = ? WHERE id = ?',
    Math.max(0, t.target + target), Math.max(0, t.current + current), new Date().toISOString(), t.id)
  await snapshotTracker(t.id)
}

const now = () => new Date().toISOString()

function dayISO(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function seedIfEmpty() {
  if ((await get('SELECT COUNT(*) AS n FROM users')).n > 0) return

  // A fresh database starts clean: the team's channels, the pipeline stages,
  // and a single admin account. No demo members, metrics or tasks — the admin
  // creates real ones in the app (change the admin password right away).
  const channels = [
    ['instagram_uzb', 'Instagram Uzb', 'instagram'],
    ['instagram_main', 'Instagram Main', 'instagram'],
    ['telegram_uzb', 'Telegram Uzb', 'telegram'],
    ['telegram_main', 'Telegram Main', 'telegram'],
    ['target', 'Target', 'target'],
    ['youtube', 'YouTube', 'youtube'],
  ]

  // ---- pipeline statuses (mirrors the team's ClickUp board) ----
  const statusList = [
    ['Idea', '#8b8388', 0],
    ['To shoot', '#fab219', 0],
    ['Shot', '#ec835a', 0],
    ['Editing', '#b5324a', 0],
    ['Ready', '#2a78d6', 0],
    ['Published', '#0ca30c', 1],
  ]

  await batch([
    ...channels.map(([key, label, icon], i) =>
      ['INSERT INTO channels (key, label, icon, sort) VALUES (?, ?, ?, ?)', key, label, icon, i]),
    ...statusList.map(([label, color, final], i) =>
      ['INSERT INTO statuses (label, color, sort, is_final) VALUES (?, ?, ?, ?)', label, color, i, final]),
    [`
      INSERT INTO users (name, username, email, password_hash, role, departments, permissions, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, 'Admin', 'admin', null, bcrypt.hashSync('admin123', 10), 'admin', '[]', '{}', '#a32234', now()],
  ])
}

// The team's July–December campaign plan. Seeds once (also into existing
// databases), then never again — the admin owns the data from there.
export async function seedCampaignsIfEmpty() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'campaigns_seeded'")) return
  const stmts = []
  if ((await get('SELECT COUNT(*) AS n FROM campaigns')).n === 0) {
    const Y = new Date().getFullYear()
    const m = (mm) => `${Y}-${String(mm).padStart(2, '0')}`
    const plan = [
      { name: 'Admissions Hype', timing: 'July 10–15', channel: 'All channels + offline banners in key locations',
        audience: 'Internal for aura, external for awareness', goal: 'Stay top of mind in the college-prep community',
        duration: 'short', owner: 'Ourselves', months: [m(7)] },
      { name: 'Free App Launch', timing: 'July 15 – August 1', channel: 'All digital channels',
        audience: 'Self-preps and their parents', goal: 'Build brand awareness and consideration',
        notes: 'Depends on IT shipping a good product', duration: 'short', owner: 'Ourselves',
        status: 'Depends on IT delivery', months: [m(7), m(8)] },
      { name: 'Alumni Event', timing: 'August 22', channel: 'Digital internal first, digital and news after',
        audience: 'All audiences', goal: 'Brand awareness, loyalty and referrals',
        duration: 'short', owner: 'Ourselves', months: [m(8)] },
      { name: 'Ochilish — Grand Opening', timing: 'September, announce 15 days before',
        channel: 'External news, private channel, bloggers, influencers',
        audience: 'Chilanzar locals for consideration, others for aura', goal: 'Show scale — SATashkent is big',
        notes: 'Chilanzar branch', duration: 'short', owner: 'Ourselves', months: [m(9)] },
      { name: '20 Prep Students', timing: 'Starts once an owner is assigned', channel: 'Instagram, Telegram Uzbek, YouTube',
        audience: 'All audiences', goal: 'Constant exposure — show what happens inside',
        notes: 'Series following 20 students preparing', duration: 'long',
        status: 'Blocked — needs an owner before launch', ongoing: true },
      { name: 'Ambassadorlar', timing: 'Plan in August, launch in September', channel: 'Set by each ambassador',
        audience: 'Set by each ambassador', goal: 'SATashkent is global, not only local',
        notes: 'Pay top university students per video in August', duration: 'long', months: [m(8), m(9)] },
      { name: 'Kazakh Online Campaign', timing: 'July 15 onward', channel: 'satashkent.kz',
        audience: 'Kazakh audience and Shoxrux', goal: 'Run the second Kazakh Marathon',
        notes: '1–2 posts per month on the main account', duration: 'long', owner: 'Abdulaziz', ongoing: true },
      { name: 'Student Union Events', timing: 'Set by UB', channel: 'Instagram and Telegram where they fit',
        audience: 'Regional and priority audience', goal: 'Stay top of mind',
        notes: 'The Union runs regional events, we cover them', duration: 'long', owner: 'UB',
        status: 'Needs coordination with UB', ongoing: true },
      { name: 'YouTube', timing: 'July onward', channel: 'YouTube',
        audience: 'Learners and general audience', goal: 'High value and high conversion',
        duration: 'long', status: 'Needs a full owner', ongoing: true },
      { name: 'Football Competition', timing: 'Set by UB', channel: 'Where it fits',
        audience: 'Schools and lyceums', goal: 'The event everyone wants — SATashkent owns UC',
        notes: 'Confirmed', duration: 'short', owner: 'Ourselves', ongoing: true },
    ]
    plan.forEach((c, i) => stmts.push([`
      INSERT INTO campaigns (name, timing, channel, audience, goal, notes, duration, owner, status, ongoing, months, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, c.name, c.timing || '', c.channel || '', c.audience || '', c.goal || '', c.notes || '',
      c.duration || 'short', c.owner || '', c.status || '', c.ongoing ? 1 : 0,
      JSON.stringify(c.months || []), i]))
  }
  stmts.push(["INSERT OR REPLACE INTO meta (key, value) VALUES ('campaigns_seeded', '1')"])
  await batch(stmts)
}

// Schema + seeds, exactly once per process — serverless handlers await this
// before touching the database.
let initPromise
export function initDb() {
  initPromise ||= (async () => {
    await initSchema()
    await seedIfEmpty()
    await seedCampaignsIfEmpty()
  })()
  return initPromise
}

// API-safe user (no password hash); permissions merged with defaults.
export function publicUser(row) {
  if (!row) return null
  let perms = {}
  try { perms = JSON.parse(row.permissions || '{}') } catch { /* ignore */ }
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    role: row.role,
    departments: JSON.parse(row.departments || '[]'),
    permissions: { ...DEFAULT_PERMS, ...perms },
    color: row.color,
    created_at: row.created_at,
  }
}
