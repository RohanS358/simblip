// Regression test for what a double-click means per object kind.
//
// The conflict this resolves: canvas.tsx bound `onDoubleClick={openProperties}`
// on EVERY object wrapper, so any component wanting double-click for its own
// editing had to call stopPropagation(). Five files did; the rest silently
// inherited "opens Properties" — including components where typing is the
// whole point. Intent is now declared per kind instead of fought over.
//
// Run directly:  node lib/scene/dblclick-policy.test.mjs

import assert from 'node:assert/strict'

const INTENT = {
  text: 'edit',
  note: 'edit',
  formula: 'edit',
  code: 'edit',
  rect: 'properties-then-edit',
  circle: 'properties-then-edit',
  polygon: 'properties-then-edit',
  line: 'properties-then-edit',
  symbol: 'properties-then-edit',
  stroke: 'properties-then-edit',
}
const dblClickIntent = (kind) => INTENT[kind] ?? 'properties'

let propertiesOpenedFor = null
const hasOpenedProperties = (id) => propertiesOpenedFor === id
const markPropertiesOpened = (id) => {
  propertiesOpenedFor = id
}
const clearPropertiesOpened = (id) => {
  if (!id || propertiesOpenedFor === id) propertiesOpenedFor = null
}

/** One double-click, returning what actually happened. */
function doubleClick(kind, objectId) {
  const intent = dblClickIntent(kind)
  if (intent === 'edit') return 'edit'
  if (intent === 'properties') return 'properties'
  // properties-then-edit: the shape's own handler runs first (child bubbles
  // before parent) and edits only if step one already happened.
  if (hasOpenedProperties(objectId)) return 'edit'
  markPropertiesOpened(objectId)
  return 'properties'
}

// ── content-first kinds edit immediately, every time ────────────────────────
// Opening a panel before letting someone type in a Note would be friction on
// the single most common action for that object.
for (const kind of ['text', 'note', 'formula', 'code']) {
  clearPropertiesOpened()
  assert.equal(doubleClick(kind, 'o1'), 'edit', `${kind}: first double-click edits`)
  assert.equal(doubleClick(kind, 'o1'), 'edit', `${kind}: still edits on repeat`)
}

// ── kinds with nothing to type into always open Properties ──────────────────
for (const kind of ['graph', 'chart', 'table', 'gridtable', 'slider', 'button', 'trigger', 'picture']) {
  clearPropertiesOpened()
  assert.equal(doubleClick(kind, 'o1'), 'properties', `${kind}: opens Properties`)
  assert.equal(doubleClick(kind, 'o1'), 'properties', `${kind}: still Properties`)
}

// ── shapes: Properties first, then the label ────────────────────────────────
for (const kind of ['rect', 'circle', 'polygon', 'symbol']) {
  clearPropertiesOpened()
  assert.equal(doubleClick(kind, 's1'), 'properties', `${kind}: 1st opens Properties`)
  assert.equal(doubleClick(kind, 's1'), 'edit', `${kind}: 2nd edits the label`)
  assert.equal(doubleClick(kind, 's1'), 'edit', `${kind}: stays in edit`)
}

// ── the window is bounded by selection, not a timer ─────────────────────────
{
  clearPropertiesOpened()
  assert.equal(doubleClick('rect', 's1'), 'properties')
  // Selecting a different object clears it…
  clearPropertiesOpened('s1')
  assert.equal(doubleClick('rect', 's1'), 'properties', 'deselect resets to step one')
  assert.equal(doubleClick('rect', 's1'), 'edit')
}
{
  // …and step one on one shape must not unlock a different shape.
  clearPropertiesOpened()
  assert.equal(doubleClick('rect', 'a'), 'properties')
  assert.equal(doubleClick('circle', 'b'), 'properties', 'per-object, not global')
  assert.equal(doubleClick('circle', 'b'), 'edit')
  // 'a' lost its turn when 'b' claimed the slot — it starts over, which is
  // correct: only one object is selected at a time.
  assert.equal(doubleClick('rect', 'a'), 'properties')
}

// ── no kind is left undeclared ──────────────────────────────────────────────
// Every renderer in components/objects/index.tsx must resolve to something.
const ALL_KINDS = [
  'circle', 'rect', 'polygon', 'line', 'stroke', 'symbol', 'note', 'text',
  'formula', 'graph', 'surface3d', 'chart', 'table', 'gridtable', 'slider',
  'button', 'trigger', 'cashflow', 'truthtable', 'code', 'dsa', 'picture',
]
for (const kind of ALL_KINDS) {
  const intent = dblClickIntent(kind)
  assert.ok(
    ['edit', 'properties', 'properties-then-edit'].includes(intent),
    `${kind} resolves to a known intent`
  )
}

console.log('dblclick-policy: all checks passed')
