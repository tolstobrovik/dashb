// The Satashkent crest: a shield holding the stepped Kufic maze, with the
// pinwheel rosette whose negative space forms a five-point star.
//
// IT IS DRAWN TWICE, and which one you get depends on how big it is.
//
// The crest was one drawing at every size, and it is used at 34px in the
// sidebar, 30px in the top bar and 16px in a browser tab. At those sizes a
// 6-unit stroke lands on well under a pixel: the maze silted up into a grey
// smudge and the rosette became a dot. Rendered side by side from 96px down
// to 18px, everything below about 44px was mush.
//
// So there are two cuts of the same mark. Above 44px the full crest, rosette
// and all — the sign-in card and the app icons. Below it, the same shield and
// the same maze redrawn with strokes half again as thick and the rosette
// dropped, because five canted bars cannot survive a 34px box and the shape
// they leave behind is noise, not a star. Same silhouette, same geometry,
// same brand; drawn for the size it is actually used at.
//
// `tone` controls the colour so it works on the crimson sidebar (cream) and
// on white.

const SHIELD = 'M11 13 Q11 6.5 17.5 6.5 H82.5 Q89 6.5 89 13 V55 C89 86 71 105 50 105 C29 105 11 86 11 55 Z'

// Five bars, each pushed out from the centre and canted, so the gap they
// leave between them IS the five-point star. Sitting them flat and close made
// one blob; the star only appears when each is turned against its neighbour.
const ROSETTE = 'M-3.8 -11.8 H3.8 V-3.4 H-3.8 Z'

// Below this the detail stops surviving the pixel grid.
const COMPACT_BELOW = 44

export default function Logo({ size = 36, tone = 'var(--cream)' }) {
  const compact = size < COMPACT_BELOW
  return (
    <svg width={size} height={size} viewBox="0 0 100 112" aria-hidden="true">
      <path
        d={SHIELD}
        fill="none"
        stroke={tone}
        strokeWidth={compact ? 10 : 9}
        strokeLinejoin="round"
      />
      {/* The maze: a stepped path falling from the top right to the bottom
          left, drawn with square ends because every corner in the mark is a
          right angle. The compact cut pulls it in from the shield's edge as
          well as thickening it — at 34px a stroke that touches the rim welds
          itself to the rim. */}
      <g
        fill="none"
        stroke={tone}
        strokeWidth={compact ? 9.5 : 7}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      >
        {compact ? (
          <>
            <path d="M20 33 H43" />
            <path d="M57 33 H80" />
            <path d="M74 40 V52 H57 V68" />
            <path d="M20 50 H40 V63 H29 V88" />
          </>
        ) : (
          <>
            {/* the top bar, its doorway, and the stub that closes it */}
            <path d="M17 32 H43" />
            <path d="M55 32 H83" />
            {/* the right descender turning back in */}
            <path d="M74 36 V51 H58 V65" />
            {/* the left bar and the long fall to the foot */}
            <path d="M17 47 H41 V60 H30 V92" />
          </>
        )}
      </g>
      {!compact && (
        <>
          {/* The spine standing in the gap of the top bar. */}
          <rect x="46" y="25" width="7" height="13" fill={tone} />
          {/* The rosette: five bars pinwheeled around a five-point star of
              negative space. */}
          <g transform="translate(66 75)" fill={tone}>
            {[0, 72, 144, 216, 288].map((a) => (
              <path key={a} d={ROSETTE} transform={`rotate(${a + 18})`} />
            ))}
          </g>
        </>
      )}
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
