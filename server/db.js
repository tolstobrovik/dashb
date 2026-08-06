// Database layer with three interchangeable backends behind one tiny API:
//  - Postgres: DATABASE_URL / POSTGRES_URL present — the production choice.
//              Durable, fast, and hosts inject the connection automatically
//              (Vercel Storage → Neon, Render blueprint database, Supabase...),
//              so there is nothing to configure by hand.
//  - Turso:    TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) — remote SQLite over
//              HTTPS, no native binaries. Kept as an alternative.
//  - file:     local dev / any VPS — a SQLite file under ./data (override with
//              DATA_DIR). On serverless hosts without any database URL it
//              falls back to /tmp, which resets on cold starts — demo mode.
import bcrypt from 'bcryptjs'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, rmSync, renameSync, existsSync } from 'fs'
import { DATABASE_URL as CONFIG_DATABASE_URL, GITHUB_DATA } from './config.js'
import { createGhStore } from './ghstore.js'

const PG_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING ||
  CONFIG_DATABASE_URL || ''
const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || ''
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined
export const IS_PG = !!PG_URL

const __dirname = dirname(fileURLToPath(import.meta.url))
const ON_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY)
const DATA_DIR = process.env.DATA_DIR || (ON_SERVERLESS ? '/tmp/satashkent-data' : join(__dirname, '..', 'data'))

// GitHub-repo storage engages on serverless hosts (or when forced for tests)
// whenever no real database URL is configured — the repo itself holds the data.
const GH_MODE = !PG_URL && !TURSO_URL && !!GITHUB_DATA?.token &&
  (ON_SERVERLESS || process.env.GITHUB_DATA_FORCE === '1')
export const STORAGE = IS_PG ? 'postgres' : TURSO_URL ? 'turso' : GH_MODE ? 'github' : 'file'

// Rewrite `?` placeholders to Postgres's $1..$n (skipping string literals).
function toPgSql(sql) {
  let out = ''
  let n = 0
  let inStr = false
  for (const ch of sql) {
    if (ch === "'") inStr = !inStr
    if (ch === '?' && !inStr) out += `$${++n}`
    else out += ch
  }
  return out
}

async function createPgBackend() {
  const { default: pg } = await import('pg')
  pg.types.setTypeParser(20, (v) => parseInt(v, 10)) // int8 (e.g. COUNT(*)) → number
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(PG_URL)
  const pool = new pg.Pool({
    connectionString: PG_URL,
    max: ON_SERVERLESS ? 3 : 10, // hosted Postgres URLs are pooled; stay modest per instance
    idleTimeoutMillis: 30000,
    ssl: local ? undefined : { rejectUnauthorized: false },
  })
  const query = (sql, args) => pool.query(toPgSql(sql), args)
  return {
    all: async (sql, args) => (await query(sql, args)).rows,
    run: async (sql, args) => {
      // Emulate SQLite's lastInsertRowid — every table run() inserts into has
      // an `id` primary key.
      const wantsId = /^\s*insert\s/i.test(sql) && !/returning/i.test(sql)
      const res = await query(wantsId ? `${sql} RETURNING id` : sql, args)
      return { changes: res.rowCount, lastInsertRowid: res.rows?.[0]?.id }
    },
    batch: async (stmts) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out = []
        for (const [sql, ...args] of stmts) out.push((await client.query(toPgSql(sql), args)).rows)
        await client.query('COMMIT')
        return out
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        client.release()
      }
    },
    exec: (sql) => pool.query(sql),
    close: () => pool.end().catch(() => {}),
  }
}

const rowsOf = (rs) => rs.rows.map((r) => {
  const o = {}
  rs.columns.forEach((c, i) => { o[c] = r[i] })
  return o
})

async function createLibsqlBackend() {
  let client
  if (TURSO_URL) {
    const { createClient } = await import('@libsql/client/web')
    client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN, intMode: 'number' })
  } else {
    const { createClient } = await import('@libsql/client')
    mkdirSync(DATA_DIR, { recursive: true })
    client = createClient({ url: `file:${join(DATA_DIR, 'dashboard.db')}`, intMode: 'number' })
  }
  return {
    all: async (sql, args) => rowsOf(await client.execute({ sql, args })),
    run: async (sql, args) => {
      const rs = await client.execute({ sql, args })
      return {
        changes: rs.rowsAffected,
        lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid),
      }
    },
    batch: async (stmts) =>
      (await client.batch(stmts.map(([sql, ...args]) => ({ sql, args })), 'write')).map(rowsOf),
    exec: (sql) => client.executeMultiple(sql),
    close: () => client.close(),
  }
}

// SQLite in /tmp as the working copy; the GitHub repo as the durable copy.
// Reads check the data branch head (cheap, throttled) and re-download when
// another instance wrote; writes are journaled and uploaded once per request
// with compare-and-swap — on a conflict the fresh remote copy is pulled and
// this instance's unflushed statements are replayed on top, then retried.
async function createGithubBackend() {
  const { createClient } = await import('@libsql/client')
  const store = createGhStore(GITHUB_DATA)
  mkdirSync(DATA_DIR, { recursive: true })
  const file = join(DATA_DIR, 'dashboard.db')

  let client = null
  let journal = []   // unflushed write statements since the last upload
  let dirty = false
  let lastCheck = 0
  let syncing = null // serializes pull/swap/replay
  let writing = 0    // write statements in flight — drained before a swap
  let flushError = null
  let flushes = 0
  let cleanHash = null // file hash as of the last pull/upload — skips no-op flushes

  const hashOf = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const openClient = () => createClient({ url: `file:${file}`, intMode: 'number' })

  // Swap in a fresh copy atomically: write beside the live file, rename over
  // it, then reopen. Queries running on the old handle keep reading the old
  // inode until it is closed a moment later — nothing ever sees a half file.
  const applyBytes = async (bytes) => {
    while (writing > 0) await new Promise((r) => setTimeout(r, 10))
    const old = client
    writeFileSync(`${file}.tmp`, bytes)
    for (const suffix of ['-wal', '-shm', '-journal']) {
      if (existsSync(file + suffix)) rmSync(file + suffix)
    }
    renameSync(`${file}.tmp`, file)
    cleanHash = hashOf(bytes)
    client = openClient()
    if (old) setTimeout(() => { try { old.close() } catch { /* already closed */ } }, 5000).unref?.()
  }

  const replayJournal = async () => {
    for (const entry of journal) {
      if (entry.exec) await client.executeMultiple(entry.exec)
      else await client.execute({ sql: entry.sql, args: entry.args })
    }
  }

  const sync = (force = false) => {
    if (syncing) return syncing
    if (!force && Date.now() - lastCheck < 4000) return Promise.resolve()
    syncing = (async () => {
      try {
        const { changed, bytes } = await store.pull()
        lastCheck = Date.now()
        if (changed && bytes) {
          await applyBytes(bytes)
          if (journal.length) await replayJournal()
        }
      } catch (e) {
        // A GitHub hiccup must not fail the user's request — serve the local
        // copy and try again on a later call. Writes stay journaled, and the
        // compare-and-swap upload keeps correctness whenever GitHub is back.
        lastCheck = Date.now()
        console.error('GitHub data sync failed:', e.message)
      } finally {
        syncing = null
      }
    })()
    return syncing
  }

  // First boot: one download brings sha + contents together; the branch only
  // needs creating the very first time the app ever runs. GitHub blips at
  // cold start are retried here, and a still-failing boot is thrown to the
  // caller — which retries the whole backend on the next request rather than
  // caching the rejection for the life of the instance.
  let initial
  for (let attempt = 0; ; attempt++) {
    try {
      initial = await store.pull()
      break
    } catch (e) {
      if (attempt >= 2) throw e
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  if (!initial.exists) await store.ensureBranch()
  lastCheck = Date.now()
  if (initial.bytes) {
    writeFileSync(file, initial.bytes)
    cleanHash = hashOf(initial.bytes)
  } else if (existsSync(file)) rmSync(file) // stale /tmp leftovers from a previous instance
  client = openClient()

  const flush = async () => {
    if (!dirty) return
    // Idempotent statements (schema init on a warm database, same-value
    // updates) leave the file byte-identical — skip the round-trip entirely.
    if (hashOf(readFileSync(file)) === cleanHash) {
      journal = []
      dirty = false
      flushError = null
      return
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const bytes = readFileSync(file)
        const result = await store.push(bytes)
        if (result === true) {
          journal = []
          dirty = false
          flushError = null
          cleanHash = hashOf(bytes)
          // Compact the data branch periodically even if the nightly cron
          // never fires — one commit per ~100 keeps the repo small forever.
          if (++flushes % 100 === 0) await store.squash(readFileSync(file)).catch(() => {})
          return
        }
        await sync(true) // conflict: pull fresh copy, replay journal, retry
      } catch (e) {
        flushError = e.message
        console.error('GitHub data flush failed:', e.message)
        return
      }
    }
    flushError = 'conflict retries exhausted'
    console.error('GitHub data flush failed: conflict retries exhausted')
  }

  return {
    all: async (sql, args) => {
      await sync()
      return rowsOf(await client.execute({ sql, args }))
    },
    run: async (sql, args) => {
      await sync()
      writing++
      try {
        const rs = await client.execute({ sql, args })
        journal.push({ sql, args })
        dirty = true
        return {
          changes: rs.rowsAffected,
          lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid),
        }
      } finally {
        writing--
      }
    },
    batch: async (stmts) => {
      await sync()
      writing++
      try {
        const out = (await client.batch(stmts.map(([sql, ...args]) => ({ sql, args })), 'write')).map(rowsOf)
        for (const [sql, ...args] of stmts) journal.push({ sql, args })
        dirty = true
        return out
      } finally {
        writing--
      }
    },
    exec: async (sql) => {
      await sync()
      writing++
      try {
        await client.executeMultiple(sql)
        journal.push({ exec: sql })
        dirty = true
      } finally {
        writing--
      }
    },
    close: () => client.close(),
    flush,
    resync: () => sync(true),
    status: () => ({ dirty, flushError }),
    squash: async () => {
      await flush()
      const result = await store.squash(readFileSync(file))
      if (result !== true) throw new Error('squash upload conflicted')
    },
  }
}

// The backend boots lazily and NEVER caches a failure: a GitHub outage during
// a cold start used to reject this promise once and poison the instance for
// its whole life — every request answered 500 until the host recycled it.
// Now a failed boot clears itself and the next request simply tries again.
let backendPromise
function backend() {
  backendPromise ||= (IS_PG ? createPgBackend() : GH_MODE ? createGithubBackend() : createLibsqlBackend())
    .catch((e) => { backendPromise = undefined; throw e })
  return backendPromise
}

// Persist any journaled writes to GitHub (no-op on the other backends). The
// serverless entry awaits this after each response; the long-running server
// calls it on an interval and at shutdown.
export async function flushPending() {
  const b = await backend()
  if (b.flush) await b.flush()
}
export async function storageStatus() {
  const b = await backend()
  return { storage: STORAGE, ...(b.status ? b.status() : {}) }
}
// Force-refresh the local copy from the durable store (github mode only) —
// used when a just-created user isn't visible to this instance yet.
export async function resyncStorage() {
  const b = await backend()
  if (b.resync) await b.resync()
}
// Compact the GitHub data branch to one commit (no-op on other backends).
export async function squashData() {
  const b = await backend()
  if (b.squash) await b.squash()
}

const cleanArgs = (args) => args.map((v) => (v === undefined ? null : v))

export async function all(sql, ...args) {
  return (await backend()).all(sql, cleanArgs(args))
}
export async function get(sql, ...args) {
  return (await all(sql, ...args))[0]
}
export async function run(sql, ...args) {
  return (await backend()).run(sql, cleanArgs(args))
}
// One transaction: statements as [sql, ...args]; returns each statement's rows.
export async function batch(stmts) {
  return (await backend()).batch(stmts.map(([sql, ...args]) => [sql, ...cleanArgs(args)]))
}
export async function exec(sql) {
  await (await backend()).exec(sql)
}
export function closeDb() {
  if (backendPromise) backendPromise.then((b) => b.close()).catch(() => {})
}

// The whole app lives on the team's clock: a "day" starts at midnight in
// Tashkent (UTC+5) no matter where the server or the browser happens to run.
export const TIMEZONE = 'Asia/Tashkent'
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }) // YYYY-MM-DD
export function dayISO(offset = 0) {
  return dayFmt.format(new Date(Date.now() + offset * 86400000))
}
// The Tashkent calendar day of a full ISO timestamp.
export const tashkentDay = (iso) => dayFmt.format(new Date(iso))

// What a member may do unless the admin changes it (Telegram-style rights).
export const DEFAULT_PERMS = {
  edit_metrics: true,     // change metric values (+/-)
  manage_metrics: false,  // add / rename / retarget / delete metrics
  manage_layout: false,   // reorder metrics, pin the main metric
  manage_content: true,   // create & edit content tasks, dates, details
  move_tasks: true,       // drag tasks between stages / days
  review_publish: true,   // move Ready → Published on a channel you're on (SMM)
  request_changes: true,  // send a task back to the crew for fixes (Pravki)
  deliver_work: true,     // deliver / re-deliver a stage's file link
}
export const PERM_KEYS = Object.keys(DEFAULT_PERMS)

export async function initSchema() {
  // The only dialect difference is the auto-increment primary key.
  const ID = IS_PG ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            ${ID},
      name          TEXT    NOT NULL,
      username      TEXT    NOT NULL,
      email         TEXT,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'member',
      crew_roles    TEXT    NOT NULL DEFAULT '[]',
      departments   TEXT    NOT NULL DEFAULT '[]',
      permissions   TEXT    NOT NULL DEFAULT '{}',
      color         TEXT    NOT NULL DEFAULT '#a32234',
      avatar        TEXT,
      phone         TEXT,
      position      TEXT,
      duties        TEXT,
      work_start    TEXT,
      work_end      TEXT,
      work_days     TEXT,
      telegram_chat_id TEXT,
      telegram_code    TEXT,
      created_at    TEXT    NOT NULL
    );

    -- Sidebar channels are data, not code: the admin adds/renames/reorders them.
    CREATE TABLE IF NOT EXISTS channels (
      id      ${ID},
      key     TEXT UNIQUE NOT NULL,
      label   TEXT NOT NULL,
      icon    TEXT NOT NULL DEFAULT 'star',
      head_id INTEGER,
      sort    INTEGER NOT NULL DEFAULT 0
    );

    -- content_type binds a metric to a task type (post/reel/story/video):
    -- creating a task of that type raises the plan (target +1), completing it
    -- fills it (current +1). NULL = a manual number (followers, reach, ...).
    CREATE TABLE IF NOT EXISTS trackers (
      id           ${ID},
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
      id         ${ID},
      tracker_id INTEGER NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
      date       TEXT    NOT NULL,
      value      INTEGER NOT NULL,
      UNIQUE(tracker_id, date)
    );

    -- The content pipeline stages (editable by the admin).
    CREATE TABLE IF NOT EXISTS statuses (
      id       ${ID},
      label    TEXT NOT NULL,
      color    TEXT NOT NULL DEFAULT '#8b8388',
      sort     INTEGER NOT NULL DEFAULT 0,
      is_final INTEGER NOT NULL DEFAULT 0
    );

    -- One content task = one card on the board, one pill on both calendars,
    -- one row in the to-do list. A task can live on several channels at once
    -- (channels = JSON array); its type binds it to each channel's plan metric.
    CREATE TABLE IF NOT EXISTS content (
      id             ${ID},
      title          TEXT    NOT NULL,
      channels       TEXT    NOT NULL DEFAULT '[]',
      type           TEXT    NOT NULL DEFAULT 'post',
      assignee_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assignees      TEXT    NOT NULL DEFAULT '[]', -- every assignee; assignee_id mirrors the first
      created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status_id      INTEGER REFERENCES statuses(id) ON DELETE SET NULL,
      recording_date TEXT,
      recording_time TEXT,
      recording_end  TEXT,
      edit_ready_date TEXT,  -- the EDITOR's deadline: the cut must be ready
      design_ready_date TEXT, -- the DESIGNER's deadline: the artwork must be ready
      ready_at       TEXT,   -- when it first reached ready/final — late-work proof
      ready_link     TEXT,   -- the editor's finished cut (the "Edit ready" link)
      shot_link      TEXT,   -- operator's raw footage link (Google Drive)
      design_link    TEXT,   -- designer's finished artwork link
      reference_text TEXT,   -- style / mood / length / format notes for the crew
      reference_links TEXT   NOT NULL DEFAULT '[]', -- example URLs (reference videos/posts)
      format         TEXT,   -- the shape of the piece: talking head, split screen…
      rubrika        TEXT,   -- the recurring column (rubric) it belongs to
      script         TEXT,   -- the written script / shot plan
      release_date   TEXT,
      release_time   TEXT,
      description    TEXT    NOT NULL DEFAULT '',
      photo          TEXT,
      operator_id    INTEGER,
      editor_id      INTEGER,
      designer_id    INTEGER, -- posts are designed, not shot: one designer hat
      checklist      TEXT    NOT NULL DEFAULT '[]',
      todo_sort      INTEGER NOT NULL DEFAULT 0,
      pinned         INTEGER NOT NULL DEFAULT 0,
      photo_thumb    TEXT,
      done_at        TEXT,
      created_at     TEXT    NOT NULL
    );

    -- Campaign plan (admin): overview table, month calendar, project list.
    CREATE TABLE IF NOT EXISTS campaigns (
      id       ${ID},
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
      checklist TEXT NOT NULL DEFAULT '[]',    -- [{"text","done"}, ...]
      sort     INTEGER NOT NULL DEFAULT 0
    );

    -- Whiteboards (org structure, planning): cards can be bound to a team
    -- member and linked into a hierarchy; data = {"nodes":[],"edges":[]}.
    CREATE TABLE IF NOT EXISTS boards (
      id         ${ID},
      name       TEXT NOT NULL,
      data       TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
      created_by INTEGER,
      updated_at TEXT NOT NULL
    );

    -- Projects: permanent areas of the business with one owner. No start or
    -- end date — a project that needs dates is a campaign. Checklist items:
    -- [{text, owner_id, due, done, done_at}].
    CREATE TABLE IF NOT EXISTS projects (
      id            ${ID},
      name          TEXT NOT NULL,
      owner_id      INTEGER,
      metric        TEXT NOT NULL DEFAULT '',
      target        REAL NOT NULL DEFAULT 0,
      actual        REAL NOT NULL DEFAULT 0,
      deadline      TEXT,
      status        TEXT NOT NULL DEFAULT 'active',  -- active | paused | closed
      description   TEXT NOT NULL DEFAULT '',
      success       TEXT NOT NULL DEFAULT '',        -- what "done well" means
      budget        REAL,
      checklist     TEXT NOT NULL DEFAULT '[]',
      photo         TEXT,
      photo_thumb   TEXT,
      last_activity TEXT,
      created_at    TEXT NOT NULL
    );

    -- Dated free-text notes on projects and campaigns. Author and date are
    -- automatic; notes count as project activity.
    CREATE TABLE IF NOT EXISTS notes (
      id         ${ID},
      kind       TEXT    NOT NULL,   -- 'project' | 'campaign'
      ref_id     INTEGER NOT NULL,
      author_id  INTEGER,
      text       TEXT    NOT NULL,
      created_at TEXT    NOT NULL
    );

    -- Personal tasks: each account's private checklist in To-Do. Never shown
    -- to anyone else and never part of channel boards, calendars or plans.
    CREATE TABLE IF NOT EXISTS personal_tasks (
      id         ${ID},
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL,
      note       TEXT    NOT NULL DEFAULT '',
      due_date   TEXT,
      pinned     INTEGER NOT NULL DEFAULT 0,
      sort       INTEGER NOT NULL DEFAULT 0,
      done_at    TEXT,
      created_at TEXT    NOT NULL
    );

    -- Launch programs (built for the Target team's ad launches): a named run
    -- with dates and a hand-set state — planned, running, halted, finished.
    -- Shown as a Gantt on the channel dashboard ('programs' widget).
    CREATE TABLE IF NOT EXISTS programs (
      id         ${ID},
      channel    TEXT    NOT NULL,
      name       TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'planned',
      platform   TEXT    NOT NULL DEFAULT 'both',
      branches   TEXT    NOT NULL DEFAULT '[]',
      start_date TEXT,
      end_date   TEXT,
      budget     REAL,
      note       TEXT    NOT NULL DEFAULT '',
      checklist  TEXT    NOT NULL DEFAULT '[]',
      creatives  TEXT    NOT NULL DEFAULT '[]',
      created_at TEXT    NOT NULL
    );

    -- Hiring needs: the positions the team still has to fill.
    CREATE TABLE IF NOT EXISTS hiring (
      id         ${ID},
      title      TEXT    NOT NULL,
      note       TEXT    NOT NULL DEFAULT '',
      priority   INTEGER NOT NULL DEFAULT 0,
      status     TEXT    NOT NULL DEFAULT 'open',
      created_at TEXT    NOT NULL
    );

    -- Candidates: the people we're considering for those positions.
    CREATE TABLE IF NOT EXISTS candidates (
      id         ${ID},
      name       TEXT    NOT NULL,
      contacts   TEXT    NOT NULL DEFAULT '',
      position   TEXT    NOT NULL DEFAULT '',
      salary     TEXT    NOT NULL DEFAULT '',
      portfolio  TEXT    NOT NULL DEFAULT '',
      experience TEXT    NOT NULL DEFAULT '',
      notes      TEXT    NOT NULL DEFAULT '',
      stage      TEXT    NOT NULL DEFAULT 'new',
      created_at TEXT    NOT NULL
    );

    -- Per-person paperwork: SOPs, responsibility sheets and other documents
    -- shared between the company and one member. Files ride as data URLs;
    -- lists never carry the bytes (see routes/docs.js).
    CREATE TABLE IF NOT EXISTS person_docs (
      id          ${ID},
      user_id     INTEGER NOT NULL,
      kind        TEXT    NOT NULL DEFAULT 'sop',
      title       TEXT    NOT NULL,
      file_name   TEXT    NOT NULL,
      mime        TEXT    NOT NULL DEFAULT 'application/pdf',
      data        TEXT    NOT NULL,
      size        INTEGER NOT NULL DEFAULT 0,
      uploaded_by INTEGER,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    -- Per-person KPIs, managed in one place: target, current standing, and
    -- who last touched it when.
    CREATE TABLE IF NOT EXISTS person_kpis (
      id         ${ID},
      user_id    INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      target     TEXT    NOT NULL DEFAULT '',
      current    TEXT    NOT NULL DEFAULT '',
      unit       TEXT    NOT NULL DEFAULT '',
      notes      TEXT    NOT NULL DEFAULT '',
      sort       INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER,
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

    -- Pravki (revisions): when the SMM reviews a Ready task and asks for
    -- changes, one row records the round, who asked, which crew stage it went
    -- back to, and the change note. Plain history — no escalation logic.
    CREATE TABLE IF NOT EXISTS revisions (
      id             ${ID},
      content_id     INTEGER NOT NULL,
      round          INTEGER NOT NULL DEFAULT 1,
      requested_by   INTEGER,
      requested_name TEXT    NOT NULL DEFAULT '',
      target         TEXT    NOT NULL DEFAULT 'editor', -- operator | editor | designer
      note           TEXT    NOT NULL DEFAULT '',
      created_at     TEXT    NOT NULL,
      resolved_at    TEXT
    );

    -- One-time flags (e.g. "campaigns seeded") so seed data never re-appears.
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

    -- The talk that belongs to the task: one thread per piece of content.
    CREATE TABLE IF NOT EXISTS comments (
      id         ${ID},
      content_id INTEGER NOT NULL,
      user_id    INTEGER,
      author     TEXT    NOT NULL DEFAULT '',
      text       TEXT    NOT NULL,
      created_at TEXT    NOT NULL
    );

    -- The bell: persisted events (someone moved your task). Deadline
    -- reminders are computed at read time and never stored.
    CREATE TABLE IF NOT EXISTS notifications (
      id         ${ID},
      user_id    INTEGER NOT NULL,
      kind       TEXT    NOT NULL DEFAULT 'status',
      text       TEXT    NOT NULL,
      content_id INTEGER,
      created_at TEXT    NOT NULL,
      read_at    TEXT
    );

    -- The paper trail: one row per meaningful change on a task — who, which
    -- field, from what, to what. Names and stage labels are written down at
    -- the moment of the change, so the log still reads like a sentence after
    -- people or stages are renamed or removed (and after the task itself is).
    CREATE TABLE IF NOT EXISTS activity (
      id            ${ID},
      content_id    INTEGER,
      content_title TEXT    NOT NULL DEFAULT '',
      user_id       INTEGER,
      user_name     TEXT    NOT NULL DEFAULT '',
      kind          TEXT    NOT NULL DEFAULT 'updated', -- created | updated | deleted
      field         TEXT,
      old_value     TEXT,
      new_value     TEXT,
      created_at    TEXT    NOT NULL
    );
  `)

  // Upgrades for existing Postgres databases (SQLite goes through migrate()).
  if (IS_PG) {
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS pinned INTEGER NOT NULL DEFAULT 0')
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS photo_thumb TEXT')
    await exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT')
    await exec('ALTER TABLE channels ADD COLUMN IF NOT EXISTS head_id INTEGER')
    await exec('ALTER TABLE channels ADD COLUMN IF NOT EXISTS dashboard TEXT')
    await exec("ALTER TABLE programs ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'both'")
    await exec("ALTER TABLE programs ADD COLUMN IF NOT EXISTS checklist TEXT NOT NULL DEFAULT '[]'")
    await exec("ALTER TABLE programs ADD COLUMN IF NOT EXISTS creatives TEXT NOT NULL DEFAULT '[]'")
    await exec("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS checklist TEXT NOT NULL DEFAULT '[]'")
    await exec('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS project_id INTEGER')
    await exec('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS owner_id INTEGER')
    await exec('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_date TEXT')
    await exec('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS end_date TEXT')
    await exec("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS channels TEXT NOT NULL DEFAULT '[]'")
    await exec("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS metric TEXT NOT NULL DEFAULT ''")
    await exec('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target REAL NOT NULL DEFAULT 0')
    await exec('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS actual REAL NOT NULL DEFAULT 0')
    await exec('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS budget REAL')
    await exec("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'idea'")
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS campaign_id INTEGER')
    await exec('ALTER TABLE projects ADD COLUMN IF NOT EXISTS photo TEXT')
    await exec('ALTER TABLE projects ADD COLUMN IF NOT EXISTS photo_thumb TEXT')
    await exec('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS photo TEXT')
    await exec('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS photo_thumb TEXT')
    await exec("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''")
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS operator_id INTEGER')
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS editor_id INTEGER')
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS designer_id INTEGER')
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS design_ready_date TEXT')
    await exec("ALTER TABLE content ADD COLUMN IF NOT EXISTS assignees TEXT NOT NULL DEFAULT '[]'")
    await exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS crew_roles TEXT NOT NULL DEFAULT '[]'")
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS recording_end TEXT')
    await exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT')
    await exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS position TEXT')
    await exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS duties TEXT')
    await exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS work_start TEXT')
    await exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS work_end TEXT')
    await exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS work_days TEXT')
    await exec("ALTER TABLE projects ADD COLUMN IF NOT EXISTS success TEXT NOT NULL DEFAULT ''")
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS edit_ready_date TEXT')
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS ready_at TEXT')
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS ready_link TEXT')
    await exec("ALTER TABLE programs ADD COLUMN IF NOT EXISTS branches TEXT NOT NULL DEFAULT '[]'")
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS shot_link TEXT')
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS design_link TEXT')
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS reference_text TEXT')
    await exec("ALTER TABLE content ADD COLUMN IF NOT EXISTS reference_links TEXT NOT NULL DEFAULT '[]'")
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS format TEXT')
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS rubrika TEXT')
    await exec('ALTER TABLE content ADD COLUMN IF NOT EXISTS script TEXT')
    await exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT')
    await exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_code TEXT')
  }

  await migrate()
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_personal_user ON personal_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_content_sort ON content(pinned, todo_sort);
    CREATE INDEX IF NOT EXISTS idx_content_operator ON content(operator_id, recording_date);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_id);
    CREATE INDEX IF NOT EXISTS idx_activity_content ON activity(content_id, id);
  `)
}

async function hasColumn(table, col) {
  return (await all(`PRAGMA table_info(${table})`)).some((c) => c.name === col)
}

async function migrate() {
  if (IS_PG) return // Postgres databases are created current-shape; the
  //                   legacy upgrades below only ever applied to SQLite files.
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
    if (!(await hasColumn('content', 'pinned'))) await exec('ALTER TABLE content ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
    if (!(await hasColumn('content', 'photo_thumb'))) await exec('ALTER TABLE content ADD COLUMN photo_thumb TEXT')
    if (!(await hasColumn('users', 'avatar'))) await exec('ALTER TABLE users ADD COLUMN avatar TEXT')
    if (!(await hasColumn('channels', 'head_id'))) await exec('ALTER TABLE channels ADD COLUMN head_id INTEGER')
    if (!(await hasColumn('channels', 'dashboard'))) await exec('ALTER TABLE channels ADD COLUMN dashboard TEXT')
    if (!(await hasColumn('programs', 'platform'))) await exec("ALTER TABLE programs ADD COLUMN platform TEXT NOT NULL DEFAULT 'both'")
    if (!(await hasColumn('programs', 'checklist'))) await exec("ALTER TABLE programs ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('programs', 'creatives'))) await exec("ALTER TABLE programs ADD COLUMN creatives TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('campaigns', 'checklist'))) await exec("ALTER TABLE campaigns ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('campaigns', 'project_id'))) {
      await exec(`
        ALTER TABLE campaigns ADD COLUMN project_id INTEGER;
        ALTER TABLE campaigns ADD COLUMN owner_id INTEGER;
        ALTER TABLE campaigns ADD COLUMN start_date TEXT;
        ALTER TABLE campaigns ADD COLUMN end_date TEXT;
        ALTER TABLE campaigns ADD COLUMN metric TEXT NOT NULL DEFAULT '';
        ALTER TABLE campaigns ADD COLUMN target REAL NOT NULL DEFAULT 0;
        ALTER TABLE campaigns ADD COLUMN actual REAL NOT NULL DEFAULT 0;
        ALTER TABLE campaigns ADD COLUMN budget REAL;
        ALTER TABLE campaigns ADD COLUMN stage TEXT NOT NULL DEFAULT 'idea';
      `)
      await exec("ALTER TABLE campaigns ADD COLUMN channels TEXT NOT NULL DEFAULT '[]'")
    }
    if (!(await hasColumn('content', 'campaign_id'))) await exec('ALTER TABLE content ADD COLUMN campaign_id INTEGER')
    if (!(await hasColumn('projects', 'photo'))) await exec('ALTER TABLE projects ADD COLUMN photo TEXT; ALTER TABLE projects ADD COLUMN photo_thumb TEXT;')
    if (!(await hasColumn('campaigns', 'photo'))) await exec("ALTER TABLE campaigns ADD COLUMN photo TEXT; ALTER TABLE campaigns ADD COLUMN photo_thumb TEXT; ALTER TABLE campaigns ADD COLUMN description TEXT NOT NULL DEFAULT '';")
    if (!(await hasColumn('content', 'operator_id'))) await exec('ALTER TABLE content ADD COLUMN operator_id INTEGER; ALTER TABLE content ADD COLUMN editor_id INTEGER;')
    if (!(await hasColumn('content', 'designer_id'))) await exec('ALTER TABLE content ADD COLUMN designer_id INTEGER')
    if (!(await hasColumn('content', 'design_ready_date'))) await exec('ALTER TABLE content ADD COLUMN design_ready_date TEXT')
    if (!(await hasColumn('content', 'ready_link'))) await exec('ALTER TABLE content ADD COLUMN ready_link TEXT')
    if (!(await hasColumn('content', 'assignees'))) await exec("ALTER TABLE content ADD COLUMN assignees TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('users', 'crew_roles'))) await exec("ALTER TABLE users ADD COLUMN crew_roles TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('content', 'recording_end'))) await exec('ALTER TABLE content ADD COLUMN recording_end TEXT')
    if (!(await hasColumn('users', 'phone'))) {
      await exec(`
        ALTER TABLE users ADD COLUMN phone TEXT;
        ALTER TABLE users ADD COLUMN position TEXT;
        ALTER TABLE users ADD COLUMN duties TEXT;
        ALTER TABLE users ADD COLUMN work_start TEXT;
        ALTER TABLE users ADD COLUMN work_end TEXT;
        ALTER TABLE users ADD COLUMN work_days TEXT;
      `)
    }
    if (!(await hasColumn('projects', 'success'))) await exec("ALTER TABLE projects ADD COLUMN success TEXT NOT NULL DEFAULT ''")
    if (!(await hasColumn('content', 'edit_ready_date'))) await exec('ALTER TABLE content ADD COLUMN edit_ready_date TEXT; ALTER TABLE content ADD COLUMN ready_at TEXT;')
    if (!(await hasColumn('programs', 'branches'))) await exec("ALTER TABLE programs ADD COLUMN branches TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('content', 'shot_link'))) await exec('ALTER TABLE content ADD COLUMN shot_link TEXT; ALTER TABLE content ADD COLUMN design_link TEXT;')
    if (!(await hasColumn('content', 'format'))) await exec('ALTER TABLE content ADD COLUMN format TEXT; ALTER TABLE content ADD COLUMN rubrika TEXT; ALTER TABLE content ADD COLUMN script TEXT;')
    if (!(await hasColumn('content', 'reference_text'))) await exec("ALTER TABLE content ADD COLUMN reference_text TEXT; ALTER TABLE content ADD COLUMN reference_links TEXT NOT NULL DEFAULT '[]';")
    if (!(await hasColumn('users', 'telegram_chat_id'))) await exec('ALTER TABLE users ADD COLUMN telegram_chat_id TEXT; ALTER TABLE users ADD COLUMN telegram_code TEXT;')
  } catch (e) {
    console.warn('Skipping legacy migrations:', e.message)
  }
}

export async function getChannelKeys() {
  return (await all('SELECT key FROM channels ORDER BY sort')).map((r) => r.key)
}

// ---- stage rules: who may move a task OUT of each stage ------------------
// The admin regulates which kind of actor advances work from which stage
// (Admin → Pipeline). Defaults mirror the natural chain — the operator works
// until Shot, the editor until Ready, the SMM everywhere — extended to
// earlier stages so behind-schedule work can still be pushed forward.
// Rules only ever narrow: they never grant crew powers they don't have, and
// the Published gate keeps its own key (review_publish).
export const STAGE_ACTORS = ['operator', 'editor', 'designer', 'member']
export function defaultMayLeave(actor, label) {
  const l = String(label || '').toLowerCase()
  if (/^deleted$/.test(l)) return actor === 'member'
  if (actor === 'member') return true
  if (actor === 'operator') return /idea|to shoot/.test(l)
  if (actor === 'editor' || actor === 'designer') return /idea|to shoot|shot|editing/.test(l)
  return false
}
export async function getStageRules() {
  try {
    const row = await get("SELECT value FROM meta WHERE key = 'stage_rules'")
    const o = JSON.parse(row?.value || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch { return {} }
}
// Effective answer for one actor kind leaving one stage: the stored override
// when the admin set one, the role default otherwise.
export async function mayLeaveStage(actor, statusId) {
  if (!statusId) return true
  const st = await get('SELECT label FROM statuses WHERE id = ?', statusId)
  if (!st) return true
  const rules = await getStageRules()
  const v = rules?.[actor]?.[String(statusId)]
  return v === undefined ? defaultMayLeave(actor, st.label) : !!v
}

// ---- the task form, tuned by the admin (ClickUp-style custom fields) ----
// Each briefing field can be off, optional or required, scoped to content
// types; Format and Rubrika also carry admin-managed option lists. Stored
// in meta 'task_fields'; getTaskFields always answers the EFFECTIVE config
// (stored overrides merged over these defaults).
export const TASK_FIELD_KEYS = ['format', 'rubrika', 'script', 'reference', 'description']
const ALL_TYPES = ['post', 'reel', 'story', 'video', 'other']
export const DEFAULT_TASK_FIELDS = {
  format:      { state: 'optional', types: ['reel', 'video'], options: ['Talking head', 'Split screen', 'Voiceover', 'Interview', 'Vlog', 'Skit'] },
  rubrika:     { state: 'optional', types: [...ALL_TYPES], options: [] },
  script:      { state: 'optional', types: ['reel', 'video'] },
  reference:   { state: 'optional', types: [...ALL_TYPES] },
  description: { state: 'optional', types: [...ALL_TYPES] },
}
export async function getTaskFields() {
  let stored = {}
  try {
    stored = JSON.parse((await get("SELECT value FROM meta WHERE key = 'task_fields'"))?.value || '{}')
    if (!stored || typeof stored !== 'object') stored = {}
  } catch { stored = {} }
  const out = {}
  for (const k of TASK_FIELD_KEYS) {
    const d = DEFAULT_TASK_FIELDS[k]
    const s = stored[k] || {}
    out[k] = {
      state: ['off', 'optional', 'required'].includes(s.state) ? s.state : d.state,
      types: Array.isArray(s.types) ? s.types.map(String).filter((t) => ALL_TYPES.includes(t)) : [...d.types],
    }
    if (d.options) {
      out[k].options = Array.isArray(s.options)
        ? [...new Set(s.options.map((o) => String(o).trim()).filter(Boolean))].slice(0, 40)
        : [...d.options]
    }
  }
  return out
}

// Which crew hats a task of each type is EXPECTED to carry — the rule the
// Unassigned / gap views count by. The admin tunes it (Admin → Pipeline) so
// a text-only post stops demanding a designer nobody ever planned to assign.
// Stored in meta 'crew_needs'; missing keys fall back to these defaults,
// which reproduce the pre-tuning behavior exactly.
export const CREW_NEED_KEYS = ['operator', 'editor', 'designer']
export const DEFAULT_CREW_NEEDS = {
  operator: ['reel', 'video'],
  editor: ['reel', 'video'],
  designer: ['post'],
}
export async function getCrewNeeds() {
  let stored = {}
  try {
    stored = JSON.parse((await get("SELECT value FROM meta WHERE key = 'crew_needs'"))?.value || '{}')
    if (!stored || typeof stored !== 'object') stored = {}
  } catch { stored = {} }
  const out = {}
  for (const k of CREW_NEED_KEYS) {
    out[k] = Array.isArray(stored[k])
      ? stored[k].map(String).filter((t) => ALL_TYPES.includes(t))
      : [...DEFAULT_CREW_NEEDS[k]]
  }
  return out
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
    `, channel, TYPE_PLAN_LABELS[type], TYPE_PLAN_LABELS[type].toLowerCase(), type, maxSort + 1, new Date().toISOString())
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

export async function seedIfEmpty() {
  if ((await get('SELECT COUNT(*) AS n FROM users')).n > 0) return

  // A fresh database starts clean: the team's channels, the pipeline stages,
  // and a single admin account. No demo members, metrics or tasks — the admin
  // creates real ones in the app (change the admin password right away).
  const channels = [
    ['instagram_main', 'Instagram Main', 'instagram'],
    ['instagram_uzb', 'Instagram Uzb', 'instagram'],
    ['telegram_uzb', 'Telegram Uzb', 'telegram'],
    ['telegram_main', 'Telegram Main', 'telegram'],
    ['target', 'Target', 'target'],
    ['youtube', 'YouTube', 'youtube'],
  ]

  // ---- pipeline statuses (mirrors the team's ClickUp board) ----
  // Deleted is the graveyard: a planned/shot piece that was killed. It stays
  // on the record (the planner's and operator's work happened) but stops
  // counting for the editor and leaves the channel plan.
  const statusList = [
    ['Idea', '#8b8388', 0],
    ['To shoot', '#fab219', 0],
    ['Shot', '#ec835a', 0],
    ['Editing', '#b5324a', 0],
    ['Ready', '#2a78d6', 0],
    ['Published', '#0ca30c', 1],
    ['Deleted', '#6d6a70', 0],
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
  stmts.push(["INSERT INTO meta (key, value) VALUES ('campaigns_seeded', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value"])
  await batch(stmts)
}

// One-time reclassification (July 2026 spec): long-running rows in the old
// campaign plan become projects, the "YouTube" row dies (it is a channel),
// and old prose fields (timing / audience / free-text status) move into an
// imported note. Everything else stays a campaign, as an Idea until its
// owner, dates and target are filled in.
async function migrateCampaignsToProjects() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'projects_migrated'")) return
  const rows = await all('SELECT * FROM campaigns')
  const toProject = ['Kazakh Online Campaign', 'Ambassadorlar', 'Student Union Events']
  const nowIso = new Date().toISOString()
  for (const c of rows) {
    if (c.name === 'YouTube') { await run('DELETE FROM campaigns WHERE id = ?', c.id); continue }
    const owner = c.owner
      ? await get('SELECT id FROM users WHERE name = ? OR username = ?', c.owner, String(c.owner).toLowerCase())
      : null
    const prose = [
      c.timing ? `Timing: ${c.timing}` : '',
      c.channel ? `Channels: ${c.channel}` : '',
      c.audience ? `Audience: ${c.audience}` : '',
      c.status ? `Status: ${c.status}` : '',
      c.owner && !owner ? `Owner: ${c.owner}` : '',
      c.notes || '',
    ].filter(Boolean).join(' · ')
    if (toProject.includes(c.name)) {
      const info = await run(
        "INSERT INTO projects (name, owner_id, description, status, created_at) VALUES (?, ?, ?, 'active', ?)",
        c.name, owner?.id ?? null, c.goal || '', nowIso)
      if (prose) await run('INSERT INTO notes (kind, ref_id, author_id, text, created_at) VALUES (?, ?, NULL, ?, ?)',
        'project', info.lastInsertRowid, `Imported from the old campaign plan — ${prose}`, nowIso)
      await run('DELETE FROM campaigns WHERE id = ?', c.id)
    } else {
      await run("UPDATE campaigns SET owner_id = ?, stage = 'idea' WHERE id = ?", owner?.id ?? null, c.id)
      if (prose) await run('INSERT INTO notes (kind, ref_id, author_id, text, created_at) VALUES (?, ?, NULL, ?, ?)',
        'campaign', c.id, `Imported from the old campaign plan — ${prose}`, nowIso)
    }
  }
  await run("INSERT INTO meta (key, value) VALUES ('projects_migrated', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

// One-time import (July 2026): the team's ClickUp content plan lands on the
// Instagram Main release calendar. Their pipeline maps 1:1 onto ours
// (SYOMKA QILINADI→To shoot · MONTAJDA→Editing · TAYYOR→Ready ·
// INSTAGRAM CHIQDI→Published). Cards already released are recorded as
// Published/done on their real dates; upcoming ones wait in To shoot.
// Deleted ClickUp cards were left out. Runs once (meta flag), and each row
// double-checks for an existing title+date so nothing ever duplicates.
async function importJulyIgPlan() {
  // Real deployments only — scratch file databases (tests, local hacking)
  // shouldn't inherit the team's live plan. IG_PLAN_FORCE=1 overrides.
  if (STORAGE === 'file' && process.env.IG_PLAN_FORCE !== '1') return
  // v2: re-checks every row (fills anything a partial v1 run missed) and
  // carries the fuller titles read from the zoomed ClickUp screenshots.
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'ig_plan_2026_07_v2'")) return
  const setFlag = () =>
    run("INSERT INTO meta (key, value) VALUES ('ig_plan_2026_07_v2', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  const chan = await get("SELECT key FROM channels WHERE key = 'instagram_main'")
  if (!chan) { await setFlag(); return } // channel gone — nowhere to import
  // Rows a v1 run may have created under the shorter guessed titles.
  const RENAMES = [
    ['2026-06-30', 'Educational Video — what ECs are helpful', 'Educational Video — what ECs are helpful and which aren’t'],
    ['2026-07-02', 'Educational Video — Rating the recommendations', 'Educational Video — Rating the recommendations (Diyor)'],
    ['2026-07-04', 'Info Video — 1-1 sessions with CTA (Mirabbos)', 'Info Video — 1-1 sessions with CTA (Mirabbos and Jasmina)'],
    ['2026-07-08', 'Educational Video — After receiving 610 in the SAT', 'Educational Video — After receiving 610 in the English section'],
    ['2026-07-11', 'Info Video — SU how it works (Mirabbos)', 'Info Video — SU how it works (Mirabbos and Jasmina)'],
    ['2026-07-22', 'Educational Video with CTA', 'Educational Video with CTA (How did this guy receive 1500+?)'],
  ]
  for (const [date, oldTitle, newTitle] of RENAMES) {
    await run("UPDATE content SET title = ? WHERE title = ? AND release_date = ? AND channels LIKE '%instagram_main%'",
      newTitle, oldTitle, date)
  }
  const V = 'video', P = 'post', B = 'Branding', S = 'Sales'
  const PLAN = [
    ['2026-06-29', 'AP: What’s your AP?', V, B],
    ['2026-06-29', 'AP Results Main', V, B],
    ['2026-06-29', 'AP Results Trial N1', V, B],
    ['2026-06-29', 'AP Results Trial N2', V, B],
    ['2026-06-30', 'Educational Video — what ECs are helpful and which aren’t', V, B],
    ['2026-07-01', 'Results Analytics Post — Ulugbek', P, B],
    ['2026-07-02', 'Educational Video — Rating the recommendations (Diyor)', V, B],
    ['2026-07-03', 'Chelovechek find it', P, B],
    ['2026-07-04', 'Info Video — 1-1 sessions with CTA (Mirabbos and Jasmina)', V, B],
    ['2026-07-07', 'Educational Video (Solving June Math)', V, B],
    ['2026-07-08', 'AP Results Post', P, B],
    ['2026-07-08', 'Educational Video — After receiving 610 in the English section', V, B],
    ['2026-07-09', 'Results reel: Solohiddin', V, B],
    ['2026-07-09', 'Educational Video (Solving June Math)', V, B],
    ['2026-07-10', 'Ayyubkhon’s Project X Finalized', V, B],
    ['2026-07-10', 'AP Results Story of the Student', V, B],
    ['2026-07-11', 'Duels Sales', V, S],
    ['2026-07-11', 'Info Video — SU how it works (Mirabbos and Jasmina)', V, B],
    ['2026-07-13', 'AP Results Video', V, B],
    ['2026-07-14', 'Info video — reference to SATashkent', V, B],
    ['2026-07-15', 'Educational Video (Profile check)', V, B],
    ['2026-07-16', 'AP Results Video', V, B],
    ['2026-07-16', 'Educational Video', V, B],
    ['2026-07-17', 'Info video — reference to SATashkent', V, B],
    ['2026-07-17', 'Sales', V, S],
    ['2026-07-18', 'Random but viral content', V, B],
    ['2026-07-20', 'Educational Video (Solving June Math)', V, B],
    ['2026-07-21', 'SAT Results', V, B],
    ['2026-07-22', 'Educational Video with CTA (How did this guy receive 1500+?)', V, B],
    ['2026-07-23', 'SAT Results with CTA', V, B],
    ['2026-07-24', 'Sales', V, S],
    ['2026-07-25', 'Random but viral content', V, B],
  ]
  const statuses = await all('SELECT id, label, is_final FROM statuses ORDER BY sort, id')
  const byLabel = (l) => statuses.find((s) => s.label.toLowerCase() === l)?.id
  const published = byLabel('published') ?? statuses.find((s) => s.is_final)?.id ?? statuses.at(-1)?.id ?? null
  const toShoot = byLabel('to shoot') ?? statuses[1]?.id ?? statuses[0]?.id ?? null
  const admin = await get("SELECT id FROM users WHERE username = 'admin'")
  const today = dayISO(0)
  for (const [date, title, type, turi] of PLAN) {
    const dupe = await get(
      "SELECT id FROM content WHERE title = ? AND release_date = ? AND channels LIKE '%instagram_main%'", title, date)
    if (dupe) continue
    const past = date < today
    await run(`
      INSERT INTO content (title, channels, type, created_by, status_id, release_date, description, done_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, title, '["instagram_main"]', type, admin?.id ?? null,
      past ? published : toShoot, date,
      `Imported from the ClickUp content plan · Content turi: ${turi}`,
      past ? `${date}T07:00:00.000Z` : null, // noon Tashkent on its release day
      new Date().toISOString())
  }
  await setFlag()
}

// One-time recovery (July 2026): the team got locked out of the admin
// account, so on the next deploy 'admin' works with the documented password
// again. Runs exactly once (meta flag) — changing the password afterwards
// sticks, and this never fires again.
async function ensureAdminAccess() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'admin_reset_2026_07'")) return
  const row = await get("SELECT id FROM users WHERE username = 'admin'")
  const hash = bcrypt.hashSync('admin123', 10)
  if (row) {
    await run("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?", hash, row.id)
  } else {
    await run(`
      INSERT INTO users (name, username, email, password_hash, role, departments, permissions, color, created_at)
      VALUES ('Admin', 'admin', NULL, ?, 'admin', '[]', '{}', '#a32234', ?)
    `, hash, new Date().toISOString())
  }
  await run("INSERT INTO meta (key, value) VALUES ('admin_reset_2026_07', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

// Schema + seeds, exactly once per process — serverless handlers await this
// before touching the database. A failed attempt (storage briefly down) is
// not cached: the next request starts a fresh one instead of replaying the
// same rejection forever.
let initPromise
export function initDb() {
  initPromise ||= (async () => {
    await initSchema()
    await seedIfEmpty()
    await seedCampaignsIfEmpty()
    await migrateCampaignsToProjects()
    await ensureAdminAccess()
    await importJulyIgPlan()
    // The Target team's dashboard leads with launch programs — once, and only
    // if the admin hasn't customized that channel's layout yet.
    if (!(await get("SELECT 1 AS x FROM meta WHERE key = 'target_programs_default'"))) {
      await run("UPDATE channels SET dashboard = ? WHERE key = 'target' AND dashboard IS NULL",
        JSON.stringify(['programs', 'metrics', 'growth', 'content']))
      await run("INSERT INTO meta (key, value) VALUES ('target_programs_default', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    }
    // Instagram Main outranks Instagram Uzb in the sidebar — once; after that
    // the admin's own reordering (Admin → Channels arrows) is the truth.
    if (!(await get("SELECT 1 AS x FROM meta WHERE key = 'ig_order_2026_07'"))) {
      const main = await get("SELECT id, sort FROM channels WHERE key = 'instagram_main'")
      const uzb = await get("SELECT id, sort FROM channels WHERE key = 'instagram_uzb'")
      if (main && uzb && main.sort > uzb.sort) {
        await run('UPDATE channels SET sort = ? WHERE id = ?', uzb.sort, main.id)
        await run('UPDATE channels SET sort = ? WHERE id = ?', main.sort, uzb.id)
      }
      await run("INSERT INTO meta (key, value) VALUES ('ig_order_2026_07', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    }
    // The designer's clock got its own field. Posts used to borrow the
    // edit-ready date for design work — move those over, once.
    if (!(await get("SELECT 1 AS x FROM meta WHERE key = 'design_date_2026_07'"))) {
      await run(`
        UPDATE content SET design_ready_date = edit_ready_date, edit_ready_date = NULL
        WHERE type = 'post' AND edit_ready_date IS NOT NULL AND design_ready_date IS NULL
      `)
      await run("INSERT INTO meta (key, value) VALUES ('design_date_2026_07', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    }
    // The Deleted stage (July 2026): killed content keeps its record instead
    // of vanishing. Added once to existing databases; the admin owns it after.
    if (!(await get("SELECT 1 AS x FROM meta WHERE key = 'deleted_status_2026_07'"))) {
      const have = await get("SELECT 1 AS x FROM statuses WHERE LOWER(label) = 'deleted'")
      if (!have) {
        const maxSort = (await get('SELECT COALESCE(MAX(sort), -1) AS m FROM statuses')).m
        await run("INSERT INTO statuses (label, color, sort, is_final) VALUES ('Deleted', '#6d6a70', ?, 0)", maxSort + 1)
      }
      await run("INSERT INTO meta (key, value) VALUES ('deleted_status_2026_07', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    }
    // Fix units minted by the old auto-pluralizer ("story" + s).
    await run("UPDATE trackers SET unit = 'stories' WHERE unit = 'storys'")
  })().catch((e) => { initPromise = undefined; throw e })
  return initPromise
}

// A user's crew capabilities as an array — the stored crew_roles when set,
// otherwise derived from the legacy single role. Multi-select lives here:
// ['editor','operator','designer'] in any combination.
export function crewRolesOf(row) {
  try {
    const arr = JSON.parse(row.crew_roles || '[]')
    if (Array.isArray(arr) && arr.length) return arr
  } catch { /* fall through to the legacy role */ }
  return { editor: ['editor'], operator: ['operator'], designer: ['designer'], crew: ['editor', 'operator'] }[row.role] || []
}

// API-safe user (no password hash); permissions merged with defaults.
export function publicUser(row) {
  if (!row) return null
  let perms = {}
  try { perms = JSON.parse(row.permissions || '{}') } catch { /* ignore */ }
  // Member defaults are for members. Crew roles (editor/operator/designer or
  // any mix) carry no granular rights at all — their powers come from being
  // on a task's crew.
  const crew = ['editor', 'operator', 'designer', 'crew'].includes(row.role)
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    role: row.role,
    crew_roles: crewRolesOf(row),
    departments: JSON.parse(row.departments || '[]'),
    permissions: crew ? {} : { ...DEFAULT_PERMS, ...perms },
    color: row.color,
    avatar: row.avatar || null,
    phone: row.phone || null,
    position: row.position || null,
    duties: row.duties || null,
    work_start: row.work_start || null,
    work_end: row.work_end || null,
    work_days: (() => { try { return JSON.parse(row.work_days || 'null') } catch { return null } })(),
    created_at: row.created_at,
  }
}
