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
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import type { PageDoc } from '@/lib/scene/types'

const active = new Map<string, string>() // sessionId → local pageId (this tab)

const deep = (d: PageDoc): PageDoc => JSON.parse(JSON.stringify(d)) as PageDoc

/** Find/create "Shared with me → Whiteboard" and add a page, without
 *  stealing the user's current focus. */
function createTargetPage(pageName: string): string {
  const ws = useWorkspaceStore.getState()
  const nb = ws.notebooks.find((n) => n.name === 'Shared with me')
  const nbId = nb?.id ?? ws.addNotebook('Shared with me')
  if (!nb) {
    useWorkspaceStore.setState((s) => ({
      notebooks: s.notebooks.map((n) => (n.id === nbId ? { ...n, emoji: '📥' } : n)),
    }))
  }
  const fresh = useWorkspaceStore.getState().notebooks.find((n) => n.id === nbId)!
  const sec = fresh.sections.find((s) => s.name === 'Whiteboard')
  const secId = sec?.id ?? ws.addSection(nbId, 'Whiteboard')
  const prevActive = useWorkspaceStore.getState().activePageId
  const pageId = ws.addPage(nbId, secId, pageName)
  useWorkspaceStore.getState().setActivePage(prevActive)
  return pageId
}

/** Start (or resume) mirroring a live session into the student's notebook.
 *  Returns the local page id. Safe to call twice for the same session. */
export function followSession(session: BoardSessionRow): string {
  const existing = active.get(session.id)
  if (existing) return existing

  const pageId = createTargetPage(session.page_name)
  active.set(session.id, pageId)

  const write = (doc: PageDoc) => {
    useDocStore.setState((s) => ({
      pages: { ...s.pages, [pageId]: deep(doc) },
      scopes: { ...s.scopes, [pageId]: undefined as never }, // force re-solve
    }))
    useDocStore.getState().ensurePage(pageId)
  }
  write(session.edited ?? session.snapshot)

  const unsub = subscribeBoardSessions(() => {
    void getSession(session.id).then((fresh) => {
      if (!fresh) return
      if (fresh.status === 'live') {
        write(fresh.edited ?? fresh.snapshot)
        return
      }
      // Presentation over: keep the final board state, stamp the page.
      write(fresh.edited ?? fresh.snapshot)
      const stamp = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      useWorkspaceStore.getState().renamePage(pageId, `${fresh.page_name} — ${stamp}`)
      toast.success(`Class copy saved: “${fresh.page_name} — ${stamp}”`)
      unsub()
    })
  })

  return pageId
}

export const followedPage = (sessionId: string): string | null => active.get(sessionId) ?? null
