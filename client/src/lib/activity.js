// Turning an activity row into a sentence: "changed the shoot start: 10:00 →
// 11:00". The server writes names and stage labels down at the moment of the
// change, so rendering needs no lookups — old rows keep reading correctly
// after people leave or stages get renamed.
const WORDS = {
  stage: 'stage', title: 'title', type: 'type', platforms: 'platforms', owners: 'owners',
  operator: 'operator', editor: 'editor', designer: 'designer',
  recording_date: 'shoot day', recording_time: 'shoot start', recording_end: 'shoot end',
  edit_ready_date: 'edit deadline', design_ready_date: 'design deadline',
  release_date: 'release day', release_time: 'release time',
  description: 'description', format: 'format', rubrika: 'rubrika', script: 'script',
  reference: 'reference', photo: 'cover photo', checklist: 'checklist',
  ready_link: 'ready link', shot_link: 'footage link', design_link: 'design link',
}

export function activityLine(a) {
  if (a.kind === 'created') return 'created the task'
  if (a.kind === 'deleted') return 'deleted the task'
  const f = a.field
  if (f === 'done') return a.new_value === 'yes' ? 'marked it done' : 'reopened it'
  if (f === 'pinned') return a.new_value === 'yes' ? 'pinned it' : 'unpinned it'
  if (f === 'pravki') return `sent it back for pravki${a.new_value ? ` (${a.new_value})` : ''}`
  // Paperwork reads as an act, not a field change: "attached ТЗ.docx".
  if (f === 'document') return a.new_value ? `attached ${a.new_value}` : `removed ${a.old_value}`
  const w = WORDS[f] || f
  if (a.old_value == null && a.new_value == null) return `updated the ${w}`
  if (a.old_value == null) return `set the ${w} to ${a.new_value}`
  if (a.new_value == null) return `cleared the ${w} (was ${a.old_value})`
  return `changed the ${w}: ${a.old_value} → ${a.new_value}`
}
