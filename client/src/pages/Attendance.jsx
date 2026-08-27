import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { todayISO } from '../lib/constants.js'
import { tr as tx } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import Avatar from '../components/Avatar.jsx'

// ---- who came in, and when ----
// The register was built as tab eight of eleven inside the Admin panel, which
// is a place nobody goes to look for "was anyone late today". It is a page
// now, with its own door in the sidebar, and the whole team can read it —
// which is the point of a counter. Only an admin writes to it.
//
// Nothing is assumed. A day with no mark on it means nobody wrote anything
// down, not that everybody was on time; marking somebody on time is its own
// fact and worth making.

const AT_STATES = [
  { key: 'on_time', label: 'On time', cls: 'at-ontime' },
  { key: 'late', label: 'Late', cls: 'at-late' },
  { key: 'away', label: 'Away', cls: 'at-away' },
]
export default function Attendance() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const [day, setDay] = useState(() => todayISO())
  const [month, setMonth] = useState(() => todayISO().slice(0, 7))
  const [users, setUsers] = useState([])
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(0)

  const load = useCallback(() => {
    const from = `${month}-01`
    const to = `${month}-31`
    return api.get(`/attendance?from=${from}&to=${to}`).then(setData).catch(() => setData(null))
  }, [month])
  useEffect(() => { api.get('/users').then(setUsers).catch(() => setUsers([])) }, [])
  useEffect(() => { load() }, [load])

  const mark = async (userId, status) => {
    setBusy(userId)
    try {
      const body = status === 'late'
        ? { status, arrived_at: prompt(tx('What time did they arrive? HH:MM'), '09:30') || null }
        : { status }
      if (status === 'late' && !body.arrived_at) { setBusy(0); return }
      await api.put(`/attendance/${userId}/${day}`, body)
      await load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(0) }
  }

  if (!data) return <div className="app-loading"><span className="spinner" /></div>
  const onDay = Object.fromEntries(data.rows.filter((r) => r.day === day).map((r) => [r.user_id, r]))
  const lateThisMonth = data.rows.filter((r) => r.status === 'late').length

  return (
    <>
      <div className="section-head">
        <h2>{tx('Attendance')}</h2>
        <span className="count">· {tx('{n} late this month', { n: lateThisMonth })}</span>
        <span className="spacer" />
        <label className="at-pick">
          <span className="stat-sub">{tx('Day')}</span>
          <input className="input" type="date" value={day} max={todayISO()}
            onChange={(e) => { setDay(e.target.value); setMonth(e.target.value.slice(0, 7)) }} />
        </label>
        <label className="at-pick">
          <span className="stat-sub">{tx('Month')}</span>
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>

      {isAdmin && <div className="card card-pad ai-note">
        <b>{tx('Nobody is late unless somebody says so.')}</b>
        <span className="stat-sub">
          {tx('A day with nothing marked means nothing was written down, not that everyone was on time. Marking somebody on time is a separate fact, and it is worth marking.')}
        </span>
      </div>}

      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr>
            <th>{tx('Member')}</th><th>{tx('This day')}</th><th>{tx('Arrived')}</th>
            <th>{tx('Late this month')}</th><th>{tx('Away')}</th><th />
          </tr></thead>
          <tbody>
            {users.map((u) => {
              const row = onDay[u.id]
              const t = data.tally[u.id] || { late: 0, away: 0, on_time: 0 }
              return (
                <tr key={u.id}>
                  <td>
                    <span className="at-who">
                      <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
                      <span><b>{u.name}</b><br /><span className="stat-sub">@{u.username}</span></span>
                    </span>
                  </td>
                  <td>
                    {/* An admin marks; everybody else reads. A row of buttons
                        that answer 403 reads as the app being broken rather
                        than as "not your call". */}
                    {isAdmin ? (
                      <span className="pill-group at-states">
                        {AT_STATES.map((st) => (
                          <button key={st.key} disabled={busy === u.id}
                            className={'pill' + (row?.status === st.key ? ` active ${st.cls}` : '')}
                            onClick={() => mark(u.id, st.key)}>
                            {tx(st.label)}
                          </button>
                        ))}
                      </span>
                    ) : row?.status ? (
                      <span className={`pill active ${AT_STATES.find((st) => st.key === row.status)?.cls || ''}`}>
                        {tx(AT_STATES.find((st) => st.key === row.status)?.label || row.status)}
                      </span>
                    ) : <span className="stat-sub">{tx('nothing written down')}</span>}
                  </td>
                  <td>{row?.status === 'late' && row.arrived_at
                    ? <b className="pay-bad">{row.arrived_at}</b>
                    : <span className="stat-sub">—</span>}</td>
                  <td>{t.late > 0
                    ? <span className="at-count at-late-count">{t.late}</span>
                    : <span className="stat-sub">0</span>}</td>
                  <td>{t.away > 0
                    ? <span className="at-count">{t.away}</span>
                    : <span className="stat-sub">0</span>}</td>
                  <td>
                    {row && isAdmin && (
                      <button className="btn btn-sm" disabled={busy === u.id}
                        data-tip={tx('Back to nothing written down')}
                        onClick={async () => {
                          setBusy(u.id)
                          try { await api.put(`/attendance/${u.id}/${day}`, {}); await load() }
                          catch (e) { toast(e.message, 'err') } finally { setBusy(0) }
                        }}>{tx('Clear')}</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
