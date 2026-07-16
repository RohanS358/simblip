'use client'

// Excel-style table object. Each column has a header that is either a bare
// name ("x") or a formula ("z=x+y"); formula columns are evaluated against
// the same scope the page's variables use, in declaration order so a column
// can reference one declared to its left (k=z^2, after z=x+y, works).
//
// The last row is reserved for a column-level summary (Sum / Avg / Min / Max
// / Count / Stddev / Stderr / First / Last / Range) chosen from a dropdown.
//
// Data rows live in `parameters.data` as ;-separated rows of ;-separated
// cells; the first column auto-numbers ("SN") so a freshly-dropped table is
// already usable.

import { useMemo } from 'react'
import { Plus, TableProperties, X } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { evalExpr, type Scope } from '@/lib/formula/engine'
import { fmtNum } from '@/lib/scene/format'
import { getString, type ObjectRendererProps } from './types'

type Col = { name: string; expr: string | null } // expr = null for plain data
type Summary = 'Sum' | 'Avg' | 'Min' | 'Max' | 'Count' | 'Stddev' | 'Stderr' | 'First' | 'Last' | 'Range' | 'None'

const SUMMARY_OPTIONS: Summary[] = [
  'Sum',
  'Avg',
  'Min',
  'Max',
  'Count',
  'Stddev',
  'Stderr',
  'First',
  'Last',
  'Range',
  'None',
]

const splitList = (s: string) =>
  s
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)

/** Header list → columns. "z=x+y" → {name:'z', expr:'x+y'}; "x" → {name:'x', expr:''}. */
function parseHeaders(s: string): Col[] {
  return splitList(s).map((h) => {
    const i = h.indexOf('=')
    if (i <= 0) return { name: h, expr: null }
    return { name: h.slice(0, i).trim(), expr: h.slice(i + 1).trim() }
  })
}

/** Reverse of parseHeaders; used when the user renames or types a formula. */
function serializeHeaders(cols: Col[]): string {
  return cols.map((c) => (c.expr !== null ? `${c.name}=${c.expr}` : c.name)).join(';')
}

function parseData(s: string, cols: number): string[][] {
  if (!s.trim()) return []
  return s.split('\n').map((row) => {
    const cells = row.split(';').map((c) => c.trim())
    // Pad/trim to column count so a half-typed row still renders in the grid.
    if (cells.length >= cols) return cells.slice(0, cols)
    return [...cells, ...Array(cols - cells.length).fill('')]
  })
}

function serializeData(rows: string[][]): string {
  return rows.map((r) => r.map((c) => c.replace(/;/g, ',').replace(/\n/g, ' ')).join(';')).join('\n')
}

export function TableObject({ pageId, object, selected }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const scope: Scope = useDocStore((s) => s.scopes[pageId]) ?? {}

  const headerStr = getString(object, 'headers', 'SN;x;y;z=x+y')
  const dataStr = getString(object, 'data', '')
  const summary = (getString(object, 'summary', 'Sum') as Summary) || 'Sum'

  const cols = useMemo(() => parseHeaders(headerStr), [headerStr])
  const data = useMemo(() => parseData(dataStr, cols.length), [dataStr, cols.length])

  // Always at least 3 data rows, even when blank — so a freshly placed table
  // already has a working grid. The user can add more with +.
  const visibleRows = data.length < 3 ? Array.from({ length: 3 }, () => Array(cols.length).fill('')) : data

  // Evaluate every formula column in left-to-right order so a column can
  // reference another column to its left. Row-by-row so a row's "z" sees
  // its OWN "x" and "y", not a different row's.
  const computed: { row: number; col: number; value: number; error?: string }[][] = useMemo(() => {
    return visibleRows.map((row, r) =>
      cols.map((c, ci) => {
        if (c.expr === null) {
          const n = Number(row[ci])
          return [{ row: r, col: ci, value: Number.isFinite(n) ? n : NaN }]
        }
        // Build the per-row scope: every prior formula column's value
        // is exposed under its own name, so k=z^2 sees z computed
        // for THIS row.
        const rowScope: Scope = { ...scope }
        for (let k = 0; k < ci; k++) {
          const prev = cols[k]
          if (prev.expr !== null) {
            const { value, error } = evalExpr(prev.expr, { ...scope, ...rowScope }, NaN)
            if (error) {
              return [{ row: r, col: ci, value: NaN, error }]
            }
            rowScope[prev.name] = value
          } else {
            const n = Number(row[k])
            rowScope[prev.name] = Number.isFinite(n) ? n : NaN
          }
        }
        const { value, error } = evalExpr(c.expr, { ...scope, ...rowScope }, NaN)
        return [{ row: r, col: ci, value, error }]
      })
    )
  }, [visibleRows, cols, scope])

  const computedMap = useMemo(() => {
    const m: Record<string, { value: number; error?: string }> = {}
    for (const row of computed) for (const cell of row) m[`${cell.row}:${cell.col}`] = cell
    return m
  }, [computed])

  // Per-column values for the summary row. Only formula columns and numeric
  // data columns contribute — non-numeric data is ignored by Sum/Avg/Min/Max.
  const colValues = useMemo(
    () =>
      cols.map((_, ci) => {
        const vals: number[] = []
        for (let r = 0; r < visibleRows.length; r++) {
          const v = computedMap[`${r}:${ci}`]?.value
          if (Number.isFinite(v)) vals.push(v)
        }
        return vals
      }),
    [cols, visibleRows, computedMap]
  )

  const summaryVal = (vals: number[]): number | null => {
    if (vals.length === 0) return null
    switch (summary) {
      case 'Sum':
        return vals.reduce((a, b) => a + b, 0)
      case 'Avg':
        return vals.reduce((a, b) => a + b, 0) / vals.length
      case 'Min':
        return Math.min(...vals)
      case 'Max':
        return Math.max(...vals)
      case 'Count':
        return vals.length
      case 'Range':
        return Math.max(...vals) - Math.min(...vals)
      case 'First':
        return vals[0]
      case 'Last':
        return vals[vals.length - 1]
      case 'Stddev': {
        const m = vals.reduce((a, b) => a + b, 0) / vals.length
        const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length
        return Math.sqrt(v)
      }
      case 'Stderr': {
        if (vals.length < 2) return NaN
        const m = vals.reduce((a, b) => a + b, 0) / vals.length
        const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1)
        return Math.sqrt(v / vals.length)
      }
      default:
        return null
    }
  }

  const writeHeaders = (next: Col[]) => setStringParam(pageId, object.id, 'headers', serializeHeaders(next))
  const writeData = (next: string[][]) => setStringParam(pageId, object.id, 'data', serializeData(next))

  const addColumn = () => {
    const next: Col[] = [...cols, { name: `c${cols.length + 1}`, expr: null }]
    writeHeaders(next)
    writeData(visibleRows.map((r) => [...r, '']))
  }
  const removeColumn = (idx: number) => {
    if (cols.length <= 1) return
    const next: Col[] = cols.filter((_, i) => i !== idx)
    writeHeaders(next)
    writeData(visibleRows.map((r) => r.filter((_, i) => i !== idx)))
  }
  const addRow = () => {
    const next = [...visibleRows, Array(cols.length).fill('')]
    writeData(next)
  }
  const removeRow = (idx: number) => {
    if (visibleRows.length <= 1) return
    const next = visibleRows.filter((_, i) => i !== idx)
    writeData(next)
  }

  const updateCell = (r: number, c: number, val: string) => {
    const next = visibleRows.map((row, i) => (i === r ? row.map((cv, j) => (j === c ? val : cv)) : row))
    writeData(next)
  }

  const updateHeader = (c: number, raw: string) => {
    const next = cols.map((col, i) => {
      if (i !== c) return col
      // Split into name=expr on the first `=`; keep both sides trimmed.
      const i2 = raw.indexOf('=')
      if (i2 <= 0) return { name: raw.trim() || col.name, expr: null }
      return { name: raw.slice(0, i2).trim() || col.name, expr: raw.slice(i2 + 1).trimStart() }
    })
    writeHeaders(next)
  }

  const onSummary = (s: Summary) => setStringParam(pageId, object.id, 'summary', s)

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card/70 hairline"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <TableProperties className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold tracking-wide text-muted-foreground">
          {object.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {cols.length} cols · {visibleRows.length} rows
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <th className="w-7 border-b border-r border-border px-1 py-1 text-center text-[10px] font-semibold text-muted-foreground">
                #
              </th>
              {cols.map((c, i) => (
                <th
                  key={i}
                  className="min-w-[64px] border-b border-r border-border px-1 py-1 text-left text-[10.5px] font-semibold"
                >
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      spellCheck={false}
                      value={c.expr !== null ? `${c.name}=${c.expr}` : c.name}
                      onChange={(e) => updateHeader(i, e.target.value)}
                      aria-label={`Column ${i + 1} header`}
                      className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60"
                      placeholder="name=expr"
                      style={c.expr !== null ? { color: 'var(--accent-mint)' } : undefined}
                    />
                    {cols.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove column ${c.name}`}
                        onClick={() => removeColumn(i)}
                        className="rounded p-0.5 text-muted-foreground opacity-50 transition-opacity hover:text-[var(--accent-rose)] hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-7 border-b border-border p-0">
                <button
                  type="button"
                  aria-label="Add column"
                  onClick={addColumn}
                  className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, r) => (
              <tr key={r} className={r % 2 ? 'bg-accent/25' : undefined}>
                <td className="border-r border-border/60 px-1 py-0.5 text-center text-[10px] text-muted-foreground tabular-nums">
                  {r + 1}
                </td>
                {row.map((cell, c) => {
                  const meta = computedMap[`${r}:${c}`]
                  const isFormula = cols[c]?.expr !== null
                  return (
                    <td key={c} className="border-r border-border/40 p-0">
                      {isFormula ? (
                        <div
                          className="px-1.5 py-0.5 text-right tabular-nums"
                          style={{
                            color: meta?.error ? 'var(--accent-rose)' : 'var(--accent-mint)',
                          }}
                          title={meta?.error ?? `${cols[c].name} = ${cols[c].expr}`}
                        >
                          {meta?.error ? '!' : fmtNum(meta?.value)}
                        </div>
                      ) : (
                        <input
                          type="text"
                          inputMode="decimal"
                          spellCheck={false}
                          value={cell}
                          onChange={(e) => updateCell(r, c, e.target.value)}
                          aria-label={`Row ${r + 1} column ${cols[c]?.name ?? c + 1}`}
                          className="w-full bg-transparent px-1.5 py-0.5 text-right text-foreground outline-none tabular-nums"
                          placeholder="0"
                        />
                      )}
                    </td>
                  )
                })}
                <td className="p-0">
                  <button
                    type="button"
                    aria-label={`Remove row ${r + 1}`}
                    onClick={() => removeRow(r)}
                    disabled={visibleRows.length <= 1}
                    className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-[var(--accent-rose)] disabled:opacity-30"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border/80 bg-accent/35">
              <td className="border-r border-border/60 px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <select
                  aria-label="Summary function"
                  value={SUMMARY_OPTIONS.includes(summary) ? summary : 'Sum'}
                  onChange={(e) => onSummary(e.target.value as Summary)}
                  className="rounded border border-border bg-card px-1 py-0.5 text-[10px] font-semibold uppercase text-foreground outline-none"
                >
                  {SUMMARY_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              {cols.map((c, i) => {
                const v = summaryVal(colValues[i])
                const isFormula = !!c.expr
                return (
                  <td
                    key={i}
                    className="border-r border-border/40 px-1.5 py-1 text-right text-[11px] font-bold tabular-nums"
                    style={{
                      color:
                        v === null
                          ? 'var(--muted-foreground)'
                          : isFormula
                            ? 'var(--accent-mint)'
                            : 'var(--foreground)',
                    }}
                  >
                    {v === null ? '—' : fmtNum(v)}
                  </td>
                )
              })}
              <td className="p-0">
                <button
                  type="button"
                  aria-label="Add row"
                  onClick={addRow}
                  className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {selected && (
        <p className="border-t border-border/60 py-1 text-center text-[10.5px] text-muted-foreground">
          Headers: <span className="font-mono">name</span> or <span className="font-mono">name=expr</span> ·
          references earlier columns
        </p>
      )}
    </div>
  )
}
