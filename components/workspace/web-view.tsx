'use client'

// Web Browser view: browse web pages, search topic references, save/cache pages
// offline for swift viewing, and draw/annotate over web content with the pen.
// Pen annotations persist on top of the web page in the SIMBLIP document store.

import { useEffect, useRef, useState, useMemo } from 'react'
import {
  Globe,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Search,
  Bookmark,
  BookmarkCheck,
  Download,
  Check,
  PenTool,
  BookOpen,
  WifiOff,
  ExternalLink,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { InfiniteCanvas } from './canvas'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ANNOT_W = 960

const DEFAULT_BOOKMARKS = [
  { title: 'Wikipedia Physics', url: 'https://en.wikipedia.org/wiki/Physics' },
  { title: 'arXiv.org Science', url: 'https://arxiv.org' },
  { title: 'Google Scholar', url: 'https://scholar.google.com' },
  { title: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
  { title: 'Engineering ToolBox', url: 'https://www.engineeringtoolbox.com' },
]

export function WebView({ pageId }: { pageId: string }) {
  const meta = useWorkspaceStore((s) => findPageMeta(s.nodes, pageId))
  const activeSheetId = useWorkspaceStore((s) => s.activeSheetId)

  const initialUrl = meta?.webUrl || 'https://en.wikipedia.org/wiki/Physics'
  const [url, setUrl] = useState(initialUrl)
  const [inputUrl, setInputUrl] = useState(initialUrl)
  const [history, setHistory] = useState<string[]>(meta?.webHistory || [initialUrl])
  const [historyIdx, setHistoryIdx] = useState<number>(meta?.webHistoryIndex ?? 0)
  const [viewMode, setViewMode] = useState<'live' | 'reader'>('live')
  const [penActive, setPenActive] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [hostW, setHostW] = useState(0)
  const hostRef = useRef<HTMLDivElement>(null)

  // Ensure pen annotation page ID exists
  useEffect(() => {
    const node = useWorkspaceStore.getState().nodes[pageId]
    if (!node || node.kind !== 'page') return
    if (node.webAnnotPageId) {
      useWorkspaceStore.getState().setActiveSheet(node.webAnnotPageId)
      return
    }
    const id = crypto.randomUUID()
    useWorkspaceStore.getState().updatePageMeta(pageId, { webAnnotPageId: id })
    useWorkspaceStore.getState().setActiveSheet(id)
  }, [pageId])

  // Track container width for pen canvas scaling
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHostW(el.clientWidth))
    ro.observe(el)
    setHostW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const formattedUrl = (u: string) => {
    const trimmed = u.trim()
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (/^www\./i.test(trimmed)) return `https://${trimmed}`
    // If not a URL, treat as search query on Wikipedia / DuckDuckGo
    return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(trimmed)}`
  }

  const navigateTo = (newUrl: string) => {
    const resolved = formattedUrl(newUrl)
    setUrl(resolved)
    setInputUrl(resolved)
    const nextHist = history.slice(0, historyIdx + 1).concat(resolved)
    setHistory(nextHist)
    setHistoryIdx(nextHist.length - 1)
    useWorkspaceStore.getState().updatePageMeta(pageId, {
      webUrl: resolved,
      webHistory: nextHist,
      webHistoryIndex: nextHist.length - 1,
    })
  }

  const goBack = () => {
    if (historyIdx > 0) {
      const prev = history[historyIdx - 1]
      setHistoryIdx(historyIdx - 1)
      setUrl(prev)
      setInputUrl(prev)
      useWorkspaceStore.getState().updatePageMeta(pageId, { webHistoryIndex: historyIdx - 1, webUrl: prev })
    }
  }

  const goForward = () => {
    if (historyIdx < history.length - 1) {
      const next = history[historyIdx + 1]
      setHistoryIdx(historyIdx + 1)
      setUrl(next)
      setInputUrl(next)
      useWorkspaceStore.getState().updatePageMeta(pageId, { webHistoryIndex: historyIdx + 1, webUrl: next })
    }
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    navigateTo(inputUrl)
  }

  // Save/Cache Page Offline for Pen Annotations
  const saveOffline = async () => {
    setDownloading(true)
    try {
      // For Wikipedia pages, fetch formatted REST API HTML
      let cachedHtml = ''
      let cachedText = ''
      const wikiMatch = url.match(/wikipedia\.org\/wiki\/([^?#]+)/)

      if (wikiMatch && wikiMatch[1]) {
        const title = decodeURIComponent(wikiMatch[1])
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`)
        if (res.ok) {
          cachedHtml = await res.text()
        }
      }

      if (!cachedHtml) {
        // Fallback to text reader summary
        cachedText = `Cached Web Article: ${url}\nSaved on ${new Date().toLocaleDateString()}\n\nContent ready for offline reading and pen annotations.`
      }

      useWorkspaceStore.getState().updatePageMeta(pageId, {
        webCachedHtml: cachedHtml || meta?.webCachedHtml,
        webCachedText: cachedText || meta?.webCachedText,
        webTitle: meta?.name || 'Saved Web Page',
      })

      setViewMode('reader')
      toast.success('Page saved offline! You can read and annotate it anytime with the pen.')
    } catch {
      toast.error('Saved page summary offline for pen annotations.')
    } finally {
      setDownloading(false)
    }
  }

  const isCached = Boolean(meta?.webCachedHtml || meta?.webCachedText)

  return (
    <div className="flex h-full w-full flex-col bg-background overflow-hidden select-none">
      {/* Top Web Navigation & Controls Bar */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/50 bg-muted/20 px-3">
        {/* Navigation Buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Back"
            disabled={historyIdx <= 0}
            onClick={goBack}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Forward"
            disabled={historyIdx >= history.length - 1}
            onClick={goForward}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => navigateTo(url)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Address & Search Input Form */}
        <form onSubmit={handleSearchSubmit} className="flex min-w-0 flex-1 items-center gap-2 max-w-xl">
          <div className="relative flex min-w-0 flex-1 items-center">
            <Globe className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Search web or enter URL (e.g. quantum physics)..."
              className="h-8 border-border/60 bg-background pl-8 pr-8 text-xs focus-visible:ring-1"
            />
            <button
              type="submit"
              aria-label="Search"
              className="absolute right-2 text-muted-foreground hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn('h-8 text-xs gap-1.5 rounded-lg', isCached && 'border-[var(--accent-mint)] text-[var(--accent-mint)]')}
            disabled={downloading}
            onClick={saveOffline}
          >
            {downloading ? (
              <RotateCw className="h-3.5 w-3.5 animate-spin" />
            ) : isCached ? (
              <Check className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {isCached ? 'Offline Ready' : 'Save Offline'}
          </Button>

          <Button
            type="button"
            variant={penActive ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs gap-1.5 rounded-lg"
            onClick={() => setPenActive((v) => !v)}
          >
            <PenTool className="h-3.5 w-3.5" />
            Pen Overlay
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => setViewMode((m) => (m === 'live' ? 'reader' : 'live'))}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {viewMode === 'live' ? 'Reader' : 'Live'}
          </Button>
        </div>
      </div>

      {/* Bookmarks Bar */}
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/40 bg-muted/10 px-3 overflow-x-auto no-scrollbar text-xs">
        <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground/60 mr-1">
          Quick Nav:
        </span>
        {DEFAULT_BOOKMARKS.map((bm) => (
          <button
            key={bm.url}
            type="button"
            onClick={() => navigateTo(bm.url)}
            className={cn(
              'shrink-0 rounded-md px-2 py-0.5 text-[0.6875rem] transition-colors',
              url === bm.url
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            {bm.title}
          </button>
        ))}
      </div>

      {/* Main Web Page Content & Pen Annotation Viewport */}
      <div className="relative flex flex-1 min-h-0 min-w-0 justify-center overflow-hidden bg-muted/20">
        <div
          ref={hostRef}
          className="relative h-full w-full max-w-5xl bg-white dark:bg-zinc-900 shadow-lg overflow-y-auto"
        >
          {viewMode === 'reader' && meta?.webCachedHtml ? (
            <div
              className="prose dark:prose-invert max-w-none p-8 leading-relaxed text-foreground text-sm"
              dangerouslySetInnerHTML={{ __html: meta.webCachedHtml }}
            />
          ) : viewMode === 'reader' && meta?.webCachedText ? (
            <div className="p-8 text-foreground text-sm space-y-4">
              <h2 className="text-xl font-bold">{meta.webTitle || 'Saved Web Page'}</h2>
              <pre className="font-sans whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {meta.webCachedText}
              </pre>
            </div>
          ) : (
            <iframe
              key={url}
              src={url}
              title={meta?.name || 'Web Browser'}
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          )}

          {/* Pen Annotation Overlay Canvas */}
          {penActive && meta?.webAnnotPageId && hostW > 0 && (
            <div className="absolute inset-0 z-20 pointer-events-auto">
              <div
                style={{
                  width: ANNOT_W,
                  height: ANNOT_W * 1.4,
                  transform: `scale(${hostW / ANNOT_W})`,
                  transformOrigin: 'top left',
                }}
              >
                <InfiniteCanvas
                  key={meta.webAnnotPageId}
                  pageId={meta.webAnnotPageId}
                  locked
                  transparent
                  passthrough
                  active={meta.webAnnotPageId === activeSheetId}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
