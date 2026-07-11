'use client'

// Live simulation backdrop — a real (tiny) physics loop, not a video:
// bouncing elastic bodies, a travelling sine wave and a double-slit fringe
// strip, drawn faint behind auth/landing surfaces. Colors carry their own
// alpha so it reads in light and dark themes alike.

import { useEffect, useRef } from 'react'

export function SimBackdrop({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)

    const balls = Array.from({ length: 7 }, (_, i) => ({
      x: Math.random(),
      y: Math.random() * 0.5,
      vx: (Math.random() - 0.5) * 0.12,
      vy: 0,
      r: 8 + (i % 3) * 5,
    }))

    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
    }
    resize()
    window.addEventListener('resize', resize)

    let last = performance.now()
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)

      // gravity + elastic floor/wall bounces
      ctx.fillStyle = 'rgba(59,130,246,0.16)'
      for (const b of balls) {
        b.vy += 0.5 * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        if (b.y > 0.92) { b.y = 0.92; b.vy *= -0.985 }
        if (b.x < 0.02 || b.x > 0.98) b.vx *= -1
        ctx.beginPath()
        ctx.arc(b.x * W, b.y * H, b.r * dpr, 0, Math.PI * 2)
        ctx.fill()
      }

      // travelling wave
      ctx.strokeStyle = 'rgba(16,185,129,0.22)'
      ctx.lineWidth = 1.5 * dpr
      ctx.beginPath()
      for (let x = 0; x <= W; x += 4 * dpr) {
        const y = H * 0.62 + Math.sin(x / (46 * dpr) - now / 480) * 26 * dpr
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()

      // double-slit fringes (cos² pattern) along the right edge
      for (let i = 0; i < 60; i++) {
        const t = i / 59
        const I = Math.cos((t - 0.5) * 22) ** 2 * Math.exp(-((t - 0.5) ** 2) * 9)
        ctx.fillStyle = `rgba(139,92,246,${0.24 * I})`
        ctx.fillRect(W - 14 * dpr, t * H, 8 * dpr, H / 60 + 1)
      }

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={className ?? 'pointer-events-none absolute inset-0 h-full w-full'}
    />
  )
}
