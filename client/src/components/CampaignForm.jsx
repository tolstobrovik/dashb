import { useState } from 'react'
import { AlertCircle, Trash2 } from 'lucide-react'
import Modal from './Modal.jsx'
import { api } from '../lib/api.js'
import { useChannels } from '../lib/channels.jsx'
import { PC, PhotoField, PcChecklist } from './ProjectBits.jsx'

// The campaign form — and the gate. Eight required fields, two save buttons:
// "Save as Idea" accepts gaps (they render red), "Create" refuses until the
// form is complete and shows a red strip naming what is missing.
export default function CampaignForm({ campaign, projects, team, metrics, defaults = {}, onClose, onSaved, onDeleted, isAdmin }) {
  const { channels } = useChannels()
  const creating = !campaign
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(() => ({
    name: campaign?.name || '',
    project_id: campaign?.project_id ?? defaults.project_id ?? '',
    owner_id: campaign?.owner_id ?? '',
    start_date: campaign?.start_date || '',
    end_date: campaign?.end_date || '',
    channels: campaign?.channels ? [...campaign.channels] : [],
    metric: campaign?.metric || '',
    target: campaign?.target || '',
    budget: campaign?.budget ?? '',
    goal: campaign?.goal || '',
    description: campaign?.description || '',
    checklist: campaign?.checklist ? [...campaign.checklist] : [],
  }))
  // Photos ride separately: only sent when the user picked or removed one.
  const [photo, setPhoto] = useState({ changed: false, photo: campaign?.photo ?? campaign?.photo_thumb ?? null, photo_thumb: campaign?.photo_thumb ?? null })

  const missing = []
  if (!form.name.trim()) missing.push('name')
  if (!form.project_id) missing.push('project')
  if (!form.owner_id) missing.push('owner')
  if (!form.start_date) missing.push('start date')
  if (!form.end_date) missing.push('end date')
  if (form.channels.length === 0) missing.push('channels')
  if (!form.metric) missing.push('primary metric')
  if (!(Number(form.target) > 0)) missing.push('target')

  const gap = (field) => (missing.includes(field) ? { boxShadow: `inset 0 0 0 2px ${PC.red}` } : undefined)

  const toggleChannel = (key) =>
    setForm((f) => ({ ...f, channels: f.channels.includes(key) ? f.channels.filter((c) => c !== key) : [...f.channels, key] }))

  const save = async (stage) => {
    if (busy) return
    if (!form.name.trim()) { setErr('Give the campaign a name'); return }
    if (stage === 'accepted' && missing.length > 0) {
      setErr(`Not ready to create — missing: ${missing.join(', ')}`)
      return
    }
    setBusy(true)
    setErr('')
    const payload = {
      ...form,
      name: form.name.trim(),
      project_id: form.project_id || null,
      owner_id: form.owner_id || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      target: Number(form.target) || 0,
      budget: form.budget === '' ? null : Number(form.budget),
      ...(photo.changed ? { photo: photo.photo, photo_thumb: photo.photo_thumb } : {}),
      ...(stage ? { stage } : {}),
    }
    try {
      const saved = creating
        ? await api.post('/campaigns', payload)
        : await api.patch(`/campaigns/${campaign.id}`, payload)
      onSaved(saved)
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  const del = async () => {
    if (!confirm(`Delete the campaign “${campaign.name}”?`)) return
    try { await api.del(`/campaigns/${campaign.id}`); onDeleted?.(campaign); onClose() } catch (e) { setErr(e.message) }
  }

  return (
    <Modal
      wide
      title={creating ? 'New campaign' : 'Campaign'}
      onClose={onClose}
      footer={<>
        {!creating && isAdmin && <button className="btn btn-danger" onClick={del}><Trash2 size={15} /> Delete</button>}
        <span className="foot-gap" />
        <button className="btn" onClick={onClose}>Cancel</button>
        {(creating || campaign?.status === 'idea') && (
          <button className="btn" onClick={() => save('idea')} disabled={busy}
            data-tip="Keeps the gaps — lands in the Idea column">Save as Idea</button>
        )}
        <button className="btn btn-primary" onClick={() => save(creating || campaign?.status === 'idea' ? 'accepted' : undefined)} disabled={busy}
          data-tip={creating || campaign?.status === 'idea' ? 'Refuses until all eight required fields are filled' : 'Save changes'}>
          {busy ? 'Saving…' : creating || campaign?.status === 'idea' ? 'Create' : 'Save'}
        </button>
      </>}
    >
      {err && <div className="pc-strip" style={{ marginBottom: 10 }}><AlertCircle size={14} /> {err}</div>}

      <div className="field"><label>Name</label>
        <input className="input" autoFocus={creating} style={gap('name')} value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Admissions Hype — July" />
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>Project <span className="stat-sub">— exactly one</span></label>
          <select className="select" style={gap('project')} value={form.project_id}
            onChange={(e) => setForm({ ...form, project_id: e.target.value === '' ? '' : Number(e.target.value) })}>
            <option value="">— pick a project —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Owner <span className="stat-sub">— one person, not a group</span></label>
          <select className="select" style={gap('owner')} value={form.owner_id}
            onChange={(e) => setForm({ ...form, owner_id: e.target.value === '' ? '' : Number(e.target.value) })}>
            <option value="">— pick an owner —</option>
            {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>Start</label>
          <input className="input" type="date" style={gap('start date')} value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        </div>
        <div className="field"><label>End</label>
          <input className="input" type="date" style={gap('end date')} value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        </div>
      </div>
      <div className="field"><label>Channels</label>
        <div className="checkbox-row" style={gap('channels') ? { ...gap('channels'), borderRadius: 8, padding: 4 } : undefined}>
          {channels.map((c) => (
            <label key={c.key} className={'checkbox-chip chip-sm' + (form.channels.includes(c.key) ? ' on' : '')}>
              <input type="checkbox" checked={form.channels.includes(c.key)} onChange={() => toggleChannel(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-3" style={{ gap: 12 }}>
        <div className="field"><label>Primary metric <span className="stat-sub">— one</span></label>
          <select className="select" style={gap('primary metric')} value={form.metric}
            onChange={(e) => setForm({ ...form, metric: e.target.value })}>
            <option value="">— pick one —</option>
            {metrics.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="field"><label>Target</label>
          <input className="input" type="number" min="0" style={gap('target')} value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="e.g. 1000" />
        </div>
        <div className="field"><label>Budget <span className="stat-sub">(optional)</span></label>
          <input className="input" type="number" min="0" value={form.budget}
            onChange={(e) => setForm({ ...form, budget: e.target.value })} />
        </div>
      </div>
      <div className="field"><label>Goal <span className="stat-sub">(optional, one line)</span></label>
        <input className="input" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="What winning looks like" />
      </div>
      <div className="field"><label>Description <span className="stat-sub">(optional)</span></label>
        <textarea className="input" rows={3} value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What this push is, references, context…" />
      </div>
      {/* Launch checklist — the admin's to-do for this campaign. Items are
          click-to-edit; an overdue unticked step will set the campaign to
          Blocked once it's live. */}
      {isAdmin && (
        <div className="field" style={{ marginTop: 4 }}>
          <PcChecklist
            items={form.checklist}
            team={team}
            canTick canEditItems
            onChange={(items) => setForm({ ...form, checklist: items })}
          />
        </div>
      )}
      <PhotoField
        photo={photo.photo}
        onChange={({ photo: ph, photo_thumb: th }) => setPhoto({ changed: true, photo: ph, photo_thumb: th })}
      />
    </Modal>
  )
}
