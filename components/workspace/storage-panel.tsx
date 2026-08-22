'use client'

// Files & Links storage browser — usage-by-type chart plus a delete-capable
// tree, built entirely from the file manifest (lib/storage/manifest.ts)
// already tracked for sync. No new persistence, just a view over it.

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, File, FileSpreadsheet, FileText, Image as ImageIcon, Presentation, Trash2 } from 'lucide-react'
import { listAllEntries } from '@/lib/storage/manifest'
import { deleteFiles } from '@/lib/storage/manager'
import type { FileManifestEntry } from '@/lib/storage/manifest-types'
import { cn } from '@/lib/utils'

type Category = 'image' | 'document' | 'spreadsheet' | 'presentation' | 'other'

const CATEGORY_LABEL: Record<Category, string> = {
  image: 'Images',
  document: 'Documents',
  spreadsheet: 'Spreadsheets',
  presentation: 'Presentations',
  other: 'Other',
}

const CATEGORY_ICON: Record<Category, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  image: ImageIcon,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  other: File,
}

// chart-1..5 tokens, same order every render — categorical hue assignment is
// fixed to the category, never re-cycled by whichever types happen to exist.
const CATEGORY_COLOR: Record<Category, string> = {
  image: 'var(--chart-1)',
  document: 'var(--chart-2)',
  spreadsheet: 'var(--chart-3)',
  presentation: 'var(--chart-4)',
  other: 'var(--chart-5)',
}

function categoryOf(mime: string, name: string): Category {
  if (mime.startsWith('image/')) return 'image'
  if (mime.includes('spreadsheet') || /\.xlsx?$/i.test(name) || /\.csv$/i.test(name)) return 'spreadsheet'
  if (mime.includes('presentation') || /\.pptx?$/i.test(name)) return 'presentation'
  if (mime.includes('pdf') || mime.includes('document') || mime.startsWith('text/') || /\.docx?$|\.md$|\.txt$/i.test(name))
    return 'document'
  return 'other'
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}

function dayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

export function StoragePanel() {
  const [entries, setEntries] = useState<FileManifestEntry[] | null>(null)
  const [expanded, setExpanded] = useState<Set<Category>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())

  const reload = () => {
    void listAllEntries().then((all) =>
      setEntries(
        all
          // Defensive: a handful of manifest rows on this device carry
          // garbage `size` values from before this field was validated at
          // write time — clamp rather than let one bad row blow up the
          // chart scale and total to Infinity/1e226.
          .map((e) => ({ ...e, size: Number.isFinite(e.size) && e.size >= 0 && e.size < 1e12 ? e.size : 0 }))
          .sort((a, b) => b.size - a.size)
      )
    )
  }
  useEffect(reload, [])

  const grouped = useMemo(() => {
    const map = new Map<Category, FileManifestEntry[]>()
    for (const e of entries ?? []) {
      const cat = categoryOf(e.mime, e.name)
      const arr = map.get(cat) ?? []
      arr.push(e)
      map.set(cat, arr)
    }
    return map
  }, [entries])

  const totalSize = useMemo(() => (entries ?? []).reduce((s, e) => s + e.size, 0), [entries])

  const categories = (Object.keys(CATEGORY_LABEL) as Category[]).filter((c) => (grouped.get(c)?.length ?? 0) > 0)

  const toggle = (cat: Category) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  const removeFiles = async (ids: string[]) => {
    setBusy((prev) => new Set([...prev, ...ids]))
    await deleteFiles(ids)
    setEntries((prev) => (prev ? prev.filter((e) => !ids.includes(e.id)) : prev))
    setBusy((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
  }

  if (entries === null) {
    return <p className="text-ui-sm text-muted-foreground">Loading storage…</p>
  }

  if (entries.length === 0) {
    return <p className="text-ui-sm text-muted-foreground">No files stored on this device yet.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-ui-sm">
        <span className="text-muted-foreground">Total on this device</span>
        <span className="font-medium">{fmtBytes(totalSize)}</span>
      </div>

      <UsageChart grouped={grouped} categories={categories} />

      <div className="space-y-1 rounded-md border border-border">
        {categories.map((cat) => {
          const files = grouped.get(cat)!
          const Icon = CATEGORY_ICON[cat]
          const isOpen = expanded.has(cat)
          const catSize = files.reduce((s, f) => s + f.size, 0)
          const catIds = files.map((f) => f.id)
          return (
            <div key={cat} className="border-b border-border last:border-b-0">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 text-left"
                  onClick={() => toggle(cat)}
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', !isOpen && '-rotate-90')} />
                  <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: CATEGORY_COLOR[cat] }} />
                  <span className="text-ui-sm font-medium">{CATEGORY_LABEL[cat]}</span>
                  <span className="text-ui-xs text-muted-foreground">
                    {files.length} · {fmtBytes(catSize)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete all ${CATEGORY_LABEL[cat]}`}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Delete all ${files.length} ${CATEGORY_LABEL[cat].toLowerCase()} from this device?`)) {
                      void removeFiles(catIds)
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {isOpen && (
                <div className="space-y-0.5 pb-1.5 pl-8 pr-2">
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent">
                      <span className="flex-1 truncate text-ui-xs" title={f.name}>
                        {f.name}
                      </span>
                      <span className="shrink-0 text-ui-2xs text-muted-foreground">{fmtBytes(f.size)}</span>
                      <button
                        type="button"
                        aria-label={`Delete ${f.name}`}
                        disabled={busy.has(f.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:opacity-40"
                        onClick={() => {
                          if (confirm(`Delete "${f.name}" from this device? Pages still referencing it may show a broken embed.`)) {
                            void removeFiles([f.id])
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-ui-2xs leading-relaxed text-muted-foreground">
        Deleting a file removes it from this device (and the cloud backup, if synced). Pages that still embed it may show a broken preview.
      </p>
    </div>
  )
}

/** Cumulative storage per category over time (by day added) — a real
 *  change-over-time series, not a fake line through categorical buckets.
 *  Falls back to a single-day bar comparison when there's no real time
 *  spread, since a 2-point line for a fresh workspace is meaningless. */
function UsageChart({ grouped, categories }: { grouped: Map<Category, FileManifestEntry[]>; categories: Category[] }) {
  const days = useMemo(() => {
    const set = new Set<string>()
    for (const cat of categories) for (const f of grouped.get(cat)!) set.add(dayKey(f.createdAt))
    return [...set].sort()
  }, [grouped, categories])

  if (days.length < 2) {
    const catSizes = categories.map((cat) => ({
      cat,
      size: grouped.get(cat)!.reduce((s, f) => s + f.size, 0),
    }))
    const max = Math.max(...catSizes.map((c) => c.size), 1)
    return (
      <div className="space-y-1.5" role="img" aria-label="Storage used by file type">
        {catSizes.map(({ cat, size }) => (
          <div key={cat} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-ui-2xs text-muted-foreground">{CATEGORY_LABEL[cat]}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${(size / max) * 100}%`, background: CATEGORY_COLOR[cat] }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-ui-2xs text-muted-foreground">{fmtBytes(size)}</span>
          </div>
        ))}
      </div>
    )
  }

  // cumulative bytes per category per day
  const series = categories.map((cat) => {
    const byDay = new Map<string, number>()
    for (const f of grouped.get(cat)!) byDay.set(dayKey(f.createdAt), (byDay.get(dayKey(f.createdAt)) ?? 0) + f.size)
    let running = 0
    const points = days.map((d) => {
      running += byDay.get(d) ?? 0
      return running
    })
    return { cat, points }
  })

  const totals = days.map((_, i) => series.reduce((s, sr) => s + sr.points[i], 0))
  const maxTotal = Math.max(...totals, 1)

  const W = 100
  const H = 40
  const stepX = days.length > 1 ? W / (days.length - 1) : 0

  // Build stacked area paths, bottom category first.
  let cumulativeBelow = days.map(() => 0)
  const areas = series.map(({ cat, points }) => {
    const top = points.map((v, i) => cumulativeBelow[i] + v)
    const topPath = top.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * stepX} ${H - (v / maxTotal) * H}`).join(' ')
    const bottomPath = [...cumulativeBelow]
      .reverse()
      .map((v, ri) => {
        const i = cumulativeBelow.length - 1 - ri
        return `L ${i * stepX} ${H - (v / maxTotal) * H}`
      })
      .join(' ')
    cumulativeBelow = top
    return { cat, d: `${topPath} ${bottomPath} Z` }
  })

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full overflow-visible" role="img" aria-label="Cumulative storage by file type over time">
        {areas.map(({ cat, d }) => (
          <path key={cat} d={d} fill={CATEGORY_COLOR[cat]} fillOpacity={0.85} stroke="var(--background)" strokeWidth={0.4} />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {categories.map((cat) => (
          <span key={cat} className="flex items-center gap-1 text-ui-2xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[cat] }} />
            {CATEGORY_LABEL[cat]}
          </span>
        ))}
      </div>
    </div>
  )
}
