'use client'

// The touch equivalent of the desktop sidebar's rail sections — a slide-over
// sheet showing one of Notebook/Components/Tools/Library. Tablet's editor
// rail and phone's drawer both open the SAME sheet with the SAME content, so
// the taxonomy is identical across every breakpoint (see
// docs/ui-simplification-plan.md §6): only how you *reach* the sheet differs
// (a persistent rail on tablet, a drawer entry on phone).

import { AnimatePresence, motion as fm } from 'framer-motion'
import { X } from 'lucide-react'
import { useSpring } from '@/lib/motion'
import { SIDEBAR_SECTIONS, type SidebarSectionId } from '@/lib/store/sidebar-sections'
import { NotebookTree } from './notebook-tree'
import { Palette } from './palette'
import { ToolsPanel } from './tools-panel'
import { LibraryPanel } from './library-panel'
import { cn } from '@/lib/utils'

export function SectionSheet({
  section,
  onClose,
  pageId,
  fullWidth = false,
}: {
  section: SidebarSectionId | null
  onClose: () => void
  pageId: string | null
  /** Phone: the sheet takes the whole screen. Tablet: a side column. */
  fullWidth?: boolean
}) {
  const spring = useSpring()
  const meta = SIDEBAR_SECTIONS.find((s) => s.id === section)

  return (
    <AnimatePresence>
      {section && meta && (
        <>
          <fm.div
            className="fixed inset-0 z-[70] bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <fm.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={spring}
            className={cn(
              'fixed inset-y-0 left-0 z-[80] flex flex-col border-r border-border bg-background shadow-2xl',
              fullWidth ? 'w-full' : 'w-[22rem] max-w-[85vw]'
            )}
            aria-label={meta.label}
          >
            {/* Library supplies its own header + close button (title, search,
                publish) — a second one here would just duplicate it. */}
            {section !== 'library' && (
              <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
                <meta.icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-[13px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {meta.label}
                </span>
                <button
                  type="button"
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1">
              {section === 'notebook' && <NotebookTree onSelectPage={onClose} />}
              {section === 'components' && <Palette />}
              {section === 'tools' && <ToolsPanel />}
              {section === 'library' && <LibraryPanel inline open onClose={onClose} pageId={pageId} />}
            </div>
          </fm.div>
        </>
      )}
    </AnimatePresence>
  )
}
