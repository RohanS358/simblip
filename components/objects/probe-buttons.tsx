'use client'

// The probe handles that live in a value-consuming component's HEADER.
//
// Press one and drag onto any component to bind it — the arrow, snapping and
// channel chip are all drawn by components/workspace/probe-layer.tsx, which
// picks the gesture up from the shared store below. The button only starts it,
// so there is exactly one drag implementation no matter where it began.

import { useDocStore } from '@/lib/store/document'
import { probeLinks, probeOrigin, probesFor } from '@/lib/scene/probes'
import { beginProbeDrag } from '@/lib/scene/probe-drag'
import type { SceneObject } from '@/lib/scene/types'

/** Circular probe handles for `object`, one per spec (graph: 1, truth table:
 *  in + out). Renders nothing for kinds that have no probes. */
export function ProbeButtons({ pageId, object }: { pageId: string; object: SceneObject }) {
  const specs = probesFor(object)
  const select = useDocStore((s) => s.setSelection)
  if (specs.length === 0) return null

  return (
    <>
      {specs.map((spec, i) => {
        const bound = probeLinks(object, spec).length
        return (
          <button
            key={spec.param}
            type="button"
            aria-label={`${spec.label} probe — drag onto a component to connect${
              bound ? ` (${bound} connected)` : ''
            }`}
            title={`${spec.label}: drag onto a component to connect`}
            // touch-none so a touch drag isn't claimed as a page scroll.
            className="flex h-4 w-4 shrink-0 cursor-crosshair touch-none items-center justify-center rounded-full border transition-colors"
            style={{
              borderColor: spec.color,
              background: bound ? spec.color : 'transparent',
            }}
            onPointerDown={(e) => {
              // Never let the canvas read this as "drag the component".
              e.stopPropagation()
              e.preventDefault()
              // The arrow has to start somewhere on the canvas, not at the
              // pointer — probeOrigin is the same anchor the layer draws from.
              select([object.id])
              beginProbeDrag({
                pageId,
                objectId: object.id,
                param: spec.param,
                from: probeOrigin(object, i, specs.length),
              })
            }}
          >
            <span
              className="block h-1.5 w-1.5 rounded-full"
              style={{ background: bound ? 'var(--card)' : spec.color }}
            />
          </button>
        )
      })}
    </>
  )
}
