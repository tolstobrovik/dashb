import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Clock, Plane, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { todayISO } from '../lib/constants.js'
import { tr as tx, locale } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import Avatar from '../components/Avatar.jsx'

// ---- who came in, and when ----
// The register was built as tab eight of eleven inside the Admin panel, which
// is not where anybody looks for "was anyone late today". It is a page now,
// with its own door, and the whole team can read it — the point of a counter.
// Only an admin writes to it.
//
// It showed ONE DAY at a time, with a date picker for the rest. Every question
// this register exists to answer is about a run of days — who keeps coming in
// late, who has been away this week — and answering any of them meant clicking
// through thirty-one days and holding the answer in your head. The month is
// the view now: people down the side, days across the top, the whole shape of
// it in one look. The data was always the whole month; only the view was one
// day wide.
//
// Nothing is assumed. An empty cell means nobody wrote anything down, not that
// somebody was on time; marking somebody on time is its own fact and worth
// making.

const STATES = [
  { key: 'on_time', label: 'On time', short: 'On time', cls: 'at-ontime', Icon: Check },
  { key: 'late', label: 'Late', short: 'Late', cls: 'at-late', Icon: Clock },
  { key: 'away', label: 'Away', short: 'Away', cls: 'at-away', Icon: Plane },
]
const byKey = Object.fromEntries(STATES.map((s) => [s.key, s]))

const monthOf = (iso) => iso.slice(0, 7)
const shiftMonth = (ym, by) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
// Every day in the month, and which of them are weekends — a blank Sunday is
// not a gap in the record.
const daysOf = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: last }, (_, i) => {
    const day = String(i + 1).padStart(2, '0')
    const iso = `${ym}-${day}`
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay()
    return { iso, n: i + 1, weekend: dow === 0 || dow === 6 }
  })
}
// Put the picker beside the square it belongs to, and never off the screen.
// Below the square if there is room, above it otherwise; nudged left when the
// last days of the month would push it past the edge. Narrow screens get a
// sheet across the bottom instead, so the thumb does not have to reach.
const PICK_W = 190
const PICK_H = 250
const pickStyle = (box) => {
  if (typeof window === 'undefined' || !box) return {}
  if (window.innerWidth <= 640) return {}   // the sheet, laid out in CSS
  const left = Math.max(8, Math.min(box.left, window.innerWidth - PICK_W - 8))
  const below = box.bottom + 6
  const room = window.innerHeight - below
  return room >= PICK_H
    ? { left, top: below }
    : { left, top: Math.max(8, box.top - PICK_H - 6) }
}

const monthWords = (ym) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })

export default function Attendance() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const today = todayISO()
  const [month, setMonth] = useState(() => monthOf(today))
  const [users, setUsers] = useState([])
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  // Which cell is open for marking. One at a time — a grid of open menus is
  // not a register, it is a mess.
  //
  // It carries the square's position because the picker is drawn OVER the
  // page rather than inside the cell: the month scrolls sideways in its own
  // box, and a box that scrolls clips whatever hangs out of it — which cut
  // the bottom off the picker and took the arrival time and Clear with it.
  const [picking, setPicking] = useState(null) // null | { userId, day, name, box }
  const [lateAt, setLateAt] = useState('09:30')

  const load = useCallback(() => {
    const days = daysOf(month)
    const from = days[0].iso
    const to = days[days.length - 1].iso
    return api.get(`/attendance?from=${from}&to=${to}`).then(setData).catch(() => setData(null))
  }, [month])
  useEffect(() => { api.get('/users').then(setUsers).catch(() => setUsers([])) }, [])
  useEffect(() => { load() }, [load])
  // Esc closes the picker, the same as every other transient thing on the board.
  useEffect(() => {
    if (!picking) return
    const onKey = (e) => e.key === 'Escape' && setPicking(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking])

  const days = useMemo(() => daysOf(month), [month])
  // One lookup for the whole grid: "what does this person's day say?"
  const cells = useMemo(() => {
    const m = {}
    for (const r of data?.rows || []) m[`${r.user_id}|${r.day}`] = r
    return m
  }, [data])

  const mark = async (userId, day, status, arrived) => {
    setBusy(`${userId}|${day}`)
    try {
      await api.put(`/attendance/${userId}/${day}`, status ? { status, arrived_at: arrived || null } : {})
      await load()
      setPicking(null)
    } catch (e) { toast(e.message, 'err') } finally { setBusy('') }
  }

  if (!data) return <div className="app-loading"><span className="spinner" /></div>

  const lateThisMonth = (data.rows || []).filter((r) => r.status === 'late').length
  const awayThisMonth = (data.rows || []).filter((r) => r.status === 'away').length

  return (
    <>
      <div className="section-head at-head">
        <h2>{tx('Attendance')}</h2>
        <span className="at-sum">
          <b className={lateThisMonth ? 'pay-bad' : ''}>{lateThisMonth}</b> {tx('late')}
          <span className="at-dot">·</span>
          <b>{awayThisMonth}</b> {tx('away')}
        </span>
        <span className="spacer" />
        <div className="at-month">
          <button className="icon-btn" onClick={() => setMonth((m) => shiftMonth(m, -1))}
            aria-label={tx('Previous month')} data-tip={tx('Previous month')}><ChevronLeft size={18} /></button>
          <b>{monthWords(month)}</b>
          <button className="icon-btn" disabled={month >= monthOf(today)}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            aria-label={tx('Next month')} data-tip={tx('Next month')}><ChevronRight size={18} /></button>
        </div>
      </div>

      {isAdmin && (
        <div className="card card-pad ai-note">
          <b>{tx('Nobody is late unless somebody says so.')}</b>
          <span className="stat-sub">
            {tx('An empty square means nothing was written down, not that somebody was on time. Click a square to say what happened.')}
          </span>
        </div>
      )}

      <div className="card at-wrap">
        <div className="at-grid-scroll">
          <table className="at-grid">
            <thead>
              <tr>
                <th className="at-name-col">{tx('Member')}</th>
                {days.map((d) => (
                  <th key={d.iso}
                    className={'at-day-h' + (d.weekend ? ' at-wknd' : '') + (d.iso === today ? ' at-today' : '')}
                    title={d.iso}>{d.n}</th>
                ))}
                <th className="at-tot-col at-tot-late">{tx('Late')}</th>
                <th className="at-tot-col">{tx('Away')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const t = data.tally[u.id] || { late: 0, away: 0, on_time: 0 }
                return (
                  <tr key={u.id}>
                    <th className="at-name-col at-who">
                      <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
                      <span className="at-who-meta">
                        <b>{u.name}</b>
                        <span className="stat-sub">@{u.username}</span>
                      </span>
                    </th>
                    {days.map((d) => {
                      const row = cells[`${u.id}|${d.iso}`]
                      const st = row?.status ? byKey[row.status] : null
                      const future = d.iso > today
                      const open = picking && picking.userId === u.id && picking.day === d.iso
                      const title = st
                        ? `${u.name} · ${d.iso} — ${tx(st.label)}${row.arrived_at ? ` ${row.arrived_at}` : ''}`
                        : `${u.name} · ${d.iso} — ${tx('nothing written down')}`
                      return (
                        <td key={d.iso} className={'at-cell' + (d.weekend ? ' at-wknd' : '') + (d.iso === today ? ' at-today' : '')}>
                          <button type="button" title={title} aria-label={title}
                            className={'at-mark' + (st ? ` on ${st.cls}` : '') + (open ? ' open' : '')}
                            disabled={!isAdmin || future || busy === `${u.id}|${d.iso}`}
                            onClick={(e) => {
                              setLateAt(row?.arrived_at || '09:30')
                              const b = e.currentTarget.getBoundingClientRect()
                              setPicking(open ? null : {
                                userId: u.id, day: d.iso, name: u.name, marked: !!row,
                                box: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
                              })
                            }}>
                            {st ? <st.Icon size={13} strokeWidth={3} /> : null}
                          </button>
                        </td>
                      )
                    })}
                    <td className="at-tot at-tot-late">{t.late > 0
                      ? <span className="at-count at-late-count">{t.late}</span>
                      : <span className="stat-sub">0</span>}</td>
                    <td className="at-tot">{t.away > 0
                      ? <span className="at-count">{t.away}</span>
                      : <span className="stat-sub">0</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="at-legend">
          {STATES.map((s) => (
            <span key={s.key} className="at-leg"><i className={`at-mark on ${s.cls}`}><s.Icon size={11} strokeWidth={3} /></i> {tx(s.label)}</span>
          ))}
          <span className="at-leg"><i className="at-mark" /> {tx('nothing written down')}</span>
        </div>
      </div>

      {/* Tapping anywhere else puts the picker away. */}
      {picking && <div className="at-scrim" onClick={() => setPicking(null)} />}

      {/* Drawn over the page, not inside the square: see the note on `picking`.
          On a phone it comes up from the bottom, where a thumb already is. */}
      {picking && (
        <div className="at-pick" role="dialog" aria-label={tx('What happened')} style={pickStyle(picking.box)}>
          <div className="at-pick-day">{picking.name} · {picking.day}</div>
          {STATES.map((s) => (
            <button key={s.key} type="button" className={'at-pick-opt ' + s.cls}
              onClick={() => (s.key === 'late'
                ? mark(picking.userId, picking.day, 'late', lateAt)
                : mark(picking.userId, picking.day, s.key))}>
              <s.Icon size={13} /> {tx(s.label)}
            </button>
          ))}
          <label className="at-pick-time">
            {tx('Arrived')}
            <input className="input" type="time" value={lateAt}
              onChange={(e) => setLateAt(e.target.value)} />
          </label>
          {picking.marked && (
            <button type="button" className="at-pick-opt at-pick-clear"
              onClick={() => mark(picking.userId, picking.day, null)}>
              <X size={13} /> {tx('Clear')}
            </button>
          )}
        </div>
      )}
    </>
  )
}
