import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Trash2, Play, Pause } from 'lucide-react'
import { api } from '../lib/api.js'

// Voice notes, the way a phone does them.
//
// A Pravki that takes four minutes to type takes fifteen seconds to say, and
// half of what a reviewer means — "this bit, right here, is too slow" — is in
// the tone. So the thread and the revision box both take a clip.
//
// The bytes never ride along with a task: recording produces a data URL that
// is posted once, and playing fetches it by id on the press that plays it.

const MAX_SECS = 180
export const secsLabel = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0))
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}

// Whichever container this browser will actually give us. Chrome and Firefox
// hand back webm/opus; Safari only does mp4, and refuses a mimeType it does
// not know rather than falling back — so it is asked, not assumed.
const pickMime = () => {
  const want = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  for (const m of want) {
    try { if (window.MediaRecorder?.isTypeSupported?.(m)) return m } catch { /* older browser */ }
  }
  return ''
}
export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder)

// ---- recording ----
// Press to start, press to stop. Not hold-to-talk: a thirty-second note held
// with one finger on a laptop trackpad is a small act of cruelty, and letting
// go by accident loses the whole thing.
export function VoiceRecorder({ onClip, disabled }) {
  const [state, setState] = useState('idle')   // idle | recording | ready | denied
  const [secs, setSecs] = useState(0)
  const [clip, setClip] = useState(null)       // { data, secs, url }
  const rec = useRef(null)
  const chunks = useRef([])
  const timer = useRef(null)
  const stream = useRef(null)

  const cleanup = () => {
    clearInterval(timer.current)
    if (stream.current) { for (const t of stream.current.getTracks()) t.stop(); stream.current = null }
  }
  useEffect(() => () => { cleanup(); if (clip?.url) URL.revokeObjectURL(clip.url) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (disabled || state === 'recording') return
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch { setState('denied'); return }
    const mime = pickMime()
    chunks.current = []
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined)
    r.ondataavailable = (e) => { if (e.data?.size) chunks.current.push(e.data) }
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' })
      cleanup()
      const fr = new FileReader()
      fr.onload = () => {
        const url = URL.createObjectURL(blob)
        setClip({ data: String(fr.result), secs: Math.max(1, secsRef.current), url })
        setState('ready')
      }
      fr.readAsDataURL(blob)
    }
    rec.current = r
    r.start()
    setState('recording')
    setSecs(0); secsRef.current = 0
    timer.current = setInterval(() => {
      secsRef.current += 1
      setSecs(secsRef.current)
      if (secsRef.current >= MAX_SECS) stop()
    }, 1000)
  }
  const secsRef = useRef(0)
  const stop = () => {
    clearInterval(timer.current)
    try { rec.current?.stop() } catch { /* already stopped */ }
  }
  const drop = () => {
    if (clip?.url) URL.revokeObjectURL(clip.url)
    setClip(null); setState('idle'); setSecs(0); secsRef.current = 0
    onClip(null)
  }
  useEffect(() => { onClip(clip ? { data: clip.data, secs: clip.secs } : null) }, [clip]) // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'denied') {
    return <span className="vn-denied" data-tip="Your browser blocked the microphone — allow it in the address bar">🎤 blocked</span>
  }
  if (state === 'ready' && clip) {
    return (
      <span className="vn-ready">
        <audio className="vn-audio" src={clip.url} controls preload="metadata" />
        <button type="button" className="icon-btn" onClick={drop} aria-label="Discard the recording"
          data-tip="Throw it away and start again"><Trash2 size={14} /></button>
      </span>
    )
  }
  if (state === 'recording') {
    return (
      <button type="button" className="vn-btn vn-rec" onClick={stop} aria-label="Stop recording">
        <Square size={13} fill="currentColor" /> {secsLabel(secs)}
        <span className="vn-pulse" />
      </button>
    )
  }
  return (
    <button type="button" className="vn-btn" onClick={start} disabled={disabled}
      aria-label="Record a voice note" data-tip="Say it instead of typing it">
      <Mic size={15} />
    </button>
  )
}

// ---- playing ----
// The clip is fetched on the first press, not on render: a thread with a
// dozen notes in it would otherwise pull a dozen recordings nobody asked for.
export function VoicePlayer({ id, secs, mine }) {
  const [src, setSrc] = useState(null)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [err, setErr] = useState('')
  const el = useRef(null)

  const press = async () => {
    if (busy) return
    if (src) {
      if (playing) { el.current?.pause() } else { el.current?.play().catch(() => setErr('could not play')) }
      return
    }
    setBusy(true)
    try {
      const v = await api.get(`/content/voice/${id}`)
      setSrc(v.data)
      // Autoplay once loaded — the press WAS the play.
      setTimeout(() => el.current?.play().catch(() => {}), 0)
    } catch { setErr('could not load') } finally { setBusy(false) }
  }

  return (
    <span className={'vn-play' + (mine ? ' vn-mine' : '')}>
      <button type="button" className="vn-play-btn" onClick={press} disabled={busy}
        aria-label={playing ? 'Pause the voice note' : 'Play the voice note'}>
        {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
      </button>
      <span className="vn-wave" aria-hidden="true">
        {/* Not a real waveform — the audio is not decoded until it is played,
            and a fake one that never matched the sound would be a small lie.
            This is a shape that says "a recording", nothing more. */}
        {[7, 12, 9, 15, 11, 6, 13, 8, 14, 10, 5, 12].map((h, i) => (
          <i key={i} style={{ height: `${h}px` }} />
        ))}
      </span>
      <span className="vn-secs">{err || secsLabel(secs)}</span>
      {src && (
        <audio ref={el} src={src} preload="auto"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      )}
    </span>
  )
}
