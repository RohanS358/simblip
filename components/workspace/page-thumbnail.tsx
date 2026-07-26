'use client'

// A tiny SVG snapshot of a page's objects, used in the notebook card grid.
// The goal is a recognizable "preview" — shapes in roughly the right place —
// not a real render. We compute a fitted viewBox from the union of bboxes so
// the card always fills, regardless of where the user last panned/zoomed.
//
// We don't load every page eagerly just to draw cards: the page is fetched
// on demand, cached by the doc store, and unloaded by the page cache after
// its grace period. The visible cards "light up" the moment a page is in
// memory; the rest stay in the "empty" state, which is still useful
// (the page is there, just not opened yet on this device).

import { useEffect, useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { pdfThumb } from '@/lib/store/pdf-thumb'
import type { SceneObject, GeometryKind } from '@/lib/scene/types'

type Props = {
  pageId: string
  className?: string
}

// Map a geometry kind to a soft accent — same family as the rest of the app.
const KIND_FILL: Record<GeometryKind, string> = {
  rect: 'fill-[var(--accent-blue)]',
  circle: 'fill-[var(--accent-mint)]',
  polygon: 'fill-[var(--accent-violet)]',
  line: 'stroke-[var(--accent-amber)]',
  stroke: 'stroke-[var(--accent-rose)]',
  text: 'fill-foreground/70',
  note: 'fill-[var(--accent-amber)]/30 stroke-[var(--accent-amber)]',
  formula: 'fill-[var(--accent-blue)]/20 stroke-[var(--accent-blue)]',
  graph: 'fill-[var(--accent-mint)]/20 stroke-[var(--accent-mint)]',
  cashflow: 'fill-[var(--accent-violet)]/20 stroke-[var(--accent-violet)]',
  truthtable: 'fill-[var(--accent-mint)]/20 stroke-[var(--accent-mint)]',
  symbol: 'fill-[var(--accent-blue)]/30 stroke-[var(--accent-blue)]',
  code: 'fill-foreground/10 stroke-foreground/30',
  table: 'fill-[var(--accent-blue)]/15 stroke-[var(--accent-blue)]',
  dsa: 'fill-[var(--accent-violet)]/15 stroke-[var(--accent-violet)]',
  gridtable: 'fill-[var(--accent-blue)]/10 stroke-[var(--accent-blue)]/50',
  slider: 'fill-[var(--accent-blue)]/20 stroke-[var(--accent-blue)]',
  button: 'fill-[var(--accent-mint)]/20 stroke-[var(--accent-mint)]',
  trigger: 'fill-[var(--accent-amber)]/20 stroke-[var(--accent-amber)]',
}

function ShapeForObj({ obj }: { obj: SceneObject }) {
  const { geometry, position, size, rotation } = obj
  const fill = KIND_FILL[geometry.kind] ?? 'fill-foreground/40'

  if (geometry.kind === 'line' || geometry.kind === 'stroke') {
    const points = geometry.points ?? [
      [0, 0],
      [size.w, size.h],
    ]
    const d = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
      .join(' ')
    return (
      <path
        d={d}
        className={`${fill} fill-none stroke-2`}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    )
  }

  if (geometry.kind === 'text') {
    // A bar roughly the size of a text object — keeps the layout honest.
    return <rect className={`${fill} opacity-60`} x={0} y={size.h * 0.3} width={size.w} height={Math.max(2, size.h * 0.35)} rx={1} />
  }

  if (geometry.kind === 'circle') {
    return <ellipse className={fill} cx={size.w / 2} cy={size.h / 2} rx={size.w / 2} ry={size.h / 2} />
  }

  if (geometry.kind === 'polygon' && geometry.points && geometry.points.length >= 3) {
    const d =
      'M' +
      geometry.points
        .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
        .join(' L') +
      ' Z'
    return <path d={d} className={fill} />
  }

  // Default: bbox rectangle, with a thin stroke for note-like kinds.
  const isNoteLike = geometry.kind === 'note' || geometry.kind === 'formula' || geometry.kind === 'graph' || geometry.kind === 'cashflow' || geometry.kind === 'truthtable' || geometry.kind === 'symbol'
  return (
    <rect
      className={fill}
      x={0}
      y={0}
      width={size.w}
      height={size.h}
      rx={isNoteLike ? 2 : 1}
      strokeWidth={isNoteLike ? 0.5 : 0}
    />
  )
}

export function PageThumbnail({ pageId, className }: Props) {
  // The preview must show what the page IS: a board previews its own
  // objects, a doc previews its first SHEET, and a PDF shows its actual
  // first page rendered from the locally cached file.
  const meta = useWorkspaceStore((s) => findPageMeta(s.notebooks, pageId))
  const kind = meta?.kind ?? 'board'
  const contentId = kind === 'doc' ? (meta?.docPages?.[0] ?? pageId) : pageId

  // Subscribe to *this* page's content (zustand will only re-render us when
  // this slice changes). Reading the page from getState() on each render
  // would also work, but subscription is the idiomatic pattern.
  const page = useDocStore((s) => s.pages[contentId])
  const [hasLoaded, setHasLoaded] = useState(false)
  const [pdfImg, setPdfImg] = useState<string | null>(null)

  useEffect(() => {
    if (hasLoaded || kind === 'pdf') return
    useDocStore.getState().ensurePage(contentId)
    setHasLoaded(true)
  }, [contentId, hasLoaded, kind])

  useEffect(() => {
    if (kind !== 'pdf') return
    let dead = false
    void pdfThumb(pageId).then((img) => {
      if (!dead) setPdfImg(img)
    })
    return () => {
      dead = true
    }
  }, [kind, pageId])

  if (kind === 'pdf') {
    return (
      <div className={className}>
        {pdfImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pdfImg} alt="" className="h-full w-full rounded-[4px] object-cover object-top" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground/50">
            <FileText className="h-6 w-6" />
            {meta?.fileName && (
              <span className="max-w-full truncate px-1 text-[9px]">{meta.fileName}</span>
            )}
          </div>
        )}
      </div>
    )
  }

  const viewBox = useMemo(() => {
    if (!page) return '0 0 100 100'
    const objs = Object.values(page.objects)
    if (objs.length === 0) return '0 0 100 100'

    // Union of bboxes, padded.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const o of objs) {
      const x = o.position.x
      const y = o.position.y
      const w = o.size.w || 1
      const h = o.size.h || 1
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x + w > maxX) maxX = x + w
      if (y + h > maxY) maxY = y + h
    }
    const padX = (maxX - minX) * 0.08
    const padY = (maxY - minY) * 0.08
    return `${minX - padX} ${minY - padY} ${maxX - minX + padX * 2} ${maxY - minY + padY * 2}`
  }, [page])

  if (!page || Object.keys(page.objects).length === 0) {
    // Empty state — the page exists, it just has nothing on it (yet).
    return (
      <div className={className}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="h-full w-full opacity-40">
          <line x1="10" y1="50" x2="90" y2="50" className="stroke-border" strokeWidth="0.5" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    )
  }

  return (
    <div className={className}>
      <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="h-full w-full">
        {Object.values(page.objects).map((obj) => (
          <g
            key={obj.id}
            transform={`translate(${obj.position.x},${obj.position.y}) rotate(${obj.rotation || 0},${obj.size.w / 2},${obj.size.h / 2})`}
          >
            <ShapeForObj obj={obj} />
          </g>
        ))}
      </svg>
    </div>
  )
}
