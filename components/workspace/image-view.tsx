'use client'

// Image page: view + annotate an uploaded image (png/jpeg/webp/gif/svg).
// Ink is a REAL InfiniteCanvas overlay, same pattern as pdf-view.tsx's
// per-page annotation layer — the shell's real board dock (pen/eraser/undo)
// draws right on top of the image. No pixel editing of the image itself.

import { BounceLoader } from '@/components/ui/bounce-loader'
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
  const [missing, setMissing] = useState(false)
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
      if (dead) return
      // A null blob means the row and the page survived but the bytes didn't.
      // Say so — the old code just left the loader spinning forever, which
      // reads as "still working" and gives the user nothing to act on.
      if (!blob) {
        setMissing(true)
        return
      }
      setUrl(URL.createObjectURL(blob))
    })()
    return () => {
      dead = true
    }
  }, [fileUrl])

  // The ink layer is what the dock draws on, so it has to be the active sheet
  // while this view is up — and NOT after it closes, or the next page's dock
  // would still be pointed at this image's ink (same cleanup as
  // presentation-view.tsx).
  useEffect(() => {
    const node = useWorkspaceStore.getState().nodes[pageId]
    if (!node || node.kind !== 'page') return
    if (node.imageAnnotPageId) {
      useWorkspaceStore.getState().setActiveSheet(node.imageAnnotPageId)
    } else {
      const id = crypto.randomUUID()
      useWorkspaceStore.getState().updatePageMeta(pageId, { imageAnnotPageId: id })
      useWorkspaceStore.getState().setActiveSheet(id)
    }
    return () => useWorkspaceStore.getState().setActiveSheet(null)
  }, [pageId])

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-muted/40 p-3 sm:p-6">
      {missing ? (
        <p className="max-w-[36ch] text-center text-ui-sm leading-relaxed text-muted-foreground">
          This image&rsquo;s file isn&rsquo;t on this device any more. Upload it again to
          restore it — the page and its annotations are kept.
        </p>
      ) : !url ? (
        <BounceLoader size={170} label="Opening image…" />
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
