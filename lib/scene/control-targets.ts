import type { SceneObject } from '@/lib/scene/types'
import { useDocStore } from '@/lib/store/document'

export function getObjectParams(obj: SceneObject | undefined | null): string[] {
  if (!obj) return []
  const keys = new Set<string>()

  // 1. Direct parameters on the object
  if (obj.parameters) {
    Object.keys(obj.parameters).forEach((k) => keys.add(k))
  }

  // 2. Behavior parameters
  if (obj.behaviors) {
    obj.behaviors.forEach((b) => {
      if (b.params) {
        Object.keys(b.params).forEach((k) => keys.add(k))
      }
    })
  }

  // 3. Spatial / Transform properties
  keys.add('x')
  keys.add('y')
  keys.add('width')
  keys.add('height')
  keys.add('rotation')

  // 4. Common component parameters based on geometry kind
  switch (obj.geometry.kind) {
    case 'slider':
    case 'button':
    case 'trigger':
      keys.add('value')
      break
    case 'gridtable':
    case 'table':
      keys.add('rows')
      keys.add('cols')
      break
    case 'formula':
      keys.add('latex')
      break
    case 'text':
    case 'note':
      keys.add('text')
      break
    case 'code':
    case 'dsa':
      keys.add('source')
      break
  }

  return Array.from(keys)
}

export function getTargetValue(
  page: any,
  targetType: string,
  targetObjectId: string,
  targetParamName: string,
  fallback: number
): number {
  if (!page || !targetParamName) return fallback

  if (targetType === 'variable') {
    const v = page.variables?.find((varItem: any) => varItem.name === targetParamName)
    if (v && Number.isFinite(v.value)) return v.value
    if (v && v.expr) {
      const parsed = Number(v.expr)
      if (!isNaN(parsed)) return parsed
    }
  } else if (targetType === 'objectParam' && targetObjectId) {
    const targetObj = page.objects?.[targetObjectId]
    if (targetObj) {
      if (targetParamName === 'x') return targetObj.position.x
      if (targetParamName === 'y') return targetObj.position.y
      if (targetParamName === 'width') return targetObj.size.w
      if (targetParamName === 'height') return targetObj.size.h
      if (targetParamName === 'rotation') return targetObj.rotation ?? 0

      // Check parameters
      const p = targetObj.parameters?.[targetParamName]
      if (p) {
        if (p.kind === 'number' && Number.isFinite(p.value)) return p.value
        if ('value' in p && Number.isFinite(Number(p.value))) return Number(p.value)
        if ('expr' in p) {
          const parsed = Number(p.expr)
          if (!isNaN(parsed)) return parsed
        }
      }

      // Check behaviors
      for (const b of targetObj.behaviors ?? []) {
        const bp = b.params?.[targetParamName]
        if (bp) {
          if (Number.isFinite(bp.value)) return bp.value
          if (bp.expr) {
            const parsed = Number(bp.expr)
            if (!isNaN(parsed)) return parsed
          }
        }
      }
    }
  }
  return fallback
}

export function writeTargetValue(
  pageId: string,
  page: any,
  targetType: string,
  targetObjectId: string,
  targetParamName: string,
  val: number
) {
  if (!page || !targetParamName) return
  // A control must never write a non-finite value. The geometry branches below
  // assign straight into position/size, and JSON.stringify turns NaN into
  // `null` on save — a null coordinate renders at left:0 and then passes every
  // bounds check (`null > right` is false), so the object is invisibly
  // off-frame with nothing reporting it.
  //
  // Reachable from a scripted control whose targetParamName names a param the
  // target does not have (the AI writes `targetParamName: "length"` on a mass,
  // which is not a real param): the slider reads a fallback, arithmetic on it
  // goes non-finite, and the write lands in position.x.
  if (!Number.isFinite(val)) return
  const docStore = useDocStore.getState()

  if (targetType === 'variable') {
    const v = page.variables?.find((varItem: any) => varItem.name === targetParamName)
    if (v) {
      docStore.updateVariable(pageId, v.id, { expr: String(val) })
    }
  } else if (targetType === 'objectParam' && targetObjectId) {
    const targetObj = page.objects?.[targetObjectId]
    if (!targetObj) return

    if (targetParamName === 'x') {
      docStore.updateObject(pageId, targetObjectId, { position: { ...targetObj.position, x: val } })
      return
    }
    if (targetParamName === 'y') {
      docStore.updateObject(pageId, targetObjectId, { position: { ...targetObj.position, y: val } })
      return
    }
    if (targetParamName === 'width') {
      docStore.updateObject(pageId, targetObjectId, { size: { ...targetObj.size, w: val } })
      return
    }
    if (targetParamName === 'height') {
      docStore.updateObject(pageId, targetObjectId, { size: { ...targetObj.size, h: val } })
      return
    }
    if (targetParamName === 'rotation') {
      docStore.updateObject(pageId, targetObjectId, { rotation: val })
      return
    }

    // Check behaviors first
    for (const b of targetObj.behaviors ?? []) {
      if (b.params && targetParamName in b.params) {
        docStore.setBehaviorParam(pageId, targetObjectId, b.id, targetParamName, String(val))
        return
      }
    }

    // Otherwise write object parameter
    docStore.updateObjectParameter(pageId, targetObjectId, targetParamName, val)
  }
}
