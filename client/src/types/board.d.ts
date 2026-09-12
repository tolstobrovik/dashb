// The board's data, written down.
//
// This app is plain JSX — there is no compiler reading this file, and nothing
// imports it. It is here because the shapes below are load-bearing and were
// previously only knowable by reading a route handler, and because the edge
// cases at the bottom are the ones that have actually cost us bugs. Editors
// pick it up for autocomplete; people pick it up for the comments.
//
// Kept honest by qa/round87-suite.mjs and qa/round88-suite.mjs, which assert
// the behaviours these comments describe. If this file and the server ever
// disagree, the server is right and this file is a bug.

// ---------------------------------------------------------------------------
// scalars
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD`, always in Asia/Tashkent. Never a `Date`: a board that shows
 *  "Tuesday" must show the same Tuesday to somebody reading it from Almaty. */
export type DayISO = string
/** `HH:MM`, 24-hour. */
export type TimeHM = string
/** A full ISO timestamp, UTC. Only ever machine-read — see DayISO. */
export type Timestamp = string
/** SQLite has no booleans. 0 and 1 arrive where a boolean is meant, and
 *  `x.pinned === true` is therefore always false. Compare truthily. */
export type SqlBool = 0 | 1

export type ChannelKey = string
export type UserId = number

// ---------------------------------------------------------------------------
// people
// ---------------------------------------------------------------------------

/** admin — the whole board · member — their channels, plus whatever their
 *  permissions add · editor/operator/designer/crew — a production hat, working
 *  across every channel and holding no channel powers · ambassador — a student
 *  with a login to one page and nothing else. */
export type Role = 'admin' | 'member' | 'editor' | 'operator' | 'designer' | 'crew' | 'ambassador'
export type CrewCap = 'editor' | 'operator' | 'designer'

export interface Permissions {
  manage_content?: boolean
  manage_users?: boolean
  manage_attendance?: boolean
  [key: string]: boolean | undefined
}

export interface User {
  id: UserId
  name: string
  username: string
  role: Role
  /** Which hats a crew account wears. Empty for admins and members. */
  crew_roles: CrewCap[]
  /** Channels a member works on. */
  departments: ChannelKey[]
  /** Channels a CHANNEL admin runs. Non-empty means they run content on those
   *  channels and are not shown the Admin panel — every tab in it would
   *  refuse them. */
  admin_channels: ChannelKey[]
  /** Channels a crew account is scoped to. EMPTY MEANS EVERY CHANNEL, not
   *  none — the crew pickers read it that way, and inverting the sense hides
   *  the whole crew from every board. */
  crew_channels: ChannelKey[]
  permissions: Permissions
  /** How many pieces of one kind this person can be booked for in a day. */
  daily_cap: number
  color: string
  avatar: string | null
  email: string | null
  phone: string | null
  position: string | null
  work_start: TimeHM | null
  work_end: TimeHM | null
  work_days: number[]
  weak_password: SqlBool
  created_at: Timestamp
}

/**
 * WHO YOU CAN SEE, which is not everybody.
 *
 * `GET /users` is scoped: an admin and the crew get the whole list; a member
 * gets themselves, every admin, all the crew, anybody sharing a channel with
 * them — and anybody holding a seat on a piece they can see.
 *
 * That last clause is not decoration. Without it a member could open a task,
 * be told somebody was editing it, and get a chip with an ellipsis in it: the
 * row named an id their directory would not resolve, so the seat rendered as
 * though nobody held it. Any code that looks a seat up in this list must cope
 * with a miss anyway — the list can be stale — but it should be rare enough
 * to be a race rather than a state. See qa/round87-suite.mjs.
 */
export type Directory = User[]

// ---------------------------------------------------------------------------
// channels
// ---------------------------------------------------------------------------

export interface Channel {
  id: number
  /** The stable slug. `label` is what people renamed it to and changes. */
  key: ChannelKey
  label: string
  icon: string
  /** Never null on a channel made after round 88: a channel created without a
   *  head is owned by whoever created it. A red NO OWNER badge on a channel
   *  nobody has got round to naming an owner for was an alarm about a form
   *  that had not been filled in. */
  head_id: UserId | null
  head_name: string | null
  head_color: string | null
  head_avatar: string | null
  drive_url: string
  daily_ad_cap: number
  sort: number
  dashboard: string
}

// ---------------------------------------------------------------------------
// the work
// ---------------------------------------------------------------------------

export type ContentType = 'reel' | 'post' | 'story' | 'video' | string

export interface ChecklistItem { text: string; done: boolean }

export interface Task {
  id: number
  title: string
  /** A piece can run on several channels at once. A page showing one channel
   *  must re-filter after every save: a piece moved off the channel you are
   *  looking at is somebody else's work now. */
  channels: ChannelKey[]
  type: ContentType
  description: string

  /** `assignees` is the list; `assignee_id` mirrors its first entry. Write
   *  `assignee_ids` and the server maintains both. Setting one and not the
   *  other by hand leaves a card whose chip and whose seat disagree. */
  assignee_id: UserId | null
  assignees: UserId[]
  created_by: UserId | null

  /** The hats. Which of them a piece owes depends on its type and on the
   *  board's rules — see FieldRules['crew']. */
  operator_id: UserId | null
  editor_id: UserId | null
  designer_id: UserId | null
  /** Whose face carries it. Not a hat: a hat is work done ON the piece. */
  face_id: UserId | null
  reviewer_id: UserId | null
  /** JSON array of UserId, as a string. Parse it. */
  reviewers: string

  /** Null means the piece is still an idea, and an idea owes you nothing but
   *  a description. See `isIdeaStage` in server/routes/content.js — the client
   *  half lives in lib/gaps.js and the two must agree. */
  status_id: number | null
  campaign_id: number | null

  recording_date: DayISO | null
  recording_time: TimeHM | null
  recording_end: TimeHM | null
  edit_ready_date: DayISO | null
  design_ready_date: DayISO | null
  release_date: DayISO | null
  release_time: TimeHM | null

  shot_link: string | null
  ready_link: string | null
  design_link: string | null
  /** Where it actually went out. The last stage cannot be reached without it;
   *  the refusal carries `needs: 'post_link'` so the client can open the sheet
   *  on that box instead of stopping at an alert. */
  post_link: string | null

  reference_text: string | null
  reference_links: string[]
  format: string | null
  rubrika: string | null
  script: string | null
  tz: string | null

  checklist: ChecklistItem[]
  pinned: SqlBool
  has_photo: SqlBool
  has_thumb: SqlBool
  comment_count: number
  todo_sort: number
  done_at: Timestamp | null
  created_at: Timestamp
  views: number | null
  skip_rate: number | null
}

/** What a PATCH may carry. Not a Partial<Task>: several keys are instructions
 *  rather than columns. */
export interface TaskPatch extends Partial<Omit<Task, 'id' | 'assignees' | 'reviewers'>> {
  /** The multi-select. Maintains `assignees` and `assignee_id` together. */
  assignee_ids?: UserId[]
  reviewer_ids?: UserId[]
  /** Tick or untick. Sets `done_at`, and may move the stage with it — which is
   *  why lib/useTaskSync.js will not guess the outcome of this one. */
  done?: boolean
  /** A photo, as a data URL. */
  photo?: string | null
  ready_file?: unknown
}

// ---------------------------------------------------------------------------
// stages and handovers
// ---------------------------------------------------------------------------

export interface Stage {
  id: number
  label: string
  color: string
  sort: number
}

/** A question the board asks before a piece moves on — "who is cutting this?"
 *  — that the sheet used not to ask, so work was handed over without anybody
 *  saying who was taking it. */
export interface HandoverGate {
  field: 'operator_id' | 'editor_id' | 'designer_id' | string
  label: string
  required: boolean
}

export interface HandoverAsk {
  gates: HandoverGate[]
}

// ---------------------------------------------------------------------------
// the board's own rules (GET /fields)
// ---------------------------------------------------------------------------

/** Per-field: which content types must fill it in, and which may. Set by the
 *  admin, stored as JSON in `meta`. */
export interface FieldRule {
  required?: ContentType[]
  optional?: ContentType[]
}

export interface FieldRules {
  format: FieldRule
  rubrika: FieldRule
  script: FieldRule
  tz: FieldRule
  reference: FieldRule
  description: FieldRule
  /** Which types owe which hat. */
  crew: Record<CrewCap, ContentType[]>
  /** Which pages the admin has switched on. An unknown key is SHOWN: a page
   *  the server has not heard of is one this build added, not one an admin
   *  switched off. */
  pages: Record<string, boolean>
  skip_tiers: unknown[]
  maker_grades: unknown[]
}

// ---------------------------------------------------------------------------
// sprints
// ---------------------------------------------------------------------------

export interface Sprint {
  id: number
  name: string
  starts_on: DayISO
  ends_on: DayISO
  closed_at: Timestamp | null
}

export interface SprintTask {
  id: number
  sprint_id: number | null
  title: string
  points: number | null
  status: string
  assignees: UserId[]
}

// ---------------------------------------------------------------------------
// the client's own state
// ---------------------------------------------------------------------------

/** lib/formState.js — is there anything on this sheet nobody has saved?
 *
 *  Measured against the values the sheet OPENED with, not against the record:
 *  a sheet that reopens after a save must not think it is dirty because the
 *  server rounded a date. Photographs are compared as present-or-absent; a
 *  CHECKLIST IS NOT — it looked like a blob, got swept in with them, and the
 *  result was a sheet you could tick four things on and close without being
 *  asked. */
export interface DirtyState {
  dirty: boolean
  /** After a save, what is on screen IS what is stored. */
  settle: (next?: Record<string, unknown>) => void
}

/** lib/formState.js — the dates that have to happen in an order.
 *
 *  Two chains, because two kinds of work reach the same day: a filmed piece is
 *  shot, then cut, then goes out; a designed one is drawn, then goes out.
 *  Moving anything upstream moves what is downstream of it, keeping the gap
 *  the plan had — each date measured from the link BEFORE it, never from
 *  whatever was touched. Measuring from the touched date stacks the gaps and
 *  throws the release a fortnight out on a four-day slip.
 *
 *  Only ever forwards. Pulling the shoot earlier drags nobody towards it. */
export interface DateCascade {
  form: Record<string, unknown>
  moved: Array<{ key: string; from: DayISO; to: DayISO }>
}

/** lib/useTaskSync.js — draw the change, then send it.
 *
 *  Only for changes whose answer is not in doubt: a seat, a pin, a title. A
 *  stage, a tick or a date chain can come back as something other than what
 *  was asked — gates, cascades, the published-link wall — and guessing those
 *  shows somebody the wrong thing and then takes it back, which is worse than
 *  the wait. Those wait, and `isBusy` says so. */
export interface TaskSync {
  update: (item: Task, patch: TaskPatch) => Promise<Task>
  busy: Set<number>
  isBusy: (id: number) => boolean
}

// ---------------------------------------------------------------------------
// the edge cases this file exists for
// ---------------------------------------------------------------------------

/**
 * RBAC UNRENDERS. A door somebody's role cannot open is not drawn — not
 * greyed out, not disabled with a lock on it. A member's sidebar has three
 * hubs and no People, and looks like it was built for them. A heading is
 * never drawn over an empty hub, which means counting items AFTER the
 * viewer's own hiding, not before.
 *
 * ACTIVE STATE IS RESOLVED BY SEGMENT. `/sprints/backlog` is not `/sprints`
 * and `/campaigns/7` is not `/projects`; matching on equality lights nothing
 * up when a deep link drops you one segment in. The hub holding the current
 * page is open whatever the viewer's folding preferences say — you cannot
 * fold away the page you are looking at.
 *
 * ARCHIVED AND ABSENT PEOPLE. Deleting an account nulls the seats it held, on
 * purpose. A seat you cannot RESOLVE is the different case, and the directory
 * is widened rather than the seat being drawn empty — see Directory.
 *
 * A HUNDRED-PLUS MEMBERS. The person picker debounces its search past three
 * characters, caps the list at 40 and says how many more there are, so a big
 * team costs a keystroke rather than a frame.
 *
 * OPTIMISTIC WRITES ARE REVERSIBLE. Every guess keeps the row it replaced and
 * puts it back on refusal. A guess that cannot be taken back is not a guess,
 * it is a lie.
 */
export type EdgeCases = never
