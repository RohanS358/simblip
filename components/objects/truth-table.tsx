'use client'

// Truth table. Pick which of the circuit's inputs and outputs to tabulate;
// every combination is then SIMULATED on the real board (no symbolic logic —
// see lib/circuit/truth-table.ts) and the results laid out as a table.
//
// Styled like the Graph card: hairline frame, muted header, mono cells, and
// the same chart tokens for the 1/0 states.

import { useMemo } from 'react'
import { TableProperties } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import {
  computeTruthTable,
  truthCandidates,
  MAX_INPUTS,
} from '@/lib/circuit/truth-table'
import { getString, type ObjectRendererProps } from './types'

const ONE = 'var(--chart-2)' // high
const ZERO = 'var(--muted-foreground)' // low

const splitList = (s: string) =>
  s
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)

export function TruthTableObject({ pageId, object, selected }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pageObjects = useDocStore((s) => s.pages[pageId]?.objects)

  const inputIds = splitList(getString(object, 'inputs'))
  const outputIds = splitList(getString(object, 'outputs'))

  const objects = useMemo(() => Object.values(pageObjects ?? {}), [pageObjects])
  const { sources, sinks } = useMemo(() => truthCandidates(objects), [objects])

  // Recomputed whenever the circuit or the chosen columns change — the table
  // tracks the board, so rewiring a gate updates it immediately.
  const table = useMemo(
    () => computeTruthTable(objects, inputIds, outputIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objects, inputIds.join(';'), outputIds.join(';')]
  )

  const nothingPicked = inputIds.length === 0 || outputIds.length === 0

  // Quick-pick shown before any column is chosen — so the component is usable
  // the moment it lands, without opening the Inspector.
  const toggle = (param: 'inputs' | 'outputs', id: string) => {
    const cur = splitList(getString(object, param))
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    setStringParam(pageId, object.id, param, next.join('; '))
  }

  const chip = (param: 'inputs' | 'outputs', id: string, name: string, on: boolean) => (
    <button
      key={id}
      type="button"
      aria-pressed={on}
      className="rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] transition-colors"
      style={{
        borderColor: on ? ONE : 'var(--border)',
        color: on ? ONE : 'var(--muted-foreground)',
        background: on ? `color-mix(in oklch, ${ONE} 12%, transparent)` : 'transparent',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => toggle(param, id)}
    >
      {name}
    </button>
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card/70 hairline">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <TableProperties className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold tracking-wide text-muted-foreground">
          {object.name}
        </span>
        {table.rows.length > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {table.rows.length} rows
          </span>
        )}
      </div>

      {nothingPicked ? (
        <div
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {sources.length === 0 && sinks.length === 0 ? (
            <p className="m-auto max-w-56 text-center text-[12px] leading-relaxed text-muted-foreground">
              Build a digital circuit with logic <b>Input</b> (or switch) and{' '}
              <b>Output</b> components — they become this table&apos;s columns.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Inputs
                </p>
                <div className="flex flex-wrap gap-1">
                  {sources.map((o) => chip('inputs', o.id, o.name, inputIds.includes(o.id)))}
                  {sources.length === 0 && (
                    <span className="text-[11px] text-muted-foreground">No inputs on this page.</span>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Outputs
                </p>
                <div className="flex flex-wrap gap-1">
                  {sinks.map((o) => chip('outputs', o.id, o.name, outputIds.includes(o.id)))}
                  {sinks.length === 0 && (
                    <span className="text-[11px] text-muted-foreground">No outputs on this page.</span>
                  )}
                </div>
              </div>
              <p className="mt-auto text-[10.5px] leading-relaxed text-muted-foreground">
                Every combination is simulated on the real circuit. Up to {MAX_INPUTS} inputs.
              </p>
            </>
          )}
        </div>
      ) : table.error ? (
        <p className="m-auto p-4 text-center text-[12px] text-muted-foreground">{table.error}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto" onPointerDown={(e) => e.stopPropagation()}>
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                {table.inputs.map((c, i) => (
                  <th
                    key={c.id}
                    className="border-b border-border px-2 py-1 text-center font-semibold text-muted-foreground"
                    style={{
                      borderRight:
                        i === table.inputs.length - 1 ? '1px solid var(--border)' : undefined,
                    }}
                  >
                    {c.name}
                  </th>
                ))}
                {table.outputs.map((c) => (
                  <th
                    key={c.id}
                    className="border-b border-border px-2 py-1 text-center font-semibold"
                    style={{ color: ONE }}
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r} className={r % 2 ? 'bg-accent/25' : undefined}>
                  {row.ins.map((v, i) => (
                    <td
                      key={i}
                      className="px-2 py-0.5 text-center tabular-nums"
                      style={{
                        color: v ? 'var(--foreground)' : ZERO,
                        borderRight:
                          i === row.ins.length - 1 ? '1px solid var(--border)' : undefined,
                      }}
                    >
                      {v}
                    </td>
                  ))}
                  {row.outs.map((v, i) => (
                    <td
                      key={i}
                      className="px-2 py-0.5 text-center font-bold tabular-nums"
                      style={{ color: v ? ONE : ZERO }}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && !nothingPicked && (
        <p className="border-t border-border/60 py-1 text-center text-[10.5px] text-muted-foreground">
          Columns are set in the Inspector
        </p>
      )}
    </div>
  )
}
