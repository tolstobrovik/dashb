import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useT } from '../lib/i18n.jsx'

// What this person has done, sitting on their dashboard where the nagging
// used to be.
//
// Every message the board sent was a deadline, a Pravki or a count of what
// was late. It knew perfectly well that somebody had delivered nine cuts this
// month and had not missed a promise in three weeks, and it never once said
// so — and a board that only ever tells you off is a board people stop
// opening.
//
// Nothing here is awarded or invented. The streak is days on which they
// really handed something over; the counts are the same deliveries the report
// and the payroll use. It shows nothing at all to somebody who has never
// delivered anything, because "0 days, 0 pieces" is a scolding with a flame
// next to it.

export default function Streak() {
  const { t } = useT()
  const [s, setS] = useState(null)
  useEffect(() => { api.get('/rewards/mine').then(setS).catch(() => setS(null)) }, [])
  if (!s || !s.total) return null
  const toNext = s.toNextMilestone
  const pct = s.nextMilestone ? Math.round((s.total / s.nextMilestone) * 100) : 100

  return (
    <div className="card card-pad streak-chip">
      <span className="streak-flame" aria-hidden="true">{s.streak >= 2 ? '🔥' : '🎬'}</span>
      <span className="streak-main">
        <b>
          {s.streak >= 2
            ? t('reward.streak', { n: s.streak })
            : t('reward.delivered', { n: s.total })}
        </b>
        <span className="stat-sub">
          {toNext ? t('reward.tonext', { n: toNext, m: s.nextMilestone }) : t('reward.allthere')}
        </span>
        {s.nextMilestone && (
          <span className="streak-bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></span>
        )}
      </span>
      <span className="streak-facts">
        <div><b>{s.week}</b><span>{t('reward.thisweek')}</span></div>
        <div><b>{s.month}</b><span>{t('reward.thismonth')}</span></div>
        {s.onTimePct !== null && (
          <div><b>{s.onTimePct}%</b><span>{t('reward.ontime')}</span></div>
        )}
      </span>
    </div>
  )
}
