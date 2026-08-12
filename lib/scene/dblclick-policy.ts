'use client'

// What a double-click means, declared per object kind.
//
// This used to be implicit and contradictory: canvas.tsx bound
// `onDoubleClick={openProperties}` on EVERY object's wrapper, so any
// component that wanted double-click for its own editing had to remember to
// call stopPropagation(). Five files did; the rest inherited "opens
// Properties" by accident. Add a new editable component and it silently
// opens the panel instead of editing — the bug is invisible until someone
// tries to type.
//
// Now each kind declares its intent once, here:
//
//   'edit'            content IS the object (Text, Note, Formula, Code) —
//                     double-click goes straight to editing, the way every
//                     comparable tool behaves.
//   'properties'      nothing to type into (Graph, Chart, Slider…) — the
//                     panel is the only sensible target.
//   'properties-then-edit'
//                     shapes, which have BOTH a form worth configuring and
//                     an optional text label. First double-click opens
//                     Properties; once it's open for that object, a further
//                     double-click edits the label. The window lasts as long
//                     as the object stays selected — no timer to race.

import type { GeometryKind } from './types'

export type DblClickIntent = 'edit' | 'properties' | 'properties-then-edit'

const INTENT: Partial<Record<GeometryKind, DblClickIntent>> = {
  // Content-first: typing is the whole point of these.
  text: 'edit',
  note: 'edit',
  formula: 'edit',
  code: 'edit',

  // Shapes: configurable form + optional text label.
  rect: 'properties-then-edit',
  circle: 'properties-then-edit',
  polygon: 'properties-then-edit',
  line: 'properties-then-edit',
  symbol: 'properties-then-edit',
  stroke: 'properties-then-edit',
}

/** Everything not listed has no inline text to edit, so Properties it is. */
export const dblClickIntent = (kind: GeometryKind): DblClickIntent =>
  INTENT[kind] ?? 'properties'

/** Does a double-click on this kind ever lead to inline text editing? */
export const canEditInline = (kind: GeometryKind): boolean =>
  dblClickIntent(kind) !== 'properties'

/**
 * Which object is currently past step one of 'properties-then-edit' — i.e.
 * its Properties panel was already opened by a double-click, so the next one
 * edits its label instead.
 *
 * This lives here, beside the policy, because BOTH ends of the gesture need
 * it and they sit on opposite sides of the React tree: the shape's own
 * handler (a child) fires before the canvas wrapper's (its parent), so the
 * shape cannot wait to be told — it has to ask. Module state rather than
 * context: flipping it is gesture bookkeeping that must not trigger a render.
 */
let propertiesOpenedFor: string | null = null

/** True once this object's Properties have been opened by a double-click. */
export const hasOpenedProperties = (objectId: string): boolean =>
  propertiesOpenedFor === objectId

/** Record that step one happened for this object. */
export const markPropertiesOpened = (objectId: string): void => {
  propertiesOpenedFor = objectId
}

/** Clear the state — called when the selection changes, which is what bounds
 *  the "next double-click edits" window to the object's own selection. */
export const clearPropertiesOpened = (objectId?: string): void => {
  if (!objectId || propertiesOpenedFor === objectId) propertiesOpenedFor = null
}
