'use client'

// The Note Gallery — a scrapbook that belongs to the ACCOUNT, not to any
// page: sticky notes and pasted images in a masonry wall, a to-do list, and a
// calendar of personal events. Nothing here syncs; it persists under the
// per-user localStorage key like every other notebook store (see
// scoped-storage.ts), so it survives indefinitely on this machine and a
// second account on the same machine gets its own.
//
// Image BYTES deliberately do not live here. A pasted screenshot is easily a
// megabyte, and localStorage writes that overflow quota trigger the archive
// eviction path — which would trade a pasted image for a page of the user's
// ink. So the bytes go to OPFS (lib/storage/opfs.ts) by id, exactly like an
// uploaded file, and only the id is persisted. lib/storage/gc.ts counts
// those ids as live refs so a GC sweep doesn't collect them.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'
import { writeFile, deleteFile } from '@/lib/storage/opfs'
import type { Repeat } from '@/lib/calendar/events.mjs'

export type NoteColor = 'amber' | 'mint' | 'blue' | 'violet' | 'rose'

export const NOTE_COLORS: NoteColor[] = ['amber', 'mint', 'blue', 'violet', 'rose']

export interface GalleryNote {
  id: string
  /** 'sticky' carries `text`; 'image' carries `fileId` (bytes in OPFS). */
  kind: 'sticky' | 'image'
  text: string
  color: NoteColor
  fileId?: string
  /** height/width of the image, so the masonry column reserves the right
   *  space before the blob URL resolves and the wall stops reflowing. */
  ratio?: number
  createdAt: number
}

export interface GalleryTodo {
  id: string
  text: string
  done: boolean
  createdAt: number
}

export interface GalleryEvent {
  id: string
  /** Local calendar day, 'YYYY-MM-DD'. */
  date: string
  /** Last day, inclusive. Absent means the event is one day long. */
  endDate?: string
  /** 'HH:mm'. Absent means all-day. */
  time?: string
  /** 'HH:mm'. Absent on a timed event means an hour after `time`. */
  endTime?: string
  title: string
  color: NoteColor
  location?: string
  notes?: string
  repeat?: Repeat
}

/** Which calendar leads: the big number, the month grid, the title. The other
 *  one rides along in each day's corner. */
export type CalendarSystem = 'ad' | 'bs'
export type CalendarView = 'month' | 'week'

const uid = () => crypto.randomUUID()

interface NotesGalleryState {
  open: boolean
  width: number
  notes: GalleryNote[]
  todos: GalleryTodo[]
  events: GalleryEvent[]
  /** The full-screen calendar. Not persisted, like `open`. */
  calendarOpen: boolean
  calendarSystem: CalendarSystem
  calendarView: CalendarView
  toggle: () => void
  setOpen: (open: boolean) => void
  setWidth: (w: number) => void
  addSticky: () => string
  addImage: (blob: Blob, ratio: number) => Promise<void>
  editNote: (id: string, patch: Partial<Pick<GalleryNote, 'text' | 'color'>>) => void
  removeNote: (id: string) => void
  addTodo: (text: string) => void
  toggleTodo: (id: string) => void
  removeTodo: (id: string) => void
  clearDoneTodos: () => void
  addEvent: (e: Omit<GalleryEvent, 'id'>) => string
  updateEvent: (id: string, patch: Partial<Omit<GalleryEvent, 'id'>>) => void
  removeEvent: (id: string) => void
  setCalendarOpen: (open: boolean) => void
  setCalendarSystem: (system: CalendarSystem) => void
  setCalendarView: (view: CalendarView) => void
}

export const useNotesGallery = create<NotesGalleryState>()(
  persist(
    (set, get) => ({
      open: false,
      width: 340,
      notes: [],
      todos: [],
      events: [],
      calendarOpen: false,
      calendarSystem: 'ad',
      calendarView: 'month',

      toggle: () => set((s) => ({ open: !s.open })),
      setOpen: (open) => set({ open }),
      setWidth: (width) => set({ width }),

      addSticky: () => {
        const id = uid()
        // Newest first: a new note appears at the top of the wall where the
        // + button that made it is, not buried at the bottom of the scroll.
        set((s) => ({
          notes: [
            {
              id,
              kind: 'sticky',
              text: '',
              color: NOTE_COLORS[s.notes.length % NOTE_COLORS.length],
              createdAt: Date.now(),
            },
            ...s.notes,
          ],
        }))
        return id
      },

      addImage: async (blob, ratio) => {
        const fileId = uid()
        await writeFile(fileId, blob)
        set((s) => ({
          notes: [
            { id: uid(), kind: 'image', text: '', color: 'blue', fileId, ratio, createdAt: Date.now() },
            ...s.notes,
          ],
        }))
      },

      editNote: (id, patch) =>
        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),

      removeNote: (id) => {
        const note = get().notes.find((n) => n.id === id)
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
        // Drop the bytes too — nothing else can ever reference them.
        if (note?.fileId) void deleteFile(note.fileId).catch(() => {})
      },

      addTodo: (text) =>
        set((s) => ({
          todos: [...s.todos, { id: uid(), text, done: false, createdAt: Date.now() }],
        })),
      toggleTodo: (id) =>
        set((s) => ({
          todos: s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
        })),
      removeTodo: (id) => set((s) => ({ todos: s.todos.filter((t) => t.id !== id) })),
      clearDoneTodos: () => set((s) => ({ todos: s.todos.filter((t) => !t.done) })),

      addEvent: (e) => {
        const id = uid()
        set((s) => ({ events: [...s.events, { ...e, id }] }))
        return id
      },
      // A patch value of `undefined` clears that field (all-day drops `time`).
      updateEvent: (id, patch) =>
        set((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
      removeEvent: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
      setCalendarOpen: (calendarOpen) => set({ calendarOpen }),
      setCalendarSystem: (calendarSystem) => set({ calendarSystem }),
      setCalendarView: (calendarView) => set({ calendarView }),
    }),
    {
      name: 'simblip-notes-gallery',
      storage: scopedJSONStorage,
      // `open` is deliberately not persisted — a panel that reopens itself on
      // every load covers the canvas you came back for.
      partialize: (s) => ({
        width: s.width,
        notes: s.notes,
        todos: s.todos,
        events: s.events,
        calendarSystem: s.calendarSystem,
        calendarView: s.calendarView,
      }),
    }
  )
)

/** Every OPFS id the gallery still references — read by the storage GC so a
 *  sweep doesn't collect pasted images as orphans. Non-reactive on purpose:
 *  the GC is a one-shot imperative pass. */
export function galleryOpfsRefs(): string[] {
  return useNotesGallery
    .getState()
    .notes.map((n) => n.fileId)
    .filter((id): id is string => !!id)
}
