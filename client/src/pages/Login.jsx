import { useState } from 'react'
import { AlertCircle, LogIn } from 'lucide-react'
import Logo from '../components/Logo.jsx'
import { useAuth } from '../lib/auth.jsx'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username, password)
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
          <div className="login-word">SATASHKENT</div>
          <div className="login-tag">College Prep Community</div>
        </div>

        <h2>Sign in</h2>
        <div className="lc-sub">Marketing team workspace</div>

        <form className="login-form" onSubmit={submit}>
          {error && (
            <div className="form-error">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          <div className="field">
            <label>Username</label>
            <input
              className="input"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: 'center', padding: 11, marginTop: 2 }}>
            <LogIn size={17} /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
