import { toast } from './toast.js'
import { tr as tx } from './i18n.jsx'

// Finishing a piece — the tick on a row, "Mark as done" in a right-click menu,
// Publish in the review queue, a card dragged into the last column — moves it
// to the stage that will not take it without the link to the published post.
// A card has nowhere to paste one, so the refusal OPENS the task on that box
// rather than stopping at an alert: the thing being asked for and the place to
// answer it are the same screen. Every other refusal still speaks for itself.
const askForTheLink = (err, item, openTask) => {
  if (err?.data?.needs === 'post_link' && openTask) {
    openTask({ ...item, needs_post_link: true })
    toast(err.message, 'err')
  } else alert(err.message)
}

export const markDone = (item, update, openTask) =>
  update(item, { done: !item.done_at })
    .then(() => toast(tx('Saved — synced')))
    .catch((err) => askForTheLink(err, item, openTask))

// A move onto a named stage: the same refusal, the same door out of it.
export const moveTo = (item, update, statusId, openTask, said) =>
  update(item, { status_id: statusId })
    .then(() => { if (said) toast(said) })
    .catch((err) => askForTheLink(err, item, openTask))

export { askForTheLink }
