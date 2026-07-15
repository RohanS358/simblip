import { useDocStore } from '@/lib/store/document'
import { uid, type SceneObject, type GeometryKind, type BehaviorType, num, str, bool } from './types'

class ScriptObject {
  id: string
  pageId: string
  
  constructor(id: string, pageId: string) {
    this.id = id
    this.pageId = pageId
  }

  // Anchors for connections
  get centre() { return { objectId: this.id, anchor: 'centre' } }
  get edge() { return { objectId: this.id, anchor: 'edge' } }
  get input1() { return { objectId: this.id, anchor: 'input1' } }
  get input2() { return { objectId: this.id, anchor: 'input2' } }
  get output() { return { objectId: this.id, anchor: 'output' } }
  get positive() { return { objectId: this.id, anchor: 'positive' } }
  get negative() { return { objectId: this.id, anchor: 'negative' } }
  get emitter() { return { objectId: this.id, anchor: 'emitter' } }
  get base() { return { objectId: this.id, anchor: 'base' } }
  get collector() { return { objectId: this.id, anchor: 'collector' } }
  get V() { return { objectId: this.id, property: 'V' } }
  get vx() { return { objectId: this.id, property: 'vx' } }

  set(props: Record<string, any>) {
    const doc = useDocStore.getState()
    const obj = doc.pages[this.pageId]?.objects?.[this.id]
    if (!obj) return this
    
    // Apply props
    const next = { ...obj }
    if (props.x !== undefined || props.y !== undefined) {
      next.position = { x: props.x ?? obj.position.x, y: props.y ?? obj.position.y }
    }
    if (props.width !== undefined || props.height !== undefined) {
      next.size = { w: props.width ?? obj.size.w, h: props.height ?? obj.size.h }
    }
    if (props.mass !== undefined) {
      const rb = next.behaviors.find(b => b.type === 'rigidBody')
      if (rb) rb.params.mass = num(props.mass)
    }
    doc.addObject(this.pageId, next, { history: false })
    return this
  }
}

export function executeSimScript(pageId: string, source: string) {
  const doc = useDocStore.getState()

  // 1. Preprocess: Very naive transpilation to allow Python-like kwargs.
  // We'll just run it as standard JS, so we'll provide wrappers.
  
  // create(kind, props)
  const create = (kind: GeometryKind | string, props: Record<string, any> = {}) => {
    const id = uid()
    const obj: SceneObject = {
      id,
      name: kind,
      geometry: { kind: (kind === 'symbol' ? 'symbol' : kind) as GeometryKind, symbol: kind === 'symbol' ? props.symbol : undefined },
      position: { x: props.x ?? 100, y: props.y ?? 100 },
      size: { w: props.width ?? 50, h: props.height ?? 50 },
      rotation: props.rotation ?? 0,
      z: Date.now(),
      behaviors: [],
      parameters: {},
      metadata: {}
    }
    doc.addObject(pageId, obj, { history: false })
    const scriptObj = new ScriptObject(id, pageId)
    if (Object.keys(props).length > 0) {
      scriptObj.set(props)
    }
    return scriptObj
  }

  const addproperty = (obj: ScriptObject, behaviorType: BehaviorType | string) => {
    const sceneObj = doc.pages[pageId]?.objects?.[obj.id]
    if (!sceneObj) return
    const b: any = {
      id: uid(),
      type: behaviorType,
      enabled: true,
      params: {}
    }
    // Set default params based on type
    if (behaviorType === 'rigidBody') b.params.mass = num(1)
    const next = { ...sceneObj, behaviors: [...sceneObj.behaviors, b] }
    doc.addObject(pageId, next, { history: false })
  }

  const connect = (a: any, b: any, type: string = 'wire') => {
    if (!a?.objectId || !b?.objectId) return
    const id = uid()
    // A wire or rope is a line geometry with a behavior
    const line: SceneObject = {
      id,
      name: type,
      geometry: { kind: 'line' },
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
      rotation: 0,
      z: Date.now(),
      behaviors: [{
        id: uid(),
        type: type as BehaviorType,
        enabled: true,
        params: {
          targetA: str(a.objectId),
          anchorA: str(a.anchor),
          targetB: str(b.objectId),
          anchorB: str(b.anchor),
        }
      }],
      parameters: {},
      metadata: { render: type }
    }
    doc.addObject(pageId, line, { history: false })
    return new ScriptObject(id, pageId)
  }

  const graph = {
    plot: (yVar: any, xVar: any, style: string = 'line', options: any = {}) => {
      // Find or create a graph object on the page
      let graphObj = Object.values(doc.pages[pageId]?.objects ?? {}).find(o => o.geometry.kind === 'graph')
      if (!graphObj) {
        graphObj = {
          id: uid(),
          name: 'Graph',
          geometry: { kind: 'graph' },
          position: { x: 400, y: 100 },
          size: { w: 300, h: 200 },
          rotation: 0,
          z: Date.now(),
          behaviors: [],
          parameters: {},
          metadata: {}
        }
      }
      
      const yProp = yVar?.property ?? yVar
      const xProp = xVar?.property ?? xVar
      const targetId = yVar?.objectId
      
      const newGraph = { ...graphObj }
      // Configure plot bindings in parameters
      newGraph.parameters = {
        ...newGraph.parameters,
        [`plot_${uid()}`]: str(`${targetId ? targetId + '.' : ''}${yProp} vs ${xProp}`)
      }
      doc.addObject(pageId, newGraph, { history: false })
    }
  }

  // Expose variables globally to the sandbox
  const builtins = {
    create,
    addproperty,
    connect,
    graph,
    console,
    Math
  }

  const sandboxVars: Record<string, any> = {}
  
  const sandbox = new Proxy(builtins, {
    has(target, key) {
      return true // Trap all variables
    },
    get(target, key: string) {
      if (key === Symbol.unscopables) return undefined
      if (key in target) return (target as any)[key]
      return sandboxVars[key]
    },
    set(target, key: string, value) {
      sandboxVars[key] = value
      return true
    }
  })

  // Strip 'var ', 'let ', 'const ' declarations to force assignments onto the Proxy
  const transpiled = source
    .replace(/\b(?:var|let|const)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/g, '$1')

  // Execute
  try {
    const fn = new Function('sandbox', `with(sandbox) { ${transpiled} }`)
    fn(sandbox)
  } catch (err) {
    console.error(err)
    throw err
  }

  // After execution, sync sandboxVars to page variables
  const currentVars = doc.pages[pageId]?.variables || []
  const newVars = [...currentVars]
  
  for (const [k, v] of Object.entries(sandboxVars)) {
    if (typeof v === 'number' || typeof v === 'string') {
      const existing = newVars.find(x => x.name === k)
      if (existing) {
        existing.value = Number(v)
      } else {
        newVars.push({ id: uid(), name: k, expr: String(v), value: Number(v) })
      }
    } else if (v instanceof ScriptObject) {
       // Ignore component references
    } else if (v?.property) {
       // Bind dynamic property
       const existing = newVars.find(x => x.name === k)
       const expr = `${v.objectId}.${v.property}`
       if (existing) {
         existing.expr = expr
       } else {
         newVars.push({ id: uid(), name: k, expr, value: 0 })
       }
    }
  }
  
  useDocStore.setState(s => {
    const p = s.pages[pageId]
    if (p) p.variables = newVars
    return s
  })
}
