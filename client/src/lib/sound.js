// The completion chime — two soft rising notes with a bell shimmer, in the
// spirit of Microsoft To Do. Synthesised with WebAudio, no audio file needed.
let ctx
export function playDing() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    const t0 = ctx.currentTime

    const note = (freq, at, dur, peak) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(freq, t0 + at)
      g.gain.setValueAtTime(0.0001, t0 + at)
      g.gain.exponentialRampToValueAtTime(peak, t0 + at + 0.014)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur)
      o.connect(g)
      g.connect(ctx.destination)
      o.start(t0 + at)
      o.stop(t0 + at + dur + 0.05)
    }

    note(587.33, 0.0, 0.30, 0.28) // D5 — the pickup
    note(880.0, 0.10, 0.60, 0.36) // A5 — the landing
    note(1174.66, 0.10, 0.45, 0.10) // D6 — soft shimmer
    note(1760.0, 0.14, 0.35, 0.05) // A6 — sparkle on top
  } catch { /* sound is a nicety — never break the click */ }
}
