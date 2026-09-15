// The moment something gets finished.
//
// Confetti alone said "an event happened". It did not say WHAT, it did not
// say whose, and it said the same thing on somebody's first piece as on their
// hundredth. Duolingo's trick is not the animation — it is that the animation
// arrives with a sentence about YOU: what you just did, how many days you
// have kept it up, and which round number you have just walked past.
//
// So a finish now brings four things, in this order and inside two seconds:
//
//   the chime      already synthesised in lib/sound.js, respects the switch
//   the confetti   already in lib/celebrate.js, respects reduced motion
//   a sentence     varied, in the reader's language, never the same twice
//                  running
//   the standing   the streak, and the milestone if one was just passed —
//                  fetched from /rewards/mine, which derives it from real
//                  deliveries and cannot be farmed by clicking
//
// All four degrade independently. No sound, no motion, no network: what is
// left is a small card that says "Published". Nothing here blocks the save,
// and nothing here is on the critical path of anything.

import { celebrate } from './celebrate.js'
import { playDing } from './sound.js'
import { api } from './api.js'

// One at a time, and never stacked: a bulk publish is one moment, not six.
let showing = false
let lastPhrase = -1

const PHRASES = {
  en: ['Nice one!', 'That’s a wrap!', 'Done and out!', 'Beautiful.', 'Shipped!', 'One more out the door.'],
  ru: ['Отлично!', 'Готово!', 'Так держать!', 'Красиво.', 'Опубликовано!', 'Ещё одно готово.'],
  uz: ['Zo‘r!', 'Tayyor!', 'Shunday davom eting!', 'Ajoyib.', 'Chiqarildi!', 'Yana bittasi tayyor.'],
}
const LINES = {
  en: {
    streak: (n) => `${n} days in a row`,
    milestone: (n) => (n === 1 ? 'Your first one' : `Your ${n}th`),
    today: (n) => (n === 1 ? '1 today' : `${n} today`),
  },
  ru: {
    streak: (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'день' : 'дн.'} подряд`,
    milestone: (n) => (n === 1 ? 'Первое!' : `${n}-е`),
    today: (n) => `сегодня: ${n}`,
  },
  uz: {
    streak: (n) => `ketma-ket ${n} kun`,
    milestone: (n) => (n === 1 ? 'Birinchisi!' : `${n}-chisi`),
    today: (n) => `bugun: ${n}`,
  },
}

const langOf = () => {
  try {
    const l = localStorage.getItem('satashkent_lang')
    if (l && PHRASES[l]) return l
  } catch { /* private window */ }
  return 'en'
}

// Never the same phrase twice running — the fastest way to make a reward feel
// like a machine is to have it say one thing.
const pick = (list) => {
  if (list.length < 2) return list[0]
  let i = lastPhrase
  while (i === lastPhrase) i = (Math.random() * list.length) | 0
  lastPhrase = i
  return list[i]
}

function card({ phrase, lines, big }) {
  const el = document.createElement('div')
  el.className = 'reward-pop'
  el.setAttribute('role', 'status')
  el.innerHTML = `
    <div class="reward-card">
      <div class="reward-big">${big}</div>
      <div class="reward-say"></div>
      <div class="reward-lines"></div>
    </div>`
  el.querySelector('.reward-say').textContent = phrase
  const box = el.querySelector('.reward-lines')
  for (const line of lines) {
    const s = document.createElement('span')
    s.textContent = line
    box.appendChild(s)
  }
  document.body.appendChild(el)
  // The card leaves on its own. A reward you have to dismiss is a dialog.
  const off = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260) }
  setTimeout(off, 2100)
  return off
}

// `after` is the row as the server returned it, so this can tell a publish
// from a plain save without asking anything.
export async function rewardFinish() {
  if (showing) return
  showing = true
  try {
    playDing()
    celebrate()
    const lang = langOf()
    const say = LINES[lang] || LINES.en
    const phrase = pick(PHRASES[lang] || PHRASES.en)

    // Show the card immediately with what is known for certain, then let the
    // standing arrive. A reward that waits on a round trip is a reward that
    // lands after the person has looked away.
    let stats = null
    try { stats = await Promise.race([api.get('/rewards/mine'), new Promise((r) => setTimeout(() => r(null), 900))]) }
    catch { /* the phrase and the confetti are enough */ }

    const lines = []
    let big = '🎉'
    if (stats) {
      if (stats.atMilestone) { lines.push(say.milestone(stats.atMilestone)); big = '🏆' }
      if (stats.streak >= 2) { lines.push(say.streak(stats.streak)); if (!stats.atMilestone) big = '🔥' }
      if (!lines.length && stats.today >= 2) lines.push(say.today(stats.today))
    }
    card({ phrase, lines, big })
  } finally {
    // Long enough that a double-click is one celebration, short enough that
    // two real finishes a few seconds apart are two.
    setTimeout(() => { showing = false }, 2400)
  }
}

// The same moment reached from a list: takes the row before and after so it
// fires only on the CROSSING into done. Re-saving something already finished
// is not a new achievement.
export function rewardIfFinished(before, after) {
  if (!before || !after) return
  if (!before.done_at && after.done_at) rewardFinish()
}
