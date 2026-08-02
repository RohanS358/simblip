// Per-object diff/apply for board-session live sync (lib/data/board-live-client.ts).
// Objects are immutably replaced on every edit (lib/store/document.ts), so a
// reference-equality diff is enough to tell what actually changed.

import type { SceneObject } from './types'
import { useDocStore } from '@/lib/store/document'

export interface ObjectDiff {
  changed: Record<string, SceneObject>
  removed: string[]
}

export function diffObjects(
  prev: Record<string, SceneObject>,
  next: Record<string, SceneObject>
): ObjectDiff {
  const changed: Record<string, SceneObject> = {}
  const removed: string[] = []
  for (const [id, obj] of Object.entries(next)) {
    if (prev[id] !== obj) changed[id] = obj
  }
  for (const id of Object.keys(prev)) {
    if (!(id in next)) removed.push(id)
  }
  return { changed, removed }
}

/** Apply a remote whole-object replace/delete to a page — used for objects
 *  arriving over the board-live socket. No undo history: this is remote
 *  state landing, not a local user action. */
export function applyObjectPatch(pageId: string, objectId: string, obj: SceneObject | null): void {
  const store = useDocStore.getState()
  if (obj === null) {
    if (store.pages[pageId]?.objects[objectId]) store.removeObjects(pageId, [objectId])
    return
  }
  if (store.pages[pageId]?.objects[objectId]) {
    store.updateObject(pageId, objectId, obj, { history: false })
  } else {
    store.addObject(pageId, obj, { history: false })
  }
}
