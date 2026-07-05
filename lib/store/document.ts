'use client'

// Document store: page content (objects + variables) plus ephemeral editor
// state (selection, viewport, tool). Content persists; editor state and
// undo history do not — history is an in-memory ring per page.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SceneObject, Variable, BehaviorType } from '@/lib/scene/types'
import { uid } from '@/lib/scene/types'
import { createBehavior } from '@/lib/behaviors/registry'
import { solveScope, evalExpr, type Scope } from '@/lib/formula/engine'

export type Tool =
  | 'select'
  | 'pen' // freehand with sketch recognition
  | 'circle'
  | 'rect'
  | 'line'
  | 'text'
  | 'note'
  | 'formula'
  | 'graph'
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

const snapshotOf = (c: PageContent): PageContent => JSON.parse(JSON.stringify(c))

/** Re-solve variables, then re-evaluate every numeric expression on the page —
 * object content params AND behavior params. One scope, spreadsheet semantics. */
function reevaluate(content: PageContent): { content: PageContent; scope: Scope } {
  const { variables, scope } = solveScope(content.variables)
  const objects: Record<string, SceneObject> = {}
  for (const [id, obj] of Object.entries(content.objects)) {
    let changed = false
    const parameters = { ...obj.parameters }
    for (const [name, param] of Object.entries(parameters)) {
      if (param.kind === 'number') {
        const { value, error } = evalExpr(param.expr, scope, param.value)
        if (value !== param.value || error !== param.error) {
          parameters[name] = { ...param, value, error }
          changed = true
        }
      }
    }
    const behaviors = obj.behaviors.map((b) => {
      let bChanged = false
      const params = { ...b.params }
      for (const [name, param] of Object.entries(params)) {
        if (param.kind === 'number') {
          const { value, error } = evalExpr(param.expr, scope, param.value)
          if (value !== param.value || error !== param.error) {
            params[name] = { ...param, value, error }
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
  /** Ink stroke width (max width of the pressure-shaped outline). */
  penSize: number
  selection: string[]
  viewports: Record<string, Viewport>
  scopes: Record<string, Scope>

  ensurePage: (pageId: string) => void
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
  setPenSize: (size: number) => void
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
      inkAnnotate: true,
      penSize: 5,
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
        set((s) => ({
          pages: { ...s.pages, [pageId]: { objects: {}, variables: [] } },
          scopes: { ...s.scopes, [pageId]: {} },
        }))
      },

      pushHistory: (pageId) => {
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
      setPenSize: (size) => set({ penSize: Math.min(12, Math.max(1.5, size)) }),
      setSelection: (ids) => set({ selection: ids }),
      setViewport: (pageId, vp) =>
        set((s) => ({ viewports: { ...s.viewports, [pageId]: vp } })),
    }),
    {
      name: 'simblip-documents-v2', // v2: entity/component scene model
      partialize: (s) => ({ pages: s.pages, viewports: s.viewports, penSize: s.penSize }),
    }
  )
)

/** Read the live formula scope for a page (used by the physics runtime). */
export function getScope(pageId: string): Scope {
  return useDocStore.getState().scopes[pageId] ?? {}
}
