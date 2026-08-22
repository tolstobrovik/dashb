import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, Clock, ArrowRightCircle, MessageSquare, AtSign, CalendarClock, RotateCcw, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { tr as tx } from '../lib/i18n.jsx'

// A bell where everything wears the same arrow makes you read every line to
// find the one that needs you. Being NAMED in a thread and being asked to
// move a deadline are the two that do — so they look like themselves.
const KIND = {
  status:  { icon: ArrowRightCircle },
  comment: { icon: MessageSquare },
  mention: { icon: AtSign },
  date_request: { icon: CalendarClock },
  pravki:  { icon: RotateCcw },
  assigned: { icon: UserRound },
}

// The bell: status changes on your tasks (written by whoever moved them)
// and deadline reminders standing a day / a week out. Reminders are derived
// server-side and never stored, so "read" for them lives in localStorage;
// events are marked read on the server. A row opens its task via the
// pasteable /todo?task= link machinery.
const SEEN_KEY = (uid) => `satashkent_rem_seen_${uid}`
const readSeen = (uid) => {
  try { const a = JSON.parse(localStorage.getItem(SEEN_KEY(uid)) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}

export default function NotificationsBell({ user }) {
  const [data, setData] = useState({ events: [], reminders: [] })
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(() => readSeen(user.id))
  const wrapRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/notifications').then(setData).catch(() => {})
    // The bell keeps the pace of the content pages (ETag-cheap 304s), so news
    // lands within seconds, not half a minute.
    const id = setInterval(() => {
      if (document.hidden) return
      api.pollView('/notifications').then((d) => { if (d) setData(d) }).catch(() => {})
    }, 12000)
    return () => clearInterval(id)
  }, [])
  // A tap anywhere else closes the panel.
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const unread = data.events.filter((e) => !e.read_at).length +
    data.reminders.filter((r) => !seen.includes(r.id)).length

  const markAll = async () => {
    const ids = data.reminders.map((r) => r.id).slice(0, 200)
    localStorage.setItem(SEEN_KEY(user.id), JSON.stringify(ids))
    setSeen(ids)
    try {
      await api.post('/notifications/read-all')
      setData(await api.get('/notifications'))
    } catch { /* the badge just stays */ }
  }
  const go = (n) => {
    setOpen(false)
    if (n.content_id) navigate(`/todo?task=${n.content_id}`)
  }

  return (
    <span className="notif-wrap" ref={wrapRef}>
      <button className="icon-btn"
        onClick={() => setOpen((o) => {
          // opening the panel asks for the freshest news right away
          if (!o) api.pollView('/notifications').then((d) => { if (d) setData(d) }).catch(() => {})
          return !o
        })}
        data-tip={tx("Notifications")} aria-label={`Notifications${unread ? ` — ${unread} unread` : ''}`}>
        <Bell size={17} />
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel card">
          <div className="notif-head">
            <b>{tx("Notifications")}</b>
            {(data.events.length > 0 || data.reminders.length > 0) && (
              <button className="lnk" onClick={markAll}><CheckCheck size={13} />{' '}{tx("Mark all read")}</button>
            )}
          </div>
          {data.reminders.length === 0 && data.events.length === 0 && (
            <div className="notif-empty">{tx("All quiet — nothing due, nothing moved.")}</div>
          )}
          {data.reminders.map((r) => (
            <button key={r.id} className={'notif-row' + (seen.includes(r.id) ? ' seen' : '')} onClick={() => go(r)}>
              <Clock size={14} className="notif-ico notif-rem" />
              <span>{r.text}</span>
            </button>
          ))}
          {data.events.map((e) => {
            const K = KIND[e.kind] || KIND.status
            return (
              <button key={e.id} className={'notif-row nr-' + (KIND[e.kind] ? e.kind : 'status') + (e.read_at ? ' seen' : '')} onClick={() => go(e)}>
                <K.icon size={14} className="notif-ico" />
                <span>{e.text}</span>
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}
