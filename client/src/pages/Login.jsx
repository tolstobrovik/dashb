import { useState } from 'react'
import { AlertCircle, LogIn, Eye, EyeOff } from 'lucide-react'
import Logo from '../components/Logo.jsx'
import { useT } from '../lib/i18n.jsx'
import LangToggle from '../components/LangToggle.jsx'
import { useAuth } from '../lib/auth.jsx'
import { getCookie, setCookie } from '../lib/api.js'

export default function Login() {
  const { login } = useAuth()
  const { t } = useT()
  // Comfort cookies: the last username comes prefilled, and the remember-me
  // choice is kept the way you left it.
  const [username, setUsername] = useState(() => getCookie('satashkent_login') || '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(() => getCookie('satashkent_remember') !== '0')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username, password, remember)
      setCookie('satashkent_login', username.trim().toLowerCase(), 30)
      setCookie('satashkent_remember', remember ? '1' : '0', 30)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <Logo size={46} tone="var(--brand-500)" />
          <div className="login-word"><b className="logo-sat">SAT</b>ashkent</div>
          <div className="login-tag">{t('login.tagline')}</div>
        </div>

        <h2>{t('login.signin')}</h2>
        <div className="lc-sub">{t('login.sub')}</div>

        <form className="login-form" onSubmit={submit}>
          {error && (
            <div className="form-error">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          <div className="field">
            <label>{t('login.username')}</label>
            <input
              className="input"
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label>{t('login.password')}</label>
            <div className="pw-wrap">
              {/* autoCapitalize matters here: with the eye toggle on, this is a
                  plain text input and phones would upper-case the first letter. */}
              <input
                className="input"
                type={showPw ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              <button type="button" className="pw-eye" onClick={() => setShowPw(!showPw)} aria-label={showPw ? t('login.hidepw') : t('login.showpw')}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <label className="remember-row">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>{t('login.remember')}</span>
            <span className="stat-sub">{t('login.rememberoff')}</span>
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: 'center', padding: 11, marginTop: 2 }}>
            <LogIn size={17} /> {busy ? t('login.signingin') : t('login.signin')}
          </button>
        </form>

        {/* Before signing in is exactly when somebody needs this: the person
            who cannot read the form is the person who has to change it. */}
        <div className="login-lang"><LangToggle className="btn btn-sm" /></div>
      </div>
    </div>
  )
}
