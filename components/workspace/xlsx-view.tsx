'use client'

// XLSX page: a real spreadsheet grid editor (x-data-spreadsheet), not a
// flattened screenshot. First open imports the uploaded .xlsx via SheetJS;
// after that the grid's own JSON is the source of truth
// (lib/store/file-page-content.ts), autosaved on every change. "Export as
// .xlsx" re-serializes on demand via SheetJS.
//
// x-data-spreadsheet is a vanilla-JS widget (not a React component), so it's
// mounted imperatively into a ref'd container, same pattern pdf.js's canvas
// rendering uses elsewhere in this codebase.

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useFilePageContentStore } from '@/lib/store/file-page-content'
import { getFile } from '@/lib/storage/manager'
import { Button } from '@/components/ui/button'

type XSpreadsheetFactory = (container: HTMLElement, opts?: Record<string, unknown>) => {
  loadData: (d: unknown) => unknown
  getData: () => unknown
  change: (cb: (d: unknown) => void) => unknown
}
declare global {
  interface Window {
    x_spreadsheet?: XSpreadsheetFactory
  }
}

// x-data-spreadsheet's npm entry (src/index.js) imports its own .less
// stylesheet, which Turbopack has no loader for — `import('x-data-spreadsheet')`
// 500s the whole route the moment this file is bundled in. Its prebuilt
// dist/xspreadsheet.js is a UMD bundle with the CSS already compiled away,
// meant to be loaded as a plain <script> (it attaches window.x_spreadsheet)
// — so it's loaded that way here instead of through the module bundler.
let loadPromise: Promise<XSpreadsheetFactory> | null = null
function loadXSpreadsheet(): Promise<XSpreadsheetFactory> {
  loadPromise ??= new Promise<XSpreadsheetFactory>((resolve, reject) => {
    if (window.x_spreadsheet) {
      resolve(window.x_spreadsheet)
      return
    }
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = '/vendor/x-data-spreadsheet/xspreadsheet.css'
    document.head.appendChild(css)
    const script = document.createElement('script')
    script.src = '/vendor/x-data-spreadsheet/xspreadsheet.js'
    script.onload = () => (window.x_spreadsheet ? resolve(window.x_spreadsheet) : reject(new Error('x-data-spreadsheet failed to load')))
    script.onerror = () => reject(new Error('x-data-spreadsheet failed to load'))
    document.body.appendChild(script)
  }).catch((err: unknown) => {
    // Don't cache a failed load — a transient network hiccup shouldn't
    // permanently break every XlsxView mount for the rest of the session.
    loadPromise = null
    throw err
  })
  return loadPromise
}

export function XlsxView({ pageId }: { pageId: string }) {
  const meta = useWorkspaceStore((s) => findPageMeta(s.nodes, pageId))
  const savedContent = useFilePageContentStore((s) => s.content[pageId])
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<ReturnType<XSpreadsheetFactory> | null>(null)
  const importedRef = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let dead = false
    void (async () => {
      let x_spreadsheet: XSpreadsheetFactory
      try {
        x_spreadsheet = await loadXSpreadsheet()
      } catch {
        toast.error('Could not load the spreadsheet editor.')
        return
      }
      if (dead) return
      // x-data-spreadsheet needs an explicit view size — without it the
      // toolbar/grid compute against a 0×0 box on first mount (this
      // container's flex/min-h-0 ancestors haven't settled a layout height
      // yet the instant this runs) and never re-measure afterward, so
      // nothing paints. Reading el's own box on each call keeps it correct
      // if the pane is resized later too.
      const instance = x_spreadsheet(el, {
        showToolbar: true,
        showBottomBar: true,
        view: {
          height: () => el.clientHeight,
          width: () => el.clientWidth,
        },
      })
      instance.change(() => {
        useFilePageContentStore.getState().setContent(pageId, instance.getData())
      })
      sheetRef.current = instance

      if (savedContent) {
        instance.loadData(savedContent)
        return
      }
      // First open: import the source .xlsx.
      const fileUrl = meta?.fileUrl
      const fileId = fileUrl?.startsWith('opfs:') ? fileUrl.slice('opfs:'.length) : null
      if (!fileId || importedRef.current) return
      importedRef.current = true
      setImporting(true)
      try {
        const blob = await getFile(fileId)
        if (!blob) return
        const [XLSX, { workbookToXSpreadsheet }] = await Promise.all([
          import('xlsx'),
          import('@/lib/store/xlsx-convert'),
        ])
        const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
        const data = workbookToXSpreadsheet(wb)
        instance.loadData(data)
        useFilePageContentStore.getState().setContent(pageId, data)
      } catch {
        toast.error('Could not read this spreadsheet — starting blank.')
      } finally {
        if (!dead) setImporting(false)
      }
    })()
    return () => {
      dead = true
      if (el) el.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId])

  const exportXlsx = async () => {
    const data = sheetRef.current?.getData()
    if (!data) return
    setExporting(true)
    try {
      const [XLSX, { xSpreadsheetToWorkbook }] = await Promise.all([
        import('xlsx'),
        import('@/lib/store/xlsx-convert'),
      ])
      const wb = xSpreadsheetToWorkbook(data as never)
      const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${meta?.name ?? 'spreadsheet'}.xlsx`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      toast.error('Could not export this spreadsheet.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-end border-b border-border/60 px-3 py-1.5">
        <Button variant="outline" size="sm" onClick={() => void exportXlsx()} disabled={exporting}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export spreadsheet
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {importing && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/80 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[0.75rem]">Importing spreadsheet…</span>
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  )
}
