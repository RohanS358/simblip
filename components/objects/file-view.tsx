'use client'

// Session document element — a PDF (or image) floating on the page with
// prev/next page + fullscreen controls. The file itself is session-only
// (lib/store/session-files.ts): nothing is uploaded or saved.

import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileUp, Maximize2 } from 'lucide-react'
import { getSessionFile, putSessionFile } from '@/lib/store/session-files'
import type { ObjectRendererProps } from './types'

export function FileObject({ object }: ObjectRendererProps) {
  const [page, setPage] = useState(1)
  const [, force] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const file = getSessionFile(object.id)

  const isPdf = file?.mime === 'application/pdf' || file?.name.toLowerCase().endsWith('.pdf')
  const isImage = file?.mime.startsWith('image/')

  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation()

  return (
    <div ref={boxRef} className="relative h-full w-full">
      <div className="glass-strong h-full w-full overflow-hidden rounded-xl">
        {!file ? (
          <button
            type="button"
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground"
            onPointerDown={stop}
            onClick={() => inputRef.current?.click()}
          >
            <FileUp className="h-6 w-6" />
            <span className="px-4 text-center text-[12px] leading-relaxed">
              {object.name || 'Attach a PDF or image'}
              <br />
              <span className="text-[10.5px] opacity-70">
                Session-only — files are never saved to the cloud. Re-attach after a reload.
                PowerPoint? Export it as PDF first.
              </span>
            </span>
          </button>
        ) : isPdf ? (
          <iframe
            key={page}
            title={file.name}
            src={`${file.url}#page=${page}&toolbar=0&navpanes=0`}
            className="h-full w-full"
          />
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt={file.name} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
            {file.name}: this format can't be shown inline — export it as PDF and re-attach.
          </div>
        )}
      </div>

      {/* Floating controls under the element. */}
      <div
        className="glass-strong absolute -bottom-11 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl px-1.5 py-1"
        onPointerDown={stop}
      >
        {isPdf && (
          <>
            <button
              type="button"
              aria-label="Previous page"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-8 text-center font-mono text-[11px]">{page}</span>
            <button
              type="button"
              aria-label="Next page"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
        <button
          type="button"
          aria-label="Replace file"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => inputRef.current?.click()}
        >
          <FileUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Fullscreen"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => void boxRef.current?.requestFullscreen?.()}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,image/*,.pptx,.ppt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            putSessionFile(object.id, f)
            setPage(1)
            force((n) => n + 1)
          }
        }}
      />
    </div>
  )
}
