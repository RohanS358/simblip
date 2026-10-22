'use client'

// Change a named object's parameter THE WAY A USER WOULD: dragging a slider thumb writes the
// slider's own value and then the thing it controls (control-targets.ts), so that is what an
// experiment or a sweep does too. Poking a slider's stored `value` alone moves nothing in the
// simulation — the first version of the director learned that the hard way.

import { useDocStore } from '@/lib/store/document'
import { writeTargetValue } from '@/lib/scene/control-targets'

const text = (o: { parameters: Record<string, unknown> }, name: string, fallback = ''): string => {
  const p = o.parameters[name] as { kind?: string; value?: unknown } | undefined
  return p?.kind === 'string' && typeof p.value === 'string' ? p.value : fallback
}

export function applyParam(pageId: string, objectName: string, param: string, value: number): boolean {
  const doc = useDocStore.getState()
  const page = doc.pages[pageId]
  const o = Object.values(page?.objects ?? {}).find((x) => x.name === objectName)
  if (!page || !o || !Number.isFinite(value)) return false
  if (o.geometry.kind === 'slider' && param === 'value') {
    doc.updateObjectParameter(pageId, o.id, 'value', value)
    writeTargetValue(pageId, useDocStore.getState().pages[pageId], text(o, 'targetType', 'variable'), text(o, 'targetObjectId'), text(o, 'targetParamName', 'x'), value)
    return true
  }
  doc.setParam(pageId, o.id, param, String(Number(value.toPrecision(6))))
  return true
}
