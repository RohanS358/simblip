'use client'

// Importer: validated Simulation JSON → primitives + behaviors on the page,
// through the same store actions a manual user takes. Fully undoable; the
// only path from AI output to the canvas.

import type { SimulationPayload } from './schema'
import type { Vec2, SceneObject } from '@/lib/scene/types'
import { num, str } from '@/lib/scene/types'
import { createGeometry, baseObject, componentById } from '@/lib/scene/factory'
import { createBehavior } from '@/lib/behaviors/registry'
import { useDocStore } from '@/lib/store/document'

export function importSimulation(pageId: string, payload: SimulationPayload, dropPoint: Vec2) {
  const store = useDocStore.getState()
  store.ensurePage(pageId)
  store.pushHistory(pageId)

  // Existing variables win — the user's page scope is the source of truth.
  // Re-read after ensurePage/pushHistory (not the pre-import snapshot) and
  // track names added so far so two same-named variables in ONE payload
  // (a duplicate add_variable call slipping through) don't both land.
  const seenVarNames = new Set(useDocStore.getState().pages[pageId].variables.map((v) => v.name))
  for (const v of payload.variables) {
    if (!seenVarNames.has(v.name)) {
      store.addVariable(pageId, v.name, v.expr)
      seenVarNames.add(v.name)
    }
  }

  const createdIds: string[] = []

  for (const spec of payload.objects) {
    const position = { x: dropPoint.x + spec.dx, y: dropPoint.y + spec.dy }
    let obj: SceneObject
    if (spec.geometry === 'symbol') {
      // circuit symbols come from the same palette factories a user clicks
      const def = componentById(spec.symbol ?? '')
      if (!def) continue
      obj = def.create(position)
      for (const [name, expr] of Object.entries(spec.params ?? {})) {
        obj.parameters[name] = num(expr)
      }
    } else {
      obj =
        ['note', 'text', 'formula', 'graph'].includes(spec.geometry) || !spec.points
          ? createGeometry(spec.geometry, position)
          : baseObject(spec.geometry, position)
    }
    obj.position = position
    if (spec.name) obj.name = spec.name
    if (spec.w && spec.h) obj.size = { w: spec.w, h: spec.h }
    if (spec.rotation) obj.rotation = spec.rotation
    if (spec.points) {
      obj.geometry.points = spec.points.map(([x, y]) => [x, y])
      const xs = spec.points.map((p) => p[0])
      const ys = spec.points.map((p) => p[1])
      obj.size = {
        w: Math.max(...xs) - Math.min(...xs) || 2,
        h: Math.max(...ys) - Math.min(...ys) || 2,
      }
    }
    if (spec.render) obj.metadata.render = spec.render

    for (const b of spec.behaviors) {
      const behavior = createBehavior(b.type)
      for (const [name, expr] of Object.entries(b.params)) {
        behavior.params[name] = num(expr)
      }
      obj.behaviors.push(behavior)
    }

    if (spec.text !== undefined) {
      if (spec.geometry === 'formula') obj.parameters.latex = str(spec.text)
      else obj.parameters.text = str(spec.text)
    }
    if (spec.geometry === 'graph') {
      const sourceId =
        spec.graphSource !== undefined ? (createdIds[spec.graphSource] ?? '') : ''
      obj.parameters.sourceId = str(sourceId)
      obj.parameters.yChannels = str((spec.graphChannels ?? []).join(','))
    }

    store.addObject(pageId, obj, { history: false })
    createdIds.push(obj.id)
  }
}
