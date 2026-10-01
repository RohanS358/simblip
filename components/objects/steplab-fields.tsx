'use client'

// The editing surface of a Step Lab, shared by the card's own settings drawer
// and the Inspector, so the two can never disagree about what a topic takes:
// the topic picker, one field per engine parameter (with its hint), and the
// engine's named results.

import type { SceneObject } from '@/lib/scene/types'
import { getEngine, enginesOfPackage, packageOfEngine } from '@/lib/steplab/registry'
import type { EngineDef, Params } from '@/lib/steplab/types'
import { QUICK } from '@/lib/steplab/quick'

export function labParams(object: SceneObject): Params {
  const out: Params = {}
  for (const [k, v] of Object.entries(object.parameters)) if (v.kind === 'string') out[k] = v.value
  return out
}

export function labEngine(params: Params): EngineDef | undefined {
  return getEngine(params.engine || 'sched')
}

const inputCls = 'min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 font-mono text-[11px]'

/** Switch topic WITHIN the card's own subject package — never across packages. A
 *  card made from "CPU scheduling" can become "Page replacement" (same package,
 *  Operating Systems) but not "Bayes' theorem"; that is another package's component. */
export function EnginePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const current = getEngine(value)
  const siblings = current ? enginesOfPackage(packageOfEngine(current)) : []
  if (siblings.length <= 1) return null
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-20 shrink-0 text-muted-foreground">Topic</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Topic" className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 text-[11.5px]">
        {siblings.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
      </select>
    </label>
  )
}

export function ParamFields({ engine, params, onEdit, onFocus }: { engine: EngineDef; params: Params; onEdit: (name: string, value: string) => void; onFocus: () => void }) {
  return (
    <>
      {engine.params.map((d) => {
        const value = params[d.name] ?? d.def
        const common = { 'aria-label': d.label, title: d.hint, value, onFocus, onChange: (e: { target: { value: string } }) => onEdit(d.name, e.target.value), className: inputCls }
        return (
          <label key={d.name} className="block text-[11px]">
            <span className="flex items-start gap-2">
              <span className="w-20 shrink-0 pt-1 text-muted-foreground">{d.label}</span>
              {d.options ? <select {...common}>{d.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                : d.long ? <textarea {...common} rows={d.def.includes('\n') ? 5 : 2} />
                : <input {...common} />}
            </span>
            {d.hint && <span className="ml-[88px] mt-0.5 block text-[10px] leading-snug text-muted-foreground/80">{d.hint}</span>}
          </label>
        )
      })}
    </>
  )
}

/** The engine's named results — the numbers a lesson quotes. */
export function ResultChips({ summary }: { summary: Record<string, string> }) {
  const entries = Object.entries(summary).filter(([, v]) => v !== '')
  if (!entries.length) return null
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate text-[var(--accent-amber)]" title={v}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The card's on-face controls (lib/steplab/quick.ts): dropdowns, sliders and
 *  small text boxes for the few inputs worth changing while watching. */
export function QuickControls({ engine, params, onEdit, onFocus, onWrite }: { engine: EngineDef; params: Params; onEdit: (name: string, value: string) => void; onFocus: () => void; onWrite: (name: string) => void }) {
  const specs = QUICK[engine.id] ?? []
  if (!specs.length) return null
  const base = 'rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px]'
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-1.5" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {specs.map((spec) => {
        const [name, min, max, step] = Array.isArray(spec) ? spec : [spec]
        const d = engine.params.find((x) => x.name === name)
        if (!d) return null
        const value = params[name] ?? d.def
        const common = { 'aria-label': d.label, title: d.hint, onFocus }
        // Programs, tables and specs are written in place on the picture, not in a tiny box.
        if (d.long) return <button key={name} type="button" title={d.hint} onClick={() => onWrite(name)} className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-foreground hover:bg-accent">✎ {d.label}</button>
        return (
          <label key={name} className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span className="shrink-0">{d.label}</span>
            {d.options ? (
              <select {...common} value={value} onChange={(e) => onEdit(name, e.target.value)} className={base}>{d.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            ) : min !== undefined ? (
              <>
                <input {...common} type="range" min={min} max={max} step={step} value={Number(value)} onChange={(e) => onEdit(name, e.target.value)} className="h-1 w-20 accent-[var(--accent-blue)]" />
                <span className="w-9 font-mono text-[10.5px] tabular-nums text-foreground">{value}</span>
              </>
            ) : (
              <input {...common} value={value} onChange={(e) => onEdit(name, e.target.value)} size={Math.min(26, Math.max(6, value.length + 1))} className={`${base} font-mono`} />
            )}
          </label>
        )
      })}
    </div>
  )
}
