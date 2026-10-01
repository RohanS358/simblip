// Applying a click to a lab's parameters. Pure: `get` reads a parameter's
// current value (the card passes the object's value, falling back to the
// engine default) and the result is the list of parameter writes to make.

import type { Act } from './types'

export interface Change { param: string; value: string }

const list = (v: string) => v.split(/[\s,;]+/).filter(Boolean)
const join = (items: string[], like: string) => items.join(/[,;]/.test(like) ? (like.includes(';') ? ';' : ',') : ' ')
const num = (n: number) => String(Math.round(n * 1e6) / 1e6)

/** `edit` needs a text box, so it is the caller's job (returns null). */
export function applyAct(a: Act, get: (param: string) => string): Change[] | null {
  switch (a.do) {
    case 'edit': return null
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
