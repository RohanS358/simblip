'use client'

// 404 — "Off the page."
//
// The route loader (app/loading.tsx) fires a cannon at a block tower by itself.
// This is the playable version of that same simulation: the page you asked for
// is missing, so you get the cannon instead. Drag to aim, release to fire,
// knock down the 404. Same physics as the loader — real projectile motion,
// x = v·cosθ·t and y = v·sinθ·t − ½gt² — because that IS the product.
//
// Reduced motion gets a static, fully navigable page with no canvas at all.

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Block = {
  x: number; y: number; vx: number; vy: number
  a: number; va: number; w: number; h: number; hit: boolean; down: boolean
}

const GRAVITY = 900        // px/s² in canvas units before dpr scaling
const MAX_POWER = 1150     // px/s at full draw
const DRAG_RANGE = 150     // css px of drag that maps to full power

export default function NotFound() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [reduced, setReduced] = useState(false)
  const [shots, setShots] = useState(0)
  const [cleared, setCleared] = useState(false)
  // Live readouts, mirrored out of the rAF loop for the HUD.
  const [aim, setAim] = useState<{ angle: number; power: number } | null>(null)
  const resetRef = useRef<() => void>(() => {})

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  const restart = useCallback(() => {
    setShots(0)
    setCleared(false)
    resetRef.current()
  }, [])

  useEffect(() => {
    if (reduced) return
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const css = getComputedStyle(document.documentElement)
    const accent = css.getPropertyValue('--accent-blue').trim() || '#3b82f6'
    const mint = css.getPropertyValue('--accent-mint').trim() || '#10b981'
    const fg = css.getPropertyValue('--muted-foreground').trim() || '#888'

    let dpr = 1, W = 0, H = 0, groundY = 0, G = 0
    let blocks: Block[] = []
    let ball = { x: 0, y: 0, vx: 0, vy: 0, flying: false }
    let trail: { x: number; y: number }[] = []
    let cannon = { x: 0, y: 0 }
    let dragging = false
    let dragFrom = { x: 0, y: 0 }
    let dragTo = { x: 0, y: 0 }
    let raf = 0

    // The tower spells 404: three glyph columns of stacked blocks.
    const buildTower = () => {
      blocks = []
      const bw = 15 * dpr
      const bh = 13 * dpr
      const gap = 1 * dpr
      // Column patterns, bottom row first — a coarse 3×5 bitmap per glyph.
      const glyphs = [
        [[1,0,1],[1,0,1],[1,1,1],[1,0,1],[0,0,1]], // 4
        [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]], // 0
        [[1,0,1],[1,0,1],[1,1,1],[1,0,1],[0,0,1]], // 4
      ]
      const glyphW = 3 * (bw + gap)
      const totalW = glyphs.length * glyphW + 2 * (10 * dpr)
      const startX = W - totalW - 26 * dpr
      glyphs.forEach((g, gi) => {
        const gx = startX + gi * (glyphW + 10 * dpr)
        g.forEach((row, ri) => {
          row.forEach((on, ci) => {
            if (!on) return
            blocks.push({
              x: gx + ci * (bw + gap),
              y: groundY - (g.length - ri) * (bh + gap),
              vx: 0, vy: 0, a: 0, va: 0, w: bw, h: bh, hit: false, down: false,
            })
          })
        })
      })
    }

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      const rect = wrap.getBoundingClientRect()
      W = canvas.width = Math.max(320, rect.width) * dpr
      H = canvas.height = rect.height * dpr
      groundY = H * 0.84
      G = GRAVITY * dpr
      cannon = { x: W * 0.11, y: groundY - 9 * dpr }
      buildTower()
    }

    const reset = () => {
      ball.flying = false
      trail = []
      buildTower()
    }
    resetRef.current = reset

    // ── Input: drag anywhere to aim, release to fire ────────────────────────
    const localPt = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }
    }
    const solveShot = () => {
      // Pull back from the cannon like a slingshot: the vector from the
      // release point to the start point is the launch velocity.
      const dx = dragFrom.x - dragTo.x
      const dy = dragFrom.y - dragTo.y
      const dist = Math.hypot(dx, dy)
      const range = DRAG_RANGE * dpr
      const power = Math.min(1, dist / range) * MAX_POWER * dpr
      const angle = Math.atan2(dy, dx)
      return { power, angle }
    }
    const onDown = (e: PointerEvent) => {
      if (ball.flying) return
      dragging = true
      canvas.setPointerCapture(e.pointerId)
      dragFrom = dragTo = localPt(e)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      dragTo = localPt(e)
      const { power, angle } = solveShot()
      setAim({ angle: (-angle * 180) / Math.PI, power: power / dpr })
    }
    const onUp = () => {
      if (!dragging) return
      dragging = false
      const { power, angle } = solveShot()
      setAim(null)
      if (power < 40 * dpr) return // a tap, not a shot
      ball = {
        x: cannon.x, y: cannon.y,
        vx: Math.cos(angle) * power,
        vy: Math.sin(angle) * power,
        flying: true,
      }
      trail = []
      setShots((n) => n + 1)
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)

    let last = performance.now()
    const draw = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000)
      last = now
      ctx.clearRect(0, 0, W, H)

      // Ground line
      ctx.strokeStyle = fg
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.5 * dpr
      ctx.setLineDash([4 * dpr, 6 * dpr])
      ctx.beginPath()
      ctx.moveTo(0, groundY + 1)
      ctx.lineTo(W, groundY + 1)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      // Aim preview: the predicted parabola, sampled from the same equations
      // the projectile will actually integrate.
      if (dragging) {
        const { power, angle } = solveShot()
        ctx.fillStyle = accent
        for (let i = 1; i <= 26; i++) {
          const t = i * 0.045
          const px = cannon.x + Math.cos(angle) * power * t
          const py = cannon.y + Math.sin(angle) * power * t + 0.5 * G * t * t
          if (py > groundY) break
          ctx.globalAlpha = 0.5 - i * 0.016
          ctx.beginPath()
          ctx.arc(px, py, 2.5 * dpr, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      // Cannon — barrel follows the aim
      const barrelAngle = dragging ? solveShot().angle : -Math.PI / 4
      ctx.save()
      ctx.translate(cannon.x, cannon.y)
      ctx.rotate(barrelAngle)
      ctx.fillStyle = fg
      ctx.fillRect(0, -3.5 * dpr, 26 * dpr, 7 * dpr)
      ctx.restore()
      ctx.fillStyle = fg
      ctx.beginPath()
      ctx.arc(cannon.x, cannon.y + 2 * dpr, 7 * dpr, 0, Math.PI * 2)
      ctx.fill()

      // Projectile
      if (ball.flying) {
        ball.vy += G * dt
        ball.x += ball.vx * dt
        ball.y += ball.vy * dt
        trail.push({ x: ball.x, y: ball.y })
        if (trail.length > 48) trail.shift()

        for (const b of blocks) {
          if (b.hit) continue
          if (
            ball.x > b.x - 4 * dpr && ball.x < b.x + b.w + 4 * dpr &&
            ball.y > b.y - 4 * dpr && ball.y < b.y + b.h + 4 * dpr
          ) {
            // Impulse falls off with distance — nearby blocks fly, far ones nudge.
            for (const t of blocks) {
              const d = Math.max(14 * dpr, Math.hypot(t.x - ball.x, t.y - ball.y))
              const k = (2000 * dpr) / d
              if (k < 30 * dpr) continue
              t.hit = true
              t.vx = ((t.x + t.w / 2 - ball.x) / d) * k + ball.vx * 0.18
              t.vy = ((t.y + t.h / 2 - ball.y) / d) * k - 70 * dpr
              t.va = (Math.random() - 0.5) * 10
            }
            ball.flying = false
          }
        }
        if (ball.y > groundY || ball.x > W || ball.x < 0) ball.flying = false
      }

      // Trail
      ctx.fillStyle = accent
      trail.forEach((p, i) => {
        ctx.globalAlpha = (i / trail.length) * 0.35
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2 * dpr, 0, Math.PI * 2)
        ctx.fill()
      })
      ctx.globalAlpha = 1
      if (ball.flying) {
        ctx.beginPath()
        ctx.arc(ball.x, ball.y, 5 * dpr, 0, Math.PI * 2)
        ctx.fill()
      }

      // Blocks
      let standing = 0
      for (const b of blocks) {
        if (b.hit) {
          b.vy += G * dt
          b.x += b.vx * dt
          b.y += b.vy * dt
          b.a += b.va * dt
          if (b.y + b.h > groundY) {
            b.y = groundY - b.h
            b.vy *= -0.32
            b.vx *= 0.78
            b.va *= 0.78
            if (Math.abs(b.vy) < 12 * dpr) { b.vy = 0; b.down = true }
          }
        }
        if (!b.down) standing++
        const c = b.hit ? mint : accent
        ctx.save()
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2)
        ctx.rotate(b.a)
        ctx.strokeStyle = c
        ctx.lineWidth = 1.5 * dpr
        ctx.globalAlpha = 0.9
        ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h)
        ctx.globalAlpha = 0.16
        ctx.fillStyle = c
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h)
        ctx.restore()
        ctx.globalAlpha = 1
      }

      // Cleared once every block has come to rest on the ground.
      if (standing === 0 && blocks.length) setCleared(true)

      raf = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }, [reduced])

  return (
    <main className="canvas-dots relative flex min-h-dvh flex-col bg-background [background-size:24px_24px]">
      {/* Wordmark */}
      <div className="px-6 pt-6 sm:px-10">
        <Link href="/" className="text-[18px] font-extrabold tracking-tight">
          SIM<span className="text-[var(--accent-blue)]">BLIP</span>
        </Link>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 sm:px-10">
        <div className="w-full max-w-3xl">
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
            Error 404
          </p>
          <h1 className="mt-2 text-[clamp(1.75rem,5vw,2.75rem)] font-bold leading-[1.05] tracking-tight">
            This page went off the canvas.
          </h1>
          <p className="mt-3 max-w-xl text-[0.875rem] leading-relaxed text-muted-foreground">
            {reduced
              ? 'The address you followed does not match a page in SIMBLIP. It may have been renamed, unshared, or deleted.'
              : 'Nothing here to open — so take the cannon instead. Drag anywhere to aim, release to fire, and knock the 404 down.'}
          </p>

          {/* The game */}
          {!reduced && (
            <div
              ref={wrapRef}
              className="relative mt-6 h-[min(46dvh,340px)] w-full overflow-hidden rounded-2xl border border-border bg-muted/20"
            >
              <canvas
                ref={canvasRef}
                className="size-full touch-none"
                aria-label="Projectile mini-game: drag to aim the cannon and knock down the 404"
              />

              {/* Live physics readout — the app's own vocabulary */}
              <div className="pointer-events-none absolute left-3 top-3 font-mono text-[0.6875rem] leading-relaxed text-muted-foreground">
                <div>g = {GRAVITY} px/s²</div>
                {aim && (
                  <>
                    <div>θ = {aim.angle.toFixed(0)}°</div>
                    <div>v₀ = {aim.power.toFixed(0)} px/s</div>
                  </>
                )}
              </div>
              <div className="pointer-events-none absolute right-3 top-3 font-mono text-[0.6875rem] text-muted-foreground">
                shots: {shots}
              </div>

              {cleared && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                  <span className="pointer-events-auto rounded-full border border-[var(--accent-mint)]/40 bg-background/90 px-3.5 py-1.5 font-mono text-[0.6875rem] text-[var(--accent-mint)] backdrop-blur">
                    Cleared in {shots} {shots === 1 ? 'shot' : 'shots'} — the page is still missing, though.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Ways out */}
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <Button asChild size="sm">
              <Link href="/notebook">Back to my notebook</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/">Go to the start</Link>
            </Button>
            {!reduced && (
              <Button size="sm" variant="ghost" onClick={restart} className="gap-1.5">
                <RotateCcw className="size-3.5" />
                Rebuild the tower
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
