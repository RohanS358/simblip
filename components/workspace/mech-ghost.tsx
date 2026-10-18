'use client'

// The mechanics preview ("Sketch → mechanics"): every part the reader found drawn over the ink —
// ground and ramps as bars at their slope, blocks turned to lie on them, balls, hinges, springs,
// ropes and arrows — with a panel to confirm or correct before anything is replaced.
//   <MechGhostOverlay>  page coordinates (moves and zooms with the drawing)
//   <MechGhostPanel>    screen space

import { useEffect } from 'react'
import { Check, X } from 'lucide-react'
import { MECH_CLASSES, mechToCheck, type MechGhost, type MechEdit } from '@/lib/sketch/mech-ghost'
import { stepLine, type StepFailure } from '@/lib/sketch/pipeline'
import type { SketchIRNode } from '@/lib/sketch/ir'

const COLOUR = { sure: 'var(--accent-mint)', unsure: 'var(--accent-amber)', chosen: 'var(--accent-blue)' } as const

const LABEL: Record<string, string> = {
  ground: 'Ground / ramp',
  block: 'Block',
  mass: 'Ball',
  hinge: 'Hinge / anchor',
  force: 'Force arrow',
  velocity: 'Velocity arrow',
}

const colourOf = (g: MechGhost, n: SketchIRNode) => {
  const was = g.original[n.id]
  if (was && was.cls !== n.cls) return COLOUR.chosen
  return n.conf >= 0.8 ? COLOUR.sure : COLOUR.unsure
}

const centre = (n: SketchIRNode): [number, number] => [n.bbox[0] + n.bbox[2] / 2, n.bbox[1] + n.bbox[3] / 2]

/** A zigzag between two points, for a spring. */
function zig(a: [number, number], b: [number, number]): string {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const L = Math.hypot(dx, dy) || 1
  const ux = dx / L
  const uy = dy / L
  const pts: string[] = [`${a[0]},${a[1]}`]
  const lead = Math.min(18, L * 0.15)
  const n = 10
  for (let i = 0; i < n; i++) {
    const t = lead + ((L - 2 * lead) * (i + 0.5)) / n
    const s = i % 2 ? 1 : -1
    pts.push(`${a[0] + ux * t - uy * 9 * s},${a[1] + uy * t + ux * 9 * s}`)
  }
  pts.push(`${b[0]},${b[1]}`)
  return pts.join(' ')
}

export function MechGhostOverlay({ ghost, zoom, hoverId }: { ghost: MechGhost; zoom: number; hoverId: string | null }) {
  const nodes = ghost.ir.nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const sw = 2 / zoom
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden>
      {ghost.ir.edges.map((e, i) => {
        const a = byId.get(e.a.node)
        const b = byId.get(e.b.node)
        if (!a || !b) return null
        const pa = centre(a)
        const pb = centre(b)
        const hot = hoverId === e.a.node || hoverId === e.b.node
        return e.kind === 'spring' ? (
          <polyline key={i} points={zig(pa, pb)} fill="none" stroke="var(--accent-blue)" strokeOpacity={hot ? 0.9 : 0.5} strokeWidth={sw * 1.5} strokeLinejoin="round" />
        ) : (
          <line key={i} x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} stroke="var(--accent-blue)" strokeOpacity={hot ? 0.9 : 0.5} strokeWidth={sw * 1.5} strokeDasharray={e.kind === 'rope' ? `${6 / zoom} ${4 / zoom}` : undefined} />
        )
      })}
      {nodes.map((n, i) => {
        const [cx, cy] = centre(n)
        const c = colourOf(ghost, n)
        const hot = hoverId === n.id
        const common = { fill: c, fillOpacity: hot ? 0.35 : 0.18, stroke: c, strokeWidth: hot ? sw * 1.8 : sw }
        const badge = (
          <g transform={`translate(${n.bbox[0]},${n.bbox[1] - 6 / zoom}) scale(${1 / zoom})`}>
            <circle r={8} cx={0} cy={0} fill={c} />
            <text x={0} y={3.5} textAnchor="middle" fontSize={10} fontWeight={600} fill="#fff">{i + 1}</text>
          </g>
        )
        if (n.cls === 'mass' || n.cls === 'hinge') {
          return (
            <g key={n.id}>
              <circle cx={cx} cy={cy} r={n.bbox[2] / 2} {...common} />
              {badge}
            </g>
          )
        }
        if (n.cls === 'force' || n.cls === 'velocity') {
          const len = n.bbox[2]
          const a = ((n.angle ?? 0) * Math.PI) / 180
          const tip: [number, number] = [cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2]
          const tail: [number, number] = [cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2]
          const h = 12 / zoom
          const head = [-0.45, 0.45].map((s) => `${tip[0] - Math.cos(a + s) * h},${tip[1] - Math.sin(a + s) * h}`)
          return (
            <g key={n.id} stroke={c} fill="none" strokeWidth={sw * 1.6} strokeLinecap="round" strokeDasharray={n.cls === 'velocity' ? `${5 / zoom} ${3 / zoom}` : undefined}>
              <line x1={tail[0]} y1={tail[1]} x2={tip[0]} y2={tip[1]} />
              <polyline points={`${head[0]} ${tip[0]},${tip[1]} ${head[1]}`} strokeDasharray="none" />
              {badge}
            </g>
          )
        }
        // ground bars and blocks: a rectangle turned about its centre
        return (
          <g key={n.id} transform={`rotate(${n.angle ?? 0} ${cx} ${cy})`}>
            <rect x={n.bbox[0]} y={n.bbox[1]} width={n.bbox[2]} height={n.bbox[3]} rx={n.cls === 'block' ? 3 : 0} {...common} />
            {n.cls === 'ground' && <rect x={n.bbox[0]} y={n.bbox[1] + n.bbox[3]} width={n.bbox[2]} height={n.bbox[3] * 0.0} fill="none" />}
            <g transform={`rotate(${-(n.angle ?? 0)} ${n.bbox[0]} ${n.bbox[1]})`}>{badge}</g>
          </g>
        )
      })}
    </svg>
  )
}

const VALUE_FOR: Record<string, { key: string; placeholder: string; unit: string } | undefined> = {
  block: { key: 'mass', placeholder: 'mass', unit: 'kg' },
  mass: { key: 'mass', placeholder: 'mass', unit: 'kg' },
  force: { key: 'F', placeholder: 'force', unit: 'N' },
  velocity: { key: 'v', placeholder: 'speed', unit: 'm/s' },
}

export function MechGhostPanel({
  ghost,
  error,
  onEdit,
  onLink,
  onHover,
  onConfirm,
  onCancel,
}: {
  ghost: MechGhost
  error: StepFailure | null
  onEdit: (id: string, edit: MechEdit) => void
  onLink: (index: number, kind: 'spring' | 'rope' | 'rod') => void
  onHover: (id: string | null) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const nodes = ghost.ir.nodes
  const idx = (id: string) => nodes.findIndex((n) => n.id === id) + 1
  const check = mechToCheck(ghost)
  const slope = (n: SketchIRNode) => (n.cls === 'ground' && Math.abs(n.angle ?? 0) >= 3 && Math.abs(Math.abs(n.angle ?? 0) - 90) >= 3 ? `${Math.round(Math.abs(n.angle ?? 0))}° ramp` : n.cls === 'ground' && Math.abs(Math.abs(n.angle ?? 0) - 90) < 3 ? 'wall' : n.cls === 'ground' ? 'level' : null)

  return (
    <div
      role="dialog"
      aria-label="Sketch to mechanics"
      className="pointer-events-auto absolute left-1/2 top-3 z-50 flex max-h-[72vh] w-[min(94vw,480px)] -translate-x-1/2 flex-col gap-2 overflow-auto rounded-lg border border-border bg-card p-3 text-ui-sm shadow-xl"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">Sketch → mechanics</span>
        <span className="text-muted-foreground">
          {nodes.length} part{nodes.length === 1 ? '' : 's'} · {ghost.ir.edges.length} link{ghost.ir.edges.length === 1 ? '' : 's'} · {check ? `${check} to check` : 'nothing to check'}
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {nodes.map((n, i) => {
          const spec = VALUE_FOR[n.cls]
          const value = spec ? n.values?.[spec.key] ?? '' : ''
          const note = slope(n)
          return (
            <li
              key={n.id}
              className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted/60"
              onPointerEnter={() => onHover(n.id)}
              onPointerLeave={() => onHover(null)}
            >
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white" style={{ background: colourOf(ghost, n) }}>
                {i + 1}
              </span>
              <select
                aria-label={`Part ${i + 1} kind`}
                className="min-w-0 flex-1 rounded border border-border bg-transparent px-1.5 py-0.5"
                value={n.cls}
                onChange={(e) => onEdit(n.id, { cls: e.target.value })}
              >
                {MECH_CLASSES.map((c) => (
                  <option key={c} value={c}>{LABEL[c]}</option>
                ))}
              </select>
              {spec ? (
                <label className="flex items-center gap-1 text-muted-foreground">
                  <input
                    aria-label={`Part ${i + 1} ${spec.placeholder}`}
                    placeholder={spec.placeholder}
                    inputMode="decimal"
                    className="w-16 rounded border border-border bg-transparent px-1.5 py-0.5 font-mono text-foreground"
                    value={value}
                    onChange={(e) => onEdit(n.id, { values: { [spec.key]: e.target.value } })}
                  />
                  {spec.unit}
                </label>
              ) : (
                <span className="w-24 text-right text-muted-foreground">{note ?? ''}</span>
              )}
            </li>
          )
        })}
      </ul>

      {ghost.ir.edges.length > 0 && (
        <ul className="flex flex-col gap-1">
          {ghost.ir.edges.map((e, i) => (
            <li key={i} className="flex items-center gap-2 text-muted-foreground">
              <span>{idx(e.a.node)} ↔ {idx(e.b.node)}</span>
              <select
                aria-label={`Link ${idx(e.a.node)} to ${idx(e.b.node)}`}
                className="rounded border border-border bg-transparent px-1.5 py-0.5 text-foreground"
                value={e.kind}
                onChange={(ev) => onLink(i, ev.target.value as 'spring' | 'rope' | 'rod')}
              >
                <option value="spring">Spring</option>
                <option value="rope">Rope</option>
                <option value="rod">Rod</option>
              </select>
            </li>
          ))}
        </ul>
      )}

      {ghost.ir.doubts.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {ghost.ir.doubts.map((d, i) => (
            <li key={i}>
              {d.why === 'dangling-wire' ? `Part ${idx(d.ref) || '?'}: not attached to anything (it was given a fixed anchor)` : `Part ${idx(d.ref) || '?'}: not sure — drawn without hatching, taken as a surface`}
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted-foreground">Masses and strengths are typed here — they are not read from handwriting yet. Blank means a default.</p>

      {error && (
        <div role="alert" className="rounded border border-[var(--accent-rose)] p-2">
          <p className="text-ui-xs uppercase tracking-wide text-muted-foreground">{stepLine(error.step)}</p>
          <p className="font-medium text-[var(--accent-rose)]">{error.title}</p>
          <p className="mt-0.5 break-words text-muted-foreground">{error.detail}</p>
          <p className="mt-1 text-muted-foreground">
            {error.built ? 'The scene is on the page.' : 'Your sketch is untouched.'} The recognition itself was fine — fix a part above and try again.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="flex items-center gap-1 rounded border border-border px-2.5 py-1 hover:bg-muted" onClick={onCancel}>
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
        <button type="button" className="flex items-center gap-1 whitespace-nowrap rounded bg-[var(--accent-blue)] px-2.5 py-1 font-medium text-white hover:opacity-90" onClick={onConfirm}>
          <Check className="h-3.5 w-3.5" /> Make it live
        </button>
      </div>
    </div>
  )
}
