// SimScript's canvas-object layer: how a `create()` call's props become a real
// SceneObject. Split out of simscript.ts so it can be unit-tested directly —
// simscript.ts itself imports the Zustand doc store and can't load in Node.
//
// The object ITSELF is always built by lib/scene/factory.ts (the same factory
// the palette and tool dock use). This module only decides which kind a name
// refers to, then layers the caller's props on top. Nothing here reads or
// writes the store.

import type { SceneObject, GeometryKind } from './types'
import { num, str } from './types'

// ── Canvas objects: aliases, per-kind props, and universal styling ──────────
//
// Everything that is not a circuit symbol or a physics component is built by
// lib/scene/factory.ts `createGeometry` — the one factory the palette and the
// tool dock already use. This section only maps SimScript's spelling onto it
// and then layers the user's props on top.

/** SimScript spellings → the real GeometryKind. Keeps the friendly aliases
 *  (`lens`, `dsa-lab`, `ide`, `truth-table`…) working without teaching the
 *  factory about them. */
export const CANVAS_ALIASES: Record<string, GeometryKind> = {
  ide: 'code', simscript: 'code',
  'dsa-lab': 'dsa', dsalab: 'dsa',
  'truth-table': 'truthtable',
  'grid-table': 'gridtable',
  '3d': 'surface3d', 'surface-3d': 'surface3d', 'graph3d': 'surface3d',
  system: 'rect', // a tagged rect, not its own geometry kind
  image: 'picture', img: 'picture',
}

export const canvasKindOf = (kind: string): GeometryKind =>
  (CANVAS_ALIASES[kind] ?? kind) as GeometryKind

/** Every GeometryKind create() can build directly. `stroke` is deliberately
 *  absent: freehand ink is drawn, not declared, and an empty stroke object
 *  would render as nothing. */
export const CANVAS_KINDS = new Set<GeometryKind>([
  'rect', 'circle', 'line', 'polygon', 'text', 'note', 'formula', 'graph',
  'surface3d', 'chart', 'cashflow', 'truthtable', 'table', 'gridtable',
  'slider', 'button', 'trigger', 'code', 'dsa', 'picture',
])

/** Props a caller may pass that are positional//styling, never a parameter. */
export const RESERVED_PROPS = new Set([
  'x', 'y', 'width', 'height', 'rotation', 'dir', 'name', 'domain',
  'fill', 'fillColor', 'stroke', 'strokeColor', 'strokeWidth', 'opacity',
  'fillOpacity', 'radius', 'cornerRadius', 'textColor', 'align',
  'verticalAlign', 'valign', 'locked', 'hidden', 'flipH', 'flipV',
  'lineHeight', 'letterSpacing', 'color', 'z',
])

/** `[1,2,3]` / `"1;2;3"` / `[[1,2],[3,4]]` → the row-and-column string shape
 *  the table-ish components store. */
const asRows = (v: unknown, rowSep = '\n', colSep = ';'): string =>
  Array.isArray(v)
    ? v.map((r) => (Array.isArray(r) ? r.join(colSep) : String(r))).join(rowSep)
    : String(v ?? '')

/**
 * Layer the user's props onto a factory-built object.
 *
 * The factory supplies correct defaults for every parameter; this only
 * overrides the ones actually passed. Kinds whose stored shape is not a
 * plain scalar (tables take joined strings, gridtable takes JSON cells)
 * get a small translation so the script stays readable.
 */
export function applyKindProps(obj: SceneObject, gk: GeometryKind, props: Record<string, any>): void {
  // Keys the kind-specific branch below has already translated. The generic
  // pass at the end must skip them, or it would re-stringify a value it does
  // not understand — `String(["SN","t"])` is "SN,t", quietly undoing the
  // ";"-joining the table format requires.
  const done = new Set<string>()
  const setStr = (k: string, v: unknown) => { obj.parameters[k] = str(String(v)); done.add(k) }
  const setNum = (k: string, v: unknown) => { obj.parameters[k] = num(Number(v)); done.add(k) }

  if (gk === 'table') {
    if (props.headers !== undefined)
      setStr('headers', Array.isArray(props.headers) ? props.headers.join(';') : props.headers)
    if (props.data !== undefined) setStr('data', asRows(props.data))
    if (props.summary !== undefined) setStr('summary', props.summary)

  } else if (gk === 'gridtable') {
    // `cells` is stored as a JSON grid. Accept a real 2-D array (the natural
    // way to write one in script) as well as pre-encoded JSON.
    if (props.cells !== undefined)
      setStr('cells', typeof props.cells === 'string' ? props.cells : JSON.stringify(props.cells))
    if (props.rows !== undefined) setNum('rows', props.rows)
    if (props.cols !== undefined) setNum('cols', props.cols)
    if (props.transparent !== undefined) setNum('transparent', props.transparent ? 1 : 0)
    // Sizing the grid without supplying cells should still produce that many
    // cells, or the component renders its 3×3 default and ignores rows/cols.
    if (props.cells === undefined && (props.rows !== undefined || props.cols !== undefined)) {
      const r = Number(props.rows ?? 3), c = Number(props.cols ?? 3)
      setStr('cells', JSON.stringify(Array.from({ length: r }, () => Array.from({ length: c }, () => ''))))
    }

  } else if (gk === 'chart') {
    if (props.chartType ?? props.type) setStr('chartType', props.chartType ?? props.type)
    if (props.labels !== undefined)
      setStr('labels', Array.isArray(props.labels) ? props.labels.join(';') : props.labels)
    // series: "Name|1;2;3", or {Name: [1,2,3]}, or [[name, values], …]
    if (props.series !== undefined) {
      const s = props.series
      setStr('series', typeof s === 'string' ? s
        : Array.isArray(s) ? s.map((e: any) => Array.isArray(e) ? `${e[0]}|${asRows(e[1], ';', ';')}` : String(e)).join('\n')
        : Object.entries(s).map(([k, v]) => `${k}|${asRows(v, ';', ';')}`).join('\n'))
    }

  } else if (gk === 'surface3d') {
    // Multiple surfaces are stored newline-separated.
    if (props.formulas ?? props.formula ?? props.z)
      setStr('formulas', asRows(props.formulas ?? props.formula ?? props.z))
    if (props.axis !== undefined) setStr('axis', props.axis)

  } else if (gk === 'picture') {
    // `opfs:<fileId>` — the same reference uploads-panel.tsx writes. A picture
    // with no src has nothing to draw, so it is required rather than defaulted.
    const src = props.src ?? props.file ?? props.fileId
    if (src !== undefined)
      obj.geometry.src = String(src).startsWith('opfs:') ? String(src) : `opfs:${src}`

  } else if (gk === 'text' || gk === 'note') {
    if (props.text !== undefined) setStr('text', props.text)
    if (gk === 'note' && props.color !== undefined) obj.metadata.color = String(props.color)

  } else if (gk === 'formula') {
    if ((props.latex ?? props.text) !== undefined) setStr('latex', props.latex ?? props.text)

  } else if (gk === 'code' || gk === 'dsa') {
    if (props.source !== undefined) setStr('source', props.source)

  } else if (gk === 'cashflow') {
    if (props.spec !== undefined)
      setStr('spec', typeof props.spec === 'string' ? props.spec : JSON.stringify(props.spec))

  } else if (gk === 'line' || gk === 'polygon') {
    if (Array.isArray(props.points)) obj.geometry.points = props.points
  }

  // Anything left that the factory declared as a parameter is a live value the
  // user is entitled to set by name (slider min/max/step/label/target*, button
  // actionType, trigger condition/threshold, truthtable inputs/outputs…).
  // Matching against the factory's OWN parameter set is what makes this work
  // for kinds added later without touching this function.
  for (const [k, v] of Object.entries(props)) {
    if (done.has(k) || RESERVED_PROPS.has(k) || !(k in obj.parameters)) continue
    obj.parameters[k] = typeof v === 'number' || obj.parameters[k]?.kind === 'number'
      ? num(Number(v))
      : str(String(v))
  }
}

/**
 * Universal appearance props, applied to every kind — a resistor, a text
 * block and a slider all accept the same ones. Keys mirror exactly what the
 * renderers read out of `metadata` (see components/objects/geometry.tsx and
 * text.tsx), so a scripted object is indistinguishable from one styled by
 * hand in the Properties panel.
 */
export function applyStyleProps(obj: SceneObject, props: Record<string, any>): void {
  const m = obj.metadata
  const fill = props.fill ?? props.fillColor
  const stroke = props.stroke ?? props.strokeColor
  if (fill !== undefined) m.fillColor = String(fill)
  if (stroke !== undefined) m.strokeColor = String(stroke)
  if (props.strokeWidth !== undefined) m.strokeWidth = Number(props.strokeWidth)
  const radius = props.radius ?? props.cornerRadius
  if (radius !== undefined) m.cornerRadius = Number(radius)
  // `opacity` is authored 0–1 or 0–100; both are common and unambiguous,
  // since a real 0.5 opacity and "50%" can't collide.
  const op = props.opacity ?? props.fillOpacity
  if (op !== undefined) m.fillOpacity = Number(op) <= 1 ? Number(op) * 100 : Number(op)
  if (props.textColor !== undefined) m.textColor = String(props.textColor)
  if (props.align !== undefined) m.align = String(props.align)
  const va = props.verticalAlign ?? props.valign
  if (va !== undefined) m.verticalAlign = String(va)
  if (props.lineHeight !== undefined) m.lineHeight = Number(props.lineHeight)
  if (props.letterSpacing !== undefined) m.letterSpacing = Number(props.letterSpacing)
  if (props.locked !== undefined) m.locked = !!props.locked
  if (props.hidden !== undefined) m.hidden = !!props.hidden
  if (props.flipH !== undefined) m.flipH = !!props.flipH
  if (props.flipV !== undefined) m.flipV = !!props.flipV
  if (props.z !== undefined) obj.z = Number(props.z)
}

// ── Terminal anchors ───────────────────────────────────────────────────────
// Which named anchor maps to which terminal index, per symbol. Lives here
// rather than in simscript.ts so the LINTER can read it too: simscript.ts
// imports the Zustand doc store, and the linter must stay pure (it runs on
// the server, before anything is executed). One table, two readers.

export const ANCHOR_INDEX: Record<string, Record<string, number>> = {
  // 2-terminal (T2) components: index 0 = positive/anode/in, index 1 = negative/cathode/out
  _t2: { positive: 0, negative: 1, anode: 0, cathode: 1, plus: 0, minus: 1, in: 0, out: 1, input: 0, output: 1, a: 0, b: 1 },
  battery:          { positive: 0, negative: 1, plus: 0, minus: 1 },
  'ac-source':      { positive: 0, negative: 1 },
  'current-source': { positive: 0, negative: 1 },
  resistor:         { input1: 0, input2: 1, in1: 0, in2: 1, a: 0, b: 1, in: 0, out: 1 },
  bulb:             { input1: 0, input2: 1, in1: 0, in2: 1, a: 0, b: 1 },
  capacitor:        { positive: 0, negative: 1, a: 0, b: 1 },
  inductor:         { a: 0, b: 1 },
  switch:           { a: 0, b: 1 },
  fuse:             { a: 0, b: 1 },
  diode:            { anode: 0, cathode: 1, a: 0, k: 1 },
  led:              { anode: 0, cathode: 1, a: 0, k: 1 },
  zener:            { anode: 0, cathode: 1 },
  ammeter:          { a: 0, b: 1 },
  voltmeter:        { a: 0, b: 1 },
  'dc-machine':     { positive: 0, negative: 1 },
  'pressure-plate': { a: 0, b: 1 },
  'not-gate':       { input: 0, in: 0, output: 1, out: 1 },
  // 3-terminal
  potentiometer:    { top: 0, wiper: 1, w: 1, bottom: 2 },
  bjt:              { base: 0, b: 0, collector: 1, c: 1, emitter: 2, e: 2 },
  'bjt-pnp':        { base: 0, b: 0, collector: 1, c: 1, emitter: 2, e: 2 },
  mosfet:           { gate: 0, g: 0, drain: 1, d: 1, source: 2, s: 2 },
  'mosfet-pmos':    { gate: 0, g: 0, drain: 1, d: 1, source: 2, s: 2 },
  opamp:            { 'in+': 0, inp: 0, positive: 0, 'in-': 1, inn: 1, negative: 1, out: 2, output: 2 },
  'sr-latch':       { s: 0, r: 1, q: 2, output: 2 },
  'd-ff':           { d: 0, clk: 1, clock: 1, q: 2, output: 2 },
  't-ff':           { t: 0, clk: 1, clock: 1, q: 2, output: 2 },
  tristate:         { input: 0, in: 0, enable: 1, en: 1, output: 2, out: 2 },
  // Gates (GATE3 default: [in0, in1, out]) — variable but default 2 inputs
  'and-gate':       { input1: 0, in1: 0, a: 0, input2: 1, in2: 1, b: 1, output: 2, out: 2 },
  'or-gate':        { input1: 0, in1: 0, a: 0, input2: 1, in2: 1, b: 1, output: 2, out: 2 },
  'xor-gate':       { input1: 0, in1: 0, a: 0, input2: 1, in2: 1, b: 1, output: 2, out: 2 },
  'nand-gate':      { input1: 0, in1: 0, a: 0, input2: 1, in2: 1, b: 1, output: 2, out: 2 },
  'nor-gate':       { input1: 0, in1: 0, a: 0, input2: 1, in2: 1, b: 1, output: 2, out: 2 },
  'jk-ff':          { j: 0, clk: 1, clock: 1, k: 2, q: 3, output: 3 },
  // 4-terminal controlled sources
  vcvs:             { 'ctrl+': 0, ctrlp: 0, 'ctrl-': 1, ctrln: 1, out: 2, 'out-': 3 },
  vccs:             { 'ctrl+': 0, ctrlp: 0, 'ctrl-': 1, ctrln: 1, out: 2, 'out-': 3 },
  ccvs:             { 'ctrl+': 0, ctrlp: 0, 'ctrl-': 1, ctrln: 1, out: 2, 'out-': 3 },
  cccs:             { 'ctrl+': 0, ctrlp: 0, 'ctrl-': 1, ctrln: 1, out: 2, 'out-': 3 },
  transformer:      { 'primary+': 0, p1: 0, 'primary-': 1, p2: 1, 'secondary+': 2, s1: 2, 'secondary-': 3, s2: 3 },
  'transformer-ct': { 'primary+': 0, p1: 0, 'primary-': 1, p2: 1, s1: 2, ct: 3, s2: 4 },
  wattmeter:        { 'current+': 0, ip: 0, 'current-': 1, in_: 1, 'voltage+': 2, vp: 2, 'voltage-': 3, vn: 3 },
  // Single terminal
  gnd:              { terminal: 0, a: 0 },
  probe:            { terminal: 0, a: 0 },
  'logic-probe':    { terminal: 0, a: 0 },
  input:            { output: 0, out: 0, q: 0 },
  clock:            { output: 0, out: 0, q: 0 },
  output:           { input: 0, in: 0, d: 0 },
  // multi-output
  'three-phase-source': { a: 0, b: 1, c: 2, n: 3, neutral: 3 },
  'induction-motor':    { a: 0, b: 1, c: 2, n: 3, neutral: 3 },
  'half-adder':     { a: 0, b: 1, sum: 2, s: 2, carry: 3, cout: 3 },
  'full-adder':     { a: 0, b: 1, cin: 2, sum: 3, s: 3, carry: 4, cout: 4 },
  decoder:          { a: 0, b: 1, y0: 2, y1: 3, y2: 4, y3: 5 },
  comparator:       { a: 0, b: 1, lt: 2, eq: 3, gt: 4 },
  mux:              { in0: 0, in1: 1, sel: 2, output: 3, out: 3 },
  demux:            { input: 0, in: 0, sel: 1, out0: 2, out1: 3 },
  encoder:          { in0: 0, in1: 1, in2: 2, in3: 3, out0: 4, out1: 5 },
  'seven-seg':      { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6 },
  'bcd-7seg':       { a: 0, b: 1, c: 2, d: 3, qa: 4, qb: 5, qc: 6, qd: 7, qe: 8, qf: 9, qg: 10 },
  counter4:         { clk: 0, clock: 0, q0: 1, q1: 2, q2: 3, q3: 4 },
  register4:        { sin: 0, clk: 1, clock: 1, sout: 2 },
}

// ── Channel tables ─────────────────────────────────────────────────────────
// What each component publishes to a graph. These live in THIS module — which
// has no imports and no 'use client' — because both a client renderer and the
// server-side linter need them.
//
// They are plain arrays, deliberately. A `Set` re-exported across a
// 'use client' boundary arrives on the server as a plain object with no
// prototype, so `.has()` is undefined at runtime: that is exactly the
// "SILENT_SYMBOLS.has is not a function" crash this replaced. Arrays survive
// the boundary intact, and these are small enough that `.includes()` costs
// nothing.

/** Motion channels every dynamic rigid body streams (SI units). */
export const BODY_CHANNELS: readonly string[] = ['x', 'y', 'vx', 'vy', 'speed', 'angle', 'omega', 'ke']

/** Two-terminal electrical parts all report the same three. */
export const DEFAULT_SYMBOL_CHANNELS: readonly string[] = ['V', 'I', 'P']

/** symbol → the exact channels that symbol's reading pushes. */
export const CHANNELS_BY_SYMBOL: Record<string, readonly string[]> = {
  potentiometer: ['Vtop', 'Vwiper', 'Vbottom'],
  'induction-motor': ['omega', 'torque', 'slip', 'I'],
  'dc-machine': ['V', 'I', 'P', 'omega', 'torque'],
  vcvs: ['Vctrl', 'Vout', 'I'],
  vccs: ['Vctrl', 'Vout', 'I'],
  ccvs: ['Isense', 'Vout', 'I'],
  cccs: ['Isense', 'Vout', 'I'],
  transformer: ['Vprimary', 'Vsecondary', 'I'],
  'transformer-ct': ['Vprimary', 'Vsec1', 'Vsec2'],
  'three-phase-source': ['Va', 'Vb', 'Vc', 'Vab'],
  probe: ['V'],
  'logic-probe': ['level'],
  output: ['value'],
  clock: ['value'],
  input: ['value'],
}

/** Symbols with no reading at all — gates, wiring, decoration. */
export const SILENT_SYMBOLS: readonly string[] = [
  'gnd', 'and-gate', 'or-gate', 'xor-gate', 'nand-gate', 'nor-gate', 'not-gate',
  'd-ff', 'jk-ff', 't-ff', 'sr-latch', 'mux', 'demux', 'decoder', 'encoder',
  'half-adder', 'full-adder', 'comparator', 'tristate', 'seven-seg', 'bcd-7seg',
  'register4', 'counter4',
]
