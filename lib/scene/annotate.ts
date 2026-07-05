// Ink annotations: a small scribble near a component opens a mini input
// (canvas.tsx); the text lands here. "100kohm" near a resistor sets R,
// "0.5kg" on a mass sets its rigid-body mass, and a bare word renames the
// object. On tablets the OS handwriting layer (e.g. iPad Scribble) turns
// pen writing into text inside the input, so it feels like writing on paper.

import { useDocStore } from '@/lib/store/document'
import type { SceneObject } from './types'

const MULTIPLIERS: Record<string, number> = {
  G: 1e9,
  M: 1e6,
  k: 1e3,
  K: 1e3,
  m: 1e-3,
  u: 1e-6,
  'µ': 1e-6,
  n: 1e-9,
  p: 1e-12,
}

// Unit word → the param names it can set (first one the object has wins),
// plus an optional scale (grams → kg).
const UNITS: { re: RegExp; params: string[]; scale?: number }[] = [
  { re: /^(ohm|ohms|Ω|Ω)$/i, params: ['R'] },
  { re: /^(v|volt|volts)$/i, params: ['V', 'Vf', 'Vt'] },
  { re: /^(f|farad|farads)$/i, params: ['C'] },
  { re: /^(h|henry|henrys)$/i, params: ['L'] },
  { re: /^(hz|hertz)$/i, params: ['f'] },
  { re: /^(a|amp|amps|ampere)$/i, params: ['Imax'] },
  { re: /^kg$/i, params: ['mass'] },
  { re: /^g$/, params: ['mass'], scale: 1e-3 },
  { re: /^(n\/m)$/i, params: ['k'] },
]

function matchUnit(s: string): { params: string[]; mult: number } | null {
  if (!s) return null
  for (const u of UNITS) if (u.re.test(s)) return { params: u.params, mult: u.scale ?? 1 }
  // Prefix multiplier + unit ("kohm", "µF") — or a bare multiplier ("2.2k").
  const m = MULTIPLIERS[s[0]]
  if (m !== undefined) {
    const rest = s.slice(1)
    if (!rest) return { params: [], mult: m }
    for (const u of UNITS) if (u.re.test(rest)) return { params: u.params, mult: m * (u.scale ?? 1) }
  }
  return null
}

function setNumeric(pageId: string, obj: SceneObject, names: string[], value: number): boolean {
  const store = useDocStore.getState()
  for (const name of names) {
    const p = obj.parameters[name]
    if (p?.kind === 'number') {
      store.setParam(pageId, obj.id, name, String(value))
      return true
    }
  }
  for (const b of obj.behaviors) {
    for (const name of names) {
      if (b.params[name]) {
        store.setBehaviorParam(pageId, obj.id, b.id, name, String(value))
        return true
      }
    }
  }
  return false
}

/** First numeric knob the object exposes — the sensible default target. */
function firstNumeric(pageId: string, obj: SceneObject, value: number): boolean {
  const store = useDocStore.getState()
  for (const [name, p] of Object.entries(obj.parameters)) {
    if (p.kind === 'number') {
      store.setParam(pageId, obj.id, name, String(value))
      return true
    }
  }
  const b = obj.behaviors.find((x) => x.enabled && Object.keys(x.params).length > 0)
  const name = b && Object.keys(b.params)[0]
  if (b && name) {
    store.setBehaviorParam(pageId, obj.id, b.id, name, String(value))
    return true
  }
  return false
}

/** Apply annotation text to an object: number(+unit) → value, word → name. */
export function applyAnnotation(pageId: string, objectId: string, text: string) {
  const store = useDocStore.getState()
  const obj = store.pages[pageId]?.objects[objectId]
  const t = text.trim()
  if (!obj || !t) return

  const m = t.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([a-zA-ZΩµ/]*)\s*$/)
  if (m) {
    const n = Number(m[1])
    if (Number.isFinite(n)) {
      store.pushHistory(pageId)
      const unit = matchUnit(m[2])
      const value = n * (unit?.mult ?? 1)
      if (unit && unit.params.length > 0 && setNumeric(pageId, obj, unit.params, value)) return
      if (firstNumeric(pageId, obj, value)) return
      // Nothing numeric to set — fall through to naming.
    }
  }
  store.updateObject(pageId, objectId, { name: t }, { history: true })
}
