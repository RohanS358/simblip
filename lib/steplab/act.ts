// Applying a click to a lab's parameters. Pure: `get` reads a parameter's
// current value (the card passes the object's value, falling back to the
// engine default) and the result is the list of parameter writes to make.

import type { Act, Box, Dom } from './types'

export interface Change { param: string; value: string }

const list = (v: string) => v.split(/[\s,;]+/).filter(Boolean)
const join = (items: string[], like: string) => items.join(/[,;]/.test(like) ? (like.includes(';') ? ';' : ',') : ' ')
const num = (n: number) => String(Math.round(n * 1e6) / 1e6)

/** `edit` needs a text box, so it is the caller's job (returns null). */
export function applyAct(a: Act, get: (param: string) => string): Change[] | null {
  switch (a.do) {
    case 'edit': case 'plot': case 'move': return null
    case 'cycle': {
      const i = a.values.indexOf(get(a.param))
      return [{ param: a.param, value: a.values[(i + 1) % a.values.length] }]
    }
    case 'set': return [{ param: a.param, value: get(a.param) === a.value ? a.off : a.value }]
    case 'step': {
      let v = Number(get(a.param))
      if (!Number.isFinite(v)) v = 0
      v += a.by
      if (a.min !== undefined) v = Math.max(a.min, v)
      if (a.max !== undefined) v = Math.min(a.max, v)
      return [{ param: a.param, value: num(v) }]
    }
    case 'toggle': {
      const first = get(a.param), second = a.also ? get(a.also) : ''
      const inFirst = list(first).includes(a.item), inSecond = list(second).includes(a.item)
      const without = (s: string) => join(list(s).filter((x) => x !== a.item), s)
      const withIt = (s: string) => join([...list(s), a.item].sort((x, y) => Number(x) - Number(y) || x.localeCompare(y)), s)
      if (!a.also) return [{ param: a.param, value: inFirst ? without(first) : withIt(first) }]
      if (!inFirst && !inSecond) return [{ param: a.param, value: withIt(first) }]
      if (inFirst) return [{ param: a.param, value: without(first) }, { param: a.also, value: withIt(second) }]
      return [{ param: a.also, value: without(second) }]
    }
    case 'char': {
      const cur = get(a.param)
      const lines = cur.split('\n')
      const row = a.row ?? 0
      const line = (lines[row] ?? '').padEnd(a.index + 1, a.chars[0])
      const i = a.chars.indexOf(line[a.index])
      lines[row] = line.slice(0, a.index) + a.chars[(i + 1) % a.chars.length] + line.slice(a.index + 1)
      return [{ param: a.param, value: lines.join('\n') }]
    }
  }
}

// ── Points on a plot ─────────────────────────────────────────────────────────
// Point lists are rows "x,y[,label]" joined by ";" or newlines. A click or drag
// arrives in drawing coordinates; the act carries the box and data range needed
// to turn it back into data.

const toData = (box: Box, dom: Dom, sx: number, sy: number): [number, number] => {
  const fx = Math.min(1, Math.max(0, (sx - box.x) / box.w)), fy = Math.min(1, Math.max(0, (sy - box.y) / box.h))
  const r = (v: number, span: number) => { const d = span >= 20 ? 1 : span >= 2 ? 100 : 1000; return Math.round(v * d) / d }
  return [r(dom.x0 + fx * (dom.x1 - dom.x0), dom.x1 - dom.x0), r(dom.y1 - fy * (dom.y1 - dom.y0), dom.y1 - dom.y0)]
}
const rowsOf = (raw: string) => { const sep = raw.includes('\n') ? '\n' : ';'; return { sep, rows: raw.split(/[;\n]/).map((r) => r.trim()).filter(Boolean).map((r) => r.split(',').map((c) => c.trim())) } }

/** Add a point (plot) or move one (move) from a pointer at drawing coords (sx, sy). */
export function applyPoint(a: Act, get: (param: string) => string, sx: number, sy: number, shift = false): Change[] | null {
  if (a.do !== 'plot' && a.do !== 'move') return null
  const [x, y] = toData(a.box, a.dom, sx, sy)
  const { sep, rows } = rowsOf(get(a.param))
  if (a.do === 'plot') rows.push([String(x), String(y), ...(a.label ? [shift ? a.label[1] : a.label[0]] : [])])
  else if (rows[a.index]) rows[a.index] = [String(x), String(y), ...rows[a.index].slice(2)]
  else return null
  return [{ param: a.param, value: rows.map((r) => r.join(',')).join(sep) }]
}

/** Remove the row a `move` point stands for. */
export function dropPoint(a: Act, get: (param: string) => string): Change[] | null {
  if (a.do !== 'move') return null
  const { sep, rows } = rowsOf(get(a.param))
  rows.splice(a.index, 1)
  return [{ param: a.param, value: rows.map((r) => r.join(',')).join(sep) }]
}
