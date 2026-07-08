import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(join(DATA_DIR, 'dashboard.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// What a member may do unless the admin changes it (Telegram-style rights).
export const DEFAULT_PERMS = {
  edit_metrics: true,    // change metric values (+/-)
  manage_metrics: false, // add / rename / retarget / delete metrics
  manage_layout: false,  // reorder metrics, pin the main metric
  manage_content: true,  // create & edit content tasks, dates, details
  move_tasks: true,      // drag tasks between stages / days
}
export const PERM_KEYS = Object.keys(DEFAULT_PERMS)

export function initSchema() {
  db.exec(`
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

  migrate()
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `)
}

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)
}

function migrate() {
  if (!hasColumn('users', 'permissions')) db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'")
  if (!hasColumn('trackers', 'content_type')) db.exec('ALTER TABLE trackers ADD COLUMN content_type TEXT')
  // Older databases stored a single channel per task — rebuild to the new shape.
  if (hasColumn('content', 'channel')) {
    db.exec(`
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
  if (!hasColumn('content', 'todo_sort')) db.exec('ALTER TABLE content ADD COLUMN todo_sort INTEGER NOT NULL DEFAULT 0')
}

export function getChannelKeys() {
  return db.prepare('SELECT key FROM channels ORDER BY sort').all().map((r) => r.key)
}

// Record today's value for a metric (upsert), so comparisons have data.
export function snapshotTracker(trackerId) {
  const row = db.prepare('SELECT current FROM trackers WHERE id = ?').get(trackerId)
  if (!row) return
  db.prepare(`
    INSERT INTO metric_history (tracker_id, date, value) VALUES (?, ?, ?)
    ON CONFLICT(tracker_id, date) DO UPDATE SET value = excluded.value
  `).run(trackerId, dayISO(0), row.current)
}

// Task types that can bind to a channel's plan metric.
export const CONTENT_TYPES = ['post', 'reel', 'story', 'video', 'other']
export const TYPE_PLAN_LABELS = { post: 'Posts', reel: 'Reels', story: 'Stories', video: 'Videos' }

// The plan metric for (channel, type) — optionally created on first use, so a
// new task always has a plan to count toward.
export function planTracker(channel, type, createIfMissing = false) {
  if (!TYPE_PLAN_LABELS[type]) return null
  let t = db.prepare('SELECT * FROM trackers WHERE department = ? AND content_type = ? ORDER BY sort, id').get(channel, type)
  if (!t && createIfMissing) {
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM trackers WHERE department = ?').get(channel).m
    const info = db.prepare(`
      INSERT INTO trackers (department, label, current, target, unit, period, content_type, sort, updated_at)
      VALUES (?, ?, 0, 0, ?, 'monthly', ?, ?, ?)
    `).run(channel, TYPE_PLAN_LABELS[type], `${type}s`, type, maxSort + 1, new Date().toISOString())
    t = db.prepare('SELECT * FROM trackers WHERE id = ?').get(info.lastInsertRowid)
  }
  return t
}

// Move a channel plan: creating a task raises the plan (target +1), completing
// it fills it (current +1); deleting / un-completing walks both back.
export function bumpPlan(channel, type, { target = 0, current = 0 }, createIfMissing = false) {
  const t = planTracker(channel, type, createIfMissing)
  if (!t) return
  db.prepare('UPDATE trackers SET target = ?, current = ?, updated_at = ? WHERE id = ?')
    .run(Math.max(0, t.target + target), Math.max(0, t.current + current), new Date().toISOString(), t.id)
  snapshotTracker(t.id)
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

export function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return

  // ---- channels ----
  const insertChannel = db.prepare('INSERT INTO channels (key, label, icon, sort) VALUES (?, ?, ?, ?)')
  const channels = [
    ['instagram_uzb', 'Instagram Uzb', 'instagram'],
    ['instagram_main', 'Instagram Main', 'instagram'],
    ['telegram_uzb', 'Telegram Uzb', 'telegram'],
    ['telegram_main', 'Telegram Main', 'telegram'],
    ['target', 'Target', 'target'],
    ['youtube', 'YouTube', 'youtube'],
  ]
  channels.forEach(([key, label, icon], i) => insertChannel.run(key, label, icon, i))
  const CH = channels.map((c) => c[0])

  // ---- pipeline statuses (mirrors the team's ClickUp board) ----
  const insertStatus = db.prepare('INSERT INTO statuses (label, color, sort, is_final) VALUES (?, ?, ?, ?)')
  const statusIds = {}
  ;[
    ['Idea', '#8b8388', 0],
    ['To shoot', '#fab219', 0],
    ['Shot', '#ec835a', 0],
    ['Editing', '#b5324a', 0],
    ['Ready', '#2a78d6', 0],
    ['Published', '#0ca30c', 1],
  ].forEach(([label, color, final], i) => {
    statusIds[label] = insertStatus.run(label, color, i, final).lastInsertRowid
  })

  // ---- users ----
  const insertUser = db.prepare(`
    INSERT INTO users (name, username, email, password_hash, role, departments, permissions, color, created_at)
    VALUES (@name, @username, @email, @password_hash, @role, @departments, @permissions, @color, @created_at)
  `)
  const hash = (pw) => bcrypt.hashSync(pw, 10)
  const users = [
    { name: 'Aziza (Admin)', username: 'admin',   pw: 'admin123', role: 'admin',  departments: [],                                   color: '#a32234' },
    { name: 'Dilnoza',       username: 'dilnoza', pw: 'media123', role: 'member', departments: ['instagram_uzb', 'instagram_main'], color: '#c0392b' },
    { name: 'Malika',        username: 'malika',  pw: 'tg123',    role: 'member', departments: ['telegram_uzb', 'telegram_main'],   color: '#b5324a' },
    { name: 'Bekzod',        username: 'bekzod',  pw: 'perf123',  role: 'member', departments: ['target'],                          color: '#8c1d2c' },
    { name: 'Sardor',        username: 'sardor',  pw: 'yt123',    role: 'member', departments: ['youtube'],                         color: '#711523' },
  ]
  const ids = {}
  for (const u of users) {
    ids[u.username] = insertUser.run({
      name: u.name, username: u.username, email: null, password_hash: hash(u.pw),
      role: u.role, departments: JSON.stringify(u.departments), permissions: '{}',
      color: u.color, created_at: now(),
    }).lastInsertRowid
  }

  // ---- metrics ----
  // ct = plan metric bound to a task type; without ct it's a manual number.
  const insertTracker = db.prepare(`
    INSERT INTO trackers (department, label, current, target, unit, period, content_type, is_primary, sort, updated_at)
    VALUES (@department, @label, @current, @target, @unit, @period, @content_type, @is_primary, @sort, @updated_at)
  `)
  const trackers = [
    { department: 'instagram_uzb', label: 'Followers', current: 3420,  target: 4000,  unit: '',        period: 'monthly' },
    { department: 'instagram_uzb', label: 'Reels',     current: 8,     target: 18,    unit: 'reels',   period: 'monthly', ct: 'reel' },
    { department: 'instagram_uzb', label: 'Posts',     current: 4,     target: 12,    unit: 'posts',   period: 'monthly', ct: 'post' },
    { department: 'instagram_uzb', label: 'Stories',   current: 3,     target: 3,     unit: 'stories', period: 'daily',   ct: 'story' },
    { department: 'instagram_uzb', label: 'Reach',     current: 12000, target: 25000, unit: '',        period: 'monthly' },
    { department: 'instagram_main', label: 'Followers', current: 9800,  target: 12000, unit: '',      period: 'monthly' },
    { department: 'instagram_main', label: 'Reels',     current: 6,     target: 16,    unit: 'reels', period: 'monthly', ct: 'reel' },
    { department: 'instagram_main', label: 'Posts',     current: 5,     target: 12,    unit: 'posts', period: 'monthly', ct: 'post' },
    { department: 'instagram_main', label: 'Reach',     current: 41000, target: 60000, unit: '',      period: 'monthly' },
    { department: 'telegram_uzb', label: 'Subscribers', current: 2100, target: 3000,  unit: '',      period: 'monthly' },
    { department: 'telegram_uzb', label: 'Posts',       current: 12,   target: 28,    unit: 'posts', period: 'monthly', ct: 'post' },
    { department: 'telegram_uzb', label: 'Views',       current: 8500, target: 15000, unit: '',      period: 'monthly' },
    { department: 'telegram_main', label: 'Subscribers', current: 5400,  target: 6000,  unit: '',      period: 'monthly' },
    { department: 'telegram_main', label: 'Posts',       current: 15,    target: 28,    unit: 'posts', period: 'monthly', ct: 'post' },
    { department: 'telegram_main', label: 'Views',       current: 22000, target: 30000, unit: '',      period: 'monthly' },
    { department: 'target', label: 'Leads',           current: 240,  target: 500,  unit: 'leads',     period: 'monthly' },
    { department: 'target', label: 'Campaigns live',  current: 3,    target: 5,    unit: 'campaigns', period: 'weekly' },
    { department: 'target', label: 'Creatives ready', current: 6,    target: 10,   unit: 'creatives', period: 'weekly' },
    { department: 'target', label: 'Budget used',     current: 1200, target: 2000, unit: '$',         period: 'monthly' },
    { department: 'youtube', label: 'Subscribers', current: 1450,  target: 2000,  unit: '',       period: 'monthly' },
    { department: 'youtube', label: 'Videos',      current: 2,     target: 4,     unit: 'videos', period: 'monthly', ct: 'video' },
    { department: 'youtube', label: 'Shorts',      current: 5,     target: 12,    unit: 'shorts', period: 'monthly', ct: 'reel' },
    { department: 'youtube', label: 'Views',       current: 18000, target: 40000, unit: '',       period: 'monthly' },
  ]
  // Pinned metrics sit at the top of the channel page (any number per channel).
  const PINNED = {
    instagram_uzb: ['Followers', 'Reels'],
    instagram_main: ['Followers', 'Reels'],
    telegram_uzb: ['Subscribers', 'Posts'],
    telegram_main: ['Subscribers', 'Posts'],
    target: ['Leads', 'Campaigns live'],
    youtube: ['Subscribers', 'Videos'],
  }
  const trackerIds = {}
  trackers.forEach((t, i) => {
    const id = insertTracker.run({
      department: t.department, label: t.label, current: t.current, target: t.target,
      unit: t.unit, period: t.period, content_type: t.ct || null,
      is_primary: PINNED[t.department]?.includes(t.label) ? 1 : 0, sort: i, updated_at: now(),
    }).lastInsertRowid
    trackerIds[`${t.department}:${t.label}`] = id
  })

  // ---- metric history (~9 weeks of plausible growth, for comparisons) ----
  const insertHist = db.prepare('INSERT OR IGNORE INTO metric_history (tracker_id, date, value) VALUES (?, ?, ?)')
  for (const t of trackers) {
    const id = trackerIds[`${t.department}:${t.label}`]
    for (let w = 9; w >= 1; w--) {
      const value = Math.max(0, Math.round(t.current * (1 - 0.045 * w)))
      insertHist.run(id, dayISO(-7 * w), value)
    }
    insertHist.run(id, dayISO(-1), Math.max(0, Math.round(t.current * 0.985)))
    insertHist.run(id, dayISO(0), t.current)
  }

  // ---- content tasks (board + calendars + to-do all read these) ----
  const insertContent = db.prepare(`
    INSERT INTO content (title, channels, type, assignee_id, created_by, status_id,
      recording_date, recording_time, release_date, release_time, description, checklist, todo_sort, done_at, created_at)
    VALUES (@title, @channels, @type, @assignee_id, @created_by, @status_id,
      @recording_date, @recording_time, @release_date, @release_time, @description, @checklist, @todo_sort, @done_at, @created_at)
  `)
  const admin = ids['admin']
  const items = [
    { title: 'Educational video: SAT tips', channels: ['instagram_uzb'], type: 'reel', assignee: 'dilnoza', status: 'To shoot',
      rec: [1, '10:00'], rel: [4, '18:00'],
      checklist: [{ text: 'Write script', done: true }, { text: 'Book location', done: false }, { text: 'Prepare equipment', done: false }] },
    { title: 'Results reel: Solohiddin', channels: ['instagram_main'], type: 'reel', assignee: 'dilnoza', status: 'Editing',
      rec: [-2, '11:00'], rel: [2, '17:00'],
      checklist: [{ text: 'Rough cut', done: true }, { text: 'Subtitles', done: false }] },
    { title: 'Toy Story post — Ulugbek', channels: ['instagram_uzb'], type: 'post', assignee: 'dilnoza', status: 'Idea',
      rel: [6, '15:00'], checklist: [] },
    // One task, two platforms — it counts toward both channels' plans.
    { title: 'AP Results post', channels: ['instagram_main', 'instagram_uzb'], type: 'post', assignee: 'dilnoza', status: 'Ready',
      rel: [1, '12:00'], checklist: [{ text: 'Design carousel', done: true }] },
    { title: 'Morning quiz', channels: ['telegram_uzb'], type: 'post', assignee: 'malika', status: 'Published',
      rel: [-1, '09:00'], done: true, checklist: [] },
    { title: 'Open day announcement', channels: ['telegram_main'], type: 'post', assignee: 'malika', status: 'Ready',
      rel: [2, '11:00'], checklist: [] },
    { title: 'Interview: Jasmina (Shahriston opening)', channels: ['youtube'], type: 'video', assignee: 'sardor', status: 'Shot',
      rec: [0, '13:00'], rel: [7, '18:00'],
      checklist: [{ text: 'Record interview', done: true }, { text: 'B-roll', done: false }, { text: 'Thumbnail', done: false }] },
    { title: 'New creatives batch', channels: ['target'], type: 'other', assignee: 'bekzod', status: 'Editing',
      rel: [3, '10:00'], checklist: [] },
  ]
  items.forEach((it, i) => {
    insertContent.run({
      title: it.title,
      channels: JSON.stringify(it.channels),
      type: it.type,
      assignee_id: ids[it.assignee],
      created_by: admin,
      status_id: statusIds[it.status],
      recording_date: it.rec ? dayISO(it.rec[0]) : null,
      recording_time: it.rec ? it.rec[1] : null,
      release_date: it.rel ? dayISO(it.rel[0]) : null,
      release_time: it.rel ? it.rel[1] : null,
      description: '',
      checklist: JSON.stringify(it.checklist || []),
      todo_sort: i,
      done_at: it.done ? now() : null,
      created_at: now(),
    })
  })
}

// The team's July–December campaign plan. Seeds once (also into existing
// databases), then never again — the admin owns the data from there.
export function seedCampaignsIfEmpty() {
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'campaigns_seeded'").get()) return
  if (db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n === 0) {
    const Y = new Date().getFullYear()
    const m = (mm) => `${Y}-${String(mm).padStart(2, '0')}`
    const insert = db.prepare(`
      INSERT INTO campaigns (name, timing, channel, audience, goal, notes, duration, owner, status, ongoing, months, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
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
    plan.forEach((c, i) => insert.run(
      c.name, c.timing || '', c.channel || '', c.audience || '', c.goal || '', c.notes || '',
      c.duration || 'short', c.owner || '', c.status || '', c.ongoing ? 1 : 0,
      JSON.stringify(c.months || []), i,
    ))
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('campaigns_seeded', '1')").run()
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
