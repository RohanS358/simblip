'use client'

// The probe handles that live in a value-consuming component's HEADER.
//
// Press one and drag onto any component to bind it — the arrow, snapping and
// channel chip are all drawn by components/workspace/probe-layer.tsx, which
// picks the gesture up from the shared store below. The button only starts it,
// so there is exactly one drag implementation no matter where it began.

import { useDocStore } from '@/lib/store/document'
import { usePrefs } from '@/lib/store/preferences'
import {
  FLOATING_PROBE_KINDS,
  probeLinks,
  probeOrigin,
  probesFor,
  probeUiScale,
} from '@/lib/scene/probes'
import { beginProbeDrag } from '@/lib/scene/probe-drag'
import type { SceneObject } from '@/lib/scene/types'

/** Circular probe handles for `object`, one per spec (graph: 1, truth table:
 *  in + out). Renders nothing for kinds that have no probes. */
export function ProbeButtons({ pageId, object }: { pageId: string; object: SceneObject }) {
  const specs = probesFor(object)
  const select = useDocStore((s) => s.setSelection)
  const componentScale = usePrefs((s) => s.notebook.componentScale ?? 1)
  if (specs.length === 0) return null
  const uiScale = probeUiScale(object, componentScale)
  // Controls have no header row to sit in — pin the probes to the card's
  // top-left corner, matching FLOAT_INSET in lib/scene/probes.ts so the arrow
  // still starts at the button.
  const floating = FLOATING_PROBE_KINDS.has(object.geometry.kind)

  const dots = (
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
                from: probeOrigin(object, i, specs.length, uiScale),
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

  if (!floating) return dots
  return <div className="absolute left-1 top-1 z-10 flex items-center gap-2">{dots}</div>
}
