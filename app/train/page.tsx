'use client'

// /train — open recognizer training. Anyone can teach the pen+hold pipeline
// what hand-drawn components look like: draw a symbol, label it with the
// component it should become, save. Each saved example becomes a $P point-
// cloud template (lib/sketch/custom.ts); with enough labelled examples the
// pen+hold feature can rebuild a whole sketched diagram — every symbol it
// recognizes spawns the real component, and the wires between them already
// connect via node snapping. Templates live in this browser's localStorage.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Eraser, GraduationCap, Trash2 } from 'lucide-react'
import { COMPONENTS } from '@/lib/scene/factory'
import {
  addCustomTemplate,
  listCustomTemplates,
  matchCustomSketch,
  removeCustomTemplate,
  syncCustomTemplates,
  type CustomSketchTemplate,
} from '@/lib/sketch/custom'
import { Button } from '@/components/ui/button'

export default function TrainPage() {
  const svgRef = useRef<SVGSVGElement | null>(null)
  // Multi-stroke drawing: each pen-down starts another stroke; the symbol is
  // the combined cloud of all of them (battery bars, capacitor plates…).
  const [strokes, setStrokes] = useState<number[][][]>([])
  const drawing = useRef(false)
  const [componentId, setComponentId] = useState(COMPONENTS[0]?.id ?? '')
  const [templates, setTemplates] = useState<CustomSketchTemplate[]>([])
  const [flash, setFlash] = useState('')

  useEffect(() => {
    void syncCustomTemplates().then(() => setTemplates(listCustomTemplates()))
  }, [])

  const points = useMemo(() => strokes.flat(), [strokes])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of templates) c[t.componentId] = (c[t.componentId] ?? 0) + 1
    return c
  }, [templates])

  // Live feedback: what would the recognizer say about the current stroke?
  const match = useMemo(
    () => (points.length > 15 ? matchCustomSketch(strokes) : null),
    [points, strokes]
  )

  const toLocal = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  const save = () => {
    const def = COMPONENTS.find((c) => c.id === componentId)
    if (!def || points.length < 15) return
    addCustomTemplate(def.label, def.id, strokes)
    setTemplates(listCustomTemplates())
    setStrokes([])
    setFlash(`Saved as “${def.label}” — ${(counts[def.id] ?? 0) + 1} example(s)`)
    setTimeout(() => setFlash(''), 2500)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
          <GraduationCap className="h-5 w-5 text-[var(--accent-amber)]" /> Train the sketch
          recognizer
        </h1>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Draw a component symbol the way you naturally would — multiple strokes are fine
          (lift the pen between battery bars or capacitor plates; try to keep the same stroke
          order you use on the canvas) — pick which component it means,
          and save it. Every example teaches the <b>pen + hold</b> feature; with a few examples
          per symbol it can turn a whole hand-sketched diagram into live components — the wires
          you draw between them already connect on their own. 3–5 varied examples per symbol
          works best. Examples are saved to the shared training library — your work improves
          recognition for everyone using SIMBLIP (demo mode keeps them in this browser).
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <div className="space-y-2">
          <svg
            ref={svgRef}
            className="h-80 w-full touch-none rounded-2xl border border-border bg-card"
            onPointerDown={(e) => {
              drawing.current = true
              e.currentTarget.setPointerCapture(e.pointerId)
              setStrokes((prev) => [...prev, [toLocal(e)]])
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return
              const p = toLocal(e)
              setStrokes((prev) => {
                const cur = prev[prev.length - 1]
                const last = cur?.[cur.length - 1]
                if (!cur || !last || Math.hypot(p[0] - last[0], p[1] - last[1]) <= 1) return prev
                return [...prev.slice(0, -1), [...cur, p]]
              })
            }}
            onPointerUp={() => (drawing.current = false)}
          >
            {strokes.map(
              (st, i) =>
                st.length > 1 && (
                  <polyline
                    key={i}
                    points={st.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="none"
                    stroke="var(--foreground)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )
            )}
          </svg>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            {match ? (
              <span>
                Recognizer currently reads this as <b>{match.name}</b> (
                {(match.score * 100).toFixed(0)}%)
              </span>
            ) : (
              <span>{points.length > 15 ? 'No template matches this yet.' : 'Draw a symbol above.'}</span>
            )}
            {flash && <span className="ml-auto font-semibold text-[var(--accent-mint)]">{flash}</span>}
          </div>
        </div>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              This drawing is a…
            </span>
            <select
              value={componentId}
              onChange={(e) => setComponentId(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[13px]"
            >
              {COMPONENTS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.domain}){counts[c.id] ? ` — ${counts[c.id]} trained` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={save} disabled={points.length < 15}>
              <Check className="h-4 w-4" /> Save example
            </Button>
            <Button variant="outline" onClick={() => setStrokes([])}>
              <Eraser className="h-4 w-4" /> Clear
            </Button>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Trained examples ({templates.length})
            </p>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 px-2.5 py-1.5 text-[12.5px]"
                >
                  <span className="truncate">{t.name}</span>
                  <button
                    type="button"
                    aria-label={`Delete example for ${t.name}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      removeCustomTemplate(t.id)
                      setTemplates(listCustomTemplates())
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {templates.length === 0 && (
                <p className="text-[12px] text-muted-foreground">Nothing trained yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
