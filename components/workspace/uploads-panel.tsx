'use client'

// Uploads Library Panel — Side panel section showing all pictures and files
// uploaded in the app as a central asset library. Clicking any asset inserts a
// reference into the active document (reusing the same opfs:<fileId> storage
// without duplicating disk space).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import {
  FileText,
  FolderUp,
  Image as ImageIcon,
  Loader2,
  Plus,
  Search,
  Trash2,
  UploadCloud,
  X,
  FileSpreadsheet,
  FileCode,
  File as FileIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth/store'
import { listAllEntries, onManifestChange } from '@/lib/storage/manifest'
import { deleteFiles, getFile, putFile } from '@/lib/storage/manager'
import type { FileManifestEntry } from '@/lib/storage/manifest-types'
import { useDocStore } from '@/lib/store/document'
import { findNode, useWorkspaceStore } from '@/lib/store/workspace'
import { baseObject } from '@/lib/scene/factory'
import type { SceneObject } from '@/lib/scene/types'
import { pageKindForFile } from '@/components/workspace/open-file'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface UploadItem {
  id: string
  name: string
  mime: string
  size: number
  createdAt: number
  url: string
  isImage: boolean
  thumbnailUrl?: string
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getFileIcon(mime: string, name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return <ImageIcon className="h-4 w-4 text-sky-500 shrink-0" />
  }
  if (mime.includes('pdf') || ext === 'pdf') {
    return <FileText className="h-4 w-4 text-rose-500 shrink-0" />
  }
  if (mime.includes('sheet') || mime.includes('excel') || ['xlsx', 'xls', 'csv'].includes(ext)) {
    return <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />
  }
  if (mime.includes('presentation') || mime.includes('powerpoint') || ['pptx', 'ppt'].includes(ext)) {
    return <FileText className="h-4 w-4 text-amber-500 shrink-0" />
  }
  if (['txt', 'md', 'json', 'js', 'ts', 'py', 'cpp', 'c', 'h'].includes(ext)) {
    return <FileCode className="h-4 w-4 text-indigo-500 shrink-0" />
  }
  return <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
}

/** World-space point currently at the middle of the active canvas viewport. */
function viewCenter(pageId: string): { x: number; y: number } {
  const v = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  return { x: Math.round((w / 2 - v.x) / v.zoom - 120), y: Math.round((h / 2 - v.y) / v.zoom - 80) }
}

export function UploadsPanel({
  open,
  onClose,
  pageId,
  inline = false,
}: {
  open: boolean
  onClose: () => void
  pageId: string | null
  inline?: boolean
}) {
  const motion = useSpring()
  const profile = useAuthStore((s) => s.profile)
  const [items, setItems] = useState<UploadItem[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'pictures' | 'documents'>('all')
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load files from manifest IndexedDB & active page objects
  const refresh = useCallback(async () => {
    try {
      const manifestEntries: FileManifestEntry[] = await listAllEntries()

      // Map manifest entries to UploadItems
      const map = new Map<string, UploadItem>()

      manifestEntries.forEach((entry) => {
        const isImg =
          entry.mime.startsWith('image/') ||
          /\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name)
        map.set(entry.id, {
          id: entry.id,
          name: entry.name,
          mime: entry.mime,
          size: entry.size,
          createdAt: entry.createdAt,
          url: `opfs:${entry.id}`,
          isImage: isImg,
        })
      })

      // Also scan active document pages for uploaded picture/file objects
      const pages = useDocStore.getState().pages
      Object.values(pages).forEach((page) => {
        Object.values(page.objects).forEach((obj) => {
          if (obj.geometry.kind === 'picture' && obj.geometry.src) {
            const src = obj.geometry.src
            const id = src.startsWith('opfs:') ? src.slice('opfs:'.length) : obj.id
            if (!map.has(id)) {
              map.set(id, {
                id,
                name: obj.name || 'Picture',
                mime: 'image/png',
                size: 0,
                createdAt: Date.now(),
                url: src,
                isImage: true,
              })
            }
          } else if (obj.metadata?.kind === 'file' && obj.metadata.fileUrl) {
            const fileUrl = obj.metadata.fileUrl as string
            const id = fileUrl.startsWith('opfs:') ? fileUrl.slice('opfs:'.length) : obj.id
            if (!map.has(id)) {
              const mime = (obj.metadata.fileMime as string) || 'application/pdf'
              map.set(id, {
                id,
                name: (obj.metadata.fileName as string) || obj.name || 'Document',
                mime,
                size: 0,
                createdAt: Date.now(),
                url: fileUrl,
                isImage: mime.startsWith('image/'),
              })
            }
          }
        })
      })

      const list = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt)
      setItems(list)
    } catch (err) {
      console.error('Failed to list uploads:', err)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
    return onManifestChange(() => void refresh())
  }, [open, refresh])

  // Handle uploading files
  const handleUploadFiles = async (files: FileList | File[]) => {
    const fileList = Array.from(files)
    if (fileList.length === 0) return
    setUploading(true)
    const ownerId = profile?.id ?? 'anon'
    let count = 0
    try {
      for (const file of fileList) {
        await putFile(file, file.name, file.type || 'application/octet-stream', ownerId)
        count++
      }
      toast.success(
        count === 1
          ? `Uploaded "${fileList[0].name}"`
          : `Uploaded ${count} files to library`
      )
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload files')
    } finally {
      setUploading(false)
    }
  }

  // Delete an asset from OPFS / manifest
  const handleDelete = async (e: React.MouseEvent, item: UploadItem) => {
    e.stopPropagation()
    try {
      await deleteFiles([item.id])
      toast.success(`Removed "${item.name}" from library`)
      await refresh()
    } catch (err) {
      toast.error('Failed to delete file')
    }
  }

  // Insert asset into active document
  const handleInsert = async (item: UploadItem) => {
    if (!pageId) {
      toast.error('Open a page first to insert files.')
      return
    }

    const center = viewCenter(pageId)
    const store = useDocStore.getState()

    if (item.isImage) {
      const obj: SceneObject = baseObject('picture', center, item.name)
      obj.size = { w: 320, h: 240 }
      obj.geometry.src = item.url.startsWith('opfs:') ? item.url : `opfs:${item.id}`

      // Attempt to load image to get natural aspect ratio
      try {
        let blob: Blob | null = null
        if (item.url.startsWith('opfs:')) {
          blob = await getFile(item.id)
        } else if (item.url.startsWith('blob:')) {
          blob = await fetch(item.url).then((r) => r.blob())
        }
        if (blob) {
          const imgUrl = URL.createObjectURL(blob)
          const img = new Image()
          img.src = imgUrl
          await new Promise<void>((res) => {
            img.onload = () => {
              const maxDim = 380
              const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
              obj.size = {
                w: Math.round(img.naturalWidth * scale) || 320,
                h: Math.round(img.naturalHeight * scale) || 240,
              }
              URL.revokeObjectURL(imgUrl)
              res()
            }
            img.onerror = () => res()
          })
        }
      } catch {
        // Fallback size used if load fails
      }

      const existingObjects = Object.values(store.pages[pageId]?.objects ?? {})
      const maxZ = existingObjects.reduce((max, o) => Math.max(max, o.z ?? 0), 0)
      obj.z = maxZ + 1

      store.pushHistory(pageId)
      store.addObject(pageId, obj)
      store.setSelection([obj.id])
      toast.success(`Inserted picture "${item.name}"`)
    } else {
      // Non-image assets (pdf/doc/xlsx/pptx) embed as a Document object on
      // the active page, previewed with the app's own viewers — same object
      // dropping the file directly onto the canvas creates (canvas.tsx's
      // embedDocFileOnCanvas), just fed from an already-uploaded asset
      // instead of a fresh File.
      if (item.mime === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf')) {
        const blob = await getFile(item.id)
        if (!blob) {
          toast.error('Could not read this file.')
          return
        }
        const obj: SceneObject = baseObject('note', center, item.name)
        obj.size = { w: 480, h: 340 }
        obj.metadata = { render: 'file' }
        store.pushHistory(pageId)
        store.addObject(pageId, obj)
        store.setSelection([obj.id])
        const { putSessionFile } = await import('@/lib/store/ephemeral-storage')
        putSessionFile(obj.id, new File([blob], item.name, { type: item.mime }))
        toast.success(`Inserted "${item.name}"`)
        return
      }
      const kind = pageKindForFile({ mime: item.mime, name: item.name })
      if (!kind) {
        toast.error("This file type isn't supported yet.")
        return
      }
      const obj: SceneObject = baseObject('note', center, item.name)
      obj.size = { w: 480, h: 340 }
      obj.metadata = { render: 'file' }
      store.pushHistory(pageId)
      store.addObject(pageId, obj)
      store.setSelection([obj.id])
      const wsStore = useWorkspaceStore.getState()
      const activeNode = findNode(wsStore.nodes, pageId)
      const parentId = activeNode?.parentId ?? null
      const newPageId = wsStore.addPageIn(parentId ?? '', item.name.replace(/\.[^.]+$/, ''), kind, false)
      wsStore.updatePageMeta(newPageId, {
        fileUrl: item.url.startsWith('opfs:') ? item.url : `opfs:${item.id}`,
        fileName: item.name,
        fileMime: item.mime,
      })
      store.updateObject(pageId, obj.id, { metadata: { ...obj.metadata, linkedPageId: newPageId } })
      toast.success(`Inserted "${item.name}"`)
    }
  }

  // Filtered items based on tab & query
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      if (filter === 'pictures' && !item.isImage) return false
      if (filter === 'documents' && item.isImage) return false
      if (q && !item.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, query, filter])

  if (!open) return null

  return (
    <fm.aside
      initial={inline ? false : { x: 16, opacity: 0 }}
      animate={inline ? undefined : { x: 0, opacity: 1 }}
      transition={motion}
      className={
        inline
          ? 'flex h-full min-h-0 w-full flex-col'
          : 'glass z-30 m-3 flex w-80 flex-col rounded-2xl'
      }
      aria-label="Uploads library"
    >
      {/* Sticky Header */}
      <div className="sticky top-0 z-20 shrink-0 bg-background/95 backdrop-blur-md pb-2 pt-1 border-b border-border/40">
        <div className="flex items-center gap-2 px-3.5 pb-2 pt-2">
          <FolderUp className="h-4 w-4 text-[var(--accent-blue)]" />
          <span className="flex-1 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Uploads Library
          </span>
          <button
            type="button"
            aria-label="Upload file"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Close uploads"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-3 space-y-2">
          {/* Search bar */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search uploaded pictures & files…"
              className="h-8 pl-8 text-[0.78125rem]"
            />
          </div>

          {/* Category Filter Tabs */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {(['all', 'pictures', 'documents'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium capitalize transition-colors',
                  filter === cat
                    ? 'bg-foreground text-background font-semibold'
                    : 'bg-accent text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setFilter(cat)}
              >
                {cat === 'all' ? `All (${items.length})` : cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Upload Drop Zone & Item List */}
      <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {/* Upload dropzone banner */}
        <div
          className={cn(
            'group relative flex flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center transition-colors cursor-pointer',
            isDragOver
              ? 'border-[var(--accent-blue)] bg-[color-mix(in_oklch,var(--accent-blue)_10%,transparent)]'
              : 'border-border/70 hover:border-border hover:bg-accent/40'
          )}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragOver(true)
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragOver(false)
            if (e.dataTransfer.files) void handleUploadFiles(e.dataTransfer.files)
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-blue)]" />
              <span className="text-[0.75rem] font-medium">Uploading to library…</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <UploadCloud className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
              <span className="text-[0.75rem] font-semibold text-foreground">
                Drop pictures or files here
              </span>
              <span className="text-[0.6875rem]">or click to browse from device</span>
            </div>
          )}
        </div>

        {/* Empty state */}
        {filtered.length === 0 && !uploading && (
          <div className="px-2 py-8 text-center text-[0.75rem] leading-relaxed text-muted-foreground">
            {items.length === 0
              ? 'No uploads yet. Drag & drop pictures, PDFs, or office files above to add them to your library.'
              : 'No uploads match your search.'}
          </div>
        )}

        {/* Uploaded items grid */}
        <div className="grid grid-cols-3 gap-2">
          {filtered.map((item) => (
            <UploadCard
              key={item.id}
              item={item}
              onInsert={() => void handleInsert(item)}
              onDelete={(e) => void handleDelete(e, item)}
            />
          ))}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.pptx,.docx,.xlsx,.txt,.md,.csv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void handleUploadFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </fm.aside>
  )
}

/** Individual Upload Grid Tile with live image preview / icon & hover name overlay */
function UploadCard({
  item,
  onInsert,
  onDelete,
}: {
  item: UploadItem
  onInsert: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!item.isImage) return
    let dead = false
    if (item.url.startsWith('opfs:')) {
      const fileId = item.url.slice('opfs:'.length)
      void getFile(fileId).then((blob) => {
        if (!dead && blob) {
          setThumbUrl(URL.createObjectURL(blob))
        }
      })
    } else if (item.url.startsWith('blob:') || item.url.startsWith('http')) {
      setThumbUrl(item.url)
    }
    return () => {
      dead = true
    }
  }, [item])

  return (
    <div
      className="group relative aspect-square rounded-xl border border-border/60 bg-muted/20 overflow-hidden cursor-pointer hover:border-[var(--accent-blue)] transition-all shadow-xs hover:shadow-md flex items-center justify-center"
      onClick={onInsert}
      title={item.name}
    >
      {/* Preview Thumbnail or Format Icon */}
      {item.isImage && thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
          alt={item.name}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      ) : (
        <div className="flex flex-col items-center justify-center p-2 text-center">
          {getFileIcon(item.mime, item.name)}
          <span className="mt-1 max-w-full truncate text-[0.625rem] text-muted-foreground font-medium">
            {item.name.split('.').pop()?.toUpperCase() ?? 'FILE'}
          </span>
        </div>
      )}

      {/* Hover Overlay with Name at Bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-1.5 pt-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <p className="truncate text-center text-[0.625rem] font-medium text-white drop-shadow-xs">
          {item.name}
        </p>
      </div>

      {/* Delete Button on Hover */}
      <button
        type="button"
        aria-label="Delete from library"
        className="absolute top-1 right-1 z-10 rounded-full bg-black/60 p-1 text-white/90 opacity-0 transition-all hover:bg-rose-600 hover:text-white group-hover:opacity-100"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}
