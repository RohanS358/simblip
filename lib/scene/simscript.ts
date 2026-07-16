import { useDocStore } from '@/lib/store/document'
import { terminalsOf } from '@/lib/circuit/engine'
import { uid, type SceneObject, type GeometryKind, type BehaviorType, num, str } from './types'

// Always read fresh state — Zustand creates new state objects on every set(),
// so any snapshot captured before an addObject call is immediately stale.
const store = () => useDocStore.getState()

class ScriptObject {
  id: string
  pageId: string

  constructor(id: string, pageId: string) {
    this.id = id
    this.pageId = pageId
  }

  // Electrical / digital anchors
  get centre()    { return { objectId: this.id, anchor: 'centre' } }
  get edge()      { return { objectId: this.id, anchor: 'edge' } }
  get input1()    { return { objectId: this.id, anchor: 'input1' } }
  get input2()    { return { objectId: this.id, anchor: 'input2' } }
  get output()    { return { objectId: this.id, anchor: 'output' } }
  get positive()  { return { objectId: this.id, anchor: 'positive' } }
  get negative()  { return { objectId: this.id, anchor: 'negative' } }
  get emitter()   { return { objectId: this.id, anchor: 'emitter' } }
  get base()      { return { objectId: this.id, anchor: 'base' } }
  get collector() { return { objectId: this.id, anchor: 'collector' } }

  // Dynamic property accessors
  get V()  { return { objectId: this.id, property: 'V' } }
  get vx() { return { objectId: this.id, property: 'vx' } }
  get vy() { return { objectId: this.id, property: 'vy' } }
  get ax() { return { objectId: this.id, property: 'ax' } }
  get ay() { return { objectId: this.id, property: 'ay' } }

  set(props: Record<string, any>) {
    // Fresh read every time — state may have changed since this object was created
    const current = store().pages[this.pageId]?.objects?.[this.id]
    if (!current) return this

    const next = {
      ...current,
      position: {
        x: props.x ?? current.position.x,
        y: props.y ?? current.position.y,
      },
      size: {
        w: props.width  ?? current.size.w,
        h: props.height ?? current.size.h,
      },
      behaviors: current.behaviors.map(b => {
        if (b.type === 'rigidBody' && props.mass !== undefined) {
          return { ...b, params: { ...b.params, mass: num(props.mass) } }
        }
        return b
      }),
    }
    store().addObject(this.pageId, next, { history: false })
    return this
  }
}

export function executeSimScript(
  pageId: string,
  source: string,
  origin: { x: number; y: number } = { x: 200, y: 100 }
) {

  // ── API functions ──────────────────────────────────────────────────────────

  const create = (kind: GeometryKind | string, props: Record<string, any> = {}): ScriptObject => {
    const id = uid()

    const geometryKind = (
      kind === 'symbol' ? 'symbol' :
      kind === 'rect'   ? 'rect'   :
      kind === 'circle' ? 'circle' :
      kind === 'line'   ? 'line'   :
      kind === 'polygon'? 'polygon':
      kind === 'text'   ? 'text'   :
      kind === 'note'   ? 'note'   :
      kind === 'graph'  ? 'graph'  :
      'rect'
    ) as GeometryKind

    const obj: SceneObject = {
      id,
      name: props.name ?? kind,
      geometry: {
        kind: geometryKind,
        symbol: geometryKind === 'symbol' ? (props.symbol ?? kind) : undefined,
      },
      // x/y in script are relative to origin — if not provided, default to 0,0 relative
      position: { x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0) },
      size:     { w: props.width ?? 60, h: props.height ?? 60 },
      rotation: props.rotation ?? (props.dir === 'up' ? -90 : props.dir === 'down' ? 90 : props.dir === 'left' ? 180 : props.dir === 'right' ? 0 : 0),
      z:         Date.now(),
      behaviors: [],
      parameters: {},
      metadata: { nameExplicit: !!props.name },
    }

    // Write to store immediately
    store().addObject(pageId, obj, { history: false })
    return new ScriptObject(id, pageId)
  }

  const addproperty = (obj: ScriptObject, behaviorType: BehaviorType | string) => {
    // Fresh read — object must already be in state from a prior create()
    const current = store().pages[pageId]?.objects?.[obj.id]
    if (!current) {
      console.warn('[SimScript] addproperty: object not found', obj.id)
      return
    }
    const b: any = {
      id: uid(),
      type: behaviorType,
      enabled: true,
      params: {}
    }
    if (behaviorType === 'rigidBody') b.params.mass = num(1)
    const next = { ...current, behaviors: [...current.behaviors, b] }
    store().addObject(pageId, next, { history: false })
  }

  const connect = (a: any, b: any, type: string = 'wire') => {
    if (!a?.objectId || !b?.objectId) {
      console.warn('[SimScript] connect: invalid anchor', a, b)
      return
    }

    // Resolve real positions from the objects already in the store
    const objA = store().pages[pageId]?.objects?.[a.objectId]
    const objB = store().pages[pageId]?.objects?.[b.objectId]

    const getAnchorCoords = (obj: SceneObject | undefined, anchorName: string, defaultX: number, defaultY: number) => {
      if (!obj) return { x: defaultX, y: defaultY }
      if (anchorName === 'centre') {
        return { x: obj.position.x + obj.size.w / 2, y: obj.position.y + obj.size.h / 2 }
      }
      const terminals = terminalsOf(obj)
      if (terminals.length === 0) {
        return { x: obj.position.x + obj.size.w / 2, y: obj.position.y + obj.size.h / 2 }
      }
      let index = 0
      if (anchorName === 'positive' || anchorName === 'input1' || anchorName === 'emitter' || anchorName === 'base') index = 0
      else if (anchorName === 'negative' || anchorName === 'input2' || anchorName === 'collector') index = 1
      else if (anchorName === 'output') index = terminals.length > 2 ? 2 : terminals.length - 1
      
      if (index >= terminals.length) index = terminals.length - 1
      const t = terminals[index]
      return {
        x: obj.position.x + t.x * obj.size.w,
        y: obj.position.y + t.y * obj.size.h
      }
    }

    const posA = getAnchorCoords(objA, a.anchor, 0, 0)
    const posB = getAnchorCoords(objB, b.anchor, 200, 200)

    const ax = posA.x
    const ay = posA.y
    const bx = posB.x
    const by = posB.y

    const id = uid()
    const line: SceneObject = {
      id,
      name: type,
      geometry: { kind: 'line' },
      // Position is top-left of the bounding box of the two endpoints
      position: { x: Math.min(ax, bx), y: Math.min(ay, by) },
      size: {
        w: Math.abs(bx - ax) || 4,
        h: Math.abs(by - ay) || 4,
      },
      rotation: 0,
      z: Date.now(),
      behaviors: [{
        id: uid(),
        type: type as BehaviorType,
        enabled: true,
        params: {
          targetA:  str(a.objectId),
          anchorA:  str(a.anchor),
          targetB:  str(b.objectId),
          anchorB:  str(b.anchor),
        },
      }],
      parameters: {},
      metadata: { render: type },
    }
    store().addObject(pageId, line, { history: false })
    return new ScriptObject(id, pageId)
  }

  const graph = {
    plot: (yVar: any, xVar: any, style: string = 'line') => {
      // Look for an existing graph on the page (fresh read)
      let graphObj = Object.values(store().pages[pageId]?.objects ?? {})
        .find(o => o.geometry.kind === 'graph')

      const newGraph: SceneObject = graphObj
        ? { ...graphObj }
        : {
            id: uid(),
            name: 'Graph',
            geometry: { kind: 'graph' },
            // Place graph 500px to the right of the origin (simulation area)
            position: { x: origin.x + 500, y: origin.y },
            size: { w: 320, h: 220 },
            rotation: 0,
            z: Date.now(),
            behaviors: [],
            parameters: {},
            metadata: {},
          }

      const yProp = yVar?.property ?? String(yVar)
      const xProp = xVar?.property ?? String(xVar)
      const yId   = yVar?.objectId  ?? ''
      const xId   = xVar?.objectId  ?? ''
      const seriesStr = yId ? `${yId}:${yProp}` : ''
      const oldSeries = (newGraph.parameters.series?.kind === 'string') ? newGraph.parameters.series.value : ''

      newGraph.parameters = {
        ...newGraph.parameters,
        series: str(seriesStr ? (oldSeries ? `${oldSeries};${seriesStr}` : seriesStr) : oldSeries),
        xChannel: str(xProp),
        [`plot_y_${uid()}`]: str(yId ? `${yId}.${yProp}` : yProp),
        [`plot_x_${uid()}`]: str(xId ? `${xId}.${xProp}` : xProp),
        plot_style:           str(style),
      }
      store().addObject(pageId, newGraph, { history: false })
    },
  }

  // ── Sandbox setup ──────────────────────────────────────────────────────────

  const builtins: Record<string, any> = {
    create,
    addproperty,
    connect,
    graph,
    console,
    Math,
  }

  const sandboxVars: Record<string, any> = {}

  const sandbox = new Proxy(builtins, {
    has() { return true },
    get(target, key: string) {
      if (key === Symbol.unscopables as any) return undefined
      if (key in target) return target[key]
      return sandboxVars[key]
    },
    set(_target, key: string, value) {
      sandboxVars[key] = value
      return true
    },
  })

  // Strip var/let/const so that variable declarations land on the Proxy
  const transpiled = source.replace(
    /\b(var|let|const)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/g,
    '$2'
  )

  // ── Execute ────────────────────────────────────────────────────────────────
  const fn = new Function('sandbox', `with(sandbox) { ${transpiled} }`)
  fn(sandbox)

  // ── Sync declared variables to the page variables sidebar ──────────────────
  const currentVars = store().pages[pageId]?.variables ?? []
  const newVars = [...currentVars]

  for (const [k, v] of Object.entries(sandboxVars)) {
    if (v instanceof ScriptObject) {
      const current = store().pages[pageId]?.objects?.[v.id]
      if (current && !current.metadata.nameExplicit && current.name !== k) {
        store().updateObject(pageId, v.id, { name: k }, { history: false })
      }
      continue  // component handles, not values
    }

    if (typeof v === 'number' || typeof v === 'string') {
      const existing = newVars.find(x => x.name === k)
      if (existing) {
        existing.value = Number(v)
        existing.expr  = String(v)
      } else {
        newVars.push({ id: uid(), name: k, expr: String(v), value: Number(v) })
      }
    } else if (v?.property) {
      // Dynamic binding — e.g. x = block.vx
      const expr = `${v.objectId}.${v.property}`
      const existing = newVars.find(x => x.name === k)
      if (existing) {
        existing.expr = expr
      } else {
        newVars.push({ id: uid(), name: k, expr, value: 0 })
      }
    }
  }

  useDocStore.setState(s => {
    const p = s.pages[pageId]
    if (!p) return s
    return { ...s, pages: { ...s.pages, [pageId]: { ...p, variables: newVars } } }
  })
}
