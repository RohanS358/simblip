// viewportBounds/viewportCenter — the "document boundary" callers (the AI
// panel's answer placement, insertAt() for paste/drag-drop) clamp or center
// on. Verifies the actual math against a stubbed data-canvas-root element
// rather than window.innerWidth: the canvas never spans the full browser
// window (the left rail, and the AI panel when open, both cut into it), so
// a full-window center/bounds reading is wrong by exactly those panels'
// width — confirmed live: an answer landed 247px right of the real canvas
// center before this fix, matching the left rail's width almost exactly.
//
// Run: node --test lib/scene/viewport-bounds.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-viewport-'))
const stub = join(dir, 'stub-store.mjs')
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'v.mjs')

const wsStub = join(dir, 'stub-workspace.mjs')

writeFileSync(stub, `
export const useDocStore = {
  getState: () => ({ viewports: globalThis.__viewports ?? {} }),
}
`)
writeFileSync(wsStub, `
export const useWorkspaceStore = {
  getState: () => ({ nodes: globalThis.__nodes ?? {} }),
}
export const findPageMeta = (nodes, id) => {
  // Same shape the real one returns: the PageNode that OWNS this content
  // page, found either directly or via its docPages list.
  for (const n of Object.values(nodes ?? {})) {
    if (n.kind === 'page' && (n.id === id || n.docPages?.includes(id))) return n
  }
  return null
}
`)
writeFileSync(entry, `
export { viewportBounds, viewportCenter } from '@/lib/scene/insertables'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`, `--alias:@/lib/store/workspace=${wsStub}`,
  `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })

const { viewportBounds, viewportCenter } = await import(bundle)

/** No owning page node — the plain infinite-canvas case every existing test
 *  above assumes. */
globalThis.__nodes = {}

// A minimal stand-in for the canvas's data-canvas-root element — just
// enough of the DOM API viewportBounds actually calls.
function stubCanvasRoot(pageId, rect) {
  globalThis.document = {
    querySelectorAll: (sel) =>
      sel === '[data-canvas-root]'
        ? [{ dataset: { canvasRoot: pageId }, getBoundingClientRect: () => rect }]
        : [],
  }
}

test('bounds match the canvas root rect exactly at zoom 1, no pan', () => {
  globalThis.__viewports = { p: { x: 0, y: 0, zoom: 1 } }
  stubCanvasRoot('p', { left: 0, top: 0, width: 1307, height: 934, right: 1307, bottom: 934 })
  const b = viewportBounds('p')
  // Math.abs, not a bare equal: -0/zoom produces -0, and assert/strict's
  // Object.is-based equal() treats -0 !== 0 — a strict-mode assertion
  // quirk, not a bounds bug (the two are numerically identical).
  assert.equal(Math.abs(b.left), 0)
  assert.equal(Math.abs(b.top), 0)
  assert.equal(b.right, 1307)
  assert.equal(b.bottom, 934)
})

test('bounds shift with pan, scale with zoom — screen size stays the divisor', () => {
  globalThis.__viewports = { p: { x: 100, y: 50, zoom: 2 } }
  stubCanvasRoot('p', { left: 0, top: 0, width: 800, height: 600 })
  const b = viewportBounds('p')
  // world = (screen - v) / zoom, same convention canvas.tsx's screenToCanvas uses
  assert.equal(b.left, (0 - 100) / 2)
  assert.equal(b.right, (800 - 100) / 2)
  assert.equal(b.top, (0 - 50) / 2)
  assert.equal(b.bottom, (600 - 50) / 2)
})

test('center is the midpoint of the real canvas rect, not window.innerWidth', () => {
  globalThis.__viewports = { p: { x: 0, y: 0, zoom: 1 } }
  // The canvas is narrower than the window — a left rail (~400px) and the
  // AI panel are cutting into it, the exact scenario that reproduced the bug.
  stubCanvasRoot('p', { left: 400, top: 50, width: 1000, height: 900 })
  const c = viewportCenter('p')
  // getBoundingClientRect's left/top are irrelevant to the WORLD center at
  // zoom 1/no pan — only its width/height matter (viewportBounds subtracts
  // v.x/v.y, not rect.left/top), so this must land on width/2, height/2.
  assert.equal(c.x, 500)
  assert.equal(c.y, 450)
})

// ── Fixed-frame pages ───────────────────────────────────────────────────────
// A slide or a doc sheet is NOT an infinite canvas: its content lives in a
// frame of a known size (lib/scene/frames.ts), and anything placed outside
// that frame is simply invisible — it does not render in Present mode and it
// does not survive export. Reported: "when I add simulation to slides, it
// goes out of the visible slide". The viewport rect is the wrong boundary
// there; the frame is the boundary.

test('a slide is bounded by its 960x540 frame, not the scrolled viewport', () => {
  globalThis.__nodes = { n1: { id: 'n1', kind: 'page', pageKind: 'pptx', docPages: ['s1'] } }
  // A big, panned, zoomed-out viewport — exactly the state that let content
  // land far outside the slide.
  globalThis.__viewports = { s1: { x: -300, y: -200, zoom: 0.5 } }
  stubCanvasRoot('s1', { left: 0, top: 0, width: 1600, height: 1000 })
  const b = viewportBounds('s1')
  assert.equal(Math.abs(b.left), 0, 'a slide starts at x=0')
  assert.equal(Math.abs(b.top), 0, 'a slide starts at y=0')
  assert.equal(b.right, 960)
  assert.equal(b.bottom, 540)
  const c = viewportCenter('s1')
  assert.equal(c.x, 480)
  assert.equal(c.y, 270)
  globalThis.__nodes = {}
})

test('a doc sheet is bounded by its A4 frame', () => {
  globalThis.__nodes = { n2: { id: 'n2', kind: 'page', pageKind: 'doc', docPages: ['d1'] } }
  globalThis.__viewports = { d1: { x: 0, y: 0, zoom: 1 } }
  stubCanvasRoot('d1', { left: 0, top: 0, width: 1600, height: 1000 })
  const b = viewportBounds('d1')
  assert.equal(b.right, 794)
  assert.equal(b.bottom, 1123)
  globalThis.__nodes = {}
})

test('a board page keeps the live viewport — it really is infinite', () => {
  // The fix must not clamp the freeform canvas, where there is no frame and
  // placing relative to what you are looking at is exactly right.
  globalThis.__nodes = { n3: { id: 'n3', kind: 'page', pageKind: 'board', docPages: ['b1'] } }
  globalThis.__viewports = { b1: { x: 0, y: 0, zoom: 1 } }
  stubCanvasRoot('b1', { left: 0, top: 0, width: 1307, height: 934 })
  const b = viewportBounds('b1')
  assert.equal(b.right, 1307)
  assert.equal(b.bottom, 934)
  globalThis.__nodes = {}
})

test('falls back to window size when no canvas root is mounted', () => {
  globalThis.__viewports = { p: { x: 0, y: 0, zoom: 1 } }
  globalThis.document = { querySelectorAll: () => [] }
  globalThis.window = { innerWidth: 1200, innerHeight: 800 }
  const b = viewportBounds('p')
  assert.equal(Math.abs(b.left), 0)
  assert.equal(Math.abs(b.top), 0)
  assert.equal(b.right, 1200)
  assert.equal(b.bottom, 800)
  delete globalThis.window
})
