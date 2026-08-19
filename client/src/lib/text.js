// What a piece of writing actually IS.
//
// The form asks people for two different kinds of thing and used to check
// both with the same blunt rule — "does this have letters in it". So a
// reference of "халатно" passed as a brief, and a script of
//
//     https://drive.google.com/file/d/1a2b3c
//
// passed as a shot list, because a URL is three "words" once you split on
// spaces. Neither is what was asked for.
//
// This reads a value once and says which it is. A LINK points somewhere. A
// SENTENCE says something. Text that carries both is an annotated link, which
// is the best answer to most of the questions this board asks. Everything
// else is either a placeholder ("N/A", ".", "тз") or a FRAGMENT — real words,
// but too few to be an answer.
//
// Mirrors server/text.js exactly, so the form can say the same thing before
// the save rather than after it. The SERVER is the one that decides: if these
// two ever drift, the worst case is a refusal the form failed to predict —
// never a placeholder getting through.

// Deliberately broad. A person pasting a link means a link whether or not
// they typed the scheme, and a bare domain is how half of them arrive.
const TLD = 'com|ru|uz|org|net|io|me|tv|app|dev|ai|co|uk|kz|edu|gov|info|biz|space|site|online|xyz|cloud|link|pro'
export const URL_RE = new RegExp(
  `(?:https?://|www\\.)[^\\s<>"']{2,}|\\b[\\w-]+\\.(?:${TLD})\\b(?:/[^\\s<>"']*)?`, 'gi')

// What people type to get past a required field without answering it.
const PLACEHOLDER = /^(?:n\/?a|na|none|null|nil|no|nope|tbd|todo|test|тз|нет|нету|н\/?д|тбд|тест|пусто|ok|ок|да|yes)$/i

// A sentence is more than a couple of words. Three is the bar: enough to be
// an answer, few enough that answering is never a chore.
export const MIN_SENTENCE_WORDS = 3

// Read a value once; everything else here is a question about the result.
//   kind: empty | link | annotated_link | placeholder | fragment | sentence
//   links: the URLs found, in order
//   words: the meaningful words left AFTER the links are taken out
export function readText(v) {
  const raw = String(v ?? '').trim()
  if (!raw) return { kind: 'empty', raw, links: [], prose: '', words: [] }
  const links = raw.match(URL_RE) || []
  const prose = raw.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim()
  // A "word" has a letter or a digit in it, so "—" and "•••" count as none.
  const words = prose.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
  const meaty = words.length >= MIN_SENTENCE_WORDS
  if (links.length) return { kind: meaty ? 'annotated_link' : 'link', raw, links, prose, words }
  // No link, so the words are all there is.
  if (!words.length || (words.length === 1 && PLACEHOLDER.test(words[0])))
    return { kind: 'placeholder', raw, links, prose, words }
  // A single short token is a shrug, not an answer: "ok", "норм", "aa".
  if (words.length === 1 && prose.replace(/[\s\p{P}\p{S}]/gu, '').length < 2)
    return { kind: 'placeholder', raw, links, prose, words }
  return { kind: meaty ? 'sentence' : 'fragment', raw, links, prose, words }
}

// ---- the questions the product actually asks --------------------------------

// Is there anything here at all? (Used where a field is merely required to be
// filled in — the low bar, kept because some fields genuinely only need one
// word: a Rubrika is "SU events", not a paragraph.)
export const hasSubstance = (v) => !['empty', 'placeholder'].includes(readText(v).kind)

// Does it POINT somewhere? A reference has to.
export const hasLink = (v) => readText(v).links.length > 0

// Does it SAY something? A script the crew films from, a reason a deadline
// moved. A bare URL does not, however long it is.
export const isSentence = (v) => ['sentence', 'annotated_link'].includes(readText(v).kind)

// Is it a link and nothing but? What a delivery field wants.
export const isBareLink = (v) => {
  const t = readText(v)
  return t.links.length > 0 && t.words.length === 0
}

// Why a value was refused, in the words the person needs — never just "invalid".
// `want` is 'sentence' | 'link' | 'substance'.
export function whyNot(v, want, label) {
  const t = readText(v)
  const L = `«${label}»`
  if (t.kind === 'empty') return `${L} is required for this type of task`
  if (t.kind === 'placeholder') return `${L} needs a real answer — “${clip(t.raw)}” is a placeholder, not an answer`
  if (want === 'link' && !t.links.length)
    return `${L} has to point somewhere — paste a link, or attach the photo or document it refers to`
  if (want === 'sentence' && !isSentence(v)) {
    return t.links.length
      ? `${L} needs words as well as a link — say what to do with it, in a sentence`
      : `${L} needs a real answer — “${clip(t.raw)}” is a note, not something anyone can work from`
  }
  return null
}
export const clip = (s) => { const t = String(s ?? '').trim(); return t.length > 40 ? `${t.slice(0, 40)}…` : t }
