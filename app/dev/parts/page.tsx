'use client'
// Dev-only gallery: every circuit part at default size and at 2 odd sizes.
import { useEffect, useState } from 'react'
import { COMPONENTS } from '@/lib/scene/factory'
import { PartSvg } from '@/components/objects/part-art'

export default function Parts() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  const defs = COMPONENTS.filter((d) => d.create({ x: 0, y: 0 }).geometry.kind === 'symbol')
  return (
    <div style={{ padding: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(420px,1fr))', gap: 28, background: 'var(--background)' }}>
      {defs.map((d) => {
        const o = d.create({ x: 0, y: 0 })
        const sizes = [[o.size.w, o.size.h], [o.size.w * 1.5, o.size.h * 1.5], [o.size.w * 0.75, o.size.h * 1.6]]
        return (
          <div key={d.id}>
            <div style={{ font: '11px monospace', color: '#888' }}>{d.id}</div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
              {sizes.map(([w, h], i) => (
                <div key={i} style={{ width: w, height: h, outline: '1px dashed #8884' }}>
                  <PartSvg obj={{ ...o, size: { w, h } }} />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
