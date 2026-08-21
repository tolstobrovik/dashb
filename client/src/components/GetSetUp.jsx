import { useEffect, useState } from 'react'
import { Download, Send, X, Share, Plus } from 'lucide-react'
import { api } from '../lib/api.js'

// The two things a person has to do once, and which nobody does unprompted:
// put the board on their home screen, and connect the bot.
//
// Both used to be discoverable only if you went looking. People were reaching
// the dashboard by retyping a .vercel.app address, and the Telegram bridge —
// which is where every deadline and Pravki actually reaches somebody — sat
// unconnected on accounts that had been open for months.
//
// So it asks. Not once and forgotten: the bot prompt comes back every time
// the app opens until it is connected, because an unconnected bot is a person
// who is not being told things. The install prompt is gentler — it can be put
// off for a week at a time, since it is a convenience rather than a channel.

const SNOOZE_KEY = 'satashkent_install_snoozed'
const WEEK = 7 * 24 * 60 * 60 * 1000

// Standalone means it is already installed — nothing to ask for.
const installed = () => window.matchMedia?.('(display-mode: standalone)')?.matches
  || window.navigator.standalone === true

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export default function GetSetUp() {
  // ---- installing ----
  const [prompt, setPrompt] = useState(null)   // the browser's own install event
  const [showIOS, setShowIOS] = useState(false)
  const [snoozed, setSnoozed] = useState(() => {
    try { return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now() - WEEK } catch { return false }
  })
  useEffect(() => {
    const grab = (e) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', grab)
    // iOS has no such event and never will — Safari installs through the
    // share sheet — so it gets told how instead of being offered a button
    // that cannot exist.
    if (isIOS() && !installed()) setShowIOS(true)
    return () => window.removeEventListener('beforeinstallprompt', grab)
  }, [])
  const snooze = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now())) } catch { /* private window */ }
    setSnoozed(true)
  }
  const install = async () => {
    if (!prompt) return
    prompt.prompt()
    try { await prompt.userChoice } catch { /* dismissed */ }
    setPrompt(null)
  }

  // ---- the bot ----
  const [tg, setTg] = useState(null)
  const [linking, setLinking] = useState(false)
  useEffect(() => {
    api.get('/telegram/status').then(setTg).catch(() => setTg(null))
  }, [])
  const connect = async () => {
    setLinking(true)
    try {
      const l = await api.post('/telegram/link', {})
      if (l.url) window.open(l.url, '_blank', 'noopener')
    } catch { /* the panel on Profile says why */ } finally { setLinking(false) }
  }

  const askBot = tg?.enabled && !tg?.linked
  const askInstall = !installed() && !snoozed && (prompt || showIOS)
  if (!askBot && !askInstall) return null

  return (
    <div className="setup-strip">
      {/* Deliberately not dismissible: every day this stays unconnected is a
          day of deadlines and Pravki that reach nobody. */}
      {askBot && (
        <div className="setup-card setup-tg">
          <Send size={16} />
          <span className="setup-txt">
            <b>Connect Telegram</b>
            <span className="setup-sub">
              Deadlines, Pravki and anything with your name on it reach you there. Right now they don’t reach you at all.
            </span>
          </span>
          <button type="button" className="btn btn-sm btn-primary" disabled={linking} onClick={connect}>
            {linking ? 'Opening…' : 'Connect'}
          </button>
        </div>
      )}

      {askInstall && (
        <div className="setup-card setup-install">
          <Download size={16} />
          <span className="setup-txt">
            <b>Put Satashkent on your home screen</b>
            <span className="setup-sub">
              {showIOS
                ? <>Tap <Share size={12} style={{ verticalAlign: -2 }} /> Share, then <Plus size={12} style={{ verticalAlign: -2 }} /> “Add to Home Screen”. It opens like an app — no address to remember.</>
                : 'One tap and it opens like an app, with no address to remember.'}
            </span>
          </span>
          {prompt && (
            <button type="button" className="btn btn-sm btn-primary" onClick={install}>Install</button>
          )}
          <button type="button" className="icon-btn" onClick={snooze} aria-label="Not now"
            data-tip="Not now — ask again next week"><X size={15} /></button>
        </div>
      )}
    </div>
  )
}
