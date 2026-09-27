// Table object data model, shared by the Table renderer and anything that
// reads a table (a Graph plotting it). Headers are "name" (data) or
// "name=expr" (formula, evaluated left→right per row against the page scope).

import { evalExpr, type Scope } from '@/lib/formula/engine'

export type Col = { name: string; expr: string | null } // expr = null for plain data
export type Cell = { value: number; error?: string }

const splitList = (s: string) =>
  s
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)

/** Header list → columns. "z=x+y" → {name:'z', expr:'x+y'}; "x" → {name:'x', expr:null}. */
export function parseHeaders(s: string): Col[] {
  return splitList(s).map((h) => {
    const i = h.indexOf('=')
    if (i <= 0) return { name: h, expr: null }
    return { name: h.slice(0, i).trim(), expr: h.slice(i + 1).trim() }
  })
}

export function serializeHeaders(cols: Col[]): string {
  return cols.map((c) => (c.expr !== null ? `${c.name}=${c.expr}` : c.name)).join(';')
}

export function parseData(s: string, cols: number): string[][] {
  if (!s.trim()) return []
  return s.split('\n').map((row) => {
    const cells = row.split(';').map((c) => c.trim())
    // Pad/trim to column count so a half-typed row still renders in the grid.
    if (cells.length >= cols) return cells.slice(0, cols)
    return [...cells, ...Array(cols - cells.length).fill('')]
  })
}

export function serializeData(rows: string[][]): string {
  return rows.map((r) => r.map((c) => c.replace(/;/g, ',').replace(/\n/g, ' ')).join(';')).join('\n')
}

/** Evaluate every cell. One left-to-right pass per row: every DATA column is
 *  in scope from the start (a formula may read a measured column to its
 *  right); formula columns join the scope as they're computed, so k=z^2
 *  after z=x+y sees THIS row's z. */
export function evalTable(cols: Col[], rows: string[][], scope: Scope): Cell[][] {
  return rows.map((row) => {
    const rowScope: Scope = { ...scope }
    cols.forEach((c, ci) => {
      if (c.expr === null) {
        const n = Number(row[ci])
        rowScope[c.name] = Number.isFinite(n) && (row[ci] ?? '').trim() !== '' ? n : NaN
      }
    })
    return cols.map((c) => {
      if (c.expr === null) return { value: rowScope[c.name] as number }
      const { value, error } = evalExpr(c.expr, rowScope, NaN)
      rowScope[c.name] = error ? NaN : value
      return { value, error }
    })
  })
}
