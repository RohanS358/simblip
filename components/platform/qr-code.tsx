'use client'

// Crisp SVG QR code (no canvas, scales with CSS). Used by room boards for
// the always-visible pairing code.

import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

export function QrCode({ value, size = 160, className }: { value: string; size?: number; className?: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`
      }
    }
    return { path: d, count: n }
  }, [value])

  return (
    <svg
      role="img"
      aria-label="Pairing QR code"
      viewBox={`0 0 ${count} ${count}`}
      width={size}
      height={size}
      className={className}
      shapeRendering="crispEdges"
    >
      <rect width={count} height={count} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
