// The Satashkent crest, redrawn from the brand mark: a shield holding the
// stepped Kufic maze, with the pinwheel rosette whose negative space forms a
// five-point star. `tone` controls the colour so it works on the crimson
// sidebar (cream) and on white.
//
// Proportions follow the supplied artwork: a shield about four-fifths as wide
// as it is tall, flat across the top with barely-rounded corners, straight
// down the sides for half its height and then swept into a deep round point.
// An earlier pass had it far too narrow and the bottom too shallow.
// Five bars, each pushed out from the centre and canted, so the gap they
// leave between them IS the five-point star. Sitting them flat and close made
// one blob; the star only appears when each is turned against its neighbour.
const ROSETTE = 'M-3.6 -11.4 H3.6 V-3.2 H-3.6 Z'

export default function Logo({ size = 36, tone = 'var(--cream)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 112" aria-hidden="true">
      {/* The shield */}
      <path
        d="M11 13 Q11 6.5 17.5 6.5 H82.5 Q89 6.5 89 13 V55 C89 86 71 105 50 105 C29 105 11 86 11 55 Z"
        fill="none"
        stroke={tone}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      {/* The maze: a stepped path falling from the top right to the bottom
          left, drawn with square ends because every corner in the mark is a
          right angle. */}
      <g fill="none" stroke={tone} strokeWidth="6" strokeLinecap="butt" strokeLinejoin="miter">
        {/* the top bar, its doorway, and the stub that closes it */}
        <path d="M17 32 H44" />
        <path d="M54 32 H83" />
        {/* the right descender turning back in */}
        <path d="M73 35 V50 H58 V64" />
        {/* the left bar and the long fall to the foot */}
        <path d="M17 47 H41 V60 H30 V92" />
      </g>
      {/* The spine standing in the gap of the top bar. */}
      <rect x="46" y="26" width="6" height="12" fill={tone} />
      {/* The rosette: five bars pinwheeled around a five-point star of
          negative space. */}
      <g transform="translate(66 74)" fill={tone}>
        {[0, 72, 144, 216, 288].map((a) => (
          <path key={a} d={ROSETTE} transform={`rotate(${a + 18})`} />
        ))}
      </g>
    </svg>
  )
}

// The wordmark. It is SATashkent — SAT, as in the exam, and then Tashkent —
// so the two halves are set as they are said. It was being rendered as one
// shouted SATASHKENT, which reads as a different word entirely.
export function Wordmark({ tone = 'var(--cream)' }) {
  return (
    <span className="logo-word" style={{ color: tone }}>
      <b className="logo-sat">SAT</b>ashkent
    </span>
  )
}

export function LogoLockup({ tone = 'var(--cream)', size = 34, subtitle = true }) {
  return (
    <div className="logo-lockup">
      <Logo size={size} tone={tone} />
      <div className="logo-text">
        <Wordmark tone={tone} />
        {subtitle && <span className="logo-sub">College Prep Community</span>}
      </div>
    </div>
  )
}
