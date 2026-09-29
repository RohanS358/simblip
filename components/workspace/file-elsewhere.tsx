'use client'

// Shown in a page's viewer when the page (and its notes/ink) synced here but
// the source file's bytes did not — they're still on the device it was added
// on, because large files only back up when asked (lib/sync/page-sync.ts).
// Says exactly that and what to do, instead of a spinner or a blank page.

import { CloudOff } from 'lucide-react'

export function FileElsewhereNotice({ kind = 'file' }: { kind?: string }) {
  return (
    <div className="mx-auto flex max-w-[40ch] flex-col items-center gap-3 px-4 text-center" role="status">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
        <CloudOff className="h-5 w-5 text-muted-foreground" />
      </span>
      <p className="text-ui-md font-medium text-foreground">This {kind} is on another device</p>
      <p className="text-ui-sm leading-relaxed text-muted-foreground">
        Your notes and annotations are here, but the original {kind} wasn&rsquo;t backed up to the cloud. On the
        device that has it, open the page menu → <span className="font-medium text-foreground">Cloud sync</span> →{' '}
        <span className="font-medium text-foreground">Sync with files</span>. Or add the {kind} again here.
      </p>
    </div>
  )
}
