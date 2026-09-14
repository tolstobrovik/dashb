// What a channel's FORMAT lets a task be asked for.
//
// A type says what a piece is — a post, a reel. A format says where it is
// going. The board only ever knew the first, so one set of rules had to cover
// every surface at once, and a team writing a Telegram announcement was asked
// for its artwork, its designer and its reference image, because somewhere a
// rule says a post needs those. It does. On Instagram.
//
// The table itself is the server's (/fields → channel_formats), not a second
// copy kept here: the form that draws the questions and the routes that refuse
// the answers have to be reading one table, or they will disagree about what a
// Telegram post owes and only one of them will be on screen.
//
// Two rules worth stating plainly, because both are easy to get backwards:
//
//   ACROSS CHANNELS IT IS THE UNION. A piece cross-posted to Instagram and
//   Telegram is still going on Instagram, so it still needs the artwork. Only
//   a task going nowhere but Telegram stops being asked.
//
//   NO CHANNEL MEANS NO OPINION. A brand-new idea nobody has filed yet is
//   judged by the type rules alone — that is "nobody has said where this is
//   going", not "this is going nowhere, so it needs nothing".

// The formats of the channels a task is on, from the channel list the app
// already holds. Unknown keys are ignored rather than guessed at.
export const formatsOf = (keys, byKey) =>
  (Array.isArray(keys) ? keys : [])
    .map((k) => byKey?.[k]?.format)
    .filter(Boolean)

// Does any of these surfaces want this brief field / this hat? `table` is the
// served channel_formats. With nothing to go on the answer is yes, so the type
// rules stand alone and this can never make the form ask for LESS than it
// knows how to justify.
export const allowsField = (table, formats, key) =>
  !formats?.length || formats.some((f) => table?.[f]?.fields?.includes(key))
export const allowsCrew = (table, formats, hat) =>
  !formats?.length || formats.some((f) => table?.[f]?.crew?.includes(hat))

// One reader for a task, so a component asks "does this task need a designer"
// rather than re-deriving the channel list every time it wants to know.
export function askedOf(table, keys, byKey) {
  const formats = formatsOf(keys, byKey)
  return {
    formats,
    field: (k) => allowsField(table, formats, k),
    crew: (h) => allowsCrew(table, formats, h),
  }
}
