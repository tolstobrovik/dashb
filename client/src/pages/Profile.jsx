import { useEffect, useRef, useState } from 'react'
import { Camera, Check, AlertCircle, Trash2, Eye, EyeOff, KeyRound, UserRound, Type, Clock, Send } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import Avatar from '../components/Avatar.jsx'
import { WORK_DAYS } from '../lib/constants.js'
import { TEXT_SIZES, getTextSize, applyTextSize } from '../lib/textSize.js'
import { THEMES, getTheme, applyTheme } from '../lib/theme.js'
import { LANGS, useT } from '../lib/i18n.jsx'
import { soundsOn, setSounds, playDone } from '../lib/sound.js'
import { Moon, Languages } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'

// Distinct hues, not seven shades of brand red — avatars and chips must be
// tellable apart at a glance.
const SWATCHES = ['#a32234', '#2a78d6', '#1D9E75', '#BA7517', '#7b5ad6', '#0e8f8f', '#d6499b', '#5a6b7a']

// The deadline record on your own account. There is no edit control here and
// no delete: the list is recomputed from the tasks themselves every time it is
// opened, so the only way to change it is to change what actually happened.
// A warning that turns out to be somebody else's delay disappears on its own.
function WarningRecord() {
  const [state, setState] = useState(null)
  useEffect(() => {
    let alive = true
    api.get('/warnings/me').then((d) => { if (alive) setState(d) }).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!state) return null
  const { warnings, open } = state
  return (
    <>
      <div className="section-head" style={{ marginTop: 22 }}>
        <h2><AlertCircle size={16} style={{ verticalAlign: -2 }} /> Missed deadlines</h2>
      </div>
      <div className="card card-pad">
        {warnings.length === 0 ? (
          <div className="warn-clean"><Check size={16} /> Nothing missed. Every deadline met so far.</div>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {warnings.length} missed {warnings.length === 1 ? 'deadline' : tx('deadlines')}
              {open > 0 && <> · <b>{open}</b> still running</>}. Delays caused by someone
              handing work over late are not counted here.
            </p>
            <div className="warn-list">
              {warnings.map((w) => (
                <div className="warn-row" key={`${w.content_id}-${w.phase}`}>
                  <AlertCircle size={16} />
                  <div>
                    <div className="warn-title">{w.title}</div>
                    <div className="warn-sub">
                      {w.phase_label} · due {w.due}
                      {w.revised && <> (re-promised from {w.promised})</>}
                      {w.delivered_day ? <> · delivered {w.delivered_day}</> : <> · not delivered yet</>}
                    </div>
                  </div>
                  <div className="warn-days">{w.days_late}d late</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}

// Everyone's own corner: photo, display name, accent color, password.
export default function Profile() {
  const { user, setUser } = useAuth()
  const [name, setName] = useState(user.name)
  const [color, setColor] = useState(user.color)
  const [avatar, setAvatar] = useState(user.avatar)
  const [phone, setPhone] = useState(user.phone || '')
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // Working schedule — shoots can only be booked inside these hours.
  const [wStart, setWStart] = useState(user.work_start || '')
  const [wEnd, setWEnd] = useState(user.work_end || '')
  const [wDays, setWDays] = useState(() => (Array.isArray(user.work_days) ? user.work_days : []))
  const [schedSaved, setSchedSaved] = useState(false)
  const [schedErr, setSchedErr] = useState('')
  const toggleDay = (d) =>
    setWDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))
  const saveSchedule = async () => {
    setSchedErr(''); setSchedSaved(false)
    try {
      const updated = await api.patch('/users/me', {
        work_start: wStart || null, work_end: wEnd || null,
        work_days: wDays.length ? wDays : null,
      })
      setUser(updated)
      setSchedSaved(true)
      setTimeout(() => setSchedSaved(false), 2500)
    } catch (e) { setSchedErr(e.message) }
  }
  const { lang, setLang, t } = useT()
  const [textSize, setTextSize] = useState(getTextSize())
  const [theme, setTheme] = useState(getTheme())
  const [snd, setSnd] = useState(soundsOn())

  // The Telegram bridge — the bell, mirrored to your pocket. Connect mints a
  // one-time deep link; pressing Start in Telegram completes it, and the page
  // notices on its own.
  const [tg, setTg] = useState(null) // { enabled, linked, bot }
  const [tgLink, setTgLinkState] = useState(null) // { url, bot } while waiting for Start
  const [tgMsg, setTgMsg] = useState('')
  // One press = one request: every bridge button locks while its call runs,
  // so an eager thumb can't send five test lines. The lock lives in a ref —
  // synchronous on purpose; a burst of clicks outruns any state re-render.
  const [tgBusy, setTgBusy] = useState(false)
  const tgLock = useRef(false)
  useEffect(() => { api.get('/telegram/status').then(setTg).catch(() => setTg({ enabled: false })) }, [])
  useEffect(() => {
    if (!tgLink || tg?.linked) return
    const id = setInterval(() => api.get('/telegram/status').then((s) => {
      setTg(s)
      if (s.linked) setTgLinkState(null)
    }).catch(() => {}), 3000)
    return () => clearInterval(id)
  }, [tgLink, tg?.linked])
  const tgCall = async (fn) => {
    if (tgLock.current) return
    tgLock.current = true
    setTgBusy(true); setTgMsg('')
    try { await fn() } catch (e) { setTgMsg(e.message) }
    // The lock outlives the request by a second — a burst of eager clicks
    // becomes one action, not one per round-trip.
    setTimeout(() => { tgLock.current = false; setTgBusy(false) }, 1000)
  }
  const tgConnect = () => tgCall(async () => {
    const l = await api.post('/telegram/link', {})
    setTgLinkState(l)
    if (l.url) window.open(l.url, '_blank', 'noopener')
  })
  const tgDisconnect = () => tgCall(async () => {
    await api.post('/telegram/unlink', {})
    setTg((s) => ({ ...s, linked: false })); setTgLinkState(null)
  })
  const tgActivate = () => tgCall(async () => {
    const out = await api.post('/telegram/set-webhook', {})
    setTgMsg(out.ok ? `Webhook set: ${out.url}` : 'Telegram refused the webhook — check the token and try again')
  })
  const tgTest = () => tgCall(async () => {
    await api.post('/telegram/test', {})
    setTgMsg('Sent — check Telegram')
  })

  // password form
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [repPw, setRepPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [pwMsg, setPwMsg] = useState(null) // { ok, text }

  const pickAvatar = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { setErr('Image is too large — keep it under 15 MB'); return }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        // Square crop from the center. 128px is plenty for the largest place
        // an avatar renders, and keeps every payload it travels in small.
        const side = Math.min(img.width, img.height)
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = Math.min(128, side)
        canvas.getContext('2d').drawImage(
          img,
          (img.width - side) / 2, (img.height - side) / 2, side, side,
          0, 0, canvas.width, canvas.height,
        )
        setAvatar(canvas.toDataURL('image/jpeg', 0.82))
        setErr('')
      } catch { setErr('Could not read that image') } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { setErr('Could not read that image'); URL.revokeObjectURL(url) }
    img.src = url
    e.target.value = '' // same file can be picked again
  }

  const saveProfile = async () => {
    setErr(''); setSaved(false); setBusy(true)
    try {
      const updated = await api.patch('/users/me', { name: name.trim(), color, avatar: avatar || null, phone: phone.trim() || null })
      setUser(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const changePassword = async () => {
    setPwMsg(null)
    if (newPw !== repPw) { setPwMsg({ ok: false, text: 'New passwords don’t match' }); return }
    try {
      await api.patch('/users/me', { current_password: curPw, new_password: newPw })
      setPwMsg({ ok: true, text: 'Password changed — use it on your next sign-in' })
      setCurPw(''); setNewPw(''); setRepPw('')
    } catch (e) { setPwMsg({ ok: false, text: e.message }) }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="section-head"><h2><UserRound size={17} style={{ verticalAlign: -3 }} /> Profile</h2></div>
      <div className="card card-pad">
        {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}

        <div className="profile-top">
          <Avatar name={name || user.name} color={color} src={avatar} size="lg" />
          <div className="profile-photo-btns">
            <label className="btn btn-sm">
              <Camera size={14} /> {avatar ? 'Change photo' : 'Add photo'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pickAvatar} />
            </label>
            {avatar && (
              <button className="btn btn-sm" onClick={() => setAvatar(null)}>
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label>Display name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field">
          <label>Phone <span className="stat-sub">(shown to the team)</span></label>
          <input className="input" type="tel" value={phone} placeholder="+998 90 123 45 67"
            onChange={(e) => setPhone(e.target.value)} />
        </div>

        <div className="field">
          <label>Accent color <span className="stat-sub">(used for your initials and chips)</span></label>
          <div className="swatch-row">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={'swatch' + (color === c ? ' on' : '')}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              >
                {color === c && <Check size={13} strokeWidth={3.5} color="#fff" />}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-primary" onClick={saveProfile} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
          {saved && <span className="save-ok"><Check size={15} /> Saved</span>}
        </div>
      </div>

      <WarningRecord />

      <div className="section-head" style={{ marginTop: 22 }}><h2><Clock size={16} style={{ verticalAlign: -2 }} /> {tx('My working hours')}</h2></div>
      <div className="card card-pad">
        {schedErr && <div className="form-error"><AlertCircle size={16} /> {schedErr}</div>}
        <div className="stat-sub" style={{ marginBottom: 10 }}>
          {tx('The days and hours you can be booked for. The board offers only these when somebody plans a shoot with you.')}
        </div>
        <div className="wd-row">
          {WORK_DAYS.map((d) => (
            <button key={d.n} type="button" className={'wd-chip' + (wDays.includes(d.n) ? ' on' : '')}
              onClick={() => toggleDay(d.n)}>
              {d.label}
            </button>
          ))}
        </div>
        <div className="sched-hours">
          <label className="sched-field">{tx('From')}
            <input className="input" type="time" value={wStart} onChange={(e) => setWStart(e.target.value)} />
          </label>
          <label className="sched-field">{tx('To')}
            <input className="input" type="time" value={wEnd} onChange={(e) => setWEnd(e.target.value)} />
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={saveSchedule}>Save schedule</button>
          {schedSaved && <span className="save-ok"><Check size={15} /> Saved</span>}
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 22 }}><h2><Send size={16} style={{ verticalAlign: -2 }} /> Telegram</h2></div>
      <div className="card card-pad">
        {!tg ? (
          <div className="stat-sub">Checking…</div>
        ) : !tg.enabled ? (
          <div className="stat-sub">
            {user.role === 'admin'
              ? 'The bot isn’t configured yet: create one with @BotFather, put its token into TELEGRAM_BOT_TOKEN (Vercel → Settings → Environment Variables), redeploy — then press Activate here.'
              : 'The bot isn’t switched on yet — ask the admin.'}
          </div>
        ) : tg.linked ? (
          <>
            <div className="stat-sub" style={{ marginBottom: 10 }}>
              <Check size={14} style={{ verticalAlign: -2, color: 'var(--ok, #1D9E75)' }} /> Connected{tg.bot ? <> to <b>@{tg.bot}</b></> : null} — status moves, comments and deadline reminders land in Telegram too.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn btn-sm" onClick={tgTest} disabled={tgBusy}>Send a test</button>
              <button className="btn btn-sm" onClick={tgDisconnect} disabled={tgBusy}>Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <div className="stat-sub" style={{ marginBottom: 10 }}>
              The bell, mirrored to your pocket: status moves, comments and deadline reminders arrive in Telegram.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={tgConnect} disabled={tgBusy}><Send size={14} /> Connect Telegram</button>
              {tgLink && (
                <span className="stat-sub">
                  Press <b>Start</b> in the chat that opened{tgLink.url ? <> (or open <a href={tgLink.url} target="_blank" rel="noreferrer">@{tgLink.bot}</a>)</> : null} — this page will notice by itself.
                </span>
              )}
            </div>
          </>
        )}
        {tg?.enabled && user.role === 'admin' && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={tgActivate} disabled={tgBusy}>Activate webhook</button>
            <span className="stat-sub">Admin, once after the token lands or the domain changes.</span>
          </div>
        )}
        {tgMsg && <div className="stat-sub" style={{ marginTop: 8 }}>{tgMsg}</div>}
      </div>

      <div className="section-head" style={{ marginTop: 22 }}><h2><Moon size={16} style={{ verticalAlign: -2 }} /> Appearance</h2></div>
      <div className="card card-pad">
        <div className="stat-sub" style={{ marginBottom: 10 }}>Dark is easy on the eyes at night. System follows your device.</div>
        <div className="seg">
          {THEMES.map((t) => (
            <button key={t.key} type="button"
              className={'seg-btn' + (theme === t.key ? ' on' : '')}
              onClick={() => { applyTheme(t.key); setTheme(t.key) }}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="stat-sub" style={{ margin: '14px 0 10px' }}>Soft sounds when tasks complete and programs launch.</div>
        <div className="seg">
          <button type="button" className={'seg-btn' + (snd ? ' on' : '')}
            onClick={() => { setSounds(true); setSnd(true); playDone() }}>Sounds on</button>
          <button type="button" className={'seg-btn' + (!snd ? ' on' : '')}
            onClick={() => { setSounds(false); setSnd(false) }}>Off</button>
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 22 }}><h2><Languages size={16} style={{ verticalAlign: -2 }} /> {t('common.language')}</h2></div>
      <div className="card card-pad">
        <div className="stat-sub" style={{ marginBottom: 10 }}>
          The buttons, menus and headings on this device. What you and everybody
          else TYPE — titles, scripts, comments — is never translated.
        </div>
        <div className="seg">
          {LANGS.map((l) => (
            <button key={l.key} type="button"
              className={'seg-btn' + (lang === l.key ? ' on' : '')}
              onClick={() => setLang(l.key)}>
              {l.native}
            </button>
          ))}
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 22 }}><h2><Type size={16} style={{ verticalAlign: -2 }} /> Text size</h2></div>
      <div className="card card-pad">
        <div className="stat-sub" style={{ marginBottom: 10 }}>Scales the whole site on this device.</div>
        <div className="seg">
          {TEXT_SIZES.map((s) => (
            <button key={s.key} type="button"
              className={'seg-btn' + (textSize === s.key ? ' on' : '')}
              style={{ fontSize: s.key === 'small' ? 12 : s.key === 'large' ? 15 : 13 }}
              onClick={() => { applyTextSize(s.key); setTextSize(s.key) }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 22 }}><h2><KeyRound size={16} style={{ verticalAlign: -2 }} /> Change password</h2></div>
      <div className="card card-pad">
        {pwMsg && (
          <div className={pwMsg.ok ? 'form-ok' : 'form-error'}>
            {pwMsg.ok ? <Check size={16} /> : <AlertCircle size={16} />} {pwMsg.text}
          </div>
        )}
        <div className="field">
          <label>Current password</label>
          <div className="pw-wrap">
            <input className="input" type={showPw ? 'text' : 'password'} value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
            <button type="button" className="pw-eye" onClick={() => setShowPw(!showPw)} data-tip={showPw ? 'Hide password' : 'Show password'} data-tip-left="" aria-label="Toggle visibility">
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div className="field">
          <label>New password</label>
          <input className="input" type={showPw ? 'text' : 'password'} value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="field">
          <label>Repeat new password</label>
          <input className="input" type={showPw ? 'text' : 'password'} value={repPw} onChange={(e) => setRepPw(e.target.value)} autoComplete="new-password" />
        </div>
        <button className="btn btn-primary" onClick={changePassword} disabled={!curPw || !newPw}>
          Change password
        </button>
      </div>
    </div>
  )
}
