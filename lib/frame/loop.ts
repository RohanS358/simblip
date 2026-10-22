// The frame loop: one clock that calls every registered painter once per frame.
//
// Painters are plain functions — `(frame) => void` — and may draw however they like
// (SVG attributes, a canvas 2D context, DOM styles), which is what lets authors write
// code that paints every frame of an animation. The loop knows nothing about the DOM:
// the clock is injected, so the SAME painters run
//
//   · live      — requestAnimationFrame, fixed-step so motion is identical at 30 or 144 Hz
//   · headless  — `step()` / `render()` advance time by hand with no window at all, which is
//                 how a scene is tested (and, later, exported) frame by frame
//
// Time is deterministic: frame N is always at N / fps seconds, whatever the machine does.

export interface Frame {
  /** Frame number since the loop started, from 0. */
  n: number
  /** Seconds since the loop started: n / fps (scaled by timeScale as it accumulates). */
  t: number
  /** Seconds this frame advances: always 1 / fps. */
  dt: number
}
export type Painter = (frame: Frame) => void

export interface Clock {
  now(): number
  request(cb: (ms: number) => void): number
  cancel(id: number): void
}

const browserClock = (): Clock => ({
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
})

export class FrameLoop {
  readonly fps: number
  timeScale = 1
  private painters = new Set<Painter>()
  private n = 0
  private t = 0
  private acc = 0
  private last = 0
  private raf: number | null = null
  private clock: Clock | null

  constructor(opts: { fps?: number; clock?: Clock | null } = {}) {
    this.fps = opts.fps ?? 60
    // No clock = headless: only step()/render() advance time.
    this.clock = opts.clock === undefined ? (typeof requestAnimationFrame === 'function' ? browserClock() : null) : opts.clock
  }

  get frame(): number { return this.n }
  get time(): number { return this.t }
  get running(): boolean { return this.raf !== null }

  /** Register a painter. Returns the function that removes it. */
  add(p: Painter): () => void {
    this.painters.add(p)
    return () => this.painters.delete(p)
  }

  /** Advance exactly one frame, now. Every painter is called once. */
  step(): void {
    const dt = 1 / this.fps
    const frame: Frame = { n: this.n, t: this.t, dt }
    for (const p of [...this.painters]) p(frame)
    this.n++
    this.t += dt
  }

  /** Headless: advance `seconds` of animation as fast as the machine allows. */
  render(seconds: number): void {
    const frames = Math.round(seconds * this.fps)
    for (let i = 0; i < frames; i++) this.step()
  }

  start(): void {
    if (this.raf !== null || !this.clock) return
    const clock = this.clock
    this.last = clock.now()
    const tick = (ms: number) => {
      // Fixed timestep: real elapsed time is banked and spent a frame at a time, so a slow
      // machine drops detail rather than slowing the animation. Capped, so a tab that was in
      // the background does not replay minutes of frames at once.
      this.acc = Math.min(0.25, this.acc + ((ms - this.last) / 1000) * this.timeScale)
      this.last = ms
      const step = 1 / this.fps
      while (this.acc >= step) { this.step(); this.acc -= step }
      this.raf = clock.request(tick)
    }
    this.raf = clock.request(tick)
  }

  stop(): void {
    if (this.raf !== null && this.clock) this.clock.cancel(this.raf)
    this.raf = null
  }

  reset(): void { this.n = 0; this.t = 0; this.acc = 0 }
}

// ── motion helpers painters share ───────────────────────────────────────────

/** Frame-rate independent smoothing: move `from` towards `to`, closing half the gap every
 *  `halfLife` seconds. The workhorse of "ease towards a pose" without a keyframe list. */
export function damp(from: number, to: number, halfLife: number, dt: number): number {
  return to + (from - to) * Math.pow(0.5, dt / Math.max(1e-4, halfLife))
}

/** Smooth 0→1 over [a, b]. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
