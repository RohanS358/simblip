// SimScript's canvas-object prop layer — what makes "everything is creatable
// in SimScript" actually true.
// Run: node lib/scene/simscript-props.test.mjs
//
// This imports the REAL lib/scene/simscript-props.ts (bundled on the fly with
// esbuild, which the repo already depends on via Next). Mirroring the logic
// here instead would test a copy, and the whole point of this change is that
// SimScript stopped keeping its own copy of things.
//
// The bug being pinned: create() used to hand-write each kind's defaults, so
// `gridtable`, `slider`, `button`, `trigger`, `surface3d` and `chart` fell
// through to a blank rect — four of them while the reference doc claimed they
// worked. Objects are now built by lib/scene/factory.ts and only layered here.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'simscript-props-'))
const bundle = join(dir, 'props.mjs')
execFileSync('npx', ['esbuild', resolve(import.meta.dirname, 'simscript-props.ts'),
  '--bundle', '--format=esm', `--outfile=${bundle}`], { stdio: 'pipe' })
const { canvasKindOf, CANVAS_KINDS, RESERVED_PROPS, applyKindProps, applyStyleProps } =
  await import(bundle)
rmSync(dir, { recursive: true, force: true })

/** Minimal stand-in for a factory-built object. `parameters` is pre-seeded the
 *  way createGeometry seeds it, since applyKindProps only overrides keys the
 *  factory already declared. */
const obj = (parameters = {}, geometry = { kind: 'rect' }) =>
  ({ id: 'o1', name: 'X', geometry, position: { x: 0, y: 0 }, size: { w: 1, h: 1 },
     rotation: 0, z: 0, behaviors: [], parameters, metadata: {} })

// ── The six kinds that used to become blank rects ──────────────────────────
test('every kind that used to fall through is now a real kind', () => {
  for (const kind of ['gridtable', 'slider', 'button', 'trigger', 'surface3d', 'chart', 'picture']) {
    assert.ok(CANVAS_KINDS.has(kind), `${kind} must be creatable, not a fallback rect`)
  }
})

test('friendly aliases resolve to their real GeometryKind', () => {
  assert.equal(canvasKindOf('dsa-lab'), 'dsa')
  assert.equal(canvasKindOf('truth-table'), 'truthtable')
  assert.equal(canvasKindOf('ide'), 'code')
  assert.equal(canvasKindOf('graph3d'), 'surface3d')
  assert.equal(canvasKindOf('img'), 'picture')
  assert.equal(canvasKindOf('resistor'), 'resistor', 'a non-alias passes through untouched')
})

// ── Styling applies to EVERY kind, including circuit symbols ───────────────
test('style props land on the metadata keys the renderers actually read', () => {
  const o = obj()
  applyStyleProps(o, {
    fill: '#ff0000', stroke: '#00ff00', strokeWidth: 3, radius: 8,
    textColor: '#111', align: 'center', locked: true, hidden: false, z: 42,
  })
  assert.equal(o.metadata.fillColor, '#ff0000')
  assert.equal(o.metadata.strokeColor, '#00ff00')
  assert.equal(o.metadata.strokeWidth, 3)
  assert.equal(o.metadata.cornerRadius, 8)
  assert.equal(o.metadata.textColor, '#111')
  assert.equal(o.metadata.align, 'center')
  assert.equal(o.metadata.locked, true)
  assert.equal(o.metadata.hidden, false)
  assert.equal(o.z, 42)
})

test('opacity accepts both 0-1 and 0-100 and normalises to percent', () => {
  const a = obj(); applyStyleProps(a, { opacity: 0.5 })
  const b = obj(); applyStyleProps(b, { opacity: 50 })
  assert.equal(a.metadata.fillOpacity, 50, '0.5 reads as a fraction')
  assert.equal(b.metadata.fillOpacity, 50, '50 reads as a percentage')
  const full = obj(); applyStyleProps(full, { opacity: 1 })
  assert.equal(full.metadata.fillOpacity, 100, 'the 0-1 boundary stays a fraction')
})

test('every styling key is reserved, so it can never become a live parameter', () => {
  // This is what stops create("resistor", { R: 330, fill: "#f00" }) from
  // inventing a bogus `fill` electrical parameter on the resistor.
  for (const k of ['fill', 'stroke', 'strokeWidth', 'opacity', 'radius', 'textColor',
                   'align', 'locked', 'hidden', 'flipH', 'flipV', 'z', 'name', 'x', 'y']) {
    assert.ok(RESERVED_PROPS.has(k), `${k} must be reserved`)
  }
  assert.equal(RESERVED_PROPS.has('R'), false, 'a real electrical value must NOT be reserved')
  assert.equal(RESERVED_PROPS.has('mass'), false, 'a real behavior param must NOT be reserved')
})

// ── Per-kind prop translation ──────────────────────────────────────────────
test('table accepts arrays as well as the stored string shape', () => {
  const o = obj({ headers: { kind: 'string', value: '' }, data: { kind: 'string', value: '' },
                  summary: { kind: 'string', value: 'Sum' } }, { kind: 'table' })
  applyKindProps(o, 'table', { headers: ['SN', 't', 'd'], data: [[1, 2, 3], [4, 5, 6]], summary: 'Avg' })
  assert.equal(o.parameters.headers.value, 'SN;t;d')
  assert.equal(o.parameters.data.value, '1;2;3\n4;5;6')
  assert.equal(o.parameters.summary.value, 'Avg')
})

test('gridtable takes a 2-D array of cells and encodes it as JSON', () => {
  const o = obj({ cells: { kind: 'string', value: '' }, rows: { kind: 'number', value: 3 },
                  cols: { kind: 'number', value: 3 }, transparent: { kind: 'number', value: 1 } },
                { kind: 'gridtable' })
  applyKindProps(o, 'gridtable', { cells: [['a', 'b'], ['c', 'd']], rows: 2, cols: 2 })
  assert.deepEqual(JSON.parse(o.parameters.cells.value), [['a', 'b'], ['c', 'd']])
  assert.equal(o.parameters.rows.value, 2)
})

test('sizing a gridtable without cells still produces that many cells', () => {
  // Otherwise rows/cols are silently ignored and the default 3x3 renders.
  const o = obj({ cells: { kind: 'string', value: '' }, rows: { kind: 'number', value: 3 },
                  cols: { kind: 'number', value: 3 } }, { kind: 'gridtable' })
  applyKindProps(o, 'gridtable', { rows: 2, cols: 4 })
  const cells = JSON.parse(o.parameters.cells.value)
  assert.equal(cells.length, 2)
  assert.equal(cells[0].length, 4)
})

test('chart series accepts an object, an array of pairs, or the raw string', () => {
  const mk = () => obj({ chartType: { kind: 'string', value: 'bar' },
                         labels: { kind: 'string', value: '' },
                         series: { kind: 'string', value: '' } }, { kind: 'chart' })
  const a = mk(); applyKindProps(a, 'chart', { labels: ['A', 'B'], series: { Sales: [1, 2] } })
  assert.equal(a.parameters.labels.value, 'A;B')
  assert.equal(a.parameters.series.value, 'Sales|1;2')

  const b = mk(); applyKindProps(b, 'chart', { series: [['Sales', [1, 2]], ['Cost', [3, 4]]] })
  assert.equal(b.parameters.series.value, 'Sales|1;2\nCost|3;4')

  const c = mk(); applyKindProps(c, 'chart', { series: 'Raw|9;9' })
  assert.equal(c.parameters.series.value, 'Raw|9;9', 'a pre-encoded string passes through')
})

test('picture src is normalised to the opfs: reference the renderer expects', () => {
  const bare = obj({}, { kind: 'picture' })
  applyKindProps(bare, 'picture', { src: 'abc123' })
  assert.equal(bare.geometry.src, 'opfs:abc123')

  const full = obj({}, { kind: 'picture' })
  applyKindProps(full, 'picture', { src: 'opfs:abc123' })
  assert.equal(full.geometry.src, 'opfs:abc123', 'an already-prefixed id is not double-prefixed')
})

test('a factory-declared parameter is settable by name without a special case', () => {
  // This is what makes kinds added to the factory LATER scriptable for free.
  const o = obj({ min: { kind: 'number', value: 0 }, max: { kind: 'number', value: 100 },
                  label: { kind: 'string', value: 'Slider' } }, { kind: 'slider' })
  applyKindProps(o, 'slider', { min: 5, max: 50, label: 'Mass', bogus: 'ignored' })
  assert.equal(o.parameters.min.value, 5)
  assert.equal(o.parameters.max.value, 50)
  assert.equal(o.parameters.label.value, 'Mass')
  assert.equal('bogus' in o.parameters, false, 'a key the factory never declared is not invented')
})

test('surface3d takes formula/formulas/z and joins multiple surfaces', () => {
  const o = obj({ formulas: { kind: 'string', value: '' }, axis: { kind: 'string', value: 'z' } },
                { kind: 'surface3d' })
  applyKindProps(o, 'surface3d', { formulas: ['sin(x)', 'cos(y)'] })
  assert.equal(o.parameters.formulas.value, 'sin(x)\ncos(y)')
})
