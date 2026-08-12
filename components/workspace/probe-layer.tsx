'use client'

// The on-canvas binding UI: probe dots, dotted arrows, and the channel chip
// at each arrowhead.
//
// Drag from a dot → arrow follows the pointer → release on an object to bind
// it. What gets written is the component's ordinary `series`/`inputs`/`outputs`
// param (lib/scene/probes.ts), so the Inspector shows the same thing.
//
// Everything here lives in WORLD coordinates inside the canvas's transformed
// container, so sizes divide by `zoom` to stay constant on screen — the same
// convention the measure/selection overlays use.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from '@/lib/store/document'
import { channelOptions } from '@/lib/scene/bindings'
import {
  attachPoint,
  defaultChannel,
  endDirection,
  orthPath,
  probeLinks,
  probeOrigin,
  probesFor,
  serializeLinks,
  snapTarget,
  type ProbeLink,
  type ProbeSpec,
  type SnapResult,
} from '@/lib/scene/probes'
import { GRAPH_COLORS } from '@/components/objects/graph'
import type { SceneObject, Vec2 } from '@/lib/scene/types'

/** Faint enough to never obstruct the drawing underneath. */
const ARROW_OPACITY = 0.42

interface Drag {
  spec: ProbeSpec
  from: Vec2
  to: Vec2
  snap: SnapResult | null
}

export function ProbeLayer({
  pageId,
  objects,
  focusedId,
  zoom,
  toCanvas,
}: {
  pageId: string
  objects: Record<string, SceneObject>
  /** The single selected object — probes and arrows show only for this one. */
  focusedId: string | null
  zoom: number
  toCanvas: (clientX: number, clientY: number) => Vec2
}) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [openChip, setOpenChip] = useState<string | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag

  const all = Object.values(objects)
  const focused = focusedId ? objects[focusedId] : undefined

  /** Write a probe's links back. Legacy graph params are cleared on the first
   *  write, or they'd resurrect as a fallback the moment `series` empties
   *  (same reason GraphOptions in the Inspector clears them). */
  const writeLinks = useCallback(
    (obj: SceneObject, spec: ProbeSpec, links: ProbeLink[]) => {
      setStringParam(pageId, obj.id, spec.param, serializeLinks(spec, links))
      if (spec.param !== 'series') return
      const p = obj.parameters
      if (p.sourceId?.kind === 'string' && p.sourceId.value) {
        setStringParam(pageId, obj.id, 'sourceId', '')
      }
      if (p.yChannels?.kind === 'string' && p.yChannels.value) {
        setStringParam(pageId, obj.id, 'yChannels', '')
      }
    },
    [pageId, setStringParam]
  )

  // A drag is a window-level gesture: the pointer leaves the dot immediately,
  // and releasing outside the canvas must still end it cleanly.
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const to = toCanvas(e.clientX, e.clientY)
      const d = dragRef.current
      if (!d) return
      setDrag({ ...d, to, snap: snapTarget(all, to, d.spec, focusedId ?? '') })
    }
    const up = () => {
      const d = dragRef.current
      setDrag(null)
      if (!d || !focused || !d.snap?.valid) return
      const { spec, snap } = d
      const links = probeLinks(focused, spec)
      // Same object+channel twice would draw two identical arrows; for object
      // mode, binding the same component twice is meaningless too.
      const taken = links.filter((l) => l.objectId === snap.target.id).map((l) => l.channel)
      const channel =
        spec.mode === 'channel' ? defaultChannel(snap.target, taken) : ''
      if (spec.mode === 'object' && links.some((l) => l.objectId === snap.target.id)) return
      if (spec.mode === 'channel' && (!channel || taken.includes(channel))) return
      writeLinks(focused, spec, [
        ...links,
        { index: links.length, objectId: snap.target.id, channel },
      ])
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, all, focused, focusedId, toCanvas, writeLinks])

  const startDrag = useCallback(
    (e: React.PointerEvent, spec: ProbeSpec, from: Vec2) => {
      // The canvas would otherwise read this as "start dragging the object".
      e.stopPropagation()
      e.preventDefault()
      setDrag({ spec, from, to: from, snap: null })
      setOpenChip(null)
    },
    []
  )

  // ── Bound-but-unfocused: dots only ────────────────────────────────────────
  // So a binding is discoverable at rest without any line on the canvas.
  const restDots = all.flatMap((obj) => {
    if (obj.id === focusedId) return []
    const specs = probesFor(obj)
    return specs.flatMap((spec, i) => {
      if (probeLinks(obj, spec).length === 0) return []
      const o = probeOrigin(obj, i, specs.length)
      return [
        <circle
          key={`${obj.id}:${spec.param}`}
          cx={o.x}
          cy={o.y}
          r={3.5 / zoom}
          fill={spec.color}
          opacity={0.5}
        />,
      ]
    })
  })

  const specs = focused ? probesFor(focused) : []

  return (
    <>
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={1}
        height={1}
      >
        {restDots}

        {focused &&
          specs.map((spec, i) => {
            const origin = probeOrigin(focused, i, specs.length)
            const links = probeLinks(focused, spec)
            return (
              <g key={spec.param}>
                {links.map((link, n) => {
                  const target = objects[link.objectId]
                  if (!target) return null
                  const end = attachPoint(target, origin)
                  // Graph arrows carry the series' own color so the line on
                  // the chart and the arrow on the canvas read as one thing.
                  const color =
                    spec.mode === 'channel'
                      ? GRAPH_COLORS[link.index % GRAPH_COLORS.length]
                      : spec.color
                  const dir = endDirection(origin, end)
                  const head = 6 / zoom
                  return (
                    <g key={`${link.objectId}:${link.channel}:${n}`}>
                      <path
                        d={orthPath(origin, end)}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.25 / zoom}
                        strokeDasharray={`${4 / zoom} ${3.5 / zoom}`}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={ARROW_OPACITY}
                      />
                      <path
                        d={`M ${end.x} ${end.y} L ${end.x - dir.x * head - dir.y * head * 0.6} ${
                          end.y - dir.y * head - dir.x * head * 0.6
                        } M ${end.x} ${end.y} L ${
                          end.x - dir.x * head + dir.y * head * 0.6
                        } ${end.y - dir.y * head + dir.x * head * 0.6}`}
                        stroke={color}
                        strokeWidth={1.25 / zoom}
                        strokeLinecap="round"
                        fill="none"
                        opacity={ARROW_OPACITY + 0.2}
                      />
                    </g>
                  )
                })}

                {/* The probe dot: filled once something is bound. */}
                <circle
                  cx={origin.x}
                  cy={origin.y}
                  r={5 / zoom}
                  fill={links.length > 0 ? spec.color : 'var(--background)'}
                  stroke={spec.color}
                  strokeWidth={1.5 / zoom}
                />
              </g>
            )
          })}

        {/* Live drag preview. */}
        {drag && (
          <>
            <path
              d={orthPath(drag.from, drag.snap ? drag.snap.point : drag.to)}
              fill="none"
              stroke={drag.snap && !drag.snap.valid ? 'var(--accent-rose)' : drag.spec.color}
              strokeWidth={1.5 / zoom}
              strokeDasharray={`${4 / zoom} ${3.5 / zoom}`}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.85}
            />
            {drag.snap && (
              <circle
                cx={drag.snap.point.x}
                cy={drag.snap.point.y}
                r={(drag.snap.terminal ? 5 : 7) / zoom}
                fill="none"
                stroke={drag.snap.valid ? drag.spec.color : 'var(--accent-rose)'}
                strokeWidth={2 / zoom}
              />
            )}
          </>
        )}
      </svg>

      {/* Probe hit targets. Separate from the SVG so they can take pointer
          events without making the whole overlay interactive. */}
      {focused &&
        specs.map((spec, i) => {
          const origin = probeOrigin(focused, i, specs.length)
          const r = 9 / zoom
          return (
            <div
              key={`hit:${spec.param}`}
              role="button"
              tabIndex={0}
              aria-label={`${spec.label} probe — drag to a component to connect`}
              title={`${spec.label}: drag to a component`}
              // touch-none: this is a drag target, so the browser must not
              // claim the gesture as a scroll before the handler sees it.
              className="absolute cursor-crosshair touch-none rounded-full"
              style={{
                left: origin.x - r,
                top: origin.y - r,
                width: r * 2,
                height: r * 2,
              }}
              onPointerDown={(e) => startDrag(e, spec, origin)}
            />
          )
        })}

      {/* Channel chips at each arrowhead. */}
      {focused &&
        specs.flatMap((spec, i) => {
          const origin = probeOrigin(focused, i, specs.length)
          const links = probeLinks(focused, spec)
          return links.map((link, n) => {
            const target = objects[link.objectId]
            if (!target) return null
            const end = attachPoint(target, origin)
            const key = `${spec.param}:${n}`
            const color =
              spec.mode === 'channel'
                ? GRAPH_COLORS[link.index % GRAPH_COLORS.length]
                : spec.color
            const remove = () =>
              writeLinks(
                focused,
                spec,
                links.filter((_, j) => j !== n).map((l, j) => ({ ...l, index: j }))
              )
            return (
              <ProbeChip
                key={key}
                x={end.x}
                y={end.y}
                zoom={zoom}
                color={color}
                mode={spec.mode}
                label={spec.mode === 'channel' ? link.channel : target.name}
                options={spec.mode === 'channel' ? channelOptions(target) : []}
                open={openChip === key}
                onToggle={() => setOpenChip(openChip === key ? null : key)}
                onPick={(channel) => {
                  writeLinks(
                    focused,
                    spec,
                    links.map((l, j) => (j === n ? { ...l, channel } : l))
                  )
                  setOpenChip(null)
                }}
                onRemove={remove}
              />
            )
          })
        })}
    </>
  )
}

/** The pill at an arrowhead: shows the bound channel, opens a picker. */
function ProbeChip({
  x,
  y,
  zoom,
  color,
  mode,
  label,
  options,
  open,
  onToggle,
  onPick,
  onRemove,
}: {
  x: number
  y: number
  zoom: number
  color: string
  mode: 'channel' | 'object'
  label: string
  options: string[]
  open: boolean
  onToggle: () => void
  onPick: (channel: string) => void
  onRemove: () => void
}) {
  // Counter-scale so the chip is a constant size on screen at any zoom.
  const s = 1 / zoom
  return (
    <div
      className="absolute"
      style={{ left: x, top: y, transform: `scale(${s})`, transformOrigin: '0 0' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex -translate-y-1/2 translate-x-2 items-center gap-0.5">
        <button
          type="button"
          aria-label={mode === 'channel' ? `Channel: ${label}. Click to change` : label}
          aria-expanded={mode === 'channel' ? open : undefined}
          className="flex items-center gap-1 rounded-full border bg-card/95 px-1.5 py-0.5 font-mono text-[10px] shadow-sm backdrop-blur transition-colors"
          style={{ borderColor: color, color }}
          onClick={mode === 'channel' ? onToggle : onRemove}
        >
          <span className="max-w-24 truncate">{label || '—'}</span>
          {mode === 'channel' && <span aria-hidden>▾</span>}
        </button>
        {mode === 'channel' && (
          <button
            type="button"
            aria-label={`Disconnect ${label}`}
            className="rounded-full border border-border bg-card/95 px-1 py-0.5 text-[10px] leading-none text-muted-foreground shadow-sm backdrop-blur hover:text-[var(--accent-rose)]"
            onClick={onRemove}
          >
            ✕
          </button>
        )}
      </div>

      {open && options.length > 0 && (
        <div
          role="listbox"
          aria-label="Choose a channel"
          className="absolute left-2 top-2 z-10 max-h-40 w-32 overflow-y-auto rounded-lg border border-border bg-popover p-0.5 shadow-lg"
        >
          {options.map((c) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={c === label}
              className={
                'block w-full truncate rounded px-1.5 py-1 text-left font-mono text-[10.5px] transition-colors hover:bg-accent ' +
                (c === label ? 'text-foreground' : 'text-muted-foreground')
              }
              onClick={() => onPick(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
