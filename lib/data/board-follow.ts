'use client'

// Student class-follow. Scanning a board's QR during a live presentation
// gives the student their OWN copy of the whiteboard in
// "Shared with me → Whiteboard". While the presentation runs, the copy
// mirrors the board's working snapshot; when the teacher ends it, the final
// state is kept and the page is stamped "<page> — <date, time>".
//
// Access control is physical: the flow requires the board's current pairing
// code (rotates after every session), so only people in the room join.

import { toast } from 'sonner'
import { getSession, subscribeBoardSessions } from './boards'
import type { BoardSessionRow } from './types'
import { useWorkspaceStore, childrenOf } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import type { PageKind } from '@/lib/scene/types'
import {
  bundleMetaPatch,
  writeBundleContent,
  type PageBundle,
} from '@/lib/store/page-bundle'
import { dbMode } from './db'
import { connectBoardLive, type BoardLiveHandle } from './board-live-client'
import type { BoardLiveServerMsg } from './board-live-types'
import { applyObjectPatch, diffObjects } from '@/lib/scene/diff'

const active = new Map<string, string>() // sessionId → local pageId (this tab)

/** Find/create "Shared with me → Whiteboard" and add a page, without
 *  stealing the user's current focus. */
function createTargetPage(pageName: string, kind: PageKind): string {
  const ws = useWorkspaceStore.getState()
  const nb = childrenOf(ws.nodes, null).find((n) => n.name === 'Shared with me')
  const nbId = nb?.id ?? ws.addNotebook('Shared with me')
  if (!nb) {
    useWorkspaceStore.setState((s) => ({
      nodes: s.nodes[nbId]?.kind === 'folder' ? { ...s.nodes, [nbId]: { ...s.nodes[nbId], emoji: '📥' } } : s.nodes,
    }))
  }
  const sec = childrenOf(useWorkspaceStore.getState().nodes, nbId).find((n) => n.name === 'Whiteboard')
  const secId = sec?.id ?? ws.addFolder('Whiteboard', nbId)
  const prevActive = useWorkspaceStore.getState().activePageId
  const pageId = ws.addPageIn(secId, pageName, kind)
  useWorkspaceStore.getState().setActivePage(prevActive)
  return pageId
}

/** Start (or resume) mirroring a live session into the student's notebook.
 *  Returns the local page id. Safe to call twice for the same session. */
export function followSession(session: BoardSessionRow): string {
  const existing = active.get(session.id)
  if (existing) return existing

  const first = (session.edited ?? session.snapshot) as PageBundle
  const kind = first.bundle?.kind ?? 'board'
  const pageId = createTargetPage(session.page_name, kind)
  active.set(session.id, pageId)

  // The mirror keeps the sender's sheet ids (a private copy on this device),
  // so every sync can simply overwrite content in place — kind, sheets and
  // file refs land via the bundle's meta patch.
  const write = (doc: PageBundle) => {
    if (doc.bundle) useWorkspaceStore.getState().updatePageMeta(pageId, bundleMetaPatch(doc.bundle))
    writeBundleContent(pageId, doc)
  }
  write(first)

  // Live socket: incoming patches/bundles land near-instantly, and — the
  // actual new capability — this student's own edits to the mirrored page
  // are now sent back into the shared session instead of staying purely
  // local. The 4s-poll mirror below stays wired as the fallback whenever
  // the socket isn't connected.
  let wsHandle: BoardLiveHandle | null = null
  let unsubPatchWatcher: (() => void) | null = null
  if (dbMode === 'cloud') {
    wsHandle = connectBoardLive(
      session.id,
      (evt: BoardLiveServerMsg) => {
        // No echo guard needed here: the server already excludes the
        // sending socket from fan-out, so this only ever sees other
        // participants' patches (teacher, board, or other students).
        switch (evt.type) {
          case 'obj-patch':
            applyObjectPatch(pageId, evt.objectId, evt.obj)
            break
          case 'bundle':
            write(evt.bundle)
            break
          case 'resync':
            void getSession(session.id).then((fresh) => {
              if (fresh) write((fresh.edited ?? fresh.snapshot) as PageBundle)
            })
            break
        }
      },
      () => {
        void getSession(session.id).then((fresh) => {
          if (fresh) write((fresh.edited ?? fresh.snapshot) as PageBundle)
        })
      }
    )
    if (kind === 'board') {
      unsubPatchWatcher = useDocStore.subscribe((s, prev) => {
        if (!wsHandle?.connected) return
        if (s.pages[pageId] === prev.pages[pageId]) return
        const { changed, removed } = diffObjects(prev.pages[pageId]?.objects ?? {}, s.pages[pageId]?.objects ?? {})
        for (const obj of Object.values(changed)) wsHandle.sendPatch(obj.id, obj)
        for (const id of removed) wsHandle.sendPatch(id, null)
      })
    }
  }

  const unsub = subscribeBoardSessions(() => {
    void getSession(session.id).then((fresh) => {
      if (!fresh) return
      if (fresh.status === 'live') {
        write((fresh.edited ?? fresh.snapshot) as PageBundle)
        return
      }
      // Presentation over: keep the final board state, stamp the page.
      write((fresh.edited ?? fresh.snapshot) as PageBundle)
      const stamp = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      useWorkspaceStore.getState().renamePage(pageId, `${fresh.page_name} — ${stamp}`)
      toast.success(`Class copy saved: “${fresh.page_name} — ${stamp}”`)
      unsub()
      unsubPatchWatcher?.()
      wsHandle?.close()
    })
  })

  return pageId
}

export const followedPage = (sessionId: string): string | null => active.get(sessionId) ?? null
