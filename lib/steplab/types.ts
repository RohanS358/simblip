// Step Lab — the contract every engine speaks.
//
// WHY THIS EXISTS. A large part of a computer-engineering syllabus is not
// physics: it is an ALGORITHM that runs on some state — a scheduler filling a
// Gantt chart, a cache deciding what to evict, a DFA consuming a string. What
// the student needs is the same in every case: the state drawn, one step at a
// time, with the reason for each step written beside it. Building one bespoke
// widget per topic would be ~50 widgets; building one widget and letting each
// topic be a pure function that RETURNS A DRAWING is one widget and ~50 short
// functions.
//
// So an engine is `run(params) -> Trace`, and a Trace is a list of Frames,
// each frame a list of dumb drawing primitives (rect / text / line / circle /
// poly) in a private coordinate space. The renderer (components/objects/
// steplab.tsx) draws whichever frame the reader is on and knows nothing about
// schedulers, caches or automata. Nothing here touches React, the store or the
// DOM — which is also what lets the lesson lint gate run every figure headless
// and check the numbers the prose quotes against the numbers the engine
// produces (see .claude/skills/course-author/lint-course.mjs).

/** Tones are the design system's accents, by meaning: `blue` selection / the
 *  thing being looked at, `mint` running / done / high, `amber` a value or a
 *  warning, `rose` an error or a miss, `violet` a derived or AI quantity,
 *  `dim` inactive. `idle` is the neutral card colour. */
export type Tone = 'idle' | 'blue' | 'mint' | 'amber' | 'rose' | 'violet' | 'dim'

/** What clicking a primitive does. The renderer applies it to the card's own
 *  parameters, so a student edits the thing they are LOOKING AT instead of a
 *  properties form. Pure data: engines declare it, the card interprets it. */
export type Act =
  /** Type a new value in place (Enter commits). */
  | { do: 'edit'; param: string; hint?: string }
  /** Click through a fixed list of values. */
  | { do: 'cycle'; param: string; values: string[] }
  /** Add/remove `item` in a space/comma list. With `also`, three states: none → param → also → none. */
  | { do: 'toggle'; param: string; item: string; also?: string }
  /** Add `by` to a number (clamped). */
  | { do: 'step'; param: string; by: number; min?: number; max?: number }
  /** Set `param` to `value`; clicking it again (already that value) sets `off` — for "put the fault HERE". */
  | { do: 'set'; param: string; value: string; off: string }
  /** Replace one character of a text param (row/col when it has lines) with the next of `chars`. */
  | { do: 'char'; param: string; index: number; chars: string; row?: number }

export type Prim =
  | { k: 'rect'; x: number; y: number; w: number; h: number; text?: string; sub?: string; tone?: Tone; r?: number; solid?: boolean; act?: Act }
  | { k: 'text'; x: number; y: number; text: string; tone?: Tone; size?: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean; mono?: boolean; act?: Act }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; tone?: Tone; arrow?: boolean; dash?: boolean; w?: number; act?: Act }
  | { k: 'circle'; x: number; y: number; r: number; text?: string; tone?: Tone; solid?: boolean; double?: boolean; act?: Act }
  | { k: 'poly'; pts: number[][]; tone?: Tone; closed?: boolean; fill?: boolean; w?: number; arrow?: boolean; dash?: boolean; act?: Act }

export interface Frame {
  draw: Prim[]
  /** One sentence: what just happened and WHY. The reader's caption. */
  note: string
}

export interface Trace {
  /** Logical drawing size — the renderer scales it to the card. */
  w: number
  h: number
  frames: Frame[]
  /** Named results of the whole run ("avgWT" -> "4.33"). These are what a
   *  lesson's `expect` pins, exactly as it pins a meter reading. */
  summary: Record<string, string>
}

export type Params = Record<string, string>

export interface ParamDef {
  name: string
  label: string
  /** A one-line hint including the format ("P1,0,5;P2,1,3 = name,arrival,burst"). */
  hint: string
  def: string
  /** When set the field is a dropdown. */
  options?: string[]
  /** Multi-line text area (programs, tables). */
  long?: boolean
  /** An empty value is meaningful ("no losses", "no error") and must not fall back to `def`. */
  optional?: boolean
}

export interface EngineDef {
  id: string
  label: string
  /** Where the engine sits in the picker, and which syllabus it serves. */
  group: string
  blurb: string
  params: ParamDef[]
  run: (p: Params) => Trace
}

// ── Param parsing ───────────────────────────────────────────────────────────
// Params arrive as strings (they live in a SceneObject's string parameters, so
// a script can write them and a student can edit them). These helpers turn
// them into values and fail with a sentence a student can act on.

export class LabError extends Error {}

export function pnum(p: Params, key: string, def: number): number {
  const raw = p[key]
  if (raw === undefined || raw === '') return def
  const v = Number(raw)
  if (!Number.isFinite(v)) throw new LabError(`"${key}" must be a number, got "${raw}"`)
  return v
}

export function pstr(p: Params, key: string, def: string): string {
  const raw = p[key]
  return raw === undefined || raw === '' ? def : raw
}

/** "a;b;c" or "a,b,c" or newline-separated -> ['a','b','c'] */
export function plist(p: Params, key: string, def: string[] = [], sep: RegExp = /[;\n]/): string[] {
  const raw = p[key]
  if (raw === undefined || raw.trim() === '') return def
  return raw.split(sep).map((s) => s.trim()).filter(Boolean)
}

/** "1 2 3, 4" -> [1,2,3,4] */
export function pnums(p: Params, key: string, def: number[] = []): number[] {
  const raw = p[key]
  if (raw === undefined || raw.trim() === '') return def
  const out = raw.split(/[\s,;]+/).filter(Boolean).map(Number)
  if (out.some((v) => !Number.isFinite(v))) throw new LabError(`"${key}" must be a list of numbers, got "${raw}"`)
  return out
}

/** Rows of comma-separated fields: "P1,0,5;P2,1,3" */
export function prows(p: Params, key: string, def: string[][] = []): string[][] {
  const raw = p[key]
  if (raw === undefined || raw.trim() === '') return def
  return raw.split(/[;\n]/).map((r) => r.trim()).filter(Boolean).map((r) => r.split(',').map((c) => c.trim()))
}

export const fmt = (v: number, d = 2): string => {
  if (!Number.isFinite(v)) return String(v)
  const s = v.toFixed(d)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}
