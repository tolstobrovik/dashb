import {
  Instagram, Send, Youtube, Target, Camera, Clapperboard, Megaphone,
  Star, BarChart3, Globe, Music2, PenTool, Image as ImageIcon, Film, CirclePlay, Video, FileText,
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
  { key: 'edit_metrics',   label: 'Update metric values',  desc: 'Use +/− and change current numbers' },
  { key: 'manage_metrics', label: 'Add & edit metrics',    desc: 'Create, rename, retarget, delete metrics' },
  { key: 'manage_layout',  label: 'Change layout',         desc: 'Reorder metrics and pin them to the top' },
  { key: 'manage_content', label: 'Create & edit content', desc: 'Add tasks, edit details and dates' },
  { key: 'move_tasks',     label: 'Move tasks',            desc: 'Drag between stages and calendar days' },
]

export const can = (user, perm) =>
  user?.role === 'admin' || !!(user?.permissions && user.permissions[perm])

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
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
  { key: 'other', label: 'Other', plan: null,      icon: FileText },
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
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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
