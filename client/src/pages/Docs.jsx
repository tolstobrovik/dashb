import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FileText, FileImage, File, FileSpreadsheet, Upload, Download, Eye, Pencil, Trash2,
  ScrollText, Search, X, ExternalLink,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { dateLabel } from '../lib/constants.js'
import Avatar from '../components/Avatar.jsx'
import Modal from '../components/Modal.jsx'
import { useContextMenu } from '../components/ContextMenu.jsx'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// Documents — the paperwork shelf between the company and each person.
//
// It used to carry a second thing: a KPI table of targets and current values,
// typed in by hand and read by nobody, sitting under the documents like a
// second page pretending to be part of the first. It is gone. What is left is
// what people actually came here for — the files — with the two things a
// shelf needs and did not have: a way to narrow it down, and a way to LOOK at
// a document without downloading it first.
//
// The kinds survive as filters rather than as an organising principle. A shelf
// sorted into three drawers when most people own two documents is filing for
// its own sake; a shelf you can filter is the same information without the
// ceremony.

const KINDS = [
  { key: 'sop', label: 'SOP' },
  { key: 'responsibility', label: tx('Responsibility') },
  { key: 'other', label: tx('Other') },
]
const kindLabel = (k) => (KINDS.find((x) => x.key === k) || KINDS[2]).label

const MAX_FILE_BYTES = 4 * 1024 * 1024

const sizeLabel = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const isImage = (m) => /^image\//.test(m || '')
const isPdf = (m) => m === 'application/pdf'
const isText = (m) => /^text\//.test(m || '')
const isSheet = (m) => /excel|spreadsheet/i.test(m || '')
const isWord = (m) => /wordprocessingml|msword/i.test(m || '')
const docIcon = (mime) => (isImage(mime) ? FileImage : isPdf(mime) ? FileText : isSheet(mime) ? FileSpreadsheet : File)
// What a browser can actually draw. PDFs, pictures and plain text it draws
// itself; a .docx is a zip of XML, so it gets converted to HTML in the page —
// the library is loaded only when somebody actually opens a Word file, so the
// shelf costs nothing to visit. Excel and PowerPoint still say so plainly,
// which beats a blank grey box that looks like the app is broken.
const canPreview = (m) => isPdf(m) || isImage(m) || isText(m) || isWord(m)

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
  const [err, setErr] = useState('')

  // ---- the filters ----
  const [kindFilter, setKindFilter] = useState('all')
  const [q, setQ] = useState('')

  const [upKind, setUpKind] = useState('sop')
  const [busyUp, setBusyUp] = useState(false)
  const fileRef = useRef(null)
  const [renaming, setRenaming] = useState(null) // null | doc row
  const [preview, setPreview] = useState(null)   // null | { doc, url, mime }

  useEffect(() => {
    api.cached('/users').then(setTeam).catch(() => {})
  }, [])

  const allMode = isAdmin && who === 0
  const load = () => {
    setErr('')
    api.get(allMode ? '/docs?all=1' : `/docs?user_id=${who}`)
      .then(setDocs).catch((e) => setErr(e.message))
  }
  useEffect(() => { load() }, [who]) // eslint-disable-line react-hooks/exhaustive-deps
  // The preview holds a blob URL; it is revoked when the sheet closes, so a
  // long session does not keep every document it looked at in memory.
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url) }, [preview])

  const byId = useMemo(() => Object.fromEntries(team.map((u) => [u.id, u])), [team])
  const nameOf = (id) => byId[id]?.name || (id === user.id ? user.name : '—')
  const person = byId[who] || (who === user.id ? user : null)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (docs || []).filter((d) => {
      if (kindFilter !== 'all' && d.kind !== kindFilter) return false
      if (!needle) return true
      return `${d.title} ${d.file_name} ${nameOf(d.user_id)}`.toLowerCase().includes(needle)
    })
  }, [docs, kindFilter, q, byId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- documents -----------------------------------------------------------
  const pickFile = () => fileRef.current?.click()
  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_FILE_BYTES) { setErr(tx('That file is too big — keep documents under 4 MB')); return }
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

  // Clicking a document SHOWS it. Downloading is still one press away, but it
  // is no longer the only way to find out what is inside.
  const showDoc = async (d) => {
    try {
      const full = await api.get(`/docs/${d.id}`)
      const url = blobUrlOf(full.data)
      const mime = full.mime || d.mime
      setPreview({ doc: d, url, mime, html: null, busy: isWord(mime) })
      // .docx: unzip and turn it into HTML right here. mammoth is pulled in on
      // demand so a shelf of PDFs never pays for it.
      if (isWord(mime)) {
        try {
          const [{ default: mammoth }, buf] = await Promise.all([
            import('mammoth/mammoth.browser.min.js'),
            fetch(url).then((r) => r.arrayBuffer()),
          ])
          const out = await mammoth.convertToHtml({ arrayBuffer: buf })
          setPreview((was) => (was && was.doc.id === d.id ? { ...was, html: out.value || '', busy: false } : was))
        } catch {
          setPreview((was) => (was && was.doc.id === d.id ? { ...was, html: null, busy: false, failed: true } : was))
        }
      }
    } catch (ex) { setErr(ex.message) }
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
    if (!confirm(`${tx('Delete')} “${d.title}”?`)) return
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
    { label: tx('Preview'), icon: Eye, onClick: () => showDoc(d) },
    { label: tx('Open in a new tab'), icon: ExternalLink, onClick: () => openDoc(d) },
    { label: tx('Download'), icon: Download, onClick: () => openDoc(d, true) },
    mayTouchDoc(d) && { label: tx('Rename'), icon: Pencil, onClick: () => setRenaming({ id: d.id, title: d.title, kind: d.kind }) },
    mayTouchDoc(d) && { label: tx('Delete'), icon: Trash2, danger: true, onClick: () => removeDoc(d) },
  ])

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
              <span className="brief-note">{tx("Your documents — always here.")}</span>
            </div>
          </div>
        )}
      </div>
      {err && <div className="form-error">{err}</div>}

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
                <Upload size={15} /> {busyUp ? tx('Uploading…') : tx('Upload')}
              </button>
              <input ref={fileRef} type="file" hidden onChange={onFile}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/*" />
            </div>
          )}
        </div>

        {/* the filters: what kind, and a search across titles, file names and
            (in all-people mode) whose shelf it sits on */}
        <div className="docs-filters">
          <div className="pill-group">
            <button className={'pill' + (kindFilter === 'all' ? ' active' : '')} onClick={() => setKindFilter('all')}>
              {tx('All')} · {(docs || []).length}
            </button>
            {KINDS.map((k) => {
              const n = (docs || []).filter((d) => d.kind === k.key).length
              return (
                <button key={k.key} className={'pill' + (kindFilter === k.key ? ' active' : '')}
                  onClick={() => setKindFilter(kindFilter === k.key ? 'all' : k.key)}>{k.label} · {n}</button>
              )
            })}
          </div>
          <span className="spacer" />
          <label className="docs-search">
            <Search size={14} />
            <input className="input" value={q} placeholder={tx('Search documents…')}
              onChange={(e) => setQ(e.target.value)} />
            {q && <button type="button" className="icon-btn" onClick={() => setQ('')} aria-label={tx('Clear')}><X size={14} /></button>}
          </label>
        </div>

        {docs === null ? (
          <div className="empty">{tx("Loading…")}</div>
        ) : shown.length === 0 ? (
          <div className="empty">
            {(docs.length === 0)
              ? tx("Nothing here yet — upload the first document.")
              : tx('Nothing matches that filter.')}
          </div>
        ) : (
          <div className="doc-grid">
            {shown.map((d) => {
              const Icon = docIcon(d.mime)
              return (
                <button key={d.id} className="doc-card" onClick={() => showDoc(d)} onContextMenu={(e) => docMenu(e, d)}>
                  <span className="doc-ic"><Icon size={22} /></span>
                  <span className="doc-main">
                    <span className="doc-title">{d.title}</span>
                    {allMode && <span className="doc-sub doc-who">{nameOf(d.user_id)}</span>}
                    <span className="doc-sub">{d.file_name} · {sizeLabel(d.size)}</span>
                    <span className="doc-sub doc-upd">
                      {dateLabel(d.created_at.slice(0, 10))} · {nameOf(d.uploaded_by)}
                      {d.updated_at.slice(0, 10) !== d.created_at.slice(0, 10) && ` · ${tx('edited')} ${dateLabel(d.updated_at.slice(0, 10))}`}
                    </span>
                  </span>
                  <span className={`chip doc-kind dk-${d.kind}`}>{kindLabel(d.kind)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* the preview itself */}
      {preview && (
        <Modal title={preview.doc.title} onClose={() => setPreview(null)} wide tall
          footer={<>
            <span className="stat-sub">{preview.doc.file_name} · {sizeLabel(preview.doc.size)}</span>
            <span className="spacer" />
            <button className="btn" onClick={() => openDoc(preview.doc)}><ExternalLink size={14} /> {tx('Open in a new tab')}</button>
            <button className="btn btn-primary" onClick={() => openDoc(preview.doc, true)}><Download size={14} /> {tx('Download')}</button>
          </>}>
          <div className="doc-preview">
            {isPdf(preview.mime) && <iframe title={preview.doc.title} src={preview.url} className="doc-frame" />}
            {isImage(preview.mime) && <img src={preview.url} alt={preview.doc.title} className="doc-img" />}
            {isText(preview.mime) && <iframe title={preview.doc.title} src={preview.url} className="doc-frame doc-frame-text" />}
            {isWord(preview.mime) && (
              preview.busy
                ? <div className="doc-noprev"><span className="spinner" /><span className="stat-sub">{tx('Opening the document…')}</span></div>
                : preview.html !== null
                  ? <div className="doc-word" dangerouslySetInnerHTML={{ __html: preview.html }} />
                  : (
                    <div className="doc-noprev">
                      <File size={34} />
                      <b>{tx('This document could not be drawn')}</b>
                      <span className="stat-sub">{tx('It may be an older .doc rather than a .docx. The file itself is one press away.')}</span>
                    </div>
                  )
            )}
            {!canPreview(preview.mime) && (
              <div className="doc-noprev">
                <File size={34} />
                <b>{tx('A browser cannot draw this kind of file')}</b>
                <span className="stat-sub">
                  {tx('Excel and PowerPoint open in their own app. Everything about it is above — the file itself is one press away.')}
                </span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {renaming && (
        <Modal title={tx('Rename')} onClose={() => setRenaming(null)}
          footer={<>
            <button className="btn" onClick={() => setRenaming(null)}>{tx('Cancel')}</button>
            <button className="btn btn-primary" onClick={saveRename}>{tx('Save')}</button>
          </>}>
          <label className="field">
            <span className="label">{tx('Title')}</span>
            <input className="input" value={renaming.title} autoFocus
              onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">{tx('Kind')}</span>
            <div className="seg">
              {KINDS.map((k) => (
                <button key={k.key} type="button" className={'seg-btn' + (renaming.kind === k.key ? ' on' : '')}
                  onClick={() => setRenaming({ ...renaming, kind: k.key })}>{k.label}</button>
              ))}
            </div>
          </label>
        </Modal>
      )}
    </div>
  )
}
