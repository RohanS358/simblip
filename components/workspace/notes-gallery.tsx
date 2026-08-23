'use client'

// The Note Gallery — the account's scrapbook, opening from the right edge
// over the canvas: a masonry wall of sticky notes and pasted images on top,
// then a to-do list, then a month calendar of personal events.
//
// It is deliberately NOT a sidebar section. Every section in the left rail is
// about the page you have open (its tree, its objects, its outline); this is
// the one surface that belongs to the person rather than the document, so it
// gets its own drawer and its own toggle in the shell header instead of a
// seventh rail icon that would read as "another page panel".
//
// Shape and material are the sidebar's, though — same glass layer, same fold
// spring, same seam-drag resize (see sidebar.tsx for why the fold animates
// WIDTH and never a transform: a transform makes the element a backdrop root
// and the glass below it renders opaque).

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion as fm, useMotionValue, animate } from 'framer-motion'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Images,
  ListChecks,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { useSpring } from '@/lib/motion'
import { startSeamDrag } from '@/lib/seam-drag'
import { readFile } from '@/lib/storage/opfs'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PanelHeader } from './panel-header'
import {
  NOTE_COLORS,
  useNotesGallery,
  type GalleryEvent,
  type GalleryNote,
  type NoteColor,
} from '@/lib/store/notes-gallery'
import { cn } from '@/lib/utils'

const MIN_W = 260
const MAX_W = 560

/** The one inline "type a thing, press Enter" field — the to-do composer and
 *  the calendar's event composer are the same control. */
const ADD_FIELD = cn(
  'min-w-0 flex-1 rounded-lg border border-border/50 bg-background/40 px-2 py-1',
  'text-ui-xs outline-none backdrop-blur-sm transition-colors',
  'placeholder:text-muted-foreground/60 focus:border-[var(--accent-blue)]/60'
)

/** A note sits ON the panel's own glass, so it has to read as a separate
 *  plane: the same translucent material a few points MORE opaque, carrying
 *  the note's hue. Nested backdrop-filter is fine — the inner surface just
 *  samples what the panel already composited. */
function tint(color: NoteColor, opacity = 74) {
  return `color-mix(in oklch, var(--accent-${color}) 14%, color-mix(in oklch, var(--card) ${opacity}%, transparent))`
}

/** Resolve a pasted image's OPFS bytes to an object URL for as long as the
 *  card is mounted. */
function useNoteImage(fileId?: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!fileId) return
    let live = true
    let objectUrl: string | null = null
    readFile(fileId)
      .then((blob) => {
        if (!blob || !live) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {})
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileId])
  return url
}

function IconButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground',
            'transition-colors hover:bg-accent hover:text-foreground active:scale-95',
            className
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-ui-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function NoteCard({ note }: { note: GalleryNote }) {
  const editNote = useNotesGallery((s) => s.editNote)
  const removeNote = useNotesGallery((s) => s.removeNote)
  const url = useNoteImage(note.fileId)
  const ta = useRef<HTMLTextAreaElement>(null)

  // The wall is masonry, so a sticky is exactly as tall as its text — no
  // inner scrollbar, no fixed card height.
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [note.text])

  return (
    <div
      className={cn(
        'group/note relative mb-2 break-inside-avoid overflow-hidden rounded-xl',
        'border border-border/40 shadow-sm backdrop-blur-sm'
      )}
      style={{ background: tint(note.color) }}
    >
      {note.kind === 'image' ? (
        url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Pasted note" className="block w-full" />
        ) : (
          <div
            className="w-full animate-pulse bg-foreground/5"
            style={{ aspectRatio: String(1 / (note.ratio || 1)) }}
          />
        )
      ) : (
        <textarea
          ref={ta}
          value={note.text}
          placeholder="Write something…"
          onChange={(e) => editNote(note.id, { text: e.target.value })}
          className={cn(
            'block w-full resize-none bg-transparent px-2.5 py-2 text-ui-sm leading-relaxed',
            'text-foreground outline-none placeholder:text-muted-foreground/60'
          )}
          rows={2}
        />
      )}

      <button
        type="button"
        aria-label="Delete note"
        onClick={() => removeNote(note.id)}
        className={cn(
          'absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md',
          'bg-[var(--chrome-glass-bright)] text-muted-foreground shadow-sm backdrop-blur-sm',
          'opacity-0 transition-[opacity,color] duration-150 ease-out',
          'hover:text-destructive focus-visible:opacity-100 group-hover/note:opacity-100'
        )}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── To-do ─────────────────────────────────────────────────────────────────

function GalleryTodos() {
  const todos = useNotesGallery((s) => s.todos)
  const addTodo = useNotesGallery((s) => s.addTodo)
  const toggleTodo = useNotesGallery((s) => s.toggleTodo)
  const removeTodo = useNotesGallery((s) => s.removeTodo)
  const clearDoneTodos = useNotesGallery((s) => s.clearDoneTodos)
  const [text, setText] = useState('')

  // Completed items sink to the bottom, so the list stays a work queue
  // instead of a log you have to read past to find what's left.
  const ordered = useMemo(
    () => [...todos].sort((a, b) => Number(a.done) - Number(b.done)),
    [todos]
  )
  const openCount = todos.reduce((n, t) => n + (t.done ? 0 : 1), 0)
  const doneCount = todos.length - openCount

  const submit = () => {
    const t = text.trim()
    if (!t) return
    addTodo(t)
    setText('')
  }

  return (
    <div className="shrink-0 border-t border-border/40">
      <div className="flex h-9 items-center gap-2 px-3">
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-[var(--accent-mint)]" />
        <h3 className="min-w-0 flex-1 truncate text-ui-sm font-medium">To-do</h3>
        {openCount > 0 && (
          <span className="shrink-0 text-ui-2xs tabular-nums text-muted-foreground">{openCount}</span>
        )}
        {doneCount > 0 && (
          <button
            type="button"
            onClick={clearDoneTodos}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-ui-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Clear done
          </button>
        )}
      </div>

      {todos.length > 0 && (
        <div className="max-h-36 overflow-y-auto px-3">
          {ordered.map((t) => (
            <div key={t.id} className="group/todo flex items-start gap-2 py-1">
              <Checkbox
                checked={t.done}
                onCheckedChange={() => toggleTodo(t.id)}
                aria-label={t.text}
                className="mt-[3px] size-3.5 shrink-0"
              />
              <span
                className={cn(
                  'min-w-0 flex-1 break-words text-ui-xs leading-relaxed',
                  t.done && 'text-muted-foreground line-through'
                )}
              >
                {t.text}
              </span>
              <button
                type="button"
                aria-label={`Delete ${t.text}`}
                onClick={() => removeTodo(t.id)}
                className="mt-[2px] shrink-0 text-muted-foreground opacity-0 transition-[opacity,color] duration-150 hover:text-destructive focus-visible:opacity-100 group-hover/todo:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 px-3 pb-2 pt-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="Add a task…"
          className={ADD_FIELD}
        />
        <IconButton label="Add task" onClick={submit}>
          <Plus className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  )
}

// ── Calendar ──────────────────────────────────────────────────────────────
// A plain month grid, which is what "the most common calendar" means: pick a
// day, see its events, type one in. Native <input type="time"> does the time
// half rather than a picker component.

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function GalleryCalendar() {
  const events = useNotesGallery((s) => s.events)
  const addEvent = useNotesGallery((s) => s.addEvent)
  const removeEvent = useNotesGallery((s) => s.removeEvent)

  const [cursor, setCursor] = useState(() => new Date())
  const [selected, setSelected] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(cursor)),
        end: endOfWeek(endOfMonth(cursor)),
      }),
    [cursor]
  )

  const byDay = useMemo(() => {
    const map: Record<string, GalleryEvent[]> = {}
    for (const e of events) (map[e.date] ??= []).push(e)
    for (const key of Object.keys(map))
      map[key].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
    return map
  }, [events])

  const dayEvents = byDay[selected] ?? []

  const submit = () => {
    const t = title.trim()
    if (!t) return
    addEvent({
      date: selected,
      time: time || undefined,
      title: t,
      color: NOTE_COLORS[events.length % NOTE_COLORS.length],
    })
    setTitle('')
    setTime('')
  }

  return (
    <div className="shrink-0 border-t border-border/40">
      <div className="flex h-9 items-center gap-1 px-3">
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[var(--accent-violet)]" />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-ui-sm font-medium transition-colors hover:text-[var(--accent-blue)]"
          onClick={() => {
            setCursor(new Date())
            setSelected(format(new Date(), 'yyyy-MM-dd'))
          }}
          title="Jump to today"
        >
          {format(cursor, 'MMMM yyyy')}
        </button>
        <IconButton label="Previous month" onClick={() => setCursor((c) => addMonths(c, -1))}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="Next month" onClick={() => setCursor((c) => addMonths(c, 1))}>
          <ChevronRight className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      <div className="grid grid-cols-7 gap-0.5 px-3">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="pb-0.5 text-center text-ui-3xs font-medium text-muted-foreground/70">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const key = format(d, 'yyyy-MM-dd')
          const isSelected = key === selected
          const marks = byDay[key]
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              className={cn(
                'relative flex h-7 items-center justify-center rounded-md text-ui-xs',
                'transition-colors duration-150 ease-out',
                isSameMonth(d, cursor) ? 'text-foreground' : 'text-muted-foreground/40',
                isSelected
                  ? 'bg-[var(--accent-blue)] font-medium text-primary-foreground'
                  : 'hover:bg-accent',
                isToday(d) && !isSelected && 'font-semibold text-[var(--accent-blue)]'
              )}
            >
              {d.getDate()}
              {marks && (
                <span
                  aria-hidden
                  className="absolute bottom-[3px] h-1 w-1 rounded-full"
                  style={{
                    background: isSelected
                      ? 'currentColor'
                      : `var(--accent-${marks[0].color})`,
                  }}
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="max-h-32 overflow-y-auto px-3 pt-2">
        {dayEvents.length === 0 ? (
          <p className="py-1 text-ui-2xs text-muted-foreground">
            Nothing on {format(new Date(`${selected}T00:00`), 'EEE d MMM')}.
          </p>
        ) : (
          dayEvents.map((e) => (
            <div
              key={e.id}
              className="group/ev mb-1 flex items-center gap-2 rounded-lg border border-border/40 px-2 py-1 backdrop-blur-sm"
              style={{ background: tint(e.color, 70) }}
            >
              <span
                aria-hidden
                className="h-3 w-[3px] shrink-0 rounded-full"
                style={{ background: `var(--accent-${e.color})` }}
              />
              {e.time && (
                <span className="shrink-0 text-ui-2xs tabular-nums text-muted-foreground">{e.time}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-ui-xs">{e.title}</span>
              <button
                type="button"
                aria-label={`Delete ${e.title}`}
                onClick={() => removeEvent(e.id)}
                className="shrink-0 text-muted-foreground opacity-0 transition-[opacity,color] duration-150 hover:text-destructive focus-visible:opacity-100 group-hover/ev:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-1 px-3 pb-3 pt-1.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="New event…"
          className={ADD_FIELD}
        />
        <label className="relative flex items-center" title="Time (optional)">
          <Clock className="pointer-events-none absolute left-1.5 h-3 w-3 text-muted-foreground" />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={cn(
              'w-[5.5rem] rounded-lg border border-border/50 bg-background/40 py-1 pl-6 pr-1',
              'text-ui-2xs tabular-nums outline-none backdrop-blur-sm transition-colors',
              'focus:border-[var(--accent-blue)]/60'
            )}
          />
        </label>
        <IconButton label="Add event" onClick={submit}>
          <Plus className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────

export function NotesGallery() {
  const motion = useSpring()
  const open = useNotesGallery((s) => s.open)
  const width = useNotesGallery((s) => s.width)
  const setWidth = useNotesGallery((s) => s.setWidth)
  const setOpen = useNotesGallery((s) => s.setOpen)
  const notes = useNotesGallery((s) => s.notes)
  const addSticky = useNotesGallery((s) => s.addSticky)
  const addImage = useNotesGallery((s) => s.addImage)

  const foldRef = useRef<HTMLDivElement>(null)
  const wallRef = useRef<HTMLDivElement>(null)

  // Width is a motion value, not an `animate` prop: the seam writes it
  // straight to the DOM so a resize never re-renders the wall per
  // pointermove, and the spring below can't then snap back from a stale
  // value on commit. Same arrangement as sidebar.tsx.
  const foldW = useMotionValue(open ? width : 0)
  useEffect(() => {
    const controls = animate(foldW, open ? width : 0, motion)
    return () => controls.stop()
    // `motion` is a stable spring config from useSpring().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, width])

  // Opening the drawer puts the caret in the wall, so ⌘V works immediately
  // instead of silently doing nothing until you happen to click inside.
  useEffect(() => {
    if (open) wallRef.current?.focus({ preventScroll: true })
  }, [open])

  // Light dismiss: it's a drawer over the canvas, so working anywhere else
  // puts it away. Capture phase, on pointerdown — by the time a click
  // completes the canvas has already begun a stroke underneath.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target || foldRef.current?.contains(target)) return
      // The header button toggles on click; without this the dismiss would
      // fire first and its own toggle would immediately reopen the drawer.
      if (target.closest('[data-notes-gallery-toggle]')) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open, setOpen])

  const acceptImages = async (files: File[]) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      // Measure first so the masonry column reserves the right height and
      // the wall doesn't reflow when the blob URL resolves.
      let ratio = 1
      try {
        const bmp = await createImageBitmap(file)
        ratio = bmp.height / bmp.width
        bmp.close()
      } catch {
        // Undecodable by the browser — keep the square placeholder ratio.
      }
      await addImage(file, ratio)
    }
  }

  return (
    <fm.aside
      ref={foldRef}
      aria-label="Note gallery"
      style={{ width: foldW, ['--panel-w' as string]: `${width}px` }}
      /* z-[70]: the floating canvas chrome is z-50 (the toolbar dock) and
         z-[60] (the transport). A drawer those draw on top of reads as
         broken, so it sits above both. */
      className="absolute bottom-0 right-0 top-12 z-[70] overflow-hidden"
    >
      {/* Pinned to the fold's RIGHT edge, not in normal flow: the fold grows
          leftward out of the screen edge, so the content has to stay anchored
          there or it would slide in from the wrong side and clip backwards. */}
      <div
        style={{ width: 'var(--panel-w)' }}
        className="absolute inset-y-0 right-0 flex flex-col"
      >
        {/* The panel's material, its own layer under the content — clipPath is
            geometrically a no-op but forces a hard clip on the composited
            layer, without which Chromium bleeds the blurred backdrop a few px
            past the right edge. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 bg-[var(--chrome-glass)] backdrop-blur-sm"
          style={{ clipPath: 'inset(0)' }}
        />

        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <PanelHeader
            icon={Images}
            title="Note Gallery"
            accent="var(--accent-amber)"
            actions={
              <>
                <IconButton label="New sticky note" onClick={() => addSticky()}>
                  <Plus className="h-4 w-4" />
                </IconButton>
                <IconButton label="Close gallery" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </IconButton>
              </>
            }
          />

          {/* tabIndex so a plain click into the wall gives it focus and a
              subsequent ⌘V lands HERE — a window-level paste listener would
              steal every image paste from the canvas while the panel is open. */}
          <div
            ref={wallRef}
            tabIndex={0}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files)
              if (!files.some((f) => f.type.startsWith('image/'))) return
              e.preventDefault()
              void acceptImages(files)
            }}
            className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 outline-none"
          >
            {notes.length === 0 ? (
              <p className="px-1 py-6 text-center text-ui-xs leading-relaxed text-muted-foreground">
                Press <Plus className="inline h-3 w-3 align-[-2px]" /> for a sticky note, or click
                here and paste an image from the clipboard.
              </p>
            ) : (
              <div className="columns-[9rem] gap-2">
                {notes.map((n) => (
                  <NoteCard key={n.id} note={n} />
                ))}
              </div>
            )}
          </div>

          <GalleryTodos />
          <GalleryCalendar />
        </div>

        <div
          role="separator"
          aria-label="Resize note gallery"
          className={cn(
            'group absolute left-0 top-0 z-30 h-full w-3 touch-none cursor-col-resize',
            'border-l-2 border-border/60 transition-colors duration-150 hover:border-sky-400'
          )}
          onPointerDown={(e) => {
            const startX = e.clientX
            const startW = width
            startSeamDrag(
              e,
              // Dragging LEFT widens a right-hand panel — the sign flips.
              (ev) => Math.min(MAX_W, Math.max(MIN_W, startW - (ev.clientX - startX))),
              (w) => {
                foldW.set(w)
                foldRef.current?.style.setProperty('--panel-w', `${w}px`)
              },
              setWidth
            )
          }}
        />
      </div>
    </fm.aside>
  )
}
