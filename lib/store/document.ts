'use client'

// Document store: page content (objects + variables) plus ephemeral editor
// state (selection, viewport, tool). Content persists; editor state and
// undo history do not — history is an in-memory ring per page.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SceneObject, Variable, BehaviorType, NumericParam } from '@/lib/scene/types'
import { uid } from '@/lib/scene/types'
import { createBehavior } from '@/lib/behaviors/registry'
import { solveScope, evalExpr, extractLiveRefs, type LiveRef, type Scope } from '@/lib/formula/engine'
import { readBuffer } from '@/lib/physics/bus'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'
import * as archive from '@/lib/store/page-archive'
import { dropBuffer } from '@/lib/physics/bus'
import { markPageDeleted } from '@/lib/store/deleted-pages'

export type Tool =
  | 'select'
  | 'lasso' // touch: drag over/across objects to multi-select, never moves them
  | 'pen' // freehand with sketch recognition
  | 'shaper' // freehand that ALWAYS beautifies: straightens, smooths, snaps shapes
  | 'eraser' // drag over ink to remove it
  | 'circle'
  | 'rect'
  | 'line'
  | 'shape' // placing a shape from the Shapes group (toolOption = shape id)
  | 'text'
  | 'note'
  | 'formula'
  | 'code'
  | 'graph'
  | 'table'
  | 'place' // placing a palette component (toolOption = component id)

export interface Viewport {
  x: number
  y: number
  zoom: number
}

interface PageContent {
  objects: Record<string, SceneObject>
  variables: Variable[]
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
  const { variables, scope } = solveScope(content.variables, liveScopeOf(content))
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
  return { content: { objects, variables }, scope }
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
  pushHistory: (pageId: string) => void
  undo: (pageId: string) => void
  redo: (pageId: string) => void

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
  updateVariable: (pageId: string, id: string, patch: { name?: string; expr?: string }) => void
  removeVariable: (pageId: string, id: string) => void

  setTool: (tool: Tool, option?: string | null) => void
  toggleInkToShape: () => void
  toggleInkAnnotate: () => void
  setSelection: (ids: string[]) => void
  setViewport: (pageId: string, vp: Viewport) => void
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
  return {
    pages: {
      ...s.pages,
      [pageId]: { ...page, objects: { ...page.objects, [objectId]: fn(obj) } },
    },
  }
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
        set((s) => patchObject(s, pageId, id, (obj) => ({ ...obj, ...patch })))
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
          for (const id of ids) delete objects[id]
          return {
            pages: { ...s.pages, [pageId]: { ...page, objects } },
            selection: s.selection.filter((sid) => !ids.includes(sid)),
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
