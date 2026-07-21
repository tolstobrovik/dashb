import { useState } from 'react'
import { Camera, Check, AlertCircle, Trash2, Eye, EyeOff, KeyRound, UserRound, Type, Clock } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import Avatar from '../components/Avatar.jsx'
import { WORK_DAYS } from '../lib/constants.js'
import { TEXT_SIZES, getTextSize, applyTextSize } from '../lib/textSize.js'
import { THEMES, getTheme, applyTheme } from '../lib/theme.js'
import { soundsOn, setSounds, playDone } from '../lib/sound.js'
import { Moon } from 'lucide-react'

// Distinct hues, not seven shades of brand red — avatars and chips must be
// tellable apart at a glance.
const SWATCHES = ['#a32234', '#2a78d6', '#1D9E75', '#BA7517', '#7b5ad6', '#0e8f8f', '#d6499b', '#5a6b7a']

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
  const [textSize, setTextSize] = useState(getTextSize())
  const [theme, setTheme] = useState(getTheme())
  const [snd, setSnd] = useState(soundsOn())

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

      <div className="section-head" style={{ marginTop: 22 }}><h2><Clock size={16} style={{ verticalAlign: -2 }} /> Working schedule</h2></div>
      <div className="card card-pad">
        {schedErr && <div className="form-error"><AlertCircle size={16} /> {schedErr}</div>}
        <div className="stat-sub" style={{ marginBottom: 10 }}>
          Shoots are booked only inside these hours — plan yours honestly.
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
          <label className="sched-field">from
            <input className="input" type="time" value={wStart} onChange={(e) => setWStart(e.target.value)} />
          </label>
          <label className="sched-field">to
            <input className="input" type="time" value={wEnd} onChange={(e) => setWEnd(e.target.value)} />
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={saveSchedule}>Save schedule</button>
          {schedSaved && <span className="save-ok"><Check size={15} /> Saved</span>}
        </div>
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
