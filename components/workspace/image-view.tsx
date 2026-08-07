'use client'

// Image page: view + annotate an uploaded image (png/jpeg/webp/gif/svg).
// Ink is a REAL InfiniteCanvas overlay, same pattern as pdf-view.tsx's
// per-page annotation layer — the shell's real board dock (pen/eraser/undo)
// draws right on top of the image. No pixel editing of the image itself.

import { useEffect, useRef, useState } from 'react'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { getFile } from '@/lib/storage/manager'
import { InfiniteCanvas } from './canvas'

// Fixed ink world-coordinate width, matching pdf-view.tsx's ANNOT_W — same
// reasoning: a stroke drawn on one device lands on the same spot of the
// image on every other device, independent of viewport size.
const ANNOT_W = 900

export function ImageView({ pageId }: { pageId: string }) {
  const meta = useWorkspaceStore((s) => findPageMeta(s.nodes, pageId))
  const activeSheetId = useWorkspaceStore((s) => s.activeSheetId)
  const [url, setUrl] = useState<string | null>(null)
  const [aspect, setAspect] = useState(1)
  const [hostW, setHostW] = useState(0)
  const hostRef = useRef<HTMLDivElement>(null)

  // ResizeObserver, not a one-shot ref callback — the ink overlay's
  // transform: scale() below has to track hostW live, or resizing the
  // window/sidebar after the image loads leaves ink misaligned from the
  // image underneath it (same reasoning pdf-view.tsx's PdfPage uses).
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHostW(el.clientWidth))
    ro.observe(el)
    setHostW(el.clientWidth)
    return () => ro.disconnect()
  }, [url])

  const fileUrl = meta?.fileUrl
  useEffect(() => {
    const fileId = fileUrl?.startsWith('opfs:') ? fileUrl.slice('opfs:'.length) : null
    if (!fileId) return
    let dead = false
    void (async () => {
      const blob = await getFile(fileId)
      if (!blob || dead) return
      setUrl(URL.createObjectURL(blob))
    })()
    return () => {
      dead = true
    }
  }, [fileUrl])

  useEffect(() => {
    const node = useWorkspaceStore.getState().nodes[pageId]
    if (!node || node.kind !== 'page') return
    if (node.imageAnnotPageId) {
      useWorkspaceStore.getState().setActiveSheet(node.imageAnnotPageId)
      return
    }
    const id = crypto.randomUUID()
    useWorkspaceStore.getState().updatePageMeta(pageId, { imageAnnotPageId: id })
    useWorkspaceStore.getState().setActiveSheet(id)
  }, [pageId])

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-muted/40 p-6">
      {!url ? (
        <span className="text-[12px] text-muted-foreground">Loading…</span>
      ) : (
        <div
          ref={hostRef}
          className="relative mx-auto max-h-full max-w-full overflow-hidden rounded-md bg-white shadow-[0_2px_16px_rgba(0,0,0,0.14)]"
          style={{ aspectRatio: `1 / ${aspect}`, width: 'min(100%, 900px)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={meta?.fileName ?? 'Image'}
            className="block h-full w-full select-none object-contain"
            onLoad={(e) => setAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
            draggable={false}
          />
          {meta?.imageAnnotPageId && hostW > 0 && (
            <div className="absolute inset-0 z-10 overflow-hidden">
              <div
                style={{
                  width: ANNOT_W,
                  height: ANNOT_W * aspect,
                  transform: `scale(${hostW / ANNOT_W})`,
                  transformOrigin: 'top left',
                }}
              >
                <InfiniteCanvas
                  key={meta.imageAnnotPageId}
                  pageId={meta.imageAnnotPageId}
                  locked
                  transparent
                  passthrough
                  active={meta.imageAnnotPageId === activeSheetId}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
