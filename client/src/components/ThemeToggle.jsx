import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { applyTheme, resolvedTheme } from '../lib/theme.js'

// One-tap light/dark flip for late nights. The full Light/Dark/System choice
// lives in Profile; this just toggles what's on screen right now.
export default function ThemeToggle({ className = 'icon-btn' }) {
  const [mode, setMode] = useState(resolvedTheme())
  const flip = () => {
    const next = mode === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setMode(next)
  }
  return (
    <button className={className} onClick={flip}
      data-tip={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} data-tip-left=""
      aria-label="Toggle dark mode">
      {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
