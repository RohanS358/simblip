'use client'

// The document outline as a left-rail section. Renders whatever the active
// view published to useTocStore — a PDF's embedded outline, a deck's slide
// headings — so both readers share one list instead of each drawing its own
// side rail beside the sidebar.

import { useTocStore } from '@/lib/store/toc'
import { cn } from '@/lib/utils'

export function TocPanel() {
  const toc = useTocStore((s) => s.toc)

  if (!toc || toc.entries.length === 0) {
    return (
      <p className="py-6 text-center text-ui-sm leading-relaxed text-muted-foreground">
        This document has no table of contents.
      </p>
    )
  }

  return (
    <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 py-1.5">
      {toc.entries.map((item, i) => {
        const selected = toc.current === item.index
        return (
          <button
            key={`${item.index}-${i}`}
            type="button"
            onClick={() => toc.goTo(item.index)}
            style={{ paddingLeft: `${item.level * 0.75 + 0.5}rem` }}
            className={cn(
              'group relative flex w-full items-center justify-between gap-1.5 rounded px-2 py-1 text-left text-ui-sm transition-colors',
              selected
                ? 'bg-[var(--accent-blue)]/15 font-medium text-[var(--accent-blue)]'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            {/* Tree branch line for indented child topics */}
            {item.level > 0 && (
              <span
                className="absolute top-1/2 w-2 -translate-y-1/2 border-t border-border/60"
                style={{ left: `${(item.level - 1) * 0.75 + 0.5}rem` }}
              />
            )}
            <span className="truncate leading-tight">{item.title}</span>
            {item.locator && (
              <span className="shrink-0 font-mono text-ui-2xs opacity-40 transition-opacity group-hover:opacity-100">
                {item.locator}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
