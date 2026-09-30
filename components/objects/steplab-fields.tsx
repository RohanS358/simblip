'use client'

// The editing surface of a Step Lab, shared by the card's own settings drawer
// and the Inspector, so the two can never disagree about what a topic takes:
// the topic picker, one field per engine parameter (with its hint), and the
// engine's named results.

import type { SceneObject } from '@/lib/scene/types'
import { ENGINES, getEngine } from '@/lib/steplab/registry'
import type { EngineDef, Params } from '@/lib/steplab/types'

export function labParams(object: SceneObject): Params {
  const out: Params = {}
  for (const [k, v] of Object.entries(object.parameters)) if (v.kind === 'string') out[k] = v.value
  return out
}

export function labEngine(params: Params): EngineDef | undefined {
  return getEngine(params.engine || 'sched')
}

const inputCls = 'min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 font-mono text-[11px]'

export function EnginePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Topic" className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 text-[11.5px]">
      {[...new Set(ENGINES.map((e) => e.group))].map((g) => (
        <optgroup key={g} label={g}>
          {ENGINES.filter((e) => e.group === g).map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </optgroup>
      ))}
    </select>
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
