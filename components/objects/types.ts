import type { SceneObject } from '@/lib/scene/types'

export interface ObjectRendererProps {
  pageId: string
  object: SceneObject
  selected: boolean
}

export function getString(obj: SceneObject, name: string, fallback = ''): string {
  const p = obj.parameters[name]
  return p?.kind === 'string' ? p.value : fallback
}

export function getNumber(obj: SceneObject, name: string, fallback = 0): number {
  const p = obj.parameters[name]
  return p?.kind === 'number' ? p.value : fallback
}
