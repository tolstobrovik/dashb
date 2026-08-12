import { useEffect, useState } from 'react'
import { AlertTriangle, Video, Scissors, Eye, Link2, CalendarClock } from 'lucide-react'
import { api } from '../lib/api.js'
import Modal from './Modal.jsx'

// The handover gate, as a conversation instead of an error.
//
// The server refuses a move that cannot be proved and says exactly what is
// missing. Rather than duplicating those rules here — two copies of a rule
// always drift — this dialog simply asks for the one thing the server named,
// sends the move again, and keeps asking until the move lands. The server
// stays the only place that decides what a handover needs.

const ASK = {
  operator_id: {
    icon: Video, title: 'Who is shooting this?',
    hint: 'The shooter owns the shooting deadline from here on.',
    kind: 'person',
  },
  editor_id: {
    icon: Scissors, title: 'Who is editing this?',
    hint: 'Handing it over makes the editor responsible for the editing deadline.',
    kind: 'person',
  },
  reviewer_id: {
    icon: Eye, title: 'Who is reviewing this?',
    hint: 'The reviewer answers for the review & publish deadline.',
    kind: 'person',
  },
  shot_link: {
    icon: Link2, title: 'Where is the footage?',
    hint: 'Upload it to Drive and paste the link. The stage cannot be passed on without it.',
    kind: 'link',
  },
  ready_link: {
    icon: Link2, title: 'Where is the cut?',
    hint: 'Paste the link to the finished edit. The stage cannot be passed on without it.',
    kind: 'link',
  },
  edit_due_revised: {
    icon: CalendarClock, title: 'Set a new editing deadline',
    kind: 'date',
  },
  review_due_revised: {
    icon: CalendarClock, title: 'Set a new review deadline',
    kind: 'date',
  },
}

export default function StageGate({ item, statusId, statusLabel, team = [], onDone, onCancel }) {
  const [draft, setDraft] = useState({})
  const [need, setNeed] = useState(null)     // the field the server is waiting for
  const [message, setMessage] = useState('')
  const [wasDue, setWasDue] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fatal, setFatal] = useState('')

  // Ask the server what it wants: the first refusal names the first gap.
  const attempt = async (extra) => {
    setBusy(true)
    try {
      const body = { status_id: statusId, ...draft, ...extra }
      const saved = await api.patch(`/content/${item.id}`, body)
      onDone(saved)
      return true
    } catch (e) {
      const miss = e.data?.missing
      if (miss && ASK[miss]) {
        setNeed(miss)
        setMessage(e.message)
        setWasDue(e.data?.was_due || null)
      } else {
        setFatal(e.message)
      }
      return false
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { attempt({}) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const supply = async (value) => {
    const extra = { [need]: value }
    setDraft((d) => ({ ...d, ...extra }))
    setNeed(null)
    await attempt(extra)
  }

  if (fatal) {
    return (
      <Modal title="This move can’t be made" onClose={onCancel}>
        <p className="gate-fatal"><AlertTriangle size={16} /> {fatal}</p>
      </Modal>
    )
  }
  if (!need) {
    return (
      <Modal title={`Moving to «${statusLabel}»`} onClose={busy ? () => {} : onCancel}>
        <p className="muted">{busy ? 'Checking the handover…' : 'One moment…'}</p>
      </Modal>
    )
  }

  const ask = ASK[need]
  const Icon = ask.icon
  return (
    <Modal title={`Moving to «${statusLabel}»`} onClose={onCancel}>
      <div className="gate">
        <div className="gate-head">
          <Icon size={18} />
          <div>
            <div className="gate-title">{ask.title}</div>
            <div className="gate-hint">{ask.hint || message}</div>
          </div>
        </div>

        {wasDue && (
          <p className="gate-late">
            <AlertTriangle size={14} /> This is being handed over late — it was due <b>{wasDue}</b>.
            The next person needs a date they can actually meet, and both dates stay on the task.
          </p>
        )}

        {ask.kind === 'person' && (
          <div className="gate-people">
            {team.map((u) => (
              <button key={u.id} type="button" className="gate-person" disabled={busy}
                onClick={() => supply(u.id)}>
                <span className="gate-dot" style={{ background: u.color || '#a32234' }} />
                {u.name}
                {u.position && <span className="muted"> · {u.position}</span>}
              </button>
            ))}
            {team.length === 0 && <p className="muted">No team members to pick from.</p>}
          </div>
        )}

        {ask.kind === 'link' && <LinkAsk busy={busy} onSubmit={supply} />}
        {ask.kind === 'date' && <DateAsk busy={busy} onSubmit={supply} />}
      </div>
    </Modal>
  )
}

function LinkAsk({ busy, onSubmit }) {
  const [v, setV] = useState('')
  const valid = /^https?:\/\/\S+$/i.test(v.trim())
  return (
    <form className="gate-form" onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(v.trim()) }}>
      <input className="input" autoFocus placeholder="https://drive.google.com/…"
        value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn" disabled={!valid || busy}>{busy ? 'Moving…' : 'Attach and move'}</button>
    </form>
  )
}

function DateAsk({ busy, onSubmit }) {
  const [v, setV] = useState('')
  return (
    <form className="gate-form" onSubmit={(e) => { e.preventDefault(); if (v) onSubmit(v) }}>
      <input className="input" type="date" autoFocus value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn" disabled={!v || busy}>{busy ? 'Moving…' : 'Promise this date'}</button>
    </form>
  )
}
