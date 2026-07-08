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

**Requirements:** Node.js 18.11+ (developed on Node 22). Installing compiles
`better-sqlite3`, so a C/C++ toolchain is used if a prebuilt binary isn't available.

```bash
# 1. install dependencies
npm install

# 2. run in development (API on :4000, UI on :5173 with hot reload)
npm run dev
#    → open http://localhost:5173
```

> **If `npm install` prints an "allow-scripts" warning** (some npm setups block
> package install scripts), let the two native packages finish, then run again:
> ```bash
> npm approve-scripts better-sqlite3
> npm approve-scripts esbuild
> npm rebuild better-sqlite3 esbuild
> ```

The database is created and **seeded automatically** on first run (sample users,
trackers, schedule and tasks) at `data/dashboard.db`.

### Production build

```bash
npm run build     # bundles the React app into dist/
npm start         # serves the app + API together on http://localhost:4000
```

### Reset the data

```bash
npm run seed      # wipes and re-seeds the database with fresh sample data
```

<br>

## 🔑 Demo accounts

| Role      | Username    | Password    | Sees                           |
| --------- | ----------- | ----------- | ------------------------------ |
| **Admin** | `admin`     | `admin123`  | Everything                     |
| Instagram | `dilnoza`   | `media123`  | Instagram Uzb + Instagram Main |
| Telegram  | `malika`    | `tg123`     | Telegram Uzb + Telegram Main   |
| Target    | `bekzod`    | `perf123`   | Target only (no sidebar)       |
| YouTube   | `sardor`    | `yt123`     | YouTube only (no sidebar)      |

> On the login screen you can **click any demo account to auto-fill** it.
> **Change these passwords before real use.** Email is optional per user (kept for
> future notifications); login is by username only.

<br>

## 🛠 Tech stack

| Layer     | Choice                                                            |
| --------- | ---------------------------------------------------------------- |
| Frontend  | React 18 + Vite + React Router, hand-built CSS design system      |
| Icons     | lucide-react                                                      |
| Backend   | Node.js + Express                                                 |
| Database  | SQLite via better-sqlite3 (a single file, no server to run)       |
| Auth      | JSON Web Tokens + bcryptjs password hashing                       |

<br>

## 📁 Project structure

```
├── server/                 Express API
│   ├── index.js            app entry + static hosting of the built UI
│   ├── db.js               SQLite schema + seed data
│   ├── auth.js             JWT signing + access-control middleware
│   ├── seed.js             `npm run seed`
│   └── routes/             auth · users · tasks · trackers · schedule
├── client/                 React app (Vite)
│   ├── src/
│   │   ├── pages/          Login · Overview · Department · MyTasks · Admin
│   │   ├── components/     Sidebar · Layout · Meter · Ring · TaskRow · …
│   │   └── lib/            api client · auth context · constants
│   └── index.html
├── data/                   SQLite database (git-ignored, auto-created)
└── vite.config.js
```

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

| Variable      | Default                             | Purpose                        |
| ------------- | ----------------------------------- | ------------------------------ |
| `PORT`        | `4000`                              | API / production server port   |
| `JWT_SECRET`  | `satashkent-dev-secret-change-me`   | **Set this in production**     |

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
