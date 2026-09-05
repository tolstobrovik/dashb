import { tr as tx, locale } from './i18n.jsx'
import {
  Instagram, Send, Youtube, Target, Camera, Clapperboard, Megaphone,
  Star, BarChart3, Globe, Music2, PenTool, Image as ImageIcon, Film, CirclePlay, Video, FileText,
  Lightbulb, Scissors, CheckCircle2, Trash2,
} from 'lucide-react'

// Icons the admin can pick when creating a sidebar channel.
export const CHANNEL_ICONS = {
  instagram: Instagram,
  telegram: Send,
  youtube: Youtube,
  target: Target,
  camera: Camera,
  video: Clapperboard,
  megaphone: Megaphone,
  chart: BarChart3,
  globe: Globe,
  music: Music2,
  pen: PenTool,
  star: Star,
}
export const iconFor = (name) => CHANNEL_ICONS[name] || Star

// Telegram-style member rights the admin can toggle per person.
export const PERMISSIONS = [
  { key: 'edit_metrics',    label: 'Update metric values',      desc: 'Use +/− and change current numbers' },
  { key: 'manage_metrics',  label: 'Add & edit metrics',        desc: 'Create, rename, retarget, delete metrics' },
  { key: 'manage_layout',   label: 'Change layout',             desc: 'Reorder metrics and pin them to the top' },
  { key: 'manage_content',  label: 'Create & edit content',     desc: 'Add tasks, edit details and dates' },
  { key: 'move_tasks',      label: 'Move tasks',                desc: 'Drag between stages and calendar days' },
  { key: 'review_publish',  label: 'Review & publish',          desc: 'Move Ready tasks to Published, on your channels' },
  { key: 'request_changes', label: 'Request changes (Pravki)',  desc: 'Send a Ready task back to the crew with notes' },
  { key: 'deliver_work',    label: 'Deliver / re-deliver work', desc: 'Update a stage’s delivery link and mark fixes done' },
  { key: 'manage_ambassadors', label: 'Run the ambassador programme',
    desc: 'Check students’ posts, set their terms, and sign new ones up' },
]

export const can = (user, perm) =>
  user?.role === 'admin' || !!(user?.permissions && user.permissions[perm])

// The Deleted stage: killed content that stays on the record. It counts for
// the planner/operator, never for the editor, and leaves every to-do view.
export const isDeletedLabel = (label) => /^deleted$/i.test(label || '')

// The Idea stage: a thought, not a commitment — no crew or dates expected yet,
// so planning views don't count its blanks as gaps.
export const isIdeaLabel = (label) => /idea/i.test(label || '')

// The little glyph a pipeline stage wears on calendar pills and chips —
// matched by label so custom stages still land on something sensible.
export const statusIcon = (label) => {
  const l = (label || '').toLowerCase()
  if (/deleted/.test(l)) return Trash2
  if (/idea/.test(l)) return Lightbulb
  if (/\bshot\b|filmed/.test(l)) return Film
  if (/shoot/.test(l)) return Clapperboard
  if (/edit/.test(l)) return Scissors
  if (/ready|approv/.test(l)) return CheckCircle2
  if (/publish|post|done|got|live/.test(l)) return Send
  return null
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Working-schedule days, Mon-first for display but numbered like JS getDay()
// (0 = Sunday) — the same encoding users.work_days stores.
export const WORK_DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 0, label: 'Sun' },
]

// "Mon–Fri · 09:00–18:00" from a user's schedule fields; null when unset.
export function scheduleLabel(u) {
  const days = Array.isArray(u?.work_days) && u.work_days.length ? u.work_days : null
  const hours = u?.work_start && u?.work_end ? `${u.work_start}–${u.work_end}` : null
  if (!days && !hours) return null
  let dayTxt = null
  if (days) {
    const ordered = WORK_DAYS.filter((d) => days.includes(d.n))
    // Contiguous run (in Mon-first order) reads as a range: Mon–Fri.
    const idx = ordered.map((d) => WORK_DAYS.findIndex((w) => w.n === d.n))
    const contiguous = idx.length > 2 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
    dayTxt = contiguous ? `${ordered[0].label}–${ordered[ordered.length - 1].label}` : ordered.map((d) => d.label).join(' ')
  }
  return [dayTxt, hours].filter(Boolean).join(' · ')
}
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const CADENCES = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
]

// What a task is. Creating a Post raises the channel's Posts plan by one;
// completing it fills the plan (15/16 → 16/16).
export const CONTENT_TYPES = [
  { key: 'post',  label: 'Post',  plan: 'Posts',   icon: ImageIcon },
  { key: 'reel',  label: 'Reel',  plan: 'Reels',   icon: Film },
  { key: 'story', label: 'Story', plan: 'Stories', icon: CirclePlay },
  { key: 'video', label: 'Video', plan: 'Videos',  icon: Video },
  // Paid promotion: a creative made for an ad set rather than for the feed.
  { key: 'target', label: 'Target', plan: 'Target', icon: Target },
  { key: 'other', label: tx('Other'), plan: null,      icon: FileText },
]
export const typeInfo = (key) => CONTENT_TYPES.find((t) => t.key === key) || CONTENT_TYPES[CONTENT_TYPES.length - 1]

// ---- Date helpers (yyyy-mm-dd) ----
// "Today" is pinned to the team's clock (Asia/Tashkent, UTC+5): the calendars,
// to-do list and overdue checks roll to a new day at Tashkent midnight, no
// matter where or on which device the dashboard is opened.
export const TIMEZONE = 'Asia/Tashkent'
const tashkentFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }) // YYYY-MM-DD
export function localISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
export const todayISO = () => tashkentFmt.format(new Date())
// The Tashkent calendar day (YYYY-MM-DD) of a full ISO timestamp — so
// "published this week" counts by the team's clock, not the browser's.
export const tashkentDay = (iso) => (iso ? tashkentFmt.format(new Date(iso)) : null)
export function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return localISO(d)
}
export function dateLabel(iso) {
  if (!iso) return 'No date'
  const t = todayISO()
  if (iso === t) return 'Today'
  if (iso === addDaysISO(t, 1)) return 'Tomorrow'
  if (iso === addDaysISO(t, -1)) return 'Yesterday'
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })
}

// Distinct solid colors for departments — the admin overview and timeline
// paint each channel in its own color, in sidebar order.
export const DEPT_PALETTE = [
  '#a32234', '#2a78d6', '#0e8a6d', '#7c5cd6', '#f2a413',
  '#c2185b', '#00838f', '#5d4037', '#455a64', '#7cb342',
]
export const deptColor = (i) => DEPT_PALETTE[((i % DEPT_PALETTE.length) + DEPT_PALETTE.length) % DEPT_PALETTE.length]

// Readable text color on a solid colored chip: dark on light fills, white
// on dark fills — so stage colors stay distinctive without transparency.
export function onColor(hex = '') {
  const n = String(hex).replace('#', '')
  if (n.length < 6) return '#fff'
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b > 168 ? '#26222b' : '#fff'
}

export function initials(name = '') {
  return name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('')
}

// ---- what counts as an answer ----------------------------------------------
// The form asks these BEFORE the save so the message lands next to the field
// rather than arriving as a refusal. The rules themselves live in one place —
// lib/text.js, mirroring server/text.js — because "is this a link" and "is
// this a sentence" are two different questions and were being answered by the
// same blunt check. The server is still the one that decides.
export { readText, hasSubstance, hasLink, isSentence, isBareLink, MIN_SENTENCE_WORDS } from './text.js'
