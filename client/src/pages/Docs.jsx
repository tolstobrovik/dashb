import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FileText, FileImage, File, Upload, Download, Eye, Pencil, Trash2, Plus,
  Target, StickyNote, BadgeCheck, ScrollText,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { dateLabel } from '../lib/constants.js'
import Avatar from '../components/Avatar.jsx'
import Modal from '../components/Modal.jsx'
import { useContextMenu } from '../components/ContextMenu.jsx'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// Docs & KPIs — the paperwork shelf between the company and each person.
// The admin picks anyone; a member lands straight on their own page. SOPs and
// responsibility sheets live here for good, and every KPI shows its target,
// where it stands, and who last updated it when.

const KINDS = [
  { key: 'sop', label: 'SOP' },
  { key: 'responsibility', label: 'Responsibility' },
  { key: 'other', label: 'Other' },
]
const kindLabel = (k) => (KINDS.find((x) => x.key === k) || KINDS[2]).label

const MAX_FILE_BYTES = 4 * 1024 * 1024

const sizeLabel = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const docIcon = (mime) => (/^image\//.test(mime) ? FileImage : mime === 'application/pdf' ? FileText : File)

// The stored data URL, turned into a real browser tab / download.
const blobUrlOf = (dataUrl) => {
  const comma = dataUrl.indexOf(',')
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'))
  const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (c) => c.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

export default function Docs() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const { openMenu } = useContextMenu()

  const [team, setTeam] = useState([])
  const [who, setWho] = useState(user.id)
  const [docs, setDocs] = useState(null)
  const [kpis, setKpis] = useState(null)
  const [err, setErr] = useState('')

  const [upKind, setUpKind] = useState('sop')
  const [busyUp, setBusyUp] = useState(false)
  const fileRef = useRef(null)

  const [kpiEdit, setKpiEdit] = useState(null)   // null | {} (new) | kpi row
  const [renaming, setRenaming] = useState(null) // null | doc row

  useEffect(() => {
    api.cached('/users').then(setTeam).catch(() => {})
  }, [])

  const allMode = isAdmin && who === 0
  const load = () => {
    setErr('')
    Promise.all([
      api.get(allMode ? '/docs?all=1' : `/docs?user_id=${who}`),
      api.get(allMode ? '/kpis?all=1' : `/kpis?user_id=${who}`),
    ]).then(([d, k]) => { setDocs(d); setKpis(k) }).catch((e) => setErr(e.message))
  }
  useEffect(load, [who]) // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => Object.fromEntries(team.map((u) => [u.id, u])), [team])
  const nameOf = (id) => byId[id]?.name || (id === user.id ? user.name : '—')
  const person = byId[who] || (who === user.id ? user : null)

  // ---- documents -----------------------------------------------------------
  const pickFile = () => fileRef.current?.click()
  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_FILE_BYTES) { setErr('That file is too big — keep documents under 4 MB'); return }
    setBusyUp(true)
    setErr('')
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result)
        r.onerror = () => reject(new Error('Could not read the file'))
        r.readAsDataURL(f)
      })
      const title = f.name.replace(/\.[^.]+$/, '')
      const doc = await api.post('/docs', { user_id: who, kind: upKind, title, file_name: f.name, data })
      setDocs((prev) => [doc, ...(prev || [])])
      toast(tx('Document uploaded — synced'))
    } catch (ex) { setErr(ex.message) } finally { setBusyUp(false) }
  }

  const openDoc = async (d, download = false) => {
    try {
      const full = await api.get(`/docs/${d.id}`)
      const url = blobUrlOf(full.data)
      if (download) {
        const a = document.createElement('a')
        a.href = url
        a.download = d.file_name
        a.click()
      } else {
        window.open(url, '_blank')
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (ex) { setErr(ex.message) }
  }

  const removeDoc = async (d) => {
    if (!confirm(`Delete “${d.title}”?`)) return
    try {
      await api.del(`/docs/${d.id}`)
      setDocs((prev) => prev.filter((x) => x.id !== d.id))
      toast(tx('Document deleted'))
    } catch (ex) { setErr(ex.message) }
  }

  const saveRename = async () => {
    try {
      const upd = await api.patch(`/docs/${renaming.id}`, { title: renaming.title, kind: renaming.kind })
      setDocs((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      setRenaming(null)
      toast(tx('Document saved — synced'))
    } catch (ex) { setErr(ex.message) }
  }

  const mayTouchDoc = (d) => isAdmin || d.uploaded_by === user.id
  const docMenu = (e, d) => openMenu(e, [
    { label: 'Open', icon: Eye, onClick: () => openDoc(d) },
    { label: 'Download', icon: Download, onClick: () => openDoc(d, true) },
    mayTouchDoc(d) && { label: 'Rename / rekind', icon: Pencil, onClick: () => setRenaming({ id: d.id, title: d.title, kind: d.kind }) },
    mayTouchDoc(d) && { label: 'Delete', icon: Trash2, danger: true, onClick: () => removeDoc(d) },
  ])

  // ---- KPIs ----------------------------------------------------------------
  const saveKpi = async () => {
    const k = kpiEdit
    if (!k.name?.trim()) { setErr('Name the KPI'); return }
    try {
      if (k.id) {
        const upd = await api.patch(`/kpis/${k.id}`, k)
        setKpis((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      } else {
        const made = await api.post('/kpis', { ...k, user_id: who })
        setKpis((prev) => [...(prev || []), made])
      }
      setKpiEdit(null)
      toast(tx('KPI saved — synced'))
    } catch (ex) { setErr(ex.message) }
  }
  const removeKpi = async (k) => {
    if (!confirm(`Delete the “${k.name}” KPI?`)) return
    try {
      await api.del(`/kpis/${k.id}`)
      setKpis((prev) => prev.filter((x) => x.id !== k.id))
      toast(tx('KPI deleted'))
    } catch (ex) { setErr(ex.message) }
  }
  const kpiMenu = (e, k) => isAdmin && openMenu(e, [
    { label: 'Edit', icon: Pencil, onClick: () => setKpiEdit({ ...k }) },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => removeKpi(k) },
  ])

  const updLabel = (row) => `${dateLabel(row.updated_at.slice(0, 10))} · ${nameOf(row.updated_by)}`

  return (
    <div className="page docs-page">
      {/* whose shelf */}
      <div className="docs-head">
        {isAdmin ? (
          <label className="docs-who">
            <span className="crew-label">{tx("Person")}</span>
            <select className="select" value={who} onChange={(e) => setWho(Number(e.target.value))}>
              <option value={0}>{tx("All people — every document")}</option>
              {[...team].sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
                <option key={u.id} value={u.id}>{u.name}{u.role === 'admin' ? ' (admin)' : ''}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="docs-me">
            <Avatar name={user.name} color={user.color} src={user.avatar} size="sm" />
            <div>
              <b>{user.name}</b>
              <span className="brief-note">{tx("Your documents and KPIs — always here.")}</span>
            </div>
          </div>
        )}
      </div>
      {err && <div className="form-error">{err}</div>}

      {/* documents */}
      <div className="card docs-card">
        <div className="docs-sec-head">
          <h2><ScrollText size={17} />{' '}{tx("Documents")}</h2>
          {!allMode && (
            <div className="docs-up">
              <div className="seg">
                {KINDS.map((k) => (
                  <button key={k.key} type="button" className={'seg-btn' + (upKind === k.key ? ' on' : '')}
                    onClick={() => setUpKind(k.key)}>{k.label}</button>
                ))}
              </div>
              <button className="btn btn-primary" onClick={pickFile} disabled={busyUp}>
                <Upload size={15} /> {busyUp ? 'Uploading…' : 'Upload'}
              </button>
              <input ref={fileRef} type="file" hidden onChange={onFile}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/*" />
            </div>
          )}
        </div>
        <div className="brief-note docs-note">
          {allMode
            ? 'Every document of every person, newest first — pick a person above to upload to their shelf.'
            : `SOPs and responsibility sheets${person ? ` for ${person.name}` : ''} — stored for good, visible to ${isAdmin ? 'them and every admin' : 'you and the admins'}.`}
        </div>
        {docs === null ? (
          <div className="empty">{tx("Loading…")}</div>
        ) : docs.length === 0 ? (
          <div className="empty">{tx("Nothing here yet — upload the first document.")}</div>
        ) : (
          <div className="doc-grid">
            {docs.map((d) => {
              const Icon = docIcon(d.mime)
              return (
                <button key={d.id} className="doc-card" onClick={() => openDoc(d)} onContextMenu={(e) => docMenu(e, d)}>
                  <span className="doc-ic"><Icon size={22} /></span>
                  <span className="doc-main">
                    <span className="doc-title">{d.title}</span>
                    {allMode && <span className="doc-sub doc-who">{nameOf(d.user_id)}</span>}
                    <span className="doc-sub">{d.file_name} · {sizeLabel(d.size)}</span>
                    <span className="doc-sub doc-upd">
                      {dateLabel(d.created_at.slice(0, 10))} · {nameOf(d.uploaded_by)}
                      {d.updated_at.slice(0, 10) !== d.created_at.slice(0, 10) && ` · edited ${dateLabel(d.updated_at.slice(0, 10))}`}
                    </span>
                  </span>
                  <span className={`chip doc-kind dk-${d.kind}`}>{kindLabel(d.kind)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="card docs-card">
        <div className="docs-sec-head">
          <h2><Target size={17} />{' '}{tx("KPIs")}</h2>
          {isAdmin && !allMode && (
            <button className="btn btn-primary" onClick={() => setKpiEdit({ name: '', target: '', current: '', unit: '', notes: '' })}>
              <Plus size={15} /> Add KPI
            </button>
          )}
        </div>
        <div className="brief-note docs-note">
          {allMode
            ? 'Every KPI of every person — double-click a row to update it; pick a person above to add new ones.'
            : 'Every KPI in one place — the target, where it stands, and who updated it last.'}
        </div>
        {kpis === null ? (
          <div className="empty">{tx("Loading…")}</div>
        ) : kpis.length === 0 ? (
          <div className="empty">No KPIs set{isAdmin ? ' — add the first one.' : ' yet.'}</div>
        ) : (
          <div className={'kpi-table' + (allMode ? ' kpi-all' : '')}>
            <div className="kpi-row kpi-head">
              {allMode && <span>{tx("Person")}</span>}
              <span>KPI</span><span>{tx("Target")}</span><span>{tx("Current")}</span><span>{tx("Notes")}</span><span>{tx("Updated")}</span>
            </div>
            {kpis.map((k) => (
              <div key={k.id} className="kpi-row" onContextMenu={(e) => kpiMenu(e, k)}
                onDoubleClick={() => isAdmin && setKpiEdit({ ...k })}>
                {allMode && <span className="kpi-name">{nameOf(k.user_id)}</span>}
                <span className="kpi-name">{k.name}</span>
                <span className="kpi-num">{k.target || '—'}{k.target && k.unit ? ` ${k.unit}` : ''}</span>
                <span className="kpi-num kpi-cur">{k.current || '—'}{k.current && k.unit ? ` ${k.unit}` : ''}</span>
                <span className="kpi-notes">{k.notes || ''}</span>
                <span className="kpi-upd"><BadgeCheck size={12} /> {updLabel(k)}</span>
              </div>
            ))}
          </div>
        )}
        {isAdmin && kpis?.length > 0 && (
          <div className="brief-note docs-note">{tx("Double-click a row (or right-click) to update it.")}</div>
        )}
      </div>

      {/* rename / rekind a document */}
      {renaming && (
        <Modal title={tx("Document")} onClose={() => setRenaming(null)}
          footer={<>
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={() => setRenaming(null)}>{tx("Cancel")}</button>
            <button className="btn btn-primary" onClick={saveRename}>{tx("Save")}</button>
          </>}>
          <div className="field"><label>{tx("Title")}</label>
            <input className="input" autoFocus value={renaming.title}
              onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') saveRename() }} />
          </div>
          <div className="seg" style={{ marginTop: 10 }}>
            {KINDS.map((k) => (
              <button key={k.key} type="button" className={'seg-btn' + (renaming.kind === k.key ? ' on' : '')}
                onClick={() => setRenaming({ ...renaming, kind: k.key })}>{k.label}</button>
            ))}
          </div>
        </Modal>
      )}

      {/* add / edit a KPI */}
      {kpiEdit && (
        <Modal title={kpiEdit.id ? 'KPI' : 'New KPI'} onClose={() => setKpiEdit(null)}
          footer={<>
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={() => setKpiEdit(null)}>{tx("Cancel")}</button>
            <button className="btn btn-primary" onClick={saveKpi}>{kpiEdit.id ? 'Save' : 'Add KPI'}</button>
          </>}>
          <div className="field"><label>{tx("Name")}</label>
            <input className="input" autoFocus placeholder={tx("e.g. Reels published per week")} value={kpiEdit.name}
              onChange={(e) => setKpiEdit({ ...kpiEdit, name: e.target.value })} />
          </div>
          <div className="kpi-form-row">
            <div className="field"><label>{tx("Target")}</label>
              <input className="input" placeholder={tx("e.g. 4")} value={kpiEdit.target}
                onChange={(e) => setKpiEdit({ ...kpiEdit, target: e.target.value })} />
            </div>
            <div className="field"><label>{tx("Current")}</label>
              <input className="input" placeholder={tx("e.g. 3")} value={kpiEdit.current}
                onChange={(e) => setKpiEdit({ ...kpiEdit, current: e.target.value })} />
            </div>
            <div className="field"><label>{tx("Unit")}</label>
              <input className="input" placeholder={tx("reels / %…")} value={kpiEdit.unit}
                onChange={(e) => setKpiEdit({ ...kpiEdit, unit: e.target.value })} />
            </div>
          </div>
          <div className="field"><label><StickyNote size={12} style={{ verticalAlign: -2 }} />{' '}{tx("Notes")}</label>
            <textarea className="input" rows={3} placeholder={tx("How it’s measured, agreements, context…")} value={kpiEdit.notes}
              onChange={(e) => setKpiEdit({ ...kpiEdit, notes: e.target.value })} />
          </div>
        </Modal>
      )}
    </div>
  )
}
