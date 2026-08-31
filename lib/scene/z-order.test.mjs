// Stacking order. The bug being locked down: z values stamped from
// Date.now() (~1.7e12) overflow CSS's 32-bit z-index and all clamp to the
// same layer, so newly drawn ink could never render above an existing
// picture no matter what number the code computed.
//
// Run directly:  node lib/scene/z-order.test.mjs

import assert from 'node:assert/strict'

// Compile the REAL module with the project's own TypeScript rather than
// regex-stripping types out of it. A hand-rolled stripper kept breaking on
// ordinary syntax (`new Set<number>()`, annotated arrow returns) and a test
// that silently tests a mangled copy of the source is worse than no test.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

const srcPath = new URL('./z-order.ts', import.meta.url)
const js = ts.transpileModule(readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText

const out = join(mkdtempSync(join(tmpdir(), 'zorder-')), 'z-order.mjs')
writeFileSync(out, js)
const mod = await import(`file://${out}`)
const { CSS_Z_MAX, needsNormalize, stackOrder, normalizeZ, nextTopZ, reorderZ, restackZ, paintBands } = mod

const obj = (id, z) => ({ id, z })
const page = (...os) => Object.fromEntries(os.map((o) => [o.id, o]))
const ids = (list) => list.map((o) => o.id)
const zs = (map) => Object.fromEntries(Object.values(map).map((o) => [o.id, o.z]))

// ── The actual reported bug ────────────────────────────────────────────────
// A picture stamped with Date.now() and a stroke stamped by the small
// counter. Before normalization the two are NOT distinguishable to CSS.
const NOW = 1788180057060
assert.ok(NOW > CSS_Z_MAX, 'a Date.now() z really does exceed the CSS ceiling')
const broken = page(obj('picture', NOW), obj('ink', 57061))
assert.equal(needsNormalize(broken), true, 'a timestamp z is flagged for normalization')

const fixed = normalizeZ(broken)
assert.deepEqual(zs(fixed), { ink: 1, picture: 2 }, 'normalizing preserves relative order, tiny numbers')
for (const o of Object.values(fixed)) assert.ok(o.z <= CSS_Z_MAX, 'every z is CSS-representable')

// …and now new ink can actually land on top, which was impossible before.
assert.equal(nextTopZ(fixed), 3, 'a new stroke goes above the picture')

// ── Normalization basics ───────────────────────────────────────────────────
const clean = page(obj('a', 1), obj('b', 2), obj('c', 3))
assert.equal(needsNormalize(clean), false, 'dense ordinals need no work')
assert.equal(normalizeZ(clean), clean, 'a clean page keeps its identity (no store write)')

assert.deepEqual(
  zs(normalizeZ(page(obj('a', 10), obj('b', 20), obj('c', 30)))),
  { a: 1, b: 2, c: 3 },
  'sparse values compact to ordinals'
)
assert.equal(needsNormalize(page(obj('a', 1.5))), true, 'a fractional z is not a valid ordinal')
assert.equal(needsNormalize(page(obj('a', -1))), true, 'a negative z is flagged')
assert.equal(needsNormalize(page(obj('a', NaN))), true, 'a NaN z is flagged')

// Ties break on id, so the order is stable rather than key-insertion order.
assert.deepEqual(ids(stackOrder(page(obj('b', 5), obj('a', 5)))), ['a', 'b'], 'ties break on id')

// ── Drag-to-reorder ────────────────────────────────────────────────────────
const four = page(obj('a', 1), obj('b', 2), obj('c', 3), obj('d', 4))

// Drag 'a' (bottom) to sit directly above 'c'.
let patch = reorderZ(four, ['a'], 'c')
assert.deepEqual(patch, { b: 1, c: 2, a: 3 }, 'a moves up; d already sat at 4')

// Drag 'd' (top) to the very bottom.
patch = reorderZ(four, ['d'], null)
assert.deepEqual(patch, { d: 1, a: 2, b: 3, c: 4 }, 'null anchor means send to the bottom')

// A multi-object drag keeps the dragged items' own relative order, even when
// the caller lists them backwards.
patch = reorderZ(four, ['c', 'a'], 'd')
assert.deepEqual(patch, { b: 1, d: 2, a: 3, c: 4 }, 'a stays below c despite the argument order')

// Dropping something where it already is changes nothing.
assert.deepEqual(reorderZ(four, ['b'], 'a'), {}, 'a no-op drag writes nothing')
assert.deepEqual(reorderZ(four, [], 'a'), {}, 'an empty drag writes nothing')
assert.deepEqual(reorderZ(four, ['a'], 'nope'), {}, 'an unknown anchor is refused, not guessed')
assert.deepEqual(reorderZ(four, ['a'], 'a'), {}, 'dropping onto the dragged object is a no-op')

// ── Bring to front / send to back ──────────────────────────────────────────
assert.deepEqual(restackZ(four, ['a'], 'front'), { b: 1, c: 2, d: 3, a: 4 }, 'bring to front')
assert.deepEqual(restackZ(four, ['d'], 'back'), { d: 1, a: 2, b: 3, c: 4 }, 'send to back')
assert.deepEqual(restackZ(four, ['a', 'b'], 'front'), { c: 1, d: 2, a: 3, b: 4 }, 'group keeps order')
assert.deepEqual(restackZ(four, ['d'], 'front'), {}, 'already at the front: nothing to write')
assert.deepEqual(restackZ(four, ['a'], 'back'), {}, 'already at the back: nothing to write')
assert.deepEqual(
  restackZ(four, ['a', 'b', 'c', 'd'], 'front'),
  {},
  'selecting everything is already "at the front"'
)

// ── System boundaries stay backdrops ───────────────────────────────────────
// A system boundary is drawn UNDER the parts inside it. It sits at z 0,
// outside the 1..N ordinal range, and normalization must leave it there
// rather than shuffling it into the stack as "the bottom object".
const sys = { id: 'sys', z: 0, metadata: { render: 'system' } }
const withSystem = page(sys, obj('part', 5), obj('ink', 9))
assert.equal(needsNormalize(withSystem), true, 'the non-backdrop members still need compacting')
const normSys = normalizeZ(withSystem)
assert.deepEqual(zs(normSys), { sys: 0, part: 1, ink: 2 }, 'the backdrop keeps z 0; parts compact above it')
assert.equal(
  needsNormalize(page(sys, obj('part', 1))),
  false,
  'a backdrop at 0 beside a clean 1..N stack needs no work'
)
// A plain object at z 0 is NOT a backdrop — only the system render tag is.
assert.equal(needsNormalize(page(obj('a', 0))), true, 'z 0 without the system tag is out of range')

// ── Ordinals never approach the CSS ceiling ────────────────────────────────
const big = page(...Array.from({ length: 5000 }, (_, i) => obj(`o${i}`, Date.now() + i)))
const normalized = normalizeZ(big)
const maxZ = Math.max(...Object.values(normalized).map((o) => o.z))
assert.equal(maxZ, 5000, '5000 objects normalize to 5000, not to a timestamp')
assert.ok(maxZ < CSS_Z_MAX, 'still nowhere near the CSS ceiling')

// ── Paint bands: the reported "ink still goes below the picture" bug ──────
// The canvas batches bare ink into one <svg> per run. Batching by KIND put
// every stroke in one layer painted before every object, so ink drawn OVER a
// picture still rendered under it — z was correct and the screen disagreed.
const ink = (id, z) => ({ id, z, ink: true })
const pic = (id, z) => ({ id, z, ink: false })
const isInk = (o) => o.ink
const shape = (bs) => bs.map((b) => [b.batched, b.objects.map((o) => o.id)])

// A stroke drawn ON TOP of a picture must end up in a band AFTER it.
assert.deepEqual(
  shape(paintBands([pic('photo', 1), ink('wire', 2)], isInk)),
  [[false, ['photo']], [true, ['wire']]],
  'ink above a picture paints after it'
)
// …and a stroke genuinely underneath still paints first.
assert.deepEqual(
  shape(paintBands([ink('under', 1), pic('photo', 2)], isInk)),
  [[true, ['under']], [false, ['photo']]],
  'ink below a picture paints before it'
)
// The real schematic case: wires under AND over the same photo.
assert.deepEqual(
  shape(paintBands([ink('below', 1), pic('photo', 2), ink('above', 3)], isInk)),
  [[true, ['below']], [false, ['photo']], [true, ['above']]],
  'ink interleaves around a picture instead of collapsing to one layer'
)

// Batching still works: a run of adjacent strokes shares ONE band, which is
// the performance property the old kind-split was protecting.
assert.deepEqual(
  shape(paintBands([ink('a', 1), ink('b', 2), ink('c', 3), pic('p', 4)], isInk)),
  [[true, ['a', 'b', 'c']], [false, ['p']]],
  'adjacent strokes share a single batch'
)
// A handwritten page is still exactly one band, not one per stroke.
const many = Array.from({ length: 500 }, (_, i) => ink(`s${i}`, i + 1))
assert.equal(paintBands(many, isInk).length, 1, '500 strokes batch into one layer')

// Input order must not matter — z decides.
assert.deepEqual(
  shape(paintBands([ink('above', 3), pic('photo', 2), ink('below', 1)], isInk)),
  [[true, ['below']], [false, ['photo']], [true, ['above']]],
  'bands come from z, not from the order the caller passed'
)
assert.deepEqual(paintBands([], isInk), [], 'an empty page has no bands')

// ── The round trip: a Layers drag actually changes what you see ───────────
// reorderZ and paintBands have to compose. This is the loop the user runs:
// draw over a photo, then drag the photo to the top and expect it to cover
// the ink. Testing them apart would miss a disagreement between the two.
{
  const mk = (id, z, isInk) => ({ id, z, ink: isInk })
  let objs = { photo: mk('photo', 1, false), wire: mk('wire', 2, true) }

  assert.deepEqual(
    shape(paintBands(Object.values(objs), isInk)),
    [[false, ['photo']], [true, ['wire']]],
    'baseline: ink drawn last paints over the photo'
  )

  // Drag the photo to the top of the Layers list.
  const moved = reorderZ(objs, ['photo'], 'wire')
  assert.deepEqual(moved, { wire: 1, photo: 2 }, 'the photo takes the top slot')
  for (const [id, z] of Object.entries(moved)) objs[id] = { ...objs[id], z }

  assert.deepEqual(
    shape(paintBands(Object.values(objs), isInk)),
    [[true, ['wire']], [false, ['photo']]],
    'after the drag the photo paints last, hiding the ink'
  )
}

console.log('z-order: ok')
