// Materializes a live board_session's temporary copy into the local
// workspace/doc stores so PageView can render it — shared by the board
// itself (app/board/page.tsx) and the desktop-live view (app/present/page.tsx),
// both of which need the identical "temp page under a synthetic folder"
// setup to show the same live content.

import {
  useWorkspaceStore,
  findPageMeta,
  childrenOf,
  descendantsOf,
} from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { bundleMetaPatch, writeBundleContent, type PageBundle } from '@/lib/store/page-bundle'
import * as pageArchive from '@/lib/store/page-archive'

export const BOARD_SESSION_FOLDER = '__board-session'
const BOARD_NB = BOARD_SESSION_FOLDER
const BOARD_NB_SEC = `${BOARD_NB}-sec`

export function registerSessionPage(tempId: string, name: string, bundle: PageBundle) {
  useWorkspaceStore.setState((s) => {
    // Drop any previous board-session folder (by name — see BOARD_NB's
    // comment) and rebuild it fresh, same "one live session at a time" model
    // the old array-based version had.
    const stale = childrenOf(s.nodes, null).find((n) => n.name === BOARD_NB)
    const nodes = { ...s.nodes }
    if (stale) {
      delete nodes[stale.id]
      descendantsOf(s.nodes, stale.id).forEach((n) => delete nodes[n.id])
    }
    nodes[BOARD_NB] = { id: BOARD_NB, parentId: null, kind: 'folder', name: BOARD_NB, emoji: '🖥️', order: 0 }
    nodes[BOARD_NB_SEC] = { id: BOARD_NB_SEC, parentId: BOARD_NB, kind: 'folder', name: 'Live', color: 'blue', order: 0 }
    nodes[tempId] = {
      id: tempId,
      parentId: BOARD_NB_SEC,
      kind: 'page',
      name,
      order: 0,
      ...(bundle.bundle ? bundleMetaPatch(bundle.bundle) : { pageKind: 'board' as const }),
    }
    return { nodes, activePageId: tempId }
  })
  writeBundleContent(tempId, bundle)
}

export function clearSessionPage(tempId: string) {
  const meta = findPageMeta(useWorkspaceStore.getState().nodes, tempId)
  const ids = [
    tempId,
    ...(meta?.docPages ?? []),
    ...(meta?.notesPages ?? []).filter(Boolean),
    ...(meta?.annotPages ?? []).filter(Boolean),
    ...(meta?.notesDocId ? [meta.notesDocId] : []),
  ]
  // NOT forgetPage — these ids belong to the teacher's pages; marking them
  // deleted here would delete the originals from the cloud.
  useDocStore.setState((s) => {
    const pages = { ...s.pages }
    const scopes = { ...s.scopes }
    for (const id of ids) {
      delete pages[id]
      delete scopes[id]
    }
    return { pages, scopes }
  })
  ids.forEach((id) => pageArchive.dropPage(id))
  useWorkspaceStore.setState((s) => {
    const boardNb = childrenOf(s.nodes, null).find((n) => n.name === BOARD_NB)
    const nodes = { ...s.nodes }
    if (boardNb) {
      delete nodes[boardNb.id]
      descendantsOf(s.nodes, boardNb.id).forEach((n) => delete nodes[n.id])
    }
    return {
      nodes,
      activePageId: s.activePageId === tempId ? null : s.activePageId,
      activeSheetId: null,
      pdfToolsActive: false,
    }
  })
}
