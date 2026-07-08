// Simplified shield mark inspired by the Satashkent crest. `tone` controls the
// stroke colour so it works on the crimson sidebar (cream) and on white.
export default function Logo({ size = 36, tone = 'var(--cream)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path
        d="M28 22 h44 v30 c0 17 -13 26 -22 30 c-9 -4 -22 -13 -22 -30 z"
        fill="none"
        stroke={tone}
        strokeWidth="5.5"
        strokeLinejoin="round"
      />
      <path d="M37 38 h26 M37 50 h16" stroke={tone} strokeWidth="5" strokeLinecap="round" />
      <path d="M50 31 v33" stroke={tone} strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}

export function LogoLockup({ tone = 'var(--cream)', size = 34, subtitle = true }) {
  return (
    <div className="logo-lockup">
      <Logo size={size} tone={tone} />
      <div className="logo-text">
        <span className="logo-word" style={{ color: tone }}>SATASHKENT</span>
        {subtitle && <span className="logo-sub">College Prep Community</span>}
      </div>
    </div>
  )
}
