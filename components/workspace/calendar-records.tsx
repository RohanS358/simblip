'use client'

// What the calendar knows about your WORK, as opposed to your plans: every
// page, document and file you made, and every gallery sticky and to-do, filed
// under the day (and minute) it was made — plus pages written FOR a day from
// the calendar, and pages linked to an event.
//
// Pages and files are stamped with `createdAt` when made (workspace.ts
// addPageIn/addFile); nodes older than that stamp have no record. A page made
// from the calendar carries `calendarAt`, which files it under the slot it was
// written for instead of the moment it was typed.

import { useMemo, useState } from 'react'
import {
  FileText,
  Globe,
  GraduationCap,
  Image as ImageIcon,
  ListChecks,
  NotebookPen,
  Paperclip,
  PenLine,
  Presentation,
  Sheet,
  StickyNote,
  X,
  type LucideIcon,
} from 'lucide-react'
import { keyOf } from '@/lib/calendar/dates.mjs'
import { childrenOf, useWorkspaceStore } from '@/lib/store/workspace'
import { useNotesGallery } from '@/lib/store/notes-gallery'
import type { Node, PageKind } from '@/lib/scene/types'
import { openFile } from './open-file'
import { cn } from '@/lib/utils'

export type CalRecord = {
  id: string
  kind: 'page' | 'file' | 'note' | 'todo'
  title: string
  /** 'YYYY-MM-DD' */
  day: string
  /** Minutes after midnight, or null when only the day is known. */
  min: number | null
  pageKind?: PageKind
  done?: boolean
}

const PAGE_ICONS: Record<PageKind, LucideIcon> = {
  board: PenLine,
  doc: FileText,
  pdf: FileText,
  image: ImageIcon,
  xlsx: Sheet,
  pptx: Presentation,
  web: Globe,
  course: GraduationCap,
}

export function recordIcon(r: Pick<CalRecord, 'kind' | 'pageKind'>): LucideIcon {
  if (r.kind === 'page') return PAGE_ICONS[r.pageKind ?? 'board'] ?? FileText
  if (r.kind === 'file') return Paperclip
  if (r.kind === 'note') return StickyNote
  return ListChecks
}

const RECORD_HUE: Record<CalRecord['kind'], string> = {
  page: 'var(--accent-blue)',
  file: 'var(--accent-violet)',
  note: 'var(--accent-amber)',
  todo: 'var(--accent-mint)',
}
export const recordHue = (r: CalRecord) => RECORD_HUE[r.kind]

function stamp(at: number): { day: string; min: number } {
  const d = new Date(at)
  return { day: keyOf(d), min: d.getHours() * 60 + d.getMinutes() }
}

/** 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' → day + minute. */
function slot(at: string): { day: string; min: number | null } {
  const [day, time] = at.split('T')
  return { day, min: time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : null }
}

/** Every record, grouped by day, each day in time order. */
export function useCalendarRecords(): Record<string, CalRecord[]> {
  const nodes = useWorkspaceStore((s) => s.nodes)
  const notes = useNotesGallery((s) => s.notes)
  const todos = useNotesGallery((s) => s.todos)

  return useMemo(() => {
    const out: Record<string, CalRecord[]> = {}
    const push = (r: CalRecord) => (out[r.day] ??= []).push(r)

    // A file's viewer page is made the first time the file is OPENED — the
    // file is the record, not its viewer.
    const viewerPages = new Set<string>()
    for (const n of Object.values(nodes)) if (n.kind === 'file' && n.pageId) viewerPages.add(n.pageId)

    for (const n of Object.values(nodes)) {
      if (n.kind === 'folder' || viewerPages.has(n.id)) continue
      const at = n.kind === 'page' && n.calendarAt ? slot(n.calendarAt) : n.createdAt ? stamp(n.createdAt) : null
      if (!at) continue
      push({
        id: n.id,
        kind: n.kind,
        title: n.name,
        ...at,
        pageKind: n.kind === 'page' ? n.pageKind : undefined,
      })
    }
    for (const n of notes)
      push({
        id: n.id,
        kind: 'note',
        title: n.kind === 'image' ? 'Pasted image' : n.text.split('\n')[0].slice(0, 60) || 'Sticky note',
        ...stamp(n.createdAt),
      })
    for (const t of todos) push({ id: t.id, kind: 'todo', title: t.text, done: t.done, ...stamp(t.createdAt) })

    for (const list of Object.values(out)) list.sort((a, b) => (a.min ?? -1) - (b.min ?? -1))
    return out
  }, [nodes, notes, todos])
}

/** Leave the calendar and show the thing: a page or file opens in the
 *  workspace, a sticky or to-do opens the Note Gallery. */
export function openRecord(r: Pick<CalRecord, 'id' | 'kind'>) {
  const gallery = useNotesGallery.getState()
  gallery.setCalendarOpen(false)
  if (r.kind === 'note' || r.kind === 'todo') {
    gallery.setOpen(true)
    return
  }
  const node = useWorkspaceStore.getState().nodes[r.id]
  if (node?.kind === 'file') openFile(node)
  else if (node?.kind === 'page') useWorkspaceStore.getState().setActivePage(node.id)
}

const NOTES_NOTEBOOK = 'Calendar Notes'

/** A new doc page for a calendar slot, filed in the "Calendar Notes" notebook
 *  (made on first use). Doesn't open it — the calendar stays up. */
export function createNotePage(title: string, calendarAt: string): string {
  const ws = useWorkspaceStore.getState()
  const folder =
    childrenOf(ws.nodes, null).find((n) => n.kind === 'folder' && n.name === NOTES_NOTEBOOK)?.id ??
    ws.addFolder(NOTES_NOTEBOOK, null)
  const id = useWorkspaceStore.getState().addPageIn(folder, title, 'doc', false)
  useWorkspaceStore.getState().updatePageMeta(id, { calendarAt })
  return id
}

// ── UI ────────────────────────────────────────────────────────────────────

const fmtMin = (min: number) => {
  const h = Math.floor(min / 60)
  return `${h % 12 || 12}:${String(min % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function RecordList({ records, empty }: { records: CalRecord[]; empty?: string }) {
  if (!records.length) return empty ? <p className="text-ui-2xs text-muted-foreground">{empty}</p> : null
  return (
    <div className="flex flex-col gap-0.5">
      {records.map((r) => {
        const Icon = recordIcon(r)
        return (
          <button
            key={`${r.kind}:${r.id}`}
            type="button"
            onClick={() => openRecord(r)}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-ui-xs transition-colors hover:bg-accent"
          >
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: recordHue(r) }} />
            <span className={cn('min-w-0 flex-1 truncate', r.done && 'text-muted-foreground line-through')}>
              {r.title}
            </span>
            {r.min !== null && (
              <span className="shrink-0 text-ui-2xs tabular-nums text-muted-foreground">{fmtMin(r.min)}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** The editor's "Linked pages" block: attached pages/files, a name search to
 *  attach more, and a button that writes a fresh note page for this slot. */
export function LinkedPages({
  links,
  onChange,
  noteTitle,
  calendarAt,
  field,
}: {
  links: string[]
  onChange: (links: string[]) => void
  noteTitle: string
  calendarAt: string
  field: string
}) {
  const nodes = useWorkspaceStore((s) => s.nodes)
  const [q, setQ] = useState('')

  const linked = links.map((id) => nodes[id]).filter((n): n is Node => !!n)
  const matches = q.trim()
    ? Object.values(nodes)
        .filter(
          (n) =>
            n.kind !== 'folder' &&
            !links.includes(n.id) &&
            n.name.toLowerCase().includes(q.trim().toLowerCase())
        )
        .slice(0, 6)
    : []

  return (
    <div className="flex flex-col gap-1.5">
      {linked.map((n) => {
        const Icon = recordIcon({ kind: n.kind === 'file' ? 'file' : 'page', pageKind: n.kind === 'page' ? n.pageKind : undefined })
        return (
          <div key={n.id} className="group/link flex items-center gap-2 rounded-lg border border-border/50 bg-background/40 px-2 py-1">
            <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
            <button
              type="button"
              onClick={() => openRecord({ id: n.id, kind: n.kind === 'file' ? 'file' : 'page' })}
              className="min-w-0 flex-1 truncate text-left text-ui-sm hover:text-[var(--accent-blue)]"
              title="Open"
            >
              {n.name}
            </button>
            <button
              type="button"
              aria-label={`Unlink ${n.name}`}
              onClick={() => onChange(links.filter((id) => id !== n.id))}
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}

      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Link a page or file…"
          className={field}
        />
        {matches.length > 0 && (
          <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border/60 bg-popover shadow-lg">
            {matches.map((n) => {
              const Icon = recordIcon({ kind: n.kind === 'file' ? 'file' : 'page', pageKind: n.kind === 'page' ? n.pageKind : undefined })
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    onChange([...links, n.id])
                    setQ('')
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-ui-sm hover:bg-accent"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{n.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onChange([...links, createNotePage(noteTitle, calendarAt)])}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 py-1.5 text-ui-sm text-muted-foreground transition-colors hover:border-[var(--accent-blue)]/60 hover:text-foreground"
      >
        <NotebookPen className="h-3.5 w-3.5" /> New note page for this event
      </button>
    </div>
  )
}
