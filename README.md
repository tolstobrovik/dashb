# Satashkent · Marketing Team Dashboard

A focused marketing CRM for the Satashkent College Prep Community team. Each
sidebar channel — **Instagram Uzb, Instagram Main, Telegram Uzb, Telegram Main,
Target, YouTube** (all editable by the admin) — has its metrics, a growth
comparison, a ClickUp-style content pipeline, and Release + Recording calendars,
with per-member permissions and reports.

Branded in the Satashkent crimson & cream colours.

<br>

## ✨ Features

- **Login** — username + password (JWT, bcrypt). Role-based access: members see
  only their channels; admins see everything.
- **Custom sidebar channels** — the admin adds/renames/reorders channels with an
  icon picker (e.g. another Instagram account). Single-channel members get a
  clean, sidebar-less layout.
- **Granular permissions (Telegram-style)** — per member, the admin toggles:
  update metric values · add/edit metrics · change layout · create/edit content ·
  move tasks. Enforced by the API, reflected in the UI.
- **Metrics per channel** — pin any number of headline metrics to the top,
  add/edit/delete, drag to reorder, +/− updates.
- **Campaign plan (admin)** — the marketing campaign plan in three views:
  overview table, month-by-month calendar, and a project list with owners,
  durations and statuses.
- **Growth comparison** — every metric vs yesterday / last week / last month /
  any custom date, with deltas and % (daily snapshots stored automatically).
- **Content pipeline board** — ClickUp-style stages (Idea → To shoot → Shot →
  Editing → Ready → Published), fully editable (names, colors, order, final
  stage). Drag cards between stages.
- **Two calendars** — Release and Recording. The same task appears in both on
  its two dates; drag a task to another day to move that date. Click a day for
  a simple agenda view.
- **Task details** — platform, assignee, recording & release date/time,
  priority, description, photo attachment, checklist, and a "counts toward"
  metric: publishing bumps the dashboard number automatically (27 → 28 posts).
- **My To-Do** — everything assigned to you, in sync with the calendars, with a
  satisfying completion ding.
- **Reports** — who did what in any period: completed tasks per person, per
  channel and per content type.

<br>

## 🚀 Getting started

**Requirements:** Node.js 18.11+ (developed on Node 22).

```bash
# 1. install dependencies
npm install

# 2. run in development (API on :4000, UI on :5173 with hot reload)
npm run dev
#    → open http://localhost:5173
```

> **If `npm install` prints an "allow-scripts" warning** (some npm setups block
> package install scripts), approve and rebuild the bundler once:
> ```bash
> npm approve-scripts esbuild && npm rebuild esbuild
> ```

The database is created and **seeded automatically** on first run (the team's
channels, the pipeline stages and one admin account) at `data/dashboard.db`.

### Production build

```bash
npm run build     # bundles the React app into dist/
npm start         # serves the app + API together on http://localhost:4000
```

### Reset the data

```bash
npm run seed      # wipes the database back to a clean start (channels + admin)
```

<br>

## 🔑 Signing in

A fresh database has exactly one account:

| Role      | Username | Password   |
| --------- | -------- | ---------- |
| **Admin** | `admin`  | `admin123` |

> **Change this password right after the first login** (Admin → Team → edit).
> The admin then creates each team member with their own username and password —
> there are no demo accounts, and login only works with credentials the admin
> has issued. Email is optional per user; login is by username only.

<br>

## 🛠 Tech stack

| Layer     | Choice                                                            |
| --------- | ---------------------------------------------------------------- |
| Frontend  | React 18 + Vite + React Router, hand-built CSS design system      |
| Icons     | lucide-react                                                      |
| Backend   | Node.js + Express                                                 |
| Database  | **PostgreSQL** in production (Vercel Storage / Render — connection auto-injected), SQLite locally; Turso also supported |
| Timezone  | All day boundaries pinned to **Asia/Tashkent** (server & client)   |
| Auth      | JSON Web Tokens + bcryptjs password hashing                       |

<br>

## 📁 Project structure

```
├── api/                    Vercel serverless entry (wraps the Express app)
├── server/                 Express API
│   ├── app.js              the Express app itself (shared by all run modes)
│   ├── index.js            long-running entry: local prod, Render, any VPS
│   ├── db.js               schema + seed data (libsql: local file or Turso)
│   ├── auth.js             JWT signing + access-control middleware
│   ├── seed.js             `npm run seed`
│   └── routes/             auth · users · channels · statuses · trackers · content · reports · campaigns
├── client/                 React app (Vite)
│   ├── src/
│   │   ├── pages/          Login · Overview · Department · MyTasks · Admin
│   │   ├── components/     Sidebar · Layout · Meter · Ring · TaskRow · …
│   │   └── lib/            api client · auth context · constants
│   └── index.html
├── data/                   SQLite database (git-ignored, auto-created)
├── vercel.json             Vercel config: build, function, SPA + API routing
├── render.yaml             Render blueprint (long-running alternative)
└── vite.config.js
```

<br>

## ☁️ Deploy to Vercel

The repo is Vercel-ready — `vercel.json` builds the client to `dist/` and routes
every `/api/*` request to one serverless function (`api/index.js`).

1. [vercel.com/new](https://vercel.com/new) → **Import** this repository. No
   settings to change — the defaults come from `vercel.json`. Deploy.
2. **Make the data permanent** (one time): create a free Postgres database at
   [neon.tech](https://neon.tech) (sign in with Google, no card needed), copy
   its **connection string**, paste it into `server/config.js` between the
   quotes, and push. That's the whole setup — no environment variables, no
   dashboard settings; the deploy triggered by that push is already durable.
3. Sign in as `admin` / `admin123` and change the password.

From then on the database is permanent: pushes, deploys, restarts and cold
starts never touch the data, and every table is created automatically on
first request. The login secret is derived from the database credential, so
sessions survive deploys with zero configuration too.

While `server/config.js` is empty the app runs in **demo mode**: serverless
has no disk, so data lives in `/tmp` and resets on every deploy or cold
start. (The `DATABASE_URL`/`POSTGRES_URL` env vars and Turso also still work
as alternatives, e.g. for Render's auto-injected database.)

**Timekeeping.** Every day boundary — calendars, the to-do list, overdue
checks, daily growth snapshots, reports — is pinned to **Asia/Tashkent**. A
scheduled job (`vercel.json` → crons) also stores a snapshot of every metric
at 00:05 Tashkent time each night, so the growth comparison has a point for
every single day even when nobody edits anything.

Prefer a classic always-on server? `render.yaml` deploys the same app to
Render as one web service **plus a managed Postgres database** — the
connection is injected automatically there too (New + → Blueprint → pick this
repo → Apply).

<br>

## 🔌 Integrations (planned)

The app is built so external tools can feed it later. Tasks already carry `source`
and `external_id` columns, and every tracker/task can be updated through the REST
API by an automated worker — so no rewrite is needed to plug these in.

- **ClickUp (recommended, straightforward).** ClickUp has a full REST API + webhooks.
  A small sync worker subscribes to `taskCreated` / `taskUpdated` / `taskStatusUpdated`
  webhooks; each event upserts a row in `tasks` (`source = 'clickup'`,
  `external_id = <clickup task id>`) so ClickUp tasks appear here automatically, and
  status changes flow back. This also enables month-end salary reports from completed
  tasks. Needs a ClickUp API token + workspace/list IDs.
- **Instagram content counts (official API).** For an Instagram **Business/Creator**
  account you own (linked to a Facebook Page + a Meta app), the Graph API returns
  published media with timestamps — so "posts/reels this month" can update a tracker
  automatically on a schedule. **Stories** are available via the `stories` edge but
  only while live (they expire after 24h), so counting "3 stories/day" needs a poller
  that checks a few times a day. Public profiles you don't own can't be read reliably
  or compliantly — see the note in the chat for details.
- **LinkedIn (gated).** Reading/posting to a **Company Page** you own is possible via
  LinkedIn's Marketing Developer Platform, but it requires app review/approval;
  personal-profile automation is not permitted. Feasible for org-page analytics, with
  a heavier approval process than ClickUp or Instagram.

## 🔐 Configuration

Environment variables (all optional):

| Variable             | Default                           | Purpose                                        |
| -------------------- | --------------------------------- | ---------------------------------------------- |
| `DATABASE_URL`       | *(injected by the host)*          | PostgreSQL connection — Vercel Storage / Render set it automatically (`POSTGRES_URL` works too) |
| `PORT`               | `4000`                            | API / production server port                   |
| `JWT_SECRET`         | *(derived from the DB credential)*| Optional — set to override the derived secret  |
| `TURSO_DATABASE_URL` | *(unset)*                         | Remote libsql/Turso database URL (alternative) |
| `TURSO_AUTH_TOKEN`   | *(unset)*                         | Auth token for the remote database             |
| `DATA_DIR`           | `./data` (`/tmp` on serverless)   | Where the SQLite file lives in file mode       |

```bash
JWT_SECRET="a-long-random-string" PORT=8080 npm start
```

<br>

## 🔎 How access control works

- Every API request (except login) requires a valid token.
- A member's token resolves to their record; the server filters **trackers, schedule
  and tasks** to that member's departments and lets them update only their own tasks
  and their department's tracker counts.
- Admin-only actions (managing users, assigning tasks to others, editing targets,
  building the schedule) are gated by an `adminOnly` middleware.
- The UI mirrors this — members never see departments or the admin panel they can't use.
