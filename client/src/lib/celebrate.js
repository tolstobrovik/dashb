// The little bit of party when something finally goes out.
//
// Publishing is the only moment on this board where a piece is FINISHED —
// weeks of shooting, cutting and revisions land on one press — and the board
// marked it with the same quiet toast as changing a date. So it gets thrown
// confetti, from the two bottom corners, the way a party popper goes off.
//
// Deliberately cheap and self-cleaning: one canvas, ~90 pieces, gone in under
// two seconds and removed from the DOM. It never blocks a click (pointer
// events off) and it does nothing at all for somebody who has asked their
// system for less motion — a full-screen burst of moving colour is exactly
// what that setting is for.

const COLOURS = ['#a32234', '#f2a413', '#0ca30c', '#2a78d6', '#7c5cd6', '#ece7e1']

export function celebrate() {
  if (typeof document === 'undefined') return
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
  } catch { /* older browser: carry on */ }
  // Never two at once — a double publish should not double the noise.
  if (document.getElementById('celebrate-canvas')) return

  const canvas = document.createElement('canvas')
  canvas.id = 'celebrate-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: '9999',
  })
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const W = window.innerWidth
  const H = window.innerHeight
  canvas.width = W * dpr
  canvas.height = H * dpr
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) { canvas.remove(); return }
  ctx.scale(dpr, dpr)

  // Two poppers, one in each bottom corner, fired inwards and up.
  const bits = []
  for (const [x, y, aim] of [[0, H, -Math.PI / 3.4], [W, H, -Math.PI + Math.PI / 3.4]]) {
    for (let i = 0; i < 45; i++) {
      const spread = (Math.random() - 0.5) * 0.85
      const speed = 11 + Math.random() * 13
      bits.push({
        x, y,
        vx: Math.cos(aim + spread) * speed,
        vy: Math.sin(aim + spread) * speed,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 5,
        spin: (Math.random() - 0.5) * 0.4,
        angle: Math.random() * Math.PI,
        colour: COLOURS[(Math.random() * COLOURS.length) | 0],
      })
    }
  }

  const GRAVITY = 0.32
  const DRAG = 0.988
  const started = performance.now()
  let raf = 0
  const done = () => { cancelAnimationFrame(raf); canvas.remove() }

  const frame = (now) => {
    const age = now - started
    ctx.clearRect(0, 0, W, H)
    let alive = 0
    for (const b of bits) {
      b.vy += GRAVITY
      b.vx *= DRAG
      b.vy *= DRAG
      b.x += b.vx
      b.y += b.vy
      b.angle += b.spin
      if (b.y > H + 40) continue
      alive++
      // Fading out over the last third, so nothing vanishes mid-air.
      ctx.globalAlpha = age > 1200 ? Math.max(0, 1 - (age - 1200) / 700) : 1
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.rotate(b.angle)
      ctx.fillStyle = b.colour
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h)
      ctx.restore()
    }
    if (!alive || age > 1900) { done(); return }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  // A safety net: if the tab is backgrounded mid-flight the frames stop
  // coming and the canvas would sit there for ever.
  setTimeout(() => { if (document.getElementById('celebrate-canvas')) done() }, 4000)
}

// The same moment, reached from a list rather than the task window: a done
// tick, a drag onto the last column. Takes the row before and after so it
// only fires on the CROSSING — re-saving something already finished is not a
// new achievement, and a board full of finished work is not a firework show.
export function celebrateIfFinished(before, after) {
  if (!before || !after) return
  if (!before.done_at && after.done_at) celebrate()
}
