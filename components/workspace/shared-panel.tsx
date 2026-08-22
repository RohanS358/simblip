'use client'

// Desktop "Shared" section — the same "Shared with me" notebook the mobile
// Shared tab and the old More-tab entry point at, rendered inline via the
// tree's own TreeNode recursion instead of a second read model.

import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore, childrenOf } from '@/lib/store/workspace'
import { useAuthStore } from '@/lib/auth/store'
import { can } from '@/lib/auth/types'
import { TreeNode, SHARED_NB, type TreeHandlers } from './notebook-tree'
import { openFile as openFileNode } from './open-file'
import { importPageInto } from '@/lib/store/import-page'
import { bundlePage } from '@/lib/store/page-bundle'
import {
  AssignDialog,
  PresentDialog,
  ShareDialog,
  type PageRef,
} from './page-actions'
import { PublishDialog } from './library-panel'
import { AddPageDialog } from './add-page-dialog'

export function SharedPanel() {
  const sharedRoot = useWorkspaceStore(
    useShallow((s) => childrenOf(s.nodes, null).find((n) => n.kind === 'folder' && n.name === SHARED_NB))
  )
  const children = useWorkspaceStore(
    useShallow((s) => (sharedRoot ? childrenOf(s.nodes, sharedRoot.id) : []))
  )
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const store = useWorkspaceStore
  const staff = can(role, 'share-pages')

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
  const [shareFor, setShareFor] = useState<PageRef | null>(null)
  const [assignFor, setAssignFor] = useState<PageRef | null>(null)
  const [presentFor, setPresentFor] = useState<PageRef | null>(null)
  const [publishFor, setPublishFor] = useState<PageRef | null>(null)
  const [addTarget, setAddTarget] = useState<{ parentId: string } | null>(null)
  const [uploadTarget, setUploadTarget] = useState<string | null>(null)

  const selectPage = (id: string) => store.getState().setActivePage(id)
  const duplicatePage = (parentId: string, page: PageRef) => {
    importPageInto(parentId, parentId, `${page.name} copy`, bundlePage(page.id), true)
  }
  const openFile: TreeHandlers['openFile'] = (node) => {
    openFileNode(node)
  }

  const handlers: TreeHandlers = {
    activePageId,
    renaming,
    setRenaming,
    selectPage,
    duplicatePage,
    setAddTarget,
    setShareFor,
    setAssignFor,
    setPresentFor,
    setPublishFor,
    staff,
    collapsed,
    toggleCollapsed: (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] })),
    uploadFileTo: (parentId) => setUploadTarget(parentId),
    openFile,
  }

  if (!sharedRoot || children.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <Share2 className="h-6 w-6 text-muted-foreground/50" />
        <p className="text-ui-sm text-muted-foreground">Nothing shared with you yet.</p>
        <p className="max-w-[24ch] text-ui-xs leading-relaxed text-muted-foreground/70">
          Pages your teachers share land here automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="px-2 pb-2">
      {children.map((n) => (
        <TreeNode key={n.id} node={n} depth={0} handlers={handlers} />
      ))}
      <ShareDialog page={shareFor} onOpenChange={(o) => !o && setShareFor(null)} />
      <AssignDialog page={assignFor} onOpenChange={(o) => !o && setAssignFor(null)} />
      <PresentDialog page={presentFor} onOpenChange={(o) => !o && setPresentFor(null)} />
      <PublishDialog
        open={publishFor !== null}
        onOpenChange={(o) => !o && setPublishFor(null)}
        pageId={publishFor?.id ?? null}
      />
      <AddPageDialog target={addTarget} onOpenChange={(o) => !o && setAddTarget(null)} onCreated={selectPage} />
    </div>
  )
}
