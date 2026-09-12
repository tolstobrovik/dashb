// ---- what is still on the table --------------------------------------------
//
// The pay card could already say what a month HAD earned. What it could never
// say is the thing people actually want to know on the 18th: what is still
// winnable, and what it would take. A bonus that pays 400 000 for twenty
// pieces was a grey line reading "5 more to go" — a fact, with no sense of
// whether five more is a comfortable week or an impossible one.
//
// So every bonus is read as a GOAL with a state, and the state is worked out
// from the calendar as well as the count:
//
//   won      earned — the money is in the total already
//   close    not yet, but a day or two of ordinary work does it
//   open     not yet, and the month is running at a pace that gets there
//   behind   at this pace the month ends short — said while there is still
//            time to do something about it, which is the whole point
//   lost     out of reach: the days have gone
//
// Everything here is derived on the server from real deliveries. None of it
// can be moved by anything a browser sends, which is what keeps it a report
// and not a video game.

const LAST_DAY = (iso) => {
  const d = new Date(`${String(iso).slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

// A whole-month range is judged against the whole month, not against today.
// Asking "am I on track for the quota?" on the 8th and being told the quota is
// unreachable because only eight days have passed would be arithmetic nobody
// asked for. Any other range is judged against itself.
export function horizonOf(from, to) {
  const wholeMonth = /^\d{4}-\d{2}-01$/.test(String(from || '')) && String(from).slice(0, 7) === String(to || '').slice(0, 7)
  return wholeMonth ? LAST_DAY(from) : to
}

// How far through the period we are, 0..1, and how many days are left in it.
export function periodOf(from, to) {
  const horizon = horizonOf(from, to)
  const span = Math.max(1, daysBetween(from, horizon) + 1)
  const elapsed = Math.min(span, Math.max(0, daysBetween(from, to) + 1))
  return { from, to, horizon, span, elapsed, days_left: Math.max(0, daysBetween(to, horizon)), through: elapsed / span }
}

// One goal, read off a count against a target.
//   have/need   where they are and where the bonus sits
//   per_day     what the remaining days would have to produce
// `reachable` is how many of the remaining days could plausibly carry one
// each — a quota of forty with two days left is not "8 to go", it is gone.
function countGoal({ key, label, unit, pays, have, need, period, dailyCap = 3 }) {
  const left = Math.max(0, need - have)
  const pctDone = need > 0 ? Math.min(100, Math.round((have / need) * 100)) : 0
  const base = { key, label, unit, pays, have, need, left, pct: pctDone, days_left: period.days_left }
  if (have >= need) return { ...base, state: 'won', left: 0, pct: 100 }
  if (period.days_left <= 0) return { ...base, state: 'lost' }
  const reachable = period.days_left * dailyCap
  if (left > reachable) return { ...base, state: 'lost', note: 'more than the days left can carry' }
  const perDay = left / Math.max(1, period.days_left)

  // NEARLY has to mean nearly. The first cut of this said a tenth of the
  // target, OR three days left for every one still owed — and five of twenty
  // with eighteen days to run came back as "nearly", with a flame on it. Five
  // is a comfortable fortnight, not an afternoon, and a board that calls it
  // nearly is a board whose "nearly" nobody reads twice.
  if (left <= Math.max(1, Math.round(need * 0.15))) return { ...base, state: 'close', per_day: perDay }
  if (left <= 3 && period.days_left >= left * 2) return { ...base, state: 'close', per_day: perDay }

  // BEHIND is a claim about pace, and pace needs a run to read. The first cut
  // compared the count against the fraction of the month elapsed, which on the
  // FIRST MORNING of every month declared everybody behind: nothing delivered
  // against a twentieth of a day's worth expected. Being told you are slipping
  // before you could possibly have done anything is the exact opposite of what
  // this is for, so nothing is called behind until a quarter of the period has
  // run, and not then unless the shortfall is a whole piece of work.
  const expected = need * period.through
  if (period.through >= 0.25 && expected - have >= 1 && have < expected * 0.8) {
    return { ...base, state: 'behind', per_day: perDay }
  }
  return { ...base, state: 'open', per_day: perDay }
}

// Punctuality is not a count, so it is read differently: how many MORE
// on-time deliveries would drag the share back over the line. That number is
// the useful one — "three more on time and it is yours" is something a person
// can act on this week; "you are on 84%" is not.
function onTimeGoal({ pays, target, done, onTime, period }) {
  const have = done > 0 ? Math.round((onTime / done) * 100) : null
  const base = { key: 'ontime', label: 'On-time bonus', unit: '%', pays, have, need: target, left: null, pct: have === null ? 0 : Math.min(100, Math.round((have / Math.max(1, target)) * 100)), days_left: period.days_left }
  if (have !== null && have >= target) return { ...base, state: 'won', left: 0, pct: 100 }
  if (have === null) return { ...base, state: 'open', note: 'nothing delivered yet' }
  if (target >= 100) return { ...base, state: period.days_left > 0 ? 'behind' : 'lost' }
  // k on-time deliveries such that (onTime + k) / (done + k) >= target/100
  const k = Math.ceil((target * done - 100 * onTime) / (100 - target))
  const needMore = Math.max(1, k)
  if (period.days_left <= 0) return { ...base, state: 'lost' }
  if (needMore > period.days_left) return { ...base, state: 'behind', on_time_more: needMore }
  return { ...base, state: needMore <= 2 ? 'close' : 'open', on_time_more: needMore }
}

// Every goal a person's rate card actually sets. A board that pays no views
// bonus never produces a views goal — an empty ladder is a statement about the
// setup, not about the person, and this page has been careful about that
// since the day it stopped printing "0 UZS" under everybody's name.
export function goalsOf({ rates, delivered, late, onTime, views, from, to }) {
  const period = periodOf(from, to)
  const out = []
  if (rates.quota > 0 && rates.quota_bonus > 0) {
    out.push(countGoal({
      key: 'quota', label: 'Quota bonus', unit: 'delivered', pays: rates.quota_bonus,
      have: delivered, need: rates.quota, period, dailyCap: 3,
    }))
  }
  if (rates.ontime_bonus > 0) {
    out.push(onTimeGoal({ pays: rates.ontime_bonus, target: rates.ontime_target || 0, done: delivered, onTime, period }))
  }
  if (rates.views_target > 0 && rates.views_bonus > 0) {
    // Views do not arrive one a day — a single reel can carry a month — so the
    // cap is the target itself: nothing here is ever "impossible", only behind.
    out.push(countGoal({
      key: 'views', label: 'Views bonus', unit: 'views', pays: rates.views_bonus,
      have: views, need: rates.views_target, period, dailyCap: rates.views_target,
    }))
  }
  return { period, goals: out }
}
