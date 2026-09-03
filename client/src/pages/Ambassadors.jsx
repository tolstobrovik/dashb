import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Send, Check, X, Clock, GraduationCap, FileText, Pencil, AlertCircle,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { useAuth } from '../lib/auth.jsx'
import Modal from '../components/Modal.jsx'
import Fold from '../components/Fold.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// The ambassador programme.
//
// Two audiences, one page, and deliberately no third thing. An ambassador is
// a student who films on their own account: they get a page that says what is
// happening to each of their ideas in a sentence, and one button to send a new
// one. An admin gets the same address and a different render — the queue of
// what is waiting on an answer, one card open at a time.
//
// The words here are fixed and are not a style choice. A student reads
// "rejected" as "you are bad at this" and "verified" as a machine talking; the
// board says "Needs changes" and "Done". Nothing in this file prints a state
// name — every card says what is happening in a sentence.

const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ')} so'm`

// How long something has been waiting on us, in the only unit anybody cares
// about when they are deciding what to open next.
function waitedFor(iso) {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return { text: tx('just now'), hours: 0 }
  const h = Math.floor(ms / 3600e3)
  if (h < 1) return { text: `${Math.max(1, Math.floor(ms / 60e3))}m`, hours: 0 }
  if (h < 48) return { text: `${h}h`, hours: h }
  return { text: `${Math.floor(h / 24)}d`, hours: h }
}

// ---- what a card says --------------------------------------------------------
// One place, so the sentence an ambassador reads and the sentence in a list can
// never drift apart.
function saysWhat(c) {
  if (c.state === 'can_film') return { tone: 'go', line: `${tx('You can film this')}. ${money(c.amount)}` }
  if (c.state === 'needs_changes') return { tone: 'stop', line: tx('Needs changes') }
  if (c.state === 'waiting') return { tone: 'idle', line: tx('Waiting for our answer') }
  if (c.state === 'posted') return { tone: 'idle', line: tx('Posted, we are checking') }
  return { tone: 'idle', line: `${tx('Done')}. ${money(c.amount)}` }
}
// Whose turn it is. Anything needing the ambassador comes first — the green
// one they can act on now, then the red one asking them for something — and
// everything that is waiting on US sits underneath.
const TURN = { can_film: 0, needs_changes: 1, waiting: 2, posted: 3, done: 4, paid: 5 }

export default function Ambassadors() {
  const { user } = useAuth()
  return user.role === 'ambassador' ? <MyPage /> : <AdminPage />
}

// ---- the ambassador's page ---------------------------------------------------
function MyPage() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(() => api.get('/ambassadors/me')
    .then((d) => { setData(d); setErr('') })
    .catch((e) => setErr(e.message)), [])
  useEffect(() => { load() }, [load])

  if (err) return <div className="card card-pad empty">{err}</div>
  if (!data) return <div className="app-loading"><span className="spinner" /></div>

  const cards = [...data.cards].sort((a, b) => (TURN[a.state] ?? 9) - (TURN[b.state] ?? 9))

  return (
    <div className="amb-me">
      {/* Two numbers. Not four, not a chart — what they posted and what they
          earned, this month. */}
      <div className="amb-numbers">
        <div className="amb-num">
          <b>{data.posted_this_month}</b>
          <span className="stat-sub">{tx('Posted this month')}</span>
        </div>
        <div className="amb-num">
          <b>{money(data.earned_this_month)}</b>
          <span className="stat-sub">{tx('Earned this month')}</span>
        </div>
      </div>

      <button className="btn btn-go amb-send" onClick={() => setSending(true)}>
        <Plus size={16} /> {tx('Send idea')}
      </button>

      <div className="amb-cards">
        {cards.map((c) => {
          const said = saysWhat(c)
          return (
            <div className={'card card-pad amb-card amb-' + said.tone} key={c.id}>
              <div className="amb-card-line">{said.line}</div>
              {c.state === 'needs_changes' && c.feedback && (
                <div className="amb-feedback">{c.feedback}</div>
              )}
              <div className="amb-card-idea stat-sub">{c.format} · {c.script}</div>
              {c.state === 'needs_changes' && (
                <button className="btn btn-sm" onClick={() => setEditing(c)}>
                  <Pencil size={13} /> {tx('Edit and send again')}
                </button>
              )}
            </div>
          )
        })}
        {cards.length === 0 && <div className="card card-pad empty">{tx('Nothing sent yet.')}</div>}
      </div>

      <Fold id="amb_details" title={tx('Your details')} icon={<GraduationCap size={15} />}>
        <div className="card card-pad amb-details">
          <div><span className="stat-sub">{tx('University')}</span><b>{data.person.university || '—'}</b></div>
          <div>
            <span className="stat-sub">{tx('Your contract')}</span>
            {data.person.has_contract
              ? <ContractLink id={data.person.id} name={data.person.contract_name} />
              : <b>—</b>}
          </div>
        </div>
      </Fold>

      {sending && <IdeaForm onClose={() => setSending(false)} onSent={() => { setSending(false); load() }} />}
      {editing && (
        <IdeaForm card={editing} onClose={() => setEditing(null)}
          onSent={() => { setEditing(null); load() }} />
      )}
    </div>
  )
}

// The contract opens in a new tab. It is stored beside the row rather than on
// a CDN, so it is fetched and handed to the browser as a blob.
function ContractLink({ id, name }) {
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    try {
      const f = await api.get(`/ambassadors/${id}/contract`)
      const win = window.open('', '_blank')
      const res = await fetch(f.data)
      const url = URL.createObjectURL(await res.blob())
      if (win) win.location = url; else window.open(url, '_blank')
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return (
    <button className="btn btn-sm" disabled={busy} onClick={open}>
      <FileText size={13} /> {name || tx('Open')}
    </button>
  )
}

// Four fields. The same form sends a new idea and sends a changed one back,
// because they are the same act — the card does not start again, it goes round.
function IdeaForm({ card = null, onClose, onSent }) {
  const [form, setForm] = useState({
    format: card?.format || '',
    script: card?.script || '',
    reference_url: card?.reference_url || '',
    planned_date: card?.planned_date || '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const send = async () => {
    setBusy(true); setErr('')
    try {
      if (card) await api.patch(`/ambassadors/me/cards/${card.id}`, form)
      else await api.post('/ambassadors/me/cards', form)
      onSent()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <Modal title={card ? tx('Edit and send again') : tx('Send idea')} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
      <button className="btn btn-primary" disabled={busy} onClick={send}>
        <Send size={14} /> {card ? tx('Send again') : tx('Send idea')}
      </button>
    </>}>
      {err && <div className="form-error">{err}</div>}
      {card?.feedback && <div className="amb-feedback">{card.feedback}</div>}
      <div className="field">
        <label>{tx('What kind of video')}</label>
        <input className="input" value={form.format} autoFocus
          placeholder={tx('Reel, vlog, interview…')}
          onChange={(e) => setForm({ ...form, format: e.target.value })} />
      </div>
      <div className="field">
        <label>{tx('What happens in it')}</label>
        <textarea className="input" rows={6} value={form.script}
          onChange={(e) => setForm({ ...form, script: e.target.value })} />
      </div>
      <div className="field">
        <label>{tx('Something like it')} <span className="stat-sub">{tx('optional')}</span></label>
        <input className="input" value={form.reference_url} placeholder="https://…"
          onChange={(e) => setForm({ ...form, reference_url: e.target.value })} />
      </div>
      <div className="field">
        <label>{tx('When you plan to film')} <span className="stat-sub">{tx('optional')}</span></label>
        <input className="input" type="date" value={form.planned_date || ''}
          onChange={(e) => setForm({ ...form, planned_date: e.target.value })} />
      </div>
    </Modal>
  )
}

// ---- the admin's render ------------------------------------------------------
function AdminPage() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [setup, setSetup] = useState(null)

  const load = useCallback(() => api.get('/ambassadors')
    .then((d) => { setData(d); setErr('') })
    .catch((e) => setErr(e.message)), [])
  useEffect(() => { load() }, [load])

  if (err) return <div className="card card-pad empty">{err}</div>
  if (!data) return <div className="app-loading"><span className="spinner" /></div>

  // Deciding one closes it and opens the next, so a queue is worked through
  // rather than clicked through.
  const decided = async (id) => {
    const at = data.inbox.findIndex((c) => c.id === id)
    const next = data.inbox[at + 1]
    await load()
    setOpenId(next ? next.id : null)
  }

  return (
    <div className="amb-admin">
      <Fold id="amb_inbox" title={tx('Waiting for our answer')} icon={<Clock size={15} />} count={data.inbox.length}>
        <div className="amb-inbox">
          {data.inbox.map((c) => (
            <InboxRow key={c.id} card={c} open={openId === c.id}
              onOpen={() => setOpenId(openId === c.id ? null : c.id)}
              onDecided={() => decided(c.id)} />
          ))}
          {data.inbox.length === 0 && (
            <div className="card card-pad empty">{tx('Nothing is waiting on us.')}</div>
          )}
        </div>
      </Fold>

      <Fold id="amb_people" title={tx('Ambassadors')} icon={<GraduationCap size={15} />}
        count={data.people.length}>
        {data.unset.length > 0 && (
          <div className="card card-pad amb-unset">
            <AlertCircle size={15} />
            <span>{tx('These accounts are not set up yet')}:</span>
            {data.unset.map((u) => (
              <button key={u.user_id} className="btn btn-sm"
                onClick={() => setSetup({ user_id: u.user_id, name: u.name })}>
                {u.name}
              </button>
            ))}
          </div>
        )}
        <div className="card table-wrap">
          <table className="tbl amb-tbl">
            <thead>
              <tr>
                <th>{tx('Name')}</th>
                <th>{tx('University')}</th>
                <th>{tx('Sent')}</th>
                <th>{tx('Approved')}</th>
                <th>{tx('Status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b></td>
                  <td>{p.university || <span className="amb-missing">{tx('not set')}</span>}</td>
                  <td>{p.sent}</td>
                  <td>{p.approved}</td>
                  <td>{p.status === 'active' ? tx('Active') : p.status === 'paused' ? tx('Paused') : tx('Ended')}</td>
                  <td className="right">
                    <button className="btn btn-sm" onClick={() => setSetup({ ...p, user_id: p.user_id })}>
                      <Pencil size={13} /> {tx('Details')}
                    </button>
                  </td>
                </tr>
              ))}
              {data.people.length === 0 && (
                <tr><td colSpan={6} className="empty">{tx('Nobody yet.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Fold>

      {setup && (
        <DetailsForm person={setup} onClose={() => setSetup(null)}
          onSaved={() => { setSetup(null); load() }} />
      )}
    </div>
  )
}

// One line while it is closed: who, what kind, and how long they have waited.
// Open, it is the whole decision.
function InboxRow({ card, open, onOpen, onDecided }) {
  const waited = waitedFor(card.waiting_since)
  return (
    <div className={'card amb-row' + (open ? ' open' : '')}>
      <button type="button" className="amb-row-head" onClick={onOpen}>
        <b>{card.name}</b>
        <span className="stat-sub">{tx('New idea')}</span>
        <span className="spacer" />
        <span className={'amb-wait' + (waited.hours >= 24 ? ' late' : '')}>{waited.text}</span>
      </button>
      {open && <Decide card={card} onDecided={onDecided} />}
    </div>
  )
}

// The four sentences from the contract, one press each. A refusal somebody has
// to compose from scratch is a refusal that arrives late or not at all.
const QUICK = [
  'Filmed without a confirmed script',
  'Story clip missing',
  'Mention was in the caption only, not spoken',
  'Logo missing in the video',
]

function Decide({ card, onDecided }) {
  const [terms, setTerms] = useState({
    we_edit: card.defaults.we_edit,
    posts_own: card.defaults.posts_own,
    collaborator: card.defaults.collaborator,
  })
  const [amount, setAmount] = useState('')   // never pre-filled — a human types it
  const [feedback, setFeedback] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const send = async (path, body) => {
    setBusy(true); setErr('')
    try { await api.post(`/ambassadors/cards/${card.id}/${path}`, body); onDecided() }
    catch (e) { setErr(e.message); setBusy(false); setAsking(false) }
  }

  const value = Number(String(amount).replace(/\s/g, ''))
  const canApprove = Number.isFinite(value) && value > 0

  return (
    <div className="amb-decide">
      {err && <div className="form-error">{err}</div>}
      <div className="amb-who stat-sub">{card.university || tx('not set')}</div>
      <div className="amb-script">{card.script}</div>
      {card.reference_url && (
        <a className="btn btn-sm" href={card.reference_url} target="_blank" rel="noreferrer">
          {tx('Something like it')}
        </a>
      )}

      <div className="amb-terms">
        {[['we_edit', 'We edit it'], ['posts_own', 'Posts on their own account'], ['collaborator', 'We are a collaborator']].map(([k, label]) => (
          <label key={k} className={'checkbox-chip' + (terms[k] ? ' on' : '')}>
            <input type="checkbox" checked={terms[k]}
              onChange={(e) => setTerms({ ...terms, [k]: e.target.checked })} />
            {tx(label)}
          </label>
        ))}
      </div>

      <div className="field amb-amount">
        <label>{tx('Amount for this video')}</label>
        <input className="input" inputMode="numeric" value={amount} placeholder="750000"
          onChange={(e) => setAmount(e.target.value.replace(/[^\d\s]/g, ''))} />
        {card.recent_amounts.length > 0 && (
          <span className="stat-sub">
            {tx('Last time')}: {card.recent_amounts.map((a) => money(a)).join(', ')}
          </span>
        )}
      </div>

      <div className="field">
        <label>{tx('What needs changing')}</label>
        <div className="amb-quick">
          {QUICK.map((q) => (
            <button key={q} type="button" className="btn btn-sm" onClick={() => setFeedback(tx(q))}>
              {tx(q)}
            </button>
          ))}
        </div>
        <textarea className="input" rows={2} value={feedback}
          onChange={(e) => setFeedback(e.target.value)} />
      </div>

      <div className="amb-actions">
        <button className="btn btn-go" disabled={busy || !canApprove} onClick={() => setAsking(true)}>
          <Check size={14} /> {tx('Approve')}
        </button>
        <button className="btn" disabled={busy || !feedback.trim()}
          onClick={() => send('changes', { feedback: feedback.trim() })}>
          <X size={14} /> {tx('Needs changes')}
        </button>
      </div>

      {/* One line, so nobody approves a number they mistyped. */}
      {asking && (
        <Modal title={tx('Approve')} onClose={() => setAsking(false)} footer={<>
          <button className="btn" onClick={() => setAsking(false)}>{tx('Cancel')}</button>
          <button className="btn btn-primary" disabled={busy}
            onClick={() => send('approve', { amount: value, ...terms })}>
            {tx('Yes')}
          </button>
        </>}>
          <p>{tx('Approve {name} at {amount}?', { name: card.name, amount: money(value) })}</p>
        </Modal>
      )}
    </div>
  )
}

// University, telegram, the usual terms and whether they are still active.
// The account itself is made in user management; this is the programme.
function DetailsForm({ person, onClose, onSaved }) {
  const [form, setForm] = useState({
    university: person.university || '',
    telegram: person.telegram || '',
    default_we_edit: !!person.default_we_edit,
    default_posts_own: person.default_posts_own === undefined ? true : !!person.default_posts_own,
    default_collaborator: !!person.default_collaborator,
    status: person.status || 'active',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setBusy(true); setErr('')
    try { await api.put(`/ambassadors/person/${person.user_id}`, form); onSaved() }
    catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <Modal title={person.name} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
      <button className="btn btn-primary" disabled={busy} onClick={save}>{tx('Save')}</button>
    </>}>
      {err && <div className="form-error">{err}</div>}
      <div className="field">
        <label>{tx('University')}</label>
        <input className="input" value={form.university} autoFocus
          onChange={(e) => setForm({ ...form, university: e.target.value })} />
      </div>
      <div className="field">
        <label>{tx('Telegram')}</label>
        <input className="input" value={form.telegram} placeholder="@…"
          onChange={(e) => setForm({ ...form, telegram: e.target.value })} />
      </div>
      <div className="field">
        <label>{tx('Their usual terms')}</label>
        <div className="amb-terms">
          {[['default_we_edit', 'We edit it'], ['default_posts_own', 'Posts on their own account'], ['default_collaborator', 'We are a collaborator']].map(([k, label]) => (
            <label key={k} className={'checkbox-chip' + (form[k] ? ' on' : '')}>
              <input type="checkbox" checked={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
              {tx(label)}
            </label>
          ))}
        </div>
        <span className="stat-sub">{tx('These only pre-tick the boxes when you approve. A card keeps whatever it was approved with.')}</span>
      </div>
      <div className="field">
        <label>{tx('Status')}</label>
        <select className="select" value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="active">{tx('Active')}</option>
          <option value="paused">{tx('Paused')}</option>
          <option value="ended">{tx('Ended')}</option>
        </select>
      </div>
    </Modal>
  )
}
