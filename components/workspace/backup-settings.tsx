'use client'

// Full local backup: everything the current account has on THIS device —
// notebook tree, every page's content, xlsx grids, and every locally stored
// file's bytes — zipped for download, and the same zip re-imported to
// restore or move to a new device. This is the only "all your data" export
// in the app; it exists because storage is local-only (lib/storage/manager.ts)
// and there's no other durable copy to fall back on.

import { useRef, useState } from 'react'
import { Loader2, Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/lib/auth/store'
import { exportWorkspaceBundle, importWorkspaceBundle, type WorkspaceBundle } from '@/lib/store/workspace-bundle'

const MANIFEST_ENTRY = 'workspace.json'
const FILES_DIR = 'files/'

export function BackupSettings() {
  const profile = useAuthStore((s) => s.profile)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const doExport = async () => {
    if (!profile) return
    setExporting(true)
    try {
      const { bundle, fileBlobs } = await exportWorkspaceBundle(profile.id)
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      zip.file(MANIFEST_ENTRY, JSON.stringify(bundle))
      for (const [id, blob] of fileBlobs) zip.file(`${FILES_DIR}${id}`, blob)
      const out = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(out)
      const a = document.createElement('a')
      a.href = url
      a.download = `simblip-backup-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Backup downloaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Backup failed')
    } finally {
      setExporting(false)
    }
  }

  const doImport = async (file: File) => {
    if (!profile) return
    setImporting(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(file)
      const manifestEntry = zip.file(MANIFEST_ENTRY)
      if (!manifestEntry) throw new Error('Not a SIMBLIP backup file')
      const bundle = JSON.parse(await manifestEntry.async('string')) as WorkspaceBundle
      const fileBlobs = new Map<string, Blob>()
      for (const path of Object.keys(zip.files)) {
        if (!path.startsWith(FILES_DIR) || zip.files[path].dir) continue
        fileBlobs.set(path.slice(FILES_DIR.length), await zip.files[path].async('blob'))
      }
      await importWorkspaceBundle(profile.id, bundle, fileBlobs)
      toast.success('Backup restored — reloading…')
      setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read that backup file')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card/60 p-3">
        <p className="text-ui-md font-medium text-foreground">Local backup</p>
        <p className="mt-1 text-ui-xs leading-normal text-muted-foreground">
          Everything you make stays on this device only — notebooks, ink, and every image or
          document you attach. Download a backup to move to a new device or protect against
          losing this browser's data, and restore it from the same place.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={doExport} disabled={exporting || importing}>
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download backup
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInput.current?.click()}
          disabled={exporting || importing}
        >
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Restore from backup
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void doImport(file)
          }}
        />
      </div>

      <p className="text-ui-xs text-muted-foreground">
        Restoring overwrites any page or file with the same id already on this device — everything
        else is left alone.
      </p>
    </div>
  )
}
