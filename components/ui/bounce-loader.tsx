'use client'

// The one loading indicator for the whole app: shapes lobbing themselves out
// of the floor, re-rolling form, colour, size and arc on every hop. Used for
// route transitions, document/PDF/image opening, and any other wait long
// enough to notice. Reduced motion gets the label only (the stage is hidden
// in CSS).

import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

const TYPES = ['circle', 'semi-circle', 'square', 'triangle', 'triangle-2', 'rectangle']
const COLORS = ['#836ee5', '#fe94b4', '#49d2f5', '#ff5354', '#00b1b4', '#ffe465', '#0071ff', '#03274b']
const rand = (n: number) => Math.random() * n

export function BounceLoader({
  label,
  /** Stage height in px — every shape dimension scales off it. */
  size = 220,
  shapes = 5,
  className,
}: {
  label?: string
  size?: number
  shapes?: number
  className?: string
}) {
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = stage.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const timers: number[] = []

    el.querySelectorAll('shape').forEach((node, i) => {
      const shape = node as HTMLElement
      const hop = () => {
        const cl = shape.classList
        shape.className = ''
        cl.add(TYPES[~~rand(TYPES.length)])

        const styles: [string, string][] = [
          ['--offset', `${(rand(0.9) - 0.45).toFixed(3)}`],
          ['--bounce-variance', `${(rand(0.34) - 0.17).toFixed(3)}`],
          ['--base_scale', `${(rand(0.12) + 0.09).toFixed(3)}`],
          ['--rotation', `${~~(rand(180) - 90)}deg`],
          ['--color', COLORS[~~rand(COLORS.length)]],
        ]
        for (const [k, v] of styles) shape.style.setProperty(k, v)

        cl.add('bounce-up')
        timers.push(window.setTimeout(() => cl.replace('bounce-up', 'bounce-down'), 400))
      }

      // Stagger the shapes so they don't launch as one block.
      timers.push(
        window.setTimeout(() => {
          hop()
          timers.push(window.setInterval(hop, 740))
        }, i * 130),
      )
    })

    return () => {
      for (const t of timers) {
        window.clearTimeout(t)
        window.clearInterval(t)
      }
    }
  }, [shapes])

  return (
    <div className={cn('flex flex-col items-center justify-center gap-2', className)}>
      <div
        ref={stage}
        aria-hidden
        className="bounce-stage"
        style={{ '--stage-h': `${size}px` } as React.CSSProperties}
      >
        {Array.from({ length: shapes }, (_, i) => (
          <shape key={i} />
        ))}
      </div>
      {label && (
        <span role="status" className="text-[0.75rem] tracking-wide text-muted-foreground">
          {label}
        </span>
      )}
    </div>
  )
}
