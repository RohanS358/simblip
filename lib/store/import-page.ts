'use client'

// Clone-delivery helper. Shares, assignments and library inserts all arrive
// as frozen PageDoc copies that the recipient OWNS — this puts such a copy
// into the user's notebook tree (creating notebook/section on demand) and
// returns the new page id. Object ids are re-minted so a delivered copy can
// never collide with (or reference) anything of the sender's.

import { useWorkspaceStore } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { uid, type PageDoc, type SceneObject } from '@/lib/scene/types'

/** Deep-clone a PageDoc with fresh object ids (graph source bindings remapped). */
export function clonePageDoc(doc: PageDoc): PageDoc {
  const copy = JSON.parse(JSON.stringify(doc)) as PageDoc
  const idMap = new Map<string, string>()
  const objects: Record<string, SceneObject> = {}
  for (const [oldId, obj] of Object.entries(copy.objects)) {
    const next = uid()
    idMap.set(oldId, next)
    objects[next] = { ...obj, id: next, behaviors: obj.behaviors.map((b) => ({ ...b, id: uid() })) }
  }
  // Graphs reference other objects by id via their sourceId parameter.
  for (const obj of Object.values(objects)) {
    const src = obj.parameters.sourceId
    if (src?.kind === 'string' && idMap.has(src.value)) {
      obj.parameters = { ...obj.parameters, sourceId: { kind: 'string', value: idMap.get(src.value)! } }
    }
  }
  return {
    objects,
    variables: copy.variables.map((v) => ({ ...v, id: uid() })),
  }
}

export function importPageDoc(input: {
  notebookName: string
  notebookEmoji?: string
  sectionName: string
  pageName: string
  content: PageDoc
  activate?: boolean
}): string {
  const ws = useWorkspaceStore.getState()

  let notebook = ws.notebooks.find((n) => n.name === input.notebookName)
  const nbId = notebook?.id ?? ws.addNotebook(input.notebookName)
  if (!notebook && input.notebookEmoji) {
    useWorkspaceStore.setState((s) => ({
      notebooks: s.notebooks.map((n) => (n.id === nbId ? { ...n, emoji: input.notebookEmoji! } : n)),
    }))
  }
  notebook = useWorkspaceStore.getState().notebooks.find((n) => n.id === nbId)!

  const section = notebook.sections.find((sec) => sec.name === input.sectionName)
  const secId = section?.id ?? ws.addSection(nbId, input.sectionName)

  const prevActive = useWorkspaceStore.getState().activePageId
  const pageId = ws.addPage(nbId, secId, input.pageName)
  if (!input.activate) useWorkspaceStore.getState().setActivePage(prevActive)

  const doc = useDocStore.getState()
  useDocStore.setState((s) => ({
    pages: { ...s.pages, [pageId]: clonePageDoc(input.content) },
  }))
  doc.ensurePage(pageId) // computes the formula scope for the fresh content

  return pageId
}

/** Insert cloned objects into an existing page, offset to a drop point. */
export function insertObjects(pageId: string, objects: SceneObject[], at: { x: number; y: number }) {
  const doc = useDocStore.getState()
  doc.ensurePage(pageId)
  if (objects.length === 0) return
  const minX = Math.min(...objects.map((o) => o.position.x))
  const minY = Math.min(...objects.map((o) => o.position.y))
  doc.pushHistory(pageId)
  for (const obj of objects) {
    const clone = JSON.parse(JSON.stringify(obj)) as SceneObject
    clone.id = uid()
    clone.behaviors = clone.behaviors.map((b) => ({ ...b, id: uid() }))
    clone.position = { x: at.x + (obj.position.x - minX), y: at.y + (obj.position.y - minY) }
    doc.addObject(pageId, clone, { history: false })
  }
}
