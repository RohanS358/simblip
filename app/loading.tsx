'use client'

// Route-transition loader — a tiny REAL simulation, the product in miniature:
// a cannon lobs a projectile on a true parabolic arc into a tower of blocks,
// which tumble as rigid bodies. Loops until the route is ready. Reduced
// motion gets the static wordmark only.

import { useEffect, useRef } from 'react'

type Block = { x: number; y: number; vx: number; vy: number; a: number; va: number; w: number; h: number; hit: boolean }

export default function Loading() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = (canvas.width = 360 * dpr)
    const H = (canvas.height = 200 * dpr)
    const css = getComputedStyle(document.documentElement)
    const accent = css.getPropertyValue('--accent-blue').trim() || '#3b82f6'
    const fg = css.getPropertyValue('--muted-foreground').trim() || '#888'

    const groundY = H * 0.86
    const G = 640 * dpr // px/s²
    const towerX = W * 0.78

    let blocks: Block[] = []
    let ball = { x: 0, y: 0, vx: 0, vy: 0, flying: false }
    let phase = 0 // time into the current volley
    let raf = 0

    const reset = () => {
      phase = 0
      ball.flying = false
      const bw = 16 * dpr
      const bh = 12 * dpr
      blocks = []
      for (let row = 0; row < 5; row++)
        for (let col = 0; col < 2; col++)
          blocks.push({
            x: towerX + col * (bw + 1),
            y: groundY - (row + 1) * (bh + 1),
            vx: 0, vy: 0, a: 0, va: 0, w: bw, h: bh, hit: false,
          })
    }

    const fire = () => {
      // Solve launch velocity so the arc lands on the tower — projectile
      // motion for real: x = v·cosθ·t, y = v·sinθ·t − ½gt².
      const x0 = W * 0.1
      const y0 = groundY - 14 * dpr
      const theta = Math.PI / 3.6
      const dx = towerX - x0
      const T = 1.1 // seconds of flight
      ball = {
        x: x0, y: y0,
        vx: dx / T,
        vy: -(Math.tan(theta) * dx) / T,
        flying: true,
      }
    }

    let last = performance.now()
    const draw = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000)
      last = now
      phase += dt
      ctx.clearRect(0, 0, W, H)

      // ground
      ctx.strokeStyle = fg
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 1.5 * dpr
      ctx.setLineDash([4 * dpr, 6 * dpr])
      ctx.beginPath()
      ctx.moveTo(0, groundY + 1)
      ctx.lineTo(W, groundY + 1)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      // cannon
      const cx = W * 0.1
      const cy = groundY - 8 * dpr
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(-Math.PI / 3.6)
      ctx.fillStyle = fg
      ctx.fillRect(0, -3.5 * dpr, 26 * dpr, 7 * dpr)
      ctx.restore()
      ctx.fillStyle = fg
      ctx.beginPath()
      ctx.arc(cx, cy + 2 * dpr, 7 * dpr, 0, Math.PI * 2)
      ctx.fill()

      if (phase > 0.5 && !ball.flying && blocks.every((b) => !b.hit)) fire()

      if (ball.flying) {
        ball.vy += G * dt
        ball.x += ball.vx * dt
        ball.y += ball.vy * dt
        // faint trajectory trace
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(ball.x, ball.y, 5 * dpr, 0, Math.PI * 2)
        ctx.fill()
        // impact: shove the tower
        for (const b of blocks) {
          if (!b.hit && ball.x > b.x - 4 * dpr && ball.x < b.x + b.w + 4 * dpr && ball.y > b.y && ball.y < b.y + b.h) {
            for (const t of blocks) {
              t.hit = true
              const d = Math.max(12 * dpr, Math.hypot(t.x - ball.x, t.y - ball.y))
              const k = (2600 * dpr) / d
              t.vx = ((t.x + t.w / 2 - ball.x) / d) * k + ball.vx * 0.25
              t.vy = ((t.y + t.h / 2 - ball.y) / d) * k - 60 * dpr
              t.va = (Math.random() - 0.5) * 9
            }
            ball.flying = false
          }
        }
        if (ball.y > groundY || ball.x > W) ball.flying = false
      }

      // blocks — settled tower or tumbling debris
      for (const b of blocks) {
        if (b.hit) {
          b.vy += G * dt
          b.x += b.vx * dt
          b.y += b.vy * dt
          b.a += b.va * dt
          if (b.y + b.h > groundY) {
            b.y = groundY - b.h
            b.vy *= -0.35
            b.vx *= 0.8
            b.va *= 0.8
          }
        }
        ctx.save()
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2)
        ctx.rotate(b.a)
        ctx.strokeStyle = accent
        ctx.lineWidth = 1.5 * dpr
        ctx.globalAlpha = 0.9
        ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h)
        ctx.globalAlpha = 0.18
        ctx.fillStyle = accent
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h)
        ctx.restore()
        ctx.globalAlpha = 1
      }

      if (phase > 3.4) reset()
      raf = requestAnimationFrame(draw)
    }

    reset()
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="canvas-dots flex h-dvh flex-col items-center justify-center gap-3 bg-background [background-size:24px_24px]">
      <canvas ref={ref} aria-hidden className="h-[200px] w-[360px] max-w-[92vw]" />
      <span className="text-[15px] font-extrabold tracking-tight">
        SIM<span className="text-[var(--accent-blue)]">BLIP</span>
      </span>
      <span className="text-[11px] tracking-wide text-muted-foreground">loading…</span>
    </div>
  )
}
