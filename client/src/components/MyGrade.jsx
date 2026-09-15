import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/constants.js'
import { tr as tx } from '../lib/i18n.jsx'

// Which rung of the ladder this month puts you on.
//
// The admin sets what A+ costs; everybody climbing it should be able to see
// where they are without asking. Separate from the pay card on purpose: a
// board that has set no rates still has a ladder, and the two answer different
// questions.
//
// It shows nothing until an admin has set one. A grade card on a board with no
// grades reads as a judgement rather than a setup.
export default function MyGrade() {
  const [me, setMe] = useState(null)
  useEffect(() => {
    const t = todayISO()
    api.get(`/reports/work/mine?from=${t.slice(0, 8)}01&to=${t}`).then(setMe).catch(() => setMe(null))
  }, [])
  if (!me || !me.ladder?.length) return null

  const done = me.count
  const span = me.next_at ? me.next_at : (me.at || 1)
  const pct = Math.max(0, Math.min(100, Math.round((done / span) * 100)))

  return (
    <div className="card card-pad my-grade">
      <Sparkles size={17} />
      <span className="my-grade-now">
        <b>{me.grade || tx('Not there yet')}</b>
        <span className="stat-sub">
          {tx('{n} delivered this month', { n: done })}
        </span>
      </span>
      <span className="my-grade-bar">
        <span className="my-grade-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="stat-sub my-grade-next">
        {me.next
          ? tx('{name} at {n}', { name: me.next, n: me.next_at })
          : tx('Top of the ladder')}
      </span>
    </div>
  )
}
