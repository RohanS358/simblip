// graph.plot() end-to-end — drives the REAL executeSimScript against a stub
// store, then solves the page the way the document store does.
// Run: node --test lib/scene/simscript-plot.test.mjs
//
// The bugs pinned here all came from one AI-written scene (two charged plates,
// two Formula cards, `graph.plot(E, "x")`):
//   - a bare object argument fell through the anchor proxy, so the series was
//     the literal "[object Object]:[object Object]" and the graph drew nothing;
//   - "x" was read as a plot STYLE rather than the x axis;
//   - a card's LaTeX had no path to a number, so a plotted formula had none;
//   - cards created without x/y all landed on the same spot.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simscript-plot-'))
const stub = join(dir, 'stub-store.mjs')
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'sim.mjs')

// The doc store is a browser/Zustand module. This stub keeps the same shape
// SimScript uses; the page is re-solved by the test with the REAL solveScope,
// exactly as reevaluate() does it.
writeFileSync(stub, `
let pages = { p: { objects: {}, variables: [] } }
export const useDocStore = {
  getState: () => ({
    pages,
    ensurePage() {},
    addObject(pageId, obj) { (pages[pageId] ??= { objects: {}, variables: [] }).objects[obj.id] = obj },
    updateObject(pageId, id, patch) {
      const cur = pages[pageId]?.objects?.[id]
      if (cur) pages[pageId].objects[id] = { ...cur, ...patch }
    },
    upsertVariable(pageId, name, expr) {
      const page = pages[pageId]
      const existing = page.variables.find((v) => v.name === name)
      if (existing) existing.expr = expr
      else page.variables.push({ id: name, name, expr, value: 0 })
    },
  }),
  setState: (fn) => { if (typeof fn === 'function') { const r = fn({ pages }); if (r?.pages) for (const k of Object.keys(r.pages)) pages[k] = r.pages[k] } },
  __reset: () => { pages = { p: { objects: {}, variables: [] } } },
  __page: () => pages.p,
  __objects: () => Object.values(pages.p?.objects ?? {}),
}
`)
writeFileSync(entry, `
export { executeSimScript } from '@/lib/scene/simscript'
export { useDocStore } from '@/lib/store/document'
export { solveScope, evalExpr } from '@/lib/formula/engine'
export { CONSTANTS, paramScopeOf } from '@/lib/formula/scope'
`)
// applySceneLayout reads the page frame from the workspace store. Stub it:
// these tests run headless with no DOM, and the real module pulls in zustand.
const wsStub = join(dir, 'ws-stub.ts')
writeFileSync(wsStub, `
export const findPageMeta = () => undefined
export const useWorkspaceStore = { getState: () => ({ nodes: {} }) }
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`, `--alias:@=${root}`,
  '--external:react', '--external:zustand'], { cwd: root, stdio: 'pipe' })

const { executeSimScript, useDocStore, solveScope, evalExpr, CONSTANTS, paramScopeOf } = await import(bundle)
rmSync(dir, { recursive: true, force: true })

const param = (o, k) => o?.parameters?.[k]?.value ?? ''
const kind = (k) => useDocStore.__objects().filter((o) => o.geometry.kind === k)

/** The page scope, composed exactly as lib/store/document.ts reevaluate does. */
const pageScope = () => {
  const page = useDocStore.__page()
  return solveScope(page.variables, { ...CONSTANTS, ...paramScopeOf(page) }).scope
}

const SCENE = `
var plate1 = create("charge", { q: 1, x: -50, y: 0 });
var plate2 = create("charge", { q: -1, x: 50, y: 0 });
addproperty(plate1, "surfaceChargeDensity", { sigma: 1 });
addproperty(plate2, "surfaceChargeDensity", { sigma: -1 });
addproperty(plate1, "dielectricConstant", { epsilonR: 4 });
addproperty(plate2, "dielectricConstant", { epsilonR: 4 });

var E = create("formula", { latex: "\\\\frac{\\\\sigma}{\\\\epsilon_0 \\\\epsilon_R}" });
var u = create("formula", { latex: "\\\\frac{1}{2} \\\\epsilon_0 |E|^2" });
graph.plot(E, "x");
graph.plot(u, "x");
`

test.beforeEach(() => useDocStore.__reset())

test('a plotted Formula card becomes a graph formula, not a bogus series', () => {
  executeSimScript('p', SCENE, { x: 0, y: 0 })
  const [g] = kind('graph')
  assert.ok(g, 'no graph created')
  assert.doesNotMatch(param(g, 'series') + param(g, 'formulas'), /\[object Object\]/)
  assert.equal(param(g, 'series'), '')
  const formulas = param(g, 'formulas').split(';').map((s) => s.trim())
  assert.equal(formulas.length, 2)
  assert.match(formulas[0], /sigma/)
  assert.match(formulas[1], /abs\(E\)/)
})

test('a second argument that is not a style names the x axis', () => {
  executeSimScript('p', SCENE, { x: 0, y: 0 })
  const [g] = kind('graph')
  assert.equal(param(g, 'xChannel'), 'x')
  assert.equal(param(g, 'plot_style'), 'line')

  useDocStore.__reset()
  executeSimScript('p', 'var b = create("mass", { x: 10, y: 10 });\ngraph.plot(b.vy, "bar");', { x: 0, y: 0 })
  assert.equal(param(kind('graph')[0], 'plot_style'), 'bar')
})

test('a plotted formula evaluates to a real number from the scene', () => {
  executeSimScript('p', SCENE, { x: 0, y: 0 })
  const scope = pageScope()
  // σ = 1 (the first plate's), ε_R = 4 (written `epsilonR` in the script).
  const E = 1 / (CONSTANTS.epsilon_0 * 4)
  assert.ok(Math.abs(scope.E - E) / E < 1e-12, `E resolved to ${scope.E}`)

  const [g] = kind('graph')
  for (const expr of param(g, 'formulas').split(';')) {
    const { value, error } = evalExpr(expr.trim(), scope, NaN)
    assert.equal(error, undefined, `${expr} → ${error}`)
    assert.ok(Number.isFinite(value) && value > 0, `${expr} → ${value}`)
  }
})

test('a bare body plots its first live channel', () => {
  executeSimScript('p', 'var b = create("mass", { x: 10, y: 10 });\ngraph.plot(b);', { x: 0, y: 0 })
  const [g] = kind('graph')
  const body = kind('circle')[0]
  assert.equal(param(g, 'series'), `${body.id}:x`)
})

test('cards created without a position do not land on each other', () => {
  executeSimScript('p', SCENE, { x: 0, y: 0 })
  const cards = kind('formula')
  assert.equal(cards.length, 2)
  const [a, b] = cards.sort((p, q) => p.position.y - q.position.y)
  assert.ok(a.position.y + a.size.h <= b.position.y, `cards overlap: ${a.position.y}+${a.size.h} vs ${b.position.y}`)
})

test('only cards other maths refers to become page variables', () => {
  executeSimScript('p', SCENE, { x: 0, y: 0 })
  const names = useDocStore.__page().variables.map((v) => v.name)
  assert.deepEqual(names, ['E'])
})
