import { useEffect, useRef, useState } from 'react'
import { File, Upload, Download, ExternalLink, Trash2, Pencil, ScrollText } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { dateLabel } from '../lib/constants.js'
import Modal from '../components/Modal.jsx'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// Documents is the KPI document.
//
// It was a shelf: three kinds of paper per person, filters, a search box, a
// person switcher for the admin, and a preview you opened one card at a
// time. The team asked for the one paper that matters — what everybody is
// measured against — and nothing standing between them and it. So the page
// IS the document: it opens on arrival, drawn in place, and the admin can put
// a new one up or take it down. The per-person shelves are still in the
// database and the API; they are simply not drawn here any more.

const MAX_FILE_BYTES = 4 * 1024 * 1024
const sizeLabel = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const isImage = (m) => /^image\//.test(m || '')
const isPdf = (m) => m === 'application/pdf'
const isText = (m) => /^text\//.test(m || '')
const isWord = (m) => /wordprocessingml|msword/i.test(m || '')
// What a browser can draw itself, plus .docx, which is converted to HTML in the
// page — the converter is loaded only when a Word file is actually opened.
const canPreview = (m) => isPdf(m) || isImage(m) || isText(m) || isWord(m)
const blobUrlOf = (dataUrl) => {
  const comma = dataUrl.indexOf(',')
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'))
  const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (c) => c.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

// ---- what the file actually looks like ----------------------------------
// A shelf of filenames tells you nothing: "SATASHKENT - Head of Main KPI
// (Jasmina) August_5" could be a spreadsheet, a scan or a one-line note, and
// the only way to find out was to open all of them. So each row draws the
// document itself.
//
// The list endpoint sends metadata only — the file rides as a data URL and
// some of these are megabytes — so a thumbnail fetches its own document, and
// only once it is actually on screen. Nine documents that nobody scrolls to
// cost nothing.
function DocThumb({ doc }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    const el = box.current
    if (!el || url || failed) return
    let dead = false
    let objectUrl = null
    const fetchIt = async () => {
      try {
        const full = await api.get(`/docs/${doc.id}`)
        if (dead || !full?.data) return
        objectUrl = blobUrlOf(full.data)
        setUrl(objectUrl)
      } catch { if (!dead) setFailed(true) }
    }
    // Only when it is looked at. IntersectionObserver is not in every engine
    // this board runs on, so a browser without it simply fetches straight away
    // rather than showing nothing for ever.
    if (typeof IntersectionObserver !== 'function') { fetchIt(); return () => { dead = true } }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fetchIt() }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => { dead = true; io.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [doc.id, url, failed])

  const mime = doc.mime || ''
  const ext = (doc.file_name || '').split('.').pop()?.slice(0, 4).toUpperCase() || '?'
  return (
    <span className="doc-thumb" ref={box} aria-hidden="true">
      {url && isImage(mime) && <img src={url} alt="" />}
      {url && isPdf(mime) && <iframe title={doc.title} src={`${url}#toolbar=0&navpanes=0&view=FitH`} scrolling="no" />}
      {/* Word, spreadsheets, anything a browser will not draw: the kind, said
          plainly, which is still more than a filename told you. */}
      {(!url || (!isImage(mime) && !isPdf(mime))) && (
        <span className="doc-thumb-kind"><File size={16} /><b>{ext}</b></span>
      )}
    </span>
  )
}

export default function Docs() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const [docs, setDocs] = useState(null)   // every KPI document, newest first
  const [shelf, setShelf] = useState(null) // the per-person documents this account may see
  const [view, setView] = useState(null)   // the one on screen: { doc, url, mime, html, busy, failed }
  const [err, setErr] = useState('')
  const [busyUp, setBusyUp] = useState(false)
  const [renaming, setRenaming] = useState(null)
  const fileRef = useRef(null)

  // Round 83 made this page THE KPI document — one paper, kind 'kpi'. What it
  // did not account for is that the papers already on the board were filed
  // under the older per-person kinds ('sop', 'responsibility'), which the page
  // stopped drawing. Nine documents — every one of them a KPI paper by its own
  // title — went invisible overnight and were reported as lost. They were
  // never lost; nothing here deletes anything. They were simply not asked for.
  //
  // So the page asks for both: the team's KPI paper above, and underneath it
  // every document this account is allowed to see. The permissions are the
  // ones the API already enforces — an admin gets the whole shelf, anybody
  // else gets their own folder — so this widens what is DRAWN, never who may
  // read what.
  const load = () => {
    api.get('/docs?kind=kpi').then(setDocs).catch((e) => setErr(e.message))
    api.get(isAdmin ? '/docs?all' : '/docs')
      .then((rows) => setShelf((rows || []).filter((d) => d.kind !== 'kpi')))
      .catch(() => setShelf([]))
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // The preview holds a blob URL; it is revoked when it is replaced or the
  // page is left, so a long session does not keep old versions in memory.
  useEffect(() => () => { if (view?.url) URL.revokeObjectURL(view.url) }, [view])

  const show = async (d) => {
    try {
      const full = await api.get(`/docs/${d.id}`)
      const url = blobUrlOf(full.data)
      const mime = full.mime || d.mime
      setView({ doc: d, url, mime, html: null, busy: isWord(mime) })
      if (isWord(mime)) {
        try {
          const [{ default: mammoth }, buf] = await Promise.all([
            import('mammoth/mammoth.browser.min.js'),
            fetch(url).then((r) => r.arrayBuffer()),
          ])
          const out = await mammoth.convertToHtml({ arrayBuffer: buf })
          setView((was) => (was && was.doc.id === d.id ? { ...was, html: out.value || '', busy: false } : was))
        } catch {
          setView((was) => (was && was.doc.id === d.id ? { ...was, html: null, busy: false, failed: true } : was))
        }
      }
    } catch (ex) { setErr(ex.message) }
  }
  // The newest document IS the page: it opens the moment the list lands.
  useEffect(() => {
    if (docs === null) return
    if (!docs.length) { setView(null); return }
    if (!view || view.doc.id !== docs[0].id) show(docs[0])
  }, [docs]) // eslint-disable-line react-hooks/exhaustive-deps

  const openDoc = async (d, download = false) => {
    try {
      const full = await api.get(`/docs/${d.id}`)
      const url = blobUrlOf(full.data)
      if (download) { const a = document.createElement('a'); a.href = url; a.download = d.file_name; a.click() }
      else window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (ex) { setErr(ex.message) }
  }
  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_FILE_BYTES) { setErr(tx('That file is too big — keep documents under 4 MB')); return }
    setBusyUp(true); setErr('')
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file')); r.readAsDataURL(f)
      })
      const title = f.name.replace(/\.[^.]+$/, '')
      await api.post('/docs', { user_id: user.id, kind: 'kpi', title, file_name: f.name, data })
      toast(docs?.length ? tx('KPI document replaced — everyone sees the new one') : tx('Document uploaded — synced'))
      load()
    } catch (ex) { setErr(ex.message) } finally { setBusyUp(false) }
  }
  const removeDoc = async (d) => {
    if (!confirm(`${tx('Delete')} “${d.title}”?`)) return
    try { await api.del(`/docs/${d.id}`); toast(tx('Document deleted')); load() } catch (ex) { setErr(ex.message) }
  }
  const saveRename = async () => {
    try {
      await api.patch(`/docs/${renaming.id}`, { title: renaming.title })
      setRenaming(null); toast(tx('Document saved — synced')); load()
    } catch (ex) { setErr(ex.message) }
  }

  const top = docs?.[0]
  const older = (docs || []).slice(1)

  return (
    <div className="page docs-page">
      {err && <div className="form-error">{err}</div>}
      <div className="card docs-card kpi-doc">
        <div className="docs-sec-head">
          <h2><ScrollText size={17} />{' '}{tx('KPI document')}</h2>
          {isAdmin && (
            <div className="docs-up">
              <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busyUp}>
                <Upload size={15} /> {busyUp ? tx('Uploading…') : top ? tx('Replace') : tx('Upload')}
              </button>
              <input ref={fileRef} type="file" hidden onChange={onFile} accept=".pdf,.doc,.docx,.txt,image/*" />
            </div>
          )}
        </div>

        {docs === null ? (
          <div className="empty faint">{tx('Loading…')}</div>
        ) : !top ? (
          <div className="empty faint">{isAdmin ? tx('No KPI document yet — upload it') : tx('No KPI document')}</div>
        ) : (
          <>
            <div className="kpi-doc-meta">
              <span className="stat-sub">
                <b>{top.title}</b> · {top.file_name} · {sizeLabel(top.size)} · {dateLabel(top.created_at.slice(0, 10))}
              </span>
              <span className="spacer" />
              <div className="kpi-doc-actions">
                <button className="btn" onClick={() => openDoc(top)}><ExternalLink size={14} /> {tx('Open in a new tab')}</button>
                <button className="btn" onClick={() => openDoc(top, true)}><Download size={14} /> {tx('Download')}</button>
                {isAdmin && <button className="btn" onClick={() => setRenaming({ id: top.id, title: top.title })}><Pencil size={14} /> {tx('Rename')}</button>}
                {isAdmin && <button className="btn" onClick={() => removeDoc(top)}><Trash2 size={14} /> {tx('Delete')}</button>}
              </div>
            </div>
            <div className="doc-preview kpi-doc-body">
              {!view ? (
                <div className="doc-noprev"><span className="spinner" /></div>
              ) : (
                <>
                  {isPdf(view.mime) && <iframe title={view.doc.title} src={view.url} className="doc-frame" />}
                  {isImage(view.mime) && <img src={view.url} alt={view.doc.title} className="doc-img" />}
                  {isText(view.mime) && <iframe title={view.doc.title} src={view.url} className="doc-frame doc-frame-text" />}
                  {isWord(view.mime) && (
                    view.busy
                      ? <div className="doc-noprev"><span className="spinner" /><span className="stat-sub">{tx('Opening the document…')}</span></div>
                      : view.html !== null
                        ? <div className="doc-word" dangerouslySetInnerHTML={{ __html: view.html }} />
                        : (
                          <div className="doc-noprev">
                            <File size={34} />
                            <b>{tx('This document could not be drawn')}</b>
                            <span className="stat-sub">{tx('It may be an older .doc rather than a .docx. The file itself is one press away.')}</span>
                          </div>
                        )
                  )}
                  {!canPreview(view.mime) && (
                    <div className="doc-noprev">
                      <File size={34} />
                      <b>{tx('A browser cannot draw this kind of file')}</b>
                      <span className="stat-sub">{tx('Excel and PowerPoint open in their own app. Everything about it is above — the file itself is one press away.')}</span>
                    </div>
                  )}
                </>
              )}
            </div>
            {older.length > 0 && (
              <details className="kpi-doc-older">
                <summary className="stat-sub">{tx('{n} older versions', { n: older.length })}</summary>
                <div className="kpi-doc-list">
                  {older.map((d) => (
                    <div key={d.id} className="kpi-doc-row">
                      <span>{d.title} <span className="stat-sub">· {dateLabel(d.created_at.slice(0, 10))}</span></span>
                      <span className="spacer" />
                      <button className="btn" onClick={() => openDoc(d, true)}><Download size={13} /></button>
                      {isAdmin && <button className="btn" onClick={() => removeDoc(d)}><Trash2 size={13} /></button>}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>

      {/* Everything else on the shelf. These are the per-person papers — and
          on this board, in practice, they ARE the KPI documents: they were
          filed under the older kinds before this page narrowed to one. A
          document nobody can reach is a document the team counts as lost, so
          they are drawn again, here, under the paper that supersedes them. */}
      {shelf !== null && shelf.length > 0 && (
        <div className="card docs-card docs-shelf">
          <div className="docs-sec-head">
            <h2><File size={17} />{' '}{tx('Documents on the shelf')}</h2>
            <span className="count">· {shelf.length}</span>
          </div>
          <div className="stat-sub" style={{ padding: '0 14px 10px' }}>
            {isAdmin
              ? tx('Every document on the board, whoever it belongs to.')
              : tx('Your own documents.')}
          </div>
          <div className="kpi-doc-list">
            {shelf.map((d) => (
              <div key={d.id} className="kpi-doc-row doc-row-thumbed">
                <DocThumb doc={d} />
                <span>
                  {d.title}
                  <span className="stat-sub"> · {d.file_name} · {sizeLabel(d.size)} · {dateLabel(String(d.created_at).slice(0, 10))}</span>
                </span>
                <span className="spacer" />
                <button className="btn" data-tip={tx('Open in a new tab')} onClick={() => openDoc(d)}><ExternalLink size={13} /></button>
                <button className="btn" data-tip={tx('Download')} onClick={() => openDoc(d, true)}><Download size={13} /></button>
                {isAdmin && <button className="btn" data-tip={tx('Rename')} onClick={() => setRenaming({ id: d.id, title: d.title })}><Pencil size={13} /></button>}
              </div>
            ))}
          </div>
        </div>
      )}


      {renaming && (
        <Modal title={tx('Rename')} onClose={() => setRenaming(null)}
          footer={<>
            <button className="btn" onClick={() => setRenaming(null)}>{tx('Cancel')}</button>
            <button className="btn btn-primary" onClick={saveRename}>{tx('Save')}</button>
          </>}>
          <label className="field">
            <span className="label">{tx('Title')}</span>
            <input className="input" value={renaming.title} autoFocus onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} />
          </label>
        </Modal>
      )}
    </div>
  )
}
