// Materializes a live board_session's temporary copy into the local
// workspace/doc stores so PageView can render it — shared by the board
// itself (app/board/page.tsx) and the desktop-live view (app/present/page.tsx),
// both of which need the identical "temp page under a synthetic folder"
// setup to show the same live content, and the identical handling of
// incoming RemoteCommands (transport, slide/page nav, param nudges, toggles).

import {
  useWorkspaceStore,
  findPageMeta,
  childrenOf,
  descendantsOf,
} from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { bundleMetaPatch, writeBundleContent, type PageBundle } from '@/lib/store/page-bundle'
import * as pageArchive from '@/lib/store/page-archive'
import { play, pause, stop } from '@/lib/physics/world'
import { num } from '@/lib/scene/types'
import type { RemoteCommand } from './types'

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

function pageHolding(mainId: string, objectId: string): string {
  const pages = useDocStore.getState().pages
  if (pages[mainId]?.objects[objectId]) return mainId
  const meta = findPageMeta(useWorkspaceStore.getState().nodes, mainId)
  for (const id of [
    ...(meta?.docPages ?? []),
    ...(meta?.notesPages ?? []).filter(Boolean),
    ...(meta?.annotPages ?? []).filter(Boolean),
  ])
    if (pages[id]?.objects[objectId]) return id
  return mainId
}

/** Apply an incoming RemoteCommand (phone or desktop-live sender) to this
 *  device's local state — transport commands run THIS device's own physics
 *  independently (see docs/superpowers/specs/2026-08-09-redis-board-live-design.md:
 *  each side runs its own simulation from the same signal, not a single
 *  shared/streamed run). */
export function applyRemote(cmd: RemoteCommand, pageId: string) {
  const doc = useDocStore.getState()
  if (cmd.objectId && (cmd.kind === 'param' || cmd.kind === 'toggle'))
    pageId = pageHolding(pageId, cmd.objectId)
  switch (cmd.kind) {
    case 'play':
      play(pageId)
      break
    case 'pause':
      pause()
      break
    case 'stop':
      stop()
      break
    case 'pdf':
      window.dispatchEvent(
        new CustomEvent('simblip-remote-pdf', { detail: { dir: cmd.dir ?? 1, objectId: cmd.objectId } })
      )
      break
    case 'pptx':
      window.dispatchEvent(new CustomEvent('simblip-remote-pptx', { detail: { dir: cmd.dir ?? 1 } }))
      break
    case 'select':
      doc.setSelection(cmd.objectId ? [cmd.objectId] : [])
      break
    case 'param':
      if (cmd.objectId && cmd.behaviorId && cmd.param)
        doc.setBehaviorParam(pageId, cmd.objectId, cmd.behaviorId, cmd.param, cmd.value ?? '0')
      break
    case 'toggle': {
      // Flip an interactive component (switch/logic input) exactly like a
      // tap on the board — flipping the CURRENT value keeps it correct even
      // when the sender's mirror of the doc is a little stale.
      if (!cmd.objectId || !cmd.param) break
      const obj = doc.pages[pageId]?.objects[cmd.objectId]
      if (!obj) break
      const p = obj.parameters[cmd.param]
      const cur = p?.kind === 'number' ? p.value : cmd.param === 'closed' ? 1 : 0
      const next = cur >= 0.5 ? '0' : '1'
      if (p) doc.setParam(pageId, cmd.objectId, cmd.param, next)
      else
        doc.updateObject(pageId, cmd.objectId, {
          parameters: { ...obj.parameters, [cmd.param]: num(next) },
        })
      break
    }
  }
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
