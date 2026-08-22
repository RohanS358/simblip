'use client'

// The drag-and-drop-or-browse upload UI for a PDF-kind page — shared by
// pdf-view.tsx's empty state and the add-page dialog's PDF step, so both
// look and behave identically instead of a hand-copied second version.
// Self-contained: owns its own drag-over feedback and file input, so it
// works standalone with nothing wrapping it.

import { BounceLoader } from '@/components/ui/bounce-loader'
import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'

export function PdfDropzone({
  onFile,
  converting,
  openingLabel,
  accept = '.pdf,.pptx,.ppt,.docx,.txt,.md',
  prompt,
}: {
  onFile: (file: File) => void
  /** Non-null while a dropped/picked file is being converted to PDF —
   *  replaces the prompt with a spinner + this status text. */
  converting?: string | null
  /** Shown instead of the normal prompt copy while a file is already known
   *  and just needs to finish loading (pdf-view.tsx's "Opening…" case). */
  openingLabel?: string | null
  /** Native file picker filter — defaults to the PDF-page's original set. */
  accept?: string
  /** Idle prompt copy. Defaults to the PDF page's wording; the add-page
   *  dialog accepts more formats and says so. NOT the same thing as
   *  `openingLabel`, which means "a file is already loading". */
  prompt?: React.ReactNode
}) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      className="relative flex h-full w-full flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
    >
      {dragOver && (
        <div className="animate-in fade-in-0 pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_oklch,var(--accent-blue)_12%,transparent)] duration-150">
          <span className="animate-in fade-in-0 zoom-in-95 rounded-lg bg-card px-3 py-1.5 text-ui-sm font-semibold shadow duration-150">
            Drop to open
          </span>
        </div>
      )}
      {converting || openingLabel ? (
        <div className="flex h-full flex-col items-center justify-center">
          <BounceLoader size={200} label={converting || openingLabel || undefined} />
        </div>
      ) : (
        <button
          type="button"
          className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => inputRef.current?.click()}
        >
          <FileUp className="h-8 w-8" />
          <span className="max-w-72 text-center text-ui-md leading-relaxed">
            {prompt ?? (
              <>
                Upload a PDF or PowerPoint to read here
                <br />
                <span className="text-ui-xs opacity-70">
                  Click, or drag &amp; drop. PPT/DOCX convert to PDF in your browser. Your other
                  devices download their own copy the first time they open it.
                </span>
              </>
            )}
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onFile(f)
        }}
      />
    </div>
  )
}
