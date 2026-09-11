'use client'

// Document store: page content (objects + variables) plus ephemeral editor
// state (selection, viewport, tool). Content persists; editor state and
// undo history do not — history is an in-memory ring per page.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  SceneObject,
  Variable,
  BehaviorType,
  NumericParam,
  ParamValue,
} from '@/lib/scene/types'
import { renameInExpr } from '@/lib/scene/bindings'
import { needsNormalize, normalizeZ } from '@/lib/scene/z-order'
import { uid } from '@/lib/scene/types'
import { createBehavior } from '@/lib/behaviors/registry'
import { solveScope, evalExpr, extractLiveRefs, type LiveRef, type Scope } from '@/lib/formula/engine'
import { CONSTANTS, paramScopeOf } from '@/lib/formula/scope'
import { readBuffer, type Sample } from '@/lib/physics/bus'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'
import * as archive from '@/lib/store/page-archive'
import { dropBuffer } from '@/lib/physics/bus'
import { markPageDeleted } from '@/lib/store/deleted-pages'
import { pointAtBoundaryT, type ConnectorAnchor } from '@/lib/scene/connectors'
import { refitBends } from '@/lib/render/connector-path'
import { terminalsOf, terminalWorld } from '@/lib/circuit/engine'
import { ANCHOR_INDEX } from '@/lib/scene/simscript-props'

/** Resolves an anchor to a world point on `obj`. Anchors without a `kind`
 *  field predate the terminal-anchor change and are treated as boundary
 *  anchors for backward compatibility. */
function resolveAnchorPoint(anchor: ConnectorAnchor | { objectId: string; t: number }, obj: SceneObject): { x: number; y: number } {
  // Scripted wiring names its anchor ('centre', 'positive', 'in1'), because
  // that is what connect() was given. Resolve it against the LIVE object, so
  // the end tracks a terminal that moved when the component was resized.
  const named = (anchor as { anchorName?: string }).anchorName
  if (named !== undefined) {
    const centre = { x: obj.position.x + obj.size.w / 2, y: obj.position.y + obj.size.h / 2 }
    const defs = terminalsOf(obj)
    const norm = named.replace(/^input/i, 'in').replace(/^output/i, 'out')
    if (defs.length === 0 || norm.toLowerCase() === 'centre' || norm.toLowerCase() === 'center') {
      return centre
    }
    // Same name→index table SimScript's connect() used to place this wire, so
    // the end lands back on the pin it was drawn to.
    const symMap = ANCHOR_INDEX[obj.geometry.symbol ?? ''] ?? {}
    const idx = symMap[named] ?? symMap[norm] ?? ANCHOR_INDEX._t2?.[named] ?? ANCHOR_INDEX._t2?.[norm]
    const t = typeof idx === 'number' ? defs[idx] : undefined
    return t ? terminalWorld(obj, t) : centre
  }
  const kind = 'kind' in anchor ? anchor.kind : 'boundary'
  if (kind === 'terminal') {
    const a = anchor as { objectId: string; terminalId: string }
    const defs = terminalsOf(obj)
    const t = defs[Number(a.terminalId)]
    // ponytail: terminal-not-found (e.g. gate input count changed under a stale anchor) falls back to boundary t=0 rather than crashing
    return t ? terminalWorld(obj, t) : pointAtBoundaryT(obj, 0)
  }
  const a = anchor as { objectId: string; t: number }
  return pointAtBoundaryT(obj, a.t)
}

export type Tool =
  | 'select'
  | 'lasso' // touch: drag over/across objects to multi-select, never moves them
  | 'pen' // freehand with sketch recognition
  | 'shaper' // freehand that ALWAYS beautifies: straightens, smooths, snaps shapes
  | 'eraser' // drag over ink to remove it
  | 'circle'
  | 'rect'
  | 'line'
  | 'measurement' // point-to-point ruler: a line tagged metadata.render='measurement'
  | 'shape' // placing a shape from the Shapes group (toolOption = shape id)
  | 'text'
  | 'note'
  | 'formula'
  | 'code'
  | 'graph'
  | 'surface3d'
  | 'chart'
  | 'table'
  | 'gridtable'
  | 'slider'
  | 'button'
  | 'trigger'
  | 'place' // placing a palette component (toolOption = component id)

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** A frozen copy of every Graph source's buffer at the moment "Pin this
 *  run" was pressed — one at a time, A/B not an experiment-management
 *  system (UX masterplan §14). */
export interface PinnedRun {
  label: string
  pinnedAt: number
  samples: Record<string, Sample[]>
}

interface PageContent {
  objects: Record<string, SceneObject>
  variables: Variable[]
  /** A doc page's flowing body text (ProseMirror JSON). See PageDoc.flow in
   *  lib/scene/types.ts — this interface is its in-memory mirror, and every
   *  function below that REBUILDS a PageContent from parts has to carry it
   *  through, or typing a sentence and then dragging an object would silently
   *  erase the sentence. */
  flow?: string
}

const HISTORY_CAP = 100
const histories = new Map<string, { past: PageContent[]; future: PageContent[] }>()
// Continuous gestures (resize/rotate drags, and the Inspector's Figma-style
// scrub-to-adjust) call updateObject(...,{history:true}) on every intermediate
// move so the canvas updates live — without this, that would push one undo
// entry per pixel moved. Coalesce same-page pushes within a short window
// into the single entry from before the gesture started; a real pause
// (>400ms) between edits still opens a fresh boundary.
const COALESCE_MS = 400
const lastPushAt = new Map<string, number>()

/**
 * Undo snapshot. Objects are treated as IMMUTABLE everywhere (every mutation
 * builds a new object via {...obj, ...patch}), so a snapshot only has to copy
 * the maps — the untouched objects can be shared by reference. The old
 * `JSON.parse(JSON.stringify(page))` serialized the entire page on every
 * gesture, which on a big page is the hitch you feel when you start dragging.
 */
const snapshotOf = (c: PageContent): PageContent => ({
  ...c,
  objects: { ...c.objects },
  variables: c.variables.map((v) => ({ ...v })),
})

/** Resolve every [Object(channel)] token on the page to the object's latest
 * live sample from the physics bus (0 before the sim produces data). */
function liveScopeOf(content: PageContent): Scope {
  const refs: LiveRef[] = []
  for (const v of content.variables) extractLiveRefs(v.expr, refs)
  for (const obj of Object.values(content.objects)) {
    for (const p of Object.values(obj.parameters)) if (p.kind === 'number') extractLiveRefs(p.expr, refs)
    for (const b of obj.behaviors)
      for (const p of Object.values(b.params)) if (p.kind === 'number') extractLiveRefs(p.expr, refs)
  }
  if (refs.length === 0) return {}
  const live: Scope = {}
  const byName = new Map(Object.values(content.objects).map((o) => [o.name, o.id]))
  for (const r of refs) {
    const id = byName.get(r.object)
    const buf = id ? readBuffer(id) : undefined
    const last = buf?.samples[buf.samples.length - 1]
    live[r.sym] = last?.channels[r.channel] ?? 0
  }
  return live
}

/**
 * A param whose expression is a bare number can't depend on the scope, so it
 * never needs re-solving. Most params on a page are literals ("5", "0.3"), and
 * every one of them was being handed to the mathjs parser on every single
 * edit. Skipping them is the difference between parsing thousands of
 * expressions per keystroke and parsing the handful that actually reference a
 * variable.
 */
const LITERAL = /^\s*-?\d+(\.\d+)?\s*$/

function solveParam(
  param: NumericParam,
  scope: Scope
): { value: number; error?: string } | null {
  if (LITERAL.test(param.expr)) {
    const v = Number(param.expr)
    return v === param.value && param.error === undefined ? null : { value: v }
  }
  const { value, error } = evalExpr(param.expr, scope, param.value)
  return value === param.value && error === param.error ? null : { value, error }
}

/** Re-solve variables, then re-evaluate every numeric expression on the page —
 * object content params AND behavior params. One scope, spreadsheet semantics. */
function reevaluate(content: PageContent): { content: PageContent; scope: Scope } {
  const { variables, scope } = solveScope(content.variables, {
    ...CONSTANTS,
    ...paramScopeOf(content),
    ...liveScopeOf(content),
  })
  const objects: Record<string, SceneObject> = {}
  for (const [id, obj] of Object.entries(content.objects)) {
    let changed = false
    const parameters = { ...obj.parameters }
    for (const [name, param] of Object.entries(parameters)) {
      if (param.kind === 'number') {
        const next = solveParam(param, scope)
        if (next) {
          parameters[name] = { ...param, ...next, error: next.error }
          changed = true
        }
      }
    }
    const behaviors = obj.behaviors.map((b) => {
      let bChanged = false
      const params = { ...b.params }
      for (const [name, param] of Object.entries(params)) {
        if (param.kind === 'number') {
          const next = solveParam(param, scope)
          if (next) {
            params[name] = { ...param, ...next, error: next.error }
            bChanged = true
          }
        }
      }
      if (bChanged) changed = true
      return bChanged ? { ...b, params } : b
    })
    objects[id] = changed ? { ...obj, parameters, behaviors } : obj
  }
  // Stacking order is repaired HERE because this is the one function every
  // page load, undo and mutation already flows through. Pages saved before
  // z was an ordinal carry Date.now()-scale values that overflow CSS's
  // 32-bit z-index and all clamp to the same layer — see lib/scene/z-order.
  // needsNormalize() keeps this free for the overwhelmingly common case: a
  // clean page returns the identical objects map, so nothing re-renders.
  const stacked = needsNormalize(objects) ? normalizeZ(objects) : objects
  return { content: { ...content, objects: stacked, variables }, scope }
}

/**
 * Rewrite every [oldName(channel)] token on a page to the object's new name —
 * the three places liveScopeOf() scans for them: page variables, object
 * params, behavior params. Without this, renaming an object silently zeroes
 * every formula that referenced it (the token resolves by name, finds
 * nothing, and yields 0 rather than an error).
 *
 * Writes only when something actually changed, so the common rename — one
 * where no formula mentions the object — costs a scan and no re-render.
 */
function renameLiveRefs(
  get: () => DocState,
  set: (fn: (s: DocState) => Partial<DocState>) => void,
  pageId: string,
  oldName: string,
  newName: string
) {
  const page = get().pages[pageId]
  if (!page) return

  const rewriteParams = (
    params: Record<string, ParamValue>
  ): Record<string, ParamValue> | null => {
    let changed = false
    const next = { ...params }
    for (const [name, p] of Object.entries(params)) {
      if (p.kind !== 'number') continue
      const expr = renameInExpr(p.expr, oldName, newName)
      if (expr !== p.expr) {
        next[name] = { ...p, expr }
        changed = true
      }
    }
    return changed ? next : null
  }

  let dirty = false

  const variables = page.variables.map((v) => {
    const expr = renameInExpr(v.expr, oldName, newName)
    if (expr === v.expr) return v
    dirty = true
    return { ...v, expr }
  })

  const objects: Record<string, SceneObject> = {}
  for (const [id, obj] of Object.entries(page.objects)) {
    const parameters = rewriteParams(obj.parameters)
    let bDirty = false
    const behaviors = obj.behaviors.map((b) => {
      const params = rewriteParams(b.params)
      if (!params) return b
      bDirty = true
      return { ...b, params }
    })
    if (parameters || bDirty) {
      dirty = true
      objects[id] = { ...obj, parameters: parameters ?? obj.parameters, behaviors }
    } else {
      objects[id] = obj
    }
  }

  if (!dirty) return
  set((s) => ({ pages: { ...s.pages, [pageId]: { ...page, objects, variables } } }))
}

interface DocState {
  pages: Record<string, PageContent>
  tool: Tool
  toolOption: string | null
  /** Pen strokes are recognized into shapes/components (off = raw ink). */
  inkToShape: boolean
  /** Small scribbles near components open the value/name annotation input. */
  inkAnnotate: boolean
  selection: string[]
  viewports: Record<string, Viewport>
  scopes: Record<string, Scope>
  /** "Pin this run" (UX masterplan §14): one page-local A/B snapshot, keyed
   *  like viewports/scopes rather than living in the synced PageDoc — it's
   *  session scratch for comparing against, not part of the document. */
  pinnedRuns: Record<string, PinnedRun | undefined>

  ensurePage: (pageId: string) => void
  /** Bring a page into memory from the archive (or create it). Idempotent. */
  loadPage: (pageId: string) => void
  /** Flush these pages to the archive and drop them from memory. Never
   *  deletes anything — see lib/store/page-cache.ts for the policy. */
  unloadPages: (pageIds: string[]) => void
  /** Same, for everything except the given pages (used under memory pressure). */
  unloadPagesExcept: (keepIds: string[]) => void
  /** Real deletion: forget the content everywhere (memory + archive). */
  forgetPage: (pageId: string) => void
  /** Scan a (loaded) page's objects and return all `opfs:<id>` file-IDs
   *  embedded in picture geometry.src — used by workspace.ts to schedule
   *  OPFS cleanup before the page is evicted via forgetPage. Returns [] when
   *  the page is not in memory (already evicted or never loaded). */
  collectPageOpfsRefs: (pageId: string) => string[]
  pushHistory: (pageId: string) => void
  undo: (pageId: string) => void
  redo: (pageId: string) => void

  /** Replace a doc page's flowing body text (ProseMirror JSON). No history
   *  push — ProseMirror owns undo for the flow, exactly as the canvas's undo
   *  ring owns it for objects; one Ctrl+Z must not cross the two layers. */
  setFlow: (pageId: string, flow: string) => void

  addObject: (pageId: string, obj: SceneObject, options?: { history?: boolean }) => void
  updateObject: (
    pageId: string,
    id: string,
    patch: Partial<SceneObject>,
    options?: { history?: boolean }
  ) => void
  removeObjects: (pageId: string, ids: string[]) => void
  /** Re-resolve [Object(channel)] live refs and re-solve the page. Called
   *  throttled by the runtime while the simulation plays; no history push. */
  refreshLive: (pageId: string) => void
  setParam: (pageId: string, objectId: string, name: string, expr: string) => void
  setStringParam: (pageId: string, objectId: string, name: string, value: string) => void
  updateObjectParameter: (pageId: string, objectId: string, name: string, value: unknown) => void

  addBehavior: (pageId: string, objectId: string, type: BehaviorType) => void
  removeBehavior: (pageId: string, objectId: string, behaviorId: string) => void
  toggleBehavior: (pageId: string, objectId: string, behaviorId: string) => void
  setBehaviorParam: (
    pageId: string,
    objectId: string,
    behaviorId: string,
    name: string,
    expr: string
  ) => void

  addVariable: (pageId: string, name?: string, expr?: string) => void
  /** Define (or redefine) a variable BY NAME, without a history entry — the
   *  script path, where the same run re-executed must not stack up `E1`,
   *  `E2`, `E3` the way addVariable's unique-name suffixing would. */
  upsertVariable: (pageId: string, name: string, expr: string) => void
  updateVariable: (pageId: string, id: string, patch: { name?: string; expr?: string }) => void
  removeVariable: (pageId: string, id: string) => void

  setTool: (tool: Tool, option?: string | null) => void
  toggleInkToShape: () => void
  toggleInkAnnotate: () => void
  setSelection: (ids: string[]) => void
  setViewport: (pageId: string, vp: Viewport) => void
  /** Freezes every Graph object's source buffer on this page into a named
   *  snapshot, overwriting any previous pin (one at a time). */
  pinCurrentRun: (pageId: string, label?: string) => void
  clearPinnedRun: (pageId: string) => void
}

function patchObject(
  s: DocState,
  pageId: string,
  objectId: string,
  fn: (obj: SceneObject) => SceneObject
): Partial<DocState> {
  const page = s.pages[pageId]
  const obj = page?.objects[objectId]
  if (!page || !obj) return {}
  // Locked objects (submission-review's frozen base, UX masterplan §18) are
  // read-only through every mutation path — move, resize, rotate, params,
  // behaviors — since they all funnel through this one function. New marks
  // added on top (ink, notes) are ordinary unlocked objects, unaffected.
  if (obj.metadata.locked) return {}
  return {
    pages: {
      ...s.pages,
      [pageId]: { ...page, objects: { ...page.objects, [objectId]: fn(obj) } },
    },
  }
}

/** After `movedObjectId` changes position/size, snap back any connector's
 *  end(s) anchored to it (metadata.{start,end}Anchor). Keeps the connector's
 *  bend points where they were — only the anchored endpoint moves — so a
 *  connector attached at both ends stays visually attached without the
 *  user re-drawing it. Cheap on the common (no-connectors) case: one pass
 *  over objects, and it bails per-object on the first metadata check. */
/** A connection has TWO storage forms and both must follow their targets:
 *
 *  - hand-drawn: `metadata.{start,end}Anchor`, a ConnectorAnchor.
 *  - scripted:   a wire/rod/spring/rope/damper behavior carrying
 *                `targetA`/`anchorA`/`targetB`/`anchorB` params, which is what
 *                SimScript's connect() writes.
 *
 *  Reading only the first meant every scripted circuit — the AI's, a course
 *  figure's, an imported page's — detached the moment a component moved. */
function wiringOf(obj: SceneObject): {
  start?: ConnectorAnchor | { objectId: string; t: number }
  end?: ConnectorAnchor | { objectId: string; t: number }
} | null {
  const meta = obj.metadata
  if (meta.render === 'connector') {
    return {
      start: meta.startAnchor as ConnectorAnchor | undefined,
      end: meta.endAnchor as ConnectorAnchor | undefined,
    }
  }
  const b = obj.behaviors.find((bh) => bh.params?.targetA && bh.params?.targetB)
  if (!b) return null
  const pv = (n: string): string | undefined => {
    const p = b.params[n]
    return p?.kind === 'string' ? p.value : undefined
  }
  const a = pv('targetA')
  const z = pv('targetB')
  if (!a || !z) return null
  // An anchor NAME (a terminal or 'centre') rather than an index — resolved
  // against the live object below, so it survives the target being resized.
  return {
    start: { objectId: a, anchorName: pv('anchorA') } as never,
    end: { objectId: z, anchorName: pv('anchorB') } as never,
  }
}

function reprojectConnectors(page: PageContent, movedObjectId: string): PageContent {
  let objects = page.objects
  let changed = false
  for (const obj of Object.values(page.objects)) {
    if (obj.metadata.locked) continue
    const wiring = wiringOf(obj)
    if (!wiring) continue
    const startAnchor = wiring.start
    const endAnchor = wiring.end
    if (startAnchor?.objectId !== movedObjectId && endAnchor?.objectId !== movedObjectId) continue

    const movedObj = objects[movedObjectId]
    if (!movedObj) continue

    const pts = obj.geometry.points ?? [[0, 0], [obj.size.w, 0]]
    let a = { x: obj.position.x + pts[0][0], y: obj.position.y + pts[0][1] }
    let b = { x: obj.position.x + pts[pts.length - 1][0], y: obj.position.y + pts[pts.length - 1][1] }

    // Resolve BOTH anchors, each against the object it actually names — not
    // just the end belonging to whatever moved.
    //
    // Only re-resolving the moved end left the opposite end on whatever
    // coordinates it happened to hold. That is correct when the connector was
    // drawn by hand between two settled objects, and wrong everywhere else: a
    // connector built by script (SimScript's connect(), an imported page, a
    // course figure) carries placeholder geometry until something moves, so it
    // rendered visibly detached at one end until the user dragged the RIGHT
    // object. An anchor is a promise that the end follows its target, and a
    // promise that only holds for the thing you touched last is not one.
    const startObj = startAnchor ? objects[startAnchor.objectId] : undefined
    const endObj = endAnchor ? objects[endAnchor.objectId] : undefined
    if (startAnchor && startObj) a = resolveAnchorPoint(startAnchor, startObj)
    if (endAnchor && endObj) b = resolveAnchorPoint(endAnchor, endObj)

    const px = Math.min(a.x, b.x)
    const py = Math.min(a.y, b.y)
    const localA = [a.x - px, a.y - py]
    const localB = [b.x - px, b.y - py]
    const newPoints = [localA, localB]

    // Bends are stored object-LOCAL, so a new bounding-box origin shifts every
    // one of them unless they're rebased by the same delta — and rebasing
    // alone would still leave a diagonal segment at the moved end. refitBends
    // does both, which is what keeps a dragged connector orthogonal instead of
    // straightening into a slanted line.
    const oldBends = obj.metadata.bends as number[][] | undefined
    let newMeta = obj.metadata
    if (oldBends && oldBends.length > 0) {
      const dx = obj.position.x - px
      const dy = obj.position.y - py
      const rebased = oldBends.map((p) => [p[0] + dx, p[1] + dy])
      newMeta = { ...obj.metadata, bends: refitBends(localA, rebased, localB) }
    }

    const newObj = {
      ...obj,
      position: { x: px, y: py },
      size: { w: Math.max(Math.abs(b.x - a.x), 2), h: Math.max(Math.abs(b.y - a.y), 2) },
      geometry: { ...obj.geometry, points: newPoints },
      metadata: newMeta,
    }
    if (!changed) objects = { ...objects }
    objects[obj.id] = newObj
    changed = true
  }
  return changed ? { ...page, objects } : page
}

export const useDocStore = create<DocState>()(
  persist(
    (set, get) => ({
      pages: {},
      tool: 'select',
      toolOption: null,
      inkToShape: true,
      inkAnnotate: false, // opt-in: a stray scribble shouldn't retitle a part
      selection: [],
      viewports: {},
      scopes: {},
      pinnedRuns: {},

      ensurePage: (pageId) => {
        const existing = get().pages[pageId]
        if (existing) {
          if (!get().scopes[pageId]) {
            const { content, scope } = reevaluate(existing)
            set((s) => ({
              pages: { ...s.pages, [pageId]: content },
              scopes: { ...s.scopes, [pageId]: scope },
            }))
          }
          return
        }
        // Not resident — rehydrate it from the archive before assuming it's
        // new. Getting this wrong would silently blank an existing page.
        const stored = archive.readPage(pageId)
        if (stored) {
          const { content, scope } = reevaluate(stored)
          set((s) => ({
            pages: { ...s.pages, [pageId]: content },
            scopes: { ...s.scopes, [pageId]: scope },
          }))
          return
        }
        set((s) => ({
          pages: { ...s.pages, [pageId]: { objects: {}, variables: [] } },
          scopes: { ...s.scopes, [pageId]: {} },
        }))
      },

      loadPage: (pageId) => get().ensurePage(pageId),

      unloadPages: (pageIds) => {
        const { pages } = get()
        const evict = pageIds.filter((id) => pages[id])
        if (evict.length === 0) return
        for (const id of evict) {
          // Persist BEFORE dropping — the archive is the durable copy now.
          archive.writePage(id, pages[id])
          // Graph history belongs to objects that are about to leave memory.
          for (const objId of Object.keys(pages[id].objects)) dropBuffer(objId)
        }
        set((s) => {
          const nextPages = { ...s.pages }
          const nextScopes = { ...s.scopes }
          for (const id of evict) {
            delete nextPages[id]
            delete nextScopes[id]
            histories.delete(id) // undo stacks are the other big memory hog
            lastPushAt.delete(id)
          }
          return { pages: nextPages, scopes: nextScopes }
        })
      },

      unloadPagesExcept: (keepIds) => {
        const keep = new Set(keepIds)
        get().unloadPages(Object.keys(get().pages).filter((id) => !keep.has(id)))
      },

      forgetPage: (pageId) => {
        archive.dropPage(pageId)
        markPageDeleted(pageId) // the only path that deletes from the cloud
        set((s) => {
          const nextPages = { ...s.pages }
          const nextScopes = { ...s.scopes }
          const nextViewports = { ...s.viewports }
          delete nextPages[pageId]
          delete nextScopes[pageId]
          delete nextViewports[pageId]
          histories.delete(pageId)
          lastPushAt.delete(pageId)
          return { pages: nextPages, scopes: nextScopes, viewports: nextViewports }
        })
      },

      collectPageOpfsRefs: (pageId) => {
        // Check in-memory store first; fall back to the localStorage archive
        // for pages that were evicted from memory before the delete triggered.
        const page = get().pages[pageId] ?? archive.readPage(pageId)
        if (!page) return []
        return Object.values(page.objects)
          .filter((o) => typeof o.geometry.src === 'string' && o.geometry.src.startsWith('opfs:'))
          .map((o) => o.geometry.src!.slice('opfs:'.length))
      },

      pushHistory: (pageId) => {
        const now = Date.now()
        const last = lastPushAt.get(pageId) ?? 0
        lastPushAt.set(pageId, now)
        if (now - last < COALESCE_MS) return // mid-gesture — the pre-gesture snapshot already covers this
        const content = get().pages[pageId]
        if (!content) return
        let h = histories.get(pageId)
        if (!h) {
          h = { past: [], future: [] }
          histories.set(pageId, h)
        }
        h.past.push(snapshotOf(content))
        if (h.past.length > HISTORY_CAP) h.past.shift()
        h.future = []
      },

      undo: (pageId) => {
        const h = histories.get(pageId)
        const content = get().pages[pageId]
        if (!h || h.past.length === 0 || !content) return
        h.future.push(snapshotOf(content))
        const { content: next, scope } = reevaluate(h.past.pop()!)
        set((s) => ({
          pages: { ...s.pages, [pageId]: next },
          scopes: { ...s.scopes, [pageId]: scope },
          selection: [],
        }))
      },

      redo: (pageId) => {
        const h = histories.get(pageId)
        const content = get().pages[pageId]
        if (!h || h.future.length === 0 || !content) return
        h.past.push(snapshotOf(content))
        const { content: next, scope } = reevaluate(h.future.pop()!)
        set((s) => ({
          pages: { ...s.pages, [pageId]: next },
          scopes: { ...s.scopes, [pageId]: scope },
          selection: [],
        }))
      },

      setFlow: (pageId, flow) => {
        get().ensurePage(pageId)
        set((s) => {
          const page = s.pages[pageId]
          if (page.flow === flow) return {}
          return { pages: { ...s.pages, [pageId]: { ...page, flow } } }
        })
      },

      addObject: (pageId, obj, { history = true } = {}) => {
        get().ensurePage(pageId)
        if (history) get().pushHistory(pageId)
        set((s) => {
          const page = s.pages[pageId]
          const { content, scope } = reevaluate({
            ...page,
            objects: { ...page.objects, [obj.id]: obj },
          })
          return {
            pages: { ...s.pages, [pageId]: content },
            scopes: { ...s.scopes, [pageId]: scope },
          }
        })
      },

      updateObject: (pageId, id, patch, { history = false } = {}) => {
        if (history) get().pushHistory(pageId)
        // Formulas reference objects by NAME ([Voltmeter 1(V)]), so a rename
        // would orphan every token pointing at the old one. Rewrite them here
        // — the one path every rename goes through — before the patch lands.
        const prevName = get().pages[pageId]?.objects[id]?.name
        if (patch.name !== undefined && prevName && patch.name !== prevName) {
          renameLiveRefs(get, set, pageId, prevName, patch.name)
        }
        set((s) => patchObject(s, pageId, id, (obj) => ({ ...obj, ...patch })))
        // Cheap gate: only walk connectors when this patch could have moved
        // the object's boundary, and only if the patch actually landed (a
        // locked object's patchObject call above is a no-op, so its
        // connectors must stay put too — re-reading state after the set
        // above is what lets us tell the two cases apart).
        if (patch.position || patch.size) {
          set((s) => {
            const page = s.pages[pageId]
            const movedObj = page?.objects[id]
            if (!page || !movedObj || movedObj.metadata.locked) return {}
            const next = reprojectConnectors(page, id)
            return next === page ? {} : { pages: { ...s.pages, [pageId]: next } }
          })
        }
      },

      refreshLive: (pageId) =>
        set((s) => {
          const page = s.pages[pageId]
          // Cheap gate: only pages that actually use live tokens re-solve.
          if (!page || !page.variables.some((v) => v.expr.includes('['))) return {}
          const { content, scope } = reevaluate(page)
          const changed =
            content.variables.some(
              (v, i) => v.value !== page.variables[i]?.value || v.error !== page.variables[i]?.error
            ) || Object.entries(content.objects).some(([id, o]) => o !== page.objects[id])
          if (!changed) return {}
          return { pages: { ...s.pages, [pageId]: content }, scopes: { ...s.scopes, [pageId]: scope } }
        }),
      removeObjects: (pageId, ids) => {
        if (ids.length === 0) return
        get().pushHistory(pageId)
        set((s) => {
          const page = s.pages[pageId]
          if (!page) return s
          const objects = { ...page.objects }
          // Deleting a group deletes what it owns: a container whose children
          // outlived it would leave orphans the Layers list still shows as
          // grouped. Ungroup deliberately empties `children` FIRST, so
          // dissolving a group frees its members instead of destroying them.
          const withDescendants = new Set<string>()
          const collect = (id: string) => {
            if (withDescendants.has(id)) return // also guards a cyclic children list
            withDescendants.add(id)
            const o = objects[id]
            if (o?.geometry.kind === 'group') for (const c of o.geometry.children ?? []) collect(c)
          }
          for (const id of ids) collect(id)

          const removable = [...withDescendants].filter((id) => !objects[id]?.metadata.locked)
          for (const id of removable) delete objects[id]

          // Drop the removed ids from any surviving group's children list, so
          // deleting one member of a group doesn't leave a dangling id behind.
          const gone = new Set(removable)
          for (const [id, obj] of Object.entries(objects)) {
            if (obj.geometry.kind !== 'group') continue
            const kids = obj.geometry.children ?? []
            const kept = kids.filter((c) => !gone.has(c))
            if (kept.length === kids.length) continue
            objects[id] = { ...obj, geometry: { ...obj.geometry, children: kept } }
          }
          // Null out any connector anchor that pointed at a removed object —
          // otherwise the dangling objectId could silently re-attach to an
          // unrelated future object that happens to reuse the same id (e.g.
          // via paste/clone-on-share id regeneration). The connector itself
          // is left in place as a free-floating line at its last position.
          const removedSet = gone
          for (const [id, obj] of Object.entries(objects)) {
            if (obj.metadata.render !== 'connector') continue
            const startAnchor = obj.metadata.startAnchor as { objectId: string; t: number } | undefined
            const endAnchor = obj.metadata.endAnchor as { objectId: string; t: number } | undefined
            const dropStart = startAnchor && removedSet.has(startAnchor.objectId)
            const dropEnd = endAnchor && removedSet.has(endAnchor.objectId)
            if (!dropStart && !dropEnd) continue
            objects[id] = {
              ...obj,
              metadata: {
                ...obj.metadata,
                ...(dropStart ? { startAnchor: undefined } : {}),
                ...(dropEnd ? { endAnchor: undefined } : {}),
              },
            }
          }
          return {
            pages: { ...s.pages, [pageId]: { ...page, objects } },
            selection: s.selection.filter((sid) => !gone.has(sid)),
          }
        })
      },

      setParam: (pageId, objectId, name, expr) => {
        get().pushHistory(pageId)
        set((s) =>
          patchObject(s, pageId, objectId, (obj) => {
            const param = obj.parameters[name]
            if (!param || param.kind !== 'number') return obj
            const scope = s.scopes[pageId] ?? {}
            const { value, error } = evalExpr(expr, scope, param.value)
            return {
              ...obj,
              parameters: { ...obj.parameters, [name]: { kind: 'number', expr, value, error } },
            }
          })
        )
      },

      setStringParam: (pageId, objectId, name, value) => {
        set((s) =>
          patchObject(s, pageId, objectId, (obj) => ({
            ...obj,
            parameters: { ...obj.parameters, [name]: { kind: 'string', value } },
          }))
        )
      },

      updateObjectParameter: (pageId, objectId, name, val) => {
        set((s) =>
          patchObject(s, pageId, objectId, (obj) => {
            const scope = s.scopes[pageId] ?? {}
            let newParam
            if (typeof val === 'number') {
              newParam = { kind: 'number' as const, expr: String(val), value: val }
            } else if (typeof val === 'boolean') {
              newParam = { kind: 'bool' as const, value: val }
            } else if (typeof val === 'string') {
              const numVal = Number(val)
              if (val.trim() !== '' && !isNaN(numVal)) {
                const { value, error } = evalExpr(val, scope, numVal)
                newParam = { kind: 'number' as const, expr: val, value, error }
              } else {
                newParam = { kind: 'string' as const, value: val }
              }
            } else {
              newParam = { kind: 'string' as const, value: String(val ?? '') }
            }
            return {
              ...obj,
              parameters: { ...obj.parameters, [name]: newParam },
            }
          })
        )
      },

      addBehavior: (pageId, objectId, type) => {
        get().pushHistory(pageId)
        set((s) =>
          patchObject(s, pageId, objectId, (obj) => {
            if (obj.behaviors.some((b) => b.type === type)) return obj
            const behavior = createBehavior(type)
            const scope = s.scopes[pageId] ?? {}
            for (const [name, p] of Object.entries(behavior.params)) {
              if (p.kind === 'number') {
                const { value, error } = evalExpr(p.expr, scope, p.value)
                behavior.params[name] = { ...p, value, error }
              }
            }
            return { ...obj, behaviors: [...obj.behaviors, behavior] }
          })
        )
      },

      removeBehavior: (pageId, objectId, behaviorId) => {
        get().pushHistory(pageId)
        set((s) =>
          patchObject(s, pageId, objectId, (obj) => ({
            ...obj,
            behaviors: obj.behaviors.filter((b) => b.id !== behaviorId),
          }))
        )
      },

      toggleBehavior: (pageId, objectId, behaviorId) => {
        set((s) =>
          patchObject(s, pageId, objectId, (obj) => ({
            ...obj,
            behaviors: obj.behaviors.map((b) =>
              b.id === behaviorId ? { ...b, enabled: !b.enabled } : b
            ),
          }))
        )
      },

      setBehaviorParam: (pageId, objectId, behaviorId, name, expr) => {
        get().pushHistory(pageId)
        set((s) =>
          patchObject(s, pageId, objectId, (obj) => {
            const scope = s.scopes[pageId] ?? {}
            return {
              ...obj,
              behaviors: obj.behaviors.map((b) => {
                if (b.id !== behaviorId) return b
                const prev = b.params[name]
                const fallback = prev?.kind === 'number' ? prev.value : 0
                const { value, error } = evalExpr(expr, scope, fallback)
                return { ...b, params: { ...b.params, [name]: { kind: 'number', expr, value, error } } }
              }),
            }
          })
        )
      },

      addVariable: (pageId, name, expr = '0') => {
        get().ensurePage(pageId)
        get().pushHistory(pageId)
        set((s) => {
          const page = s.pages[pageId]
          const base = name ?? 'x'
          let candidate = base
          let i = 1
          while (page.variables.some((v) => v.name === candidate)) candidate = `${base}${i++}`
          const variables = [...page.variables, { id: uid(), name: candidate, expr, value: 0 }]
          const { content, scope } = reevaluate({ ...page, variables })
          return {
            pages: { ...s.pages, [pageId]: content },
            scopes: { ...s.scopes, [pageId]: scope },
          }
        })
      },

      upsertVariable: (pageId, name, expr) => {
        get().ensurePage(pageId)
        set((s) => {
          const page = s.pages[pageId]
          if (!page) return s
          const existing = page.variables.find((v) => v.name === name)
          const variables = existing
            ? page.variables.map((v) => (v.id === existing.id ? { ...v, expr } : v))
            : [...page.variables, { id: uid(), name, expr, value: 0 }]
          const { content, scope } = reevaluate({ ...page, variables })
          return {
            pages: { ...s.pages, [pageId]: content },
            scopes: { ...s.scopes, [pageId]: scope },
          }
        })
      },

      updateVariable: (pageId, id, patch) => {
        get().pushHistory(pageId)
        set((s) => {
          const page = s.pages[pageId]
          if (!page) return s
          const variables = page.variables.map((v) => (v.id === id ? { ...v, ...patch } : v))
          const { content, scope } = reevaluate({ ...page, variables })
          return {
            pages: { ...s.pages, [pageId]: content },
            scopes: { ...s.scopes, [pageId]: scope },
          }
        })
      },

      removeVariable: (pageId, id) => {
        get().pushHistory(pageId)
        set((s) => {
          const page = s.pages[pageId]
          if (!page) return s
          const variables = page.variables.filter((v) => v.id !== id)
          const { content, scope } = reevaluate({ ...page, variables })
          return {
            pages: { ...s.pages, [pageId]: content },
            scopes: { ...s.scopes, [pageId]: scope },
          }
        })
      },

      setTool: (tool, option = null) => set({ tool, toolOption: option }),
      toggleInkToShape: () => set((s) => ({ inkToShape: !s.inkToShape })),
      toggleInkAnnotate: () => set((s) => ({ inkAnnotate: !s.inkAnnotate })),
      setSelection: (ids) => set({ selection: ids }),
      setViewport: (pageId, vp) =>
        set((s) => ({ viewports: { ...s.viewports, [pageId]: vp } })),
      pinCurrentRun: (pageId, label) => {
        const page = get().pages[pageId]
        if (!page) return
        const sourceIds = new Set<string>()
        for (const o of Object.values(page.objects)) {
          if (o.geometry.kind !== 'graph') continue
          // Same param format as graph.tsx's parseSeries: "objId:ch;..."
          // falling back to the legacy single sourceId param.
          const seriesRaw = o.parameters.series
          const series = seriesRaw?.kind === 'string' ? seriesRaw.value : ''
          const entries = series
            .split(';')
            .map((c) => c.trim())
            .filter(Boolean)
          if (entries.length > 0) {
            for (const entry of entries) {
              const i = entry.indexOf(':')
              if (i > 0) sourceIds.add(entry.slice(0, i))
            }
          } else {
            const src = o.parameters.sourceId
            const id = src?.kind === 'string' ? src.value : undefined
            if (id) sourceIds.add(id)
          }
        }
        const samples: Record<string, Sample[]> = {}
        for (const id of sourceIds) {
          const buf = readBuffer(id)
          if (buf && buf.samples.length > 0) samples[id] = buf.samples.map((s) => ({ ...s, channels: { ...s.channels } }))
        }
        if (Object.keys(samples).length === 0) return
        set((s) => ({
          pinnedRuns: {
            ...s.pinnedRuns,
            [pageId]: { label: label ?? `Pinned @ ${new Date().toLocaleTimeString()}`, pinnedAt: Date.now(), samples },
          },
        }))
      },
      clearPinnedRun: (pageId) =>
        set((s) => ({ pinnedRuns: { ...s.pinnedRuns, [pageId]: undefined } })),
    }),
    {
      name: 'simblip-documents-v2', // v2: entity/component scene model
      storage: scopedJSONStorage,
      // Page CONTENT is no longer persisted here — it lives in the page
      // archive, one entry per page, so pages can be evicted from memory
      // without losing (or, worse, deleting) anything. Only the tiny
      // per-page viewport rides along.
      partialize: (s) => ({ viewports: s.viewports }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // One-time migration: older builds persisted every page inside this
        // blob. Move them into the archive, then start empty — the active
        // page is loaded on demand from there.
        const legacy = state.pages as Record<string, PageContent> | undefined
        if (legacy && Object.keys(legacy).length > 0) {
          for (const [id, content] of Object.entries(legacy)) {
            if (!archive.hasPage(id)) archive.writePage(id, content)
          }
        }
        state.pages = {}
        state.scopes = {}
        // Zoom is the one part of a persisted viewport that shouldn't
        // survive a reload — landing back at whatever zoom you happened to
        // leave a page at (often mid-gesture, e.g. a pinch that hadn't
        // settled) reads as broken rather than restored. Pan position is
        // still worth keeping; only reset the zoom factor.
        for (const vp of Object.values(state.viewports)) vp.zoom = 1
      },
    }
  )
)

/** Read the live formula scope for a page (used by the physics runtime). */
export function getScope(pageId: string): Scope {
  return useDocStore.getState().scopes[pageId] ?? {}
}


// ── Durable archiving ───────────────────────────────────────────────────────
// The doc store no longer persists page content itself (see partialize), so
// something has to write it down. Every changed page is flushed to the page
// archive on a short debounce — and immediately when the tab goes away, so a
// reload can never land between the last edit and the last write.

if (typeof window !== 'undefined') {
  const dirty = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flushArchive = () => {
    timer = null
    const { pages } = useDocStore.getState()
    for (const id of dirty) {
      const content = pages[id]
      if (content) archive.writePage(id, content) // evicted pages were written on the way out
    }
    dirty.clear()
  }

  useDocStore.subscribe((s, prev) => {
    if (s.pages === prev.pages) return
    for (const id of Object.keys(s.pages)) {
      if (s.pages[id] !== prev.pages[id]) dirty.add(id)
    }
    if (dirty.size === 0) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(flushArchive, 400)
  })

  // pagehide covers the mobile/bfcache path that beforeunload misses.
  window.addEventListener('pagehide', flushArchive)
  window.addEventListener('beforeunload', flushArchive)
}
