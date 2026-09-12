'use client'

// A lesson's live objects, rendered INTO the prose.
//
// Two decisions, both learned the hard way:
//
// 1. NO CANVAS. A canvas is a viewport onto unbounded space, so it has no
//    intrinsic size — a figure inside one cannot tell the document how tall it
//    is, and the author has to guess a box. Guess high and a 200px table floats
//    in dead grid; guess low and a chart is clipped. Objects are therefore
//    rendered directly through the same registry the canvas uses
//    (components/objects/index.tsx), at the size their script gave them, so the
//    layout gets a real height to work with.
//
// 2. NO READ-ONLY MODE. An earlier pass hid the components' own chrome — table
//    headers, row numbers, the chart's legend — on the theory that a reader
//    only wants the data. That was wrong twice over: it removed information the
//    reader needs, and it disabled the controls, which is the opposite of the
//    point. A slider you cannot drag and a table whose headers are hidden teach
//    less than a picture would. Components here behave EXACTLY as they do on a
//    canvas: same affordances, same interactivity, same everything.
//
// And no frame. A component is not an illustration dropped beside the text —
// it is part of the text, the way an equation is. The caption is a line of
// prose above it, not a card around it.

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { openProperties } from '@/lib/store/sidebar-sections'
import { dblClickIntent } from '@/lib/scene/dblclick-policy'
import { executeSimScript } from '@/lib/scene/simscript'
import {
  play,
  pause,
  stop,
  registerElement,
  unregisterElement,
  useRuntimeStore,
} from '@/lib/physics/world'
import { OBJECT_RENDERERS } from '@/components/objects'
import type { SceneObject } from '@/lib/scene/types'
import type { CourseFigure } from '@/lib/store/course'
import { cn } from '@/lib/utils'
import { Lock, Pause, Play, RotateCcw } from 'lucide-react'

/** A short, stable key for a script's text. Only used to notice that a figure
 *  was edited — collisions would merely skip one rebuild, never corrupt
 *  anything — so a 32-bit rolling hash is plenty and costs nothing per render. */
function hashScript(src: string): string {
  let h = 2166136261
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

/** Figures already built this session, by scratch-page id. Cleared when the
 *  lesson unmounts and drops those pages (course-view.tsx). */
const BUILT = new Set<string>()

/** A `system` is a run boundary for the solver — it scopes what Play steps —
 *  and to a reader it is just a dashed box drawn around the drawing. It stays
 *  in the scene (the physics needs it); it is simply not drawn. */
function isStructural(o: SceneObject): boolean {
  return o.geometry.kind === 'rect' && String(o.metadata?.render ?? '') === 'system'
}

/** Behaviors the runtime actually STEPS. A figure that has none of them —
 *  a table, a chart, a block diagram — is a picture, and offering it a
 *  Simulate button would be a lie: Play would advance a clock and change
 *  nothing on screen. */
const RUNNABLE_BEHAVIORS = new Set([
  'rigidBody',
  'spring',
  'rope',
  'rod',
  'damper',
  'hinge',
  'motor',
  'force',
  'electricalNode',
  'charge',
  'efield',
  'bfield',
  'dielectric',
  'torsionSpring',
  'heatSource',
])

function isSimulatable(objects: SceneObject[]): boolean {
  return objects.some((o) =>
    (o.behaviors ?? []).some((b) => b.enabled && RUNNABLE_BEHAVIORS.has(b.type))
  )
}

/** Everything a reader should see, in the order the author created it. `z` is
 *  the creation counter, so sorting by it preserves script order. */
function readableObjects(objects: Record<string, SceneObject>): SceneObject[] {
  return Object.values(objects)
    .filter((o) => !isStructural(o))
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
}

/** Objects whose meaning comes from their relative positions — a bob on a rod,
 *  a wired circuit — are drawn together as one picture. Everything else is a
 *  self-contained component and stands on its own line. */
const SPATIAL_KINDS = new Set(['circle', 'rect', 'polygon', 'symbol', 'line', 'stroke'])
const isSpatial = (o: SceneObject) => SPATIAL_KINDS.has(o.geometry.kind)

/** One component, at its authored size, with everything it normally has.
 *
 *  Double-click follows the SAME declared policy as the canvas
 *  (lib/scene/dblclick-policy.ts), so a chart opens Properties here exactly as
 *  it does on a board, and an 'edit' kind (text, formula) still handles the
 *  gesture itself. Properties reads the global selection, so the object is
 *  selected first and the sidebar is pointed at this figure's scratch page —
 *  the same redirection a doc does for its focused sheet (sidebar.tsx). */
function InlineObject({ object, pageId }: { object: SceneObject; pageId: string }) {
  const Renderer = OBJECT_RENDERERS[object.geometry.kind]
  if (!Renderer) return null

  const onDoubleClick = () => {
    if (dblClickIntent(object.geometry.kind) === 'edit') return // the component's own gesture
    useDocStore.getState().setSelection([object.id])
    useWorkspaceStore.setState({ activeSheetId: pageId })
    openProperties()
  }

  return (
    // Registered with the physics runtime exactly as the canvas registers its
    // object wrappers (canvas.tsx). This is not optional decoration: a run
    // writes results straight to the DOM — body transforms, meter readouts,
    // wire current flow — and an unregistered element simply never receives
    // them. Before this, a figure's ammeter stayed blank however long you
    // played it, because the runtime had no element to write into.
    <div
      ref={(el) => {
        registerElement(object.id, el)
        return () => {
          if (el) unregisterElement(object.id, el)
        }
      }}
      data-object-id={object.id}
      className="max-w-full"
      style={{ width: object.size.w || undefined, height: object.size.h || undefined }}
      onDoubleClick={onDoubleClick}
    >
      <Renderer pageId={pageId} object={object} />
    </div>
  )
}

/** Per-figure transport.
 *
 *  A lesson is not a canvas: there is no single page being edited, so there is
 *  nothing for the app's one transport pill to point at. Every figure is its
 *  own scratch page, so every figure carries its own Simulate button and runs
 *  its own scene.
 *
 *  There is ONE world (lib/physics/world.ts), so starting a figure stops
 *  whichever was running — deliberately. Two circuits stepping at once would
 *  compete for the same solver, and a reader comparing them would be reading
 *  two runs at different times. Starting one resets the other to its drawn
 *  state, which is exactly what a reader expects from a figure they walked
 *  away from. */
function FigureTransport({ scratchId }: { scratchId: string }) {
  const mode = useRuntimeStore((s) => s.mode)
  const runPage = useRuntimeStore((s) => s.pageId)
  const time = useRuntimeStore((s) => s.time)

  const mine = runPage === scratchId && mode !== 'edit'
  const running = mine && mode === 'running'

  return (
    <div className="mb-2.5 flex items-center gap-1.5">
      <button
        type="button"
        aria-label={running ? 'Pause this figure' : 'Simulate this figure'}
        onClick={() => (running ? pause() : play(scratchId))}
        className={cn(
          'flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-ui-2xs font-semibold transition-colors',
          running
            ? 'border-transparent bg-[var(--accent-mint)] text-white'
            : 'border-[var(--accent-mint)]/40 text-[var(--accent-mint)] hover:bg-[var(--accent-mint)]/10'
        )}
      >
        {running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        {running ? 'Pause' : mine ? 'Resume' : 'Simulate'}
      </button>
      <button
        type="button"
        aria-label="Reset this figure"
        disabled={!mine}
        onClick={stop}
        className="flex items-center justify-center rounded-xl border border-border px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
      >
        <RotateCcw className="h-3 w-3" />
      </button>
      {mine && (
        <span className="font-mono text-ui-2xs tabular-nums text-[var(--accent-mint)]">
          {time.toFixed(2)}s
        </span>
      )}
    </div>
  )
}

/** A spatial picture: objects keep their relative positions, scaled DOWN to fit
 *  a narrow column but never up past the size the author drew.
 *
 *  The scale is MEASURED. It used to be CSS-only — `scale: calc(100cqw / 900)`
 *  on a container-query box — which looks right and does nothing: `100cqw` is
 *  a length, dividing it by a number leaves a length, and `scale` takes a
 *  number, so the browser dropped the declaration and every figure rendered at
 *  full size. Circuits hid it (they are drawn about a column wide already);
 *  the first wide block diagram ran straight off the page and over the
 *  paragraph beside it. CSS cannot express "length ÷ length", so this is one
 *  ResizeObserver. */
function SpatialBlock({ objects, pageId }: { objects: SceneObject[]; pageId: string }) {
  const box = useMemo(() => {
    const xs = objects.flatMap((o) => [o.position.x, o.position.x + o.size.w])
    const ys = objects.flatMap((o) => [o.position.y, o.position.y + o.size.h])
    const pad = 16
    return {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      w: Math.max(...xs) - Math.min(...xs) + pad * 2,
      h: Math.max(...ys) - Math.min(...ys) + pad * 2,
    }
  }, [objects])

  const hostRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const fit = () => {
      const w = el.clientWidth
      // Never up: a two-object figure blown up to the column width would be
      // a different drawing from the one the author sized.
      if (w > 0) setScale(Math.min(1, w / box.w))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [box.w])

  if (!objects.length) return null

  return (
    <div ref={hostRef} className="w-full" style={{ maxWidth: box.w }}>
      <div className="relative w-full" style={{ height: box.h * scale }}>
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: box.w, height: box.h, scale: String(scale) }}
        >
          {objects.map((o) => (
            <div
              key={o.id}
              className="absolute"
              style={{
                left: o.position.x - box.x,
                top: o.position.y - box.y,
                width: o.size.w || undefined,
                height: o.size.h || undefined,
                transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined,
              }}
            >
              <InlineObject object={o} pageId={pageId} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export const CourseFigureBlock = memo(function CourseFigureBlock({
  fig,
  pageId,
  locked,
}: {
  fig: CourseFigure
  pageId: string
  locked: boolean
}) {
  const scratchId = `${pageId}::fig::${fig.id}`
  const [ready, setReady] = useState(false)

  // The guard is keyed by the SCRIPT, not just the page: editing a figure
  // (course-editor.tsx) has to rebuild it, and an id-only key would show the
  // old drawing until the lesson was closed and reopened. Same script, same
  // key — so the duplicate-build protection this guard exists for still holds.
  const buildKey = `${scratchId}::${hashScript(fig.script)}`

  useEffect(() => {
    if (locked) return
    // Module-level guard: ensurePage/executeSimScript commit asynchronously, so
    // two effects in the same tick (StrictMode's double-invoke, two mounts of
    // one figure) both saw an empty page and both built it — the figure came
    // out duplicated, once per run.
    if (!BUILT.has(buildKey)) {
      BUILT.add(buildKey)
      useDocStore.getState().ensurePage(scratchId)
      // Build into a CLEAN page rather than skipping a populated one: "has
      // objects" is not "was built by this script", and a hot reload or a
      // resumed session leaves the previous run behind. The script is the
      // source of truth.
      useDocStore.setState((s) => ({
        pages: { ...s.pages, [scratchId]: { objects: {}, variables: [] } },
      }))
      try {
        executeSimScript(scratchId, fig.script, { x: 0, y: 0 })
      } catch {
        // A figure that fails to build shows its caption rather than taking the
        // lesson down. Authoring catches these — every script is linted before
        // it ships (.claude/skills/course-author).
        BUILT.delete(buildKey)
      }
    }
    setReady(true)
  }, [scratchId, fig.script, locked])

  const objects = useDocStore((s) => s.pages[scratchId]?.objects)
  const visible = useMemo(() => (objects ? readableObjects(objects) : []), [objects])
  // The `system` boundary is filtered out of `visible`, and it is exactly the
  // object a mechanics figure hangs its behaviors on — so ask the whole page,
  // not the drawable subset, whether there is anything to step.
  const runnable = useMemo(
    () => (objects ? isSimulatable(Object.values(objects)) : false),
    [objects]
  )

  // A figure left running when its page goes away would step a scene that no
  // longer exists. Scrolling a lesson unmounts nothing (the whole document is
  // mounted), so in practice this fires when the lesson closes — the same
  // moment CourseView deletes these scratch pages.
  useEffect(() => {
    return () => {
      if (useRuntimeStore.getState().pageId === scratchId) stop()
    }
  }, [scratchId])

  /** Consecutive spatial objects are one picture; components stand alone. */
  const blocks = useMemo(() => {
    const out: { spatial: boolean; items: SceneObject[] }[] = []
    for (const o of visible) {
      const spatial = isSpatial(o)
      const last = out[out.length - 1]
      if (last && last.spatial && spatial) last.items.push(o)
      else out.push({ spatial, items: [o] })
    }
    return out
  }, [visible])

  // A drawing wider than a shared column gets the whole row (course-view.tsx
  // reads this with :has). Measured from the objects themselves rather than
  // declared by the author: the layout engine decides how wide a diagram is,
  // and asking an author to predict that is asking them to get it wrong.
  const wide = useMemo(() => {
    const xs = visible.filter((o) => isSpatial(o)).flatMap((o) => [o.position.x, o.position.x + o.size.w])
    return xs.length ? Math.max(...xs) - Math.min(...xs) > 620 : false
  }, [visible])

  return (
    // No card, no border: the caption is a line of prose and the components sit
    // in the text, the way a displayed equation does.
    <div className="my-6" {...(wide ? { 'data-wide': '' } : {})}>
      <p className="m-0 mb-2 text-ui-xs font-semibold text-muted-foreground">{fig.caption}</p>

      {locked ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-muted/60 px-4 py-3">
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="m-0 text-ui-xs leading-relaxed text-muted-foreground">
            Answer the question above first — a prediction is worth nothing once you can see it.
          </p>
        </div>
      ) : ready && blocks.length === 0 ? (
        <p className="m-0 text-ui-xs text-muted-foreground">This figure built nothing.</p>
      ) : (
        <div className="flex flex-col items-start gap-4">
          {runnable && <FigureTransport scratchId={scratchId} />}
          {blocks.map((b, i) =>
            b.spatial ? (
              <SpatialBlock key={i} objects={b.items} pageId={scratchId} />
            ) : (
              b.items.map((o) => <InlineObject key={o.id} object={o} pageId={scratchId} />)
            )
          )}
        </div>
      )}

      {fig.note && (
        <p className="m-0 mt-2 text-ui-xs leading-relaxed text-muted-foreground">{fig.note}</p>
      )}
    </div>
  )
})

/** Drop the build guard for a lesson's figures, so reopening it rebuilds them.
 *  Called by CourseView's teardown alongside deleting the scratch pages — the
 *  two must always happen together. */
export function forgetBuiltFigures(prefix: string): void {
  for (const id of BUILT) if (id.startsWith(prefix)) BUILT.delete(id)
}
