// The Satashkent crest, redrawn from the brand mark: a shield holding an open
// book over the stepped maze pattern, with the five-petal star whose negative
// space forms a five-point star. `tone` controls the colour so it works on
// the crimson sidebar (cream) and on white.
const PETAL = 'M0 -3.4 L-5.8 -9.4 L0 -15.6 L5.8 -9.4 Z'

export default function Logo({ size = 36, tone = 'var(--cream)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 106" aria-hidden="true">
      {/* Shield */}
      <path
        d="M16 15 Q16 8 23 8 H77 Q84 8 84 15 V54 C84 82 68 99.5 50 99.5 C32 99.5 16 82 16 54 Z"
        fill="none"
        stroke={tone}
        strokeWidth="7"
        strokeLinejoin="round"
      />
      {/* Open book above the top bar */}
      <path
        d="M29 29.5 C32.5 25.5 36.5 25.5 40 29 C43.5 25.5 47.5 25.5 51 29.5"
        fill="none"
        stroke={tone}
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* Maze: top bar with its doorway, the right descender, the left steps */}
      <g fill="none" stroke={tone} strokeWidth="5.5" strokeLinecap="butt" strokeLinejoin="miter">
        <path d="M19.5 37 H59" />
        <path d="M67 37 H80.5" />
        <path d="M70.5 40 V51 H58 V63" />
        <path d="M19.5 50 H45 V62 H33.5 V90" />
      </g>
      {/* Five-petal star */}
      <g transform="translate(63.5 73.5)" fill={tone}>
        {[18, 90, 162, 234, 306].map((a) => (
          <path key={a} d={PETAL} transform={`rotate(${a})`} />
        ))}
      </g>
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
