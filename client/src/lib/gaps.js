import { isDeletedLabel } from './constants.js'

// What a task is still missing, and where it sits.
//
// This began life inside the Unassigned page. That page is gone — a whole
// destination whose only job was to list holes was one screen too many — but
// the reading of a hole is not: the stage walls use it to refuse a move, the
// task itself shows it, and it is the honest answer to "is this ready to go
// on?". So it lives here, on its own, with no page attached.
//
// WHICH hats count as missing is the admin's call (Admin → Pipeline → Who
// must be on a task, served as /fields `crew`): a text-only post stops
// shouting "needs a designer" the day the admin unticks it. Dates keep their
// own logic: filmed work wants a shoot day, everything wants a release day,
// and work already past the edit (ready_at) stopped needing its shoot-side
// people long ago.
//
// WHERE the task sits decides what it owes. An idea owes nothing. From the
// shooting stage a filmed piece owes its shooter and its days — that is what
// booking a shoot means. The EDITOR is owed one stage later, once the footage
// exists: asking for one while the shoot is still ahead is a gap nobody can
// close honestly.
export const stageRankOf = (statuses) => {
  const live = [...statuses].sort((a, b) => (a.sort - b.sort) || (a.id - b.id))
    .filter((s) => !isDeletedLabel(s.label))
  const shootAt = live.findIndex((s) => /to\s*shoot|shooting|s[yj]omka/i.test(s.label || ''))
  const idx = new Map(live.map((s, i) => [s.id, i]))
  return (statusId) => {
    const at = idx.has(statusId) ? idx.get(statusId) : -1
    if (shootAt < 0 || at < 0) return 'booked'    // no shooting stage: everything is booked
    if (at < shootAt) return 'idea'
    if (at === shootAt) return 'booked'
    return 'shot'
  }
}

export const gapsOf = (t, crew, rank) => {
  const need = (hat, fallback) => (Array.isArray(crew?.[hat]) ? crew[hat] : fallback).includes(t.type)
  const filmed = t.type === 'reel' || t.type === 'video'
  const preEdit = !t.ready_at
  const where = rank ? rank(t.status_id) : 'shot'
  const people = []
  const dates = []
  // An idea owes nothing. Brainstorm material with no owner and no dates is
  // not a planning failure, it is a thought — nagging about it is how a board
  // teaches people to stop writing thoughts down.
  if (where === 'idea') return { people, dates }
  if (!(t.assignees?.length ? t.assignees.length : t.assignee_id)) people.push({ key: 'owner', label: 'needs an owner' })
  if (need('operator', ['reel', 'video']) && preEdit && !t.operator_id) people.push({ key: 'operator', label: 'needs an operator' })
  if (need('editor', ['reel', 'video']) && preEdit && where === 'shot' && !t.editor_id) people.push({ key: 'editor', label: 'needs an editor' })
  if (need('designer', ['post']) && !t.designer_id) people.push({ key: 'designer', label: 'needs a designer' })
  if (filmed && preEdit && !t.recording_date) dates.push({ key: 'shoot', label: 'no shoot day' })
  if (!t.release_date) dates.push({ key: 'release', label: 'no release day' })
  return { people, dates }
}
