'use client'

// The full-screen calendar — the Note Gallery's month grid, expanded into a
// real calendar: month and week views, multi-day and timed events, drag to
// move, drag an edge to resize, drag across empty days/hours to create, and a
// full event editor.
//
// Two calendars at once. Every day shows its Gregorian (AD) and its Bikram
// Sambat (BS) date; one "leads" — the big number, which month the grid is,
// the title, the mini month — and the other sits in the day's corner. The
// swap flips every one of those together, because all of them go through
// lib/calendar/dates.mjs's monthOf/partsIn with the same `system` argument.
// BS numbers are always Devanagari, so two numbers in one cell never read as
// the same calendar.
//
// Events are stored by AD day key (see notes-gallery.ts) and only ever
// DISPLAYED in BS, so swapping never rewrites data.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion as fm } from 'framer-motion'
import {
  ArrowLeftRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Link2,
  MapPin,
  NotebookPen,
  Plus,
  Repeat as RepeatIcon,
  Trash2,
  X,
} from 'lucide-react'
import { format } from 'date-fns'
import {
  addDays,
  BS_MONTHS_NE,
  dayNum,
  keyOf,
  monthName,
  monthOf,
  nepaliDigits,
  partsIn,
  rangeLabel,
  toBS,
  weekday,
  type CalSystem,
} from '@/lib/calendar/dates.mjs'
import {
  endMin,
  expand,
  extraDays,
  fromMin,
  isTimedSingle,
  layoutDay,
  layoutRow,
  toMin,
  type Repeat,
} from '@/lib/calendar/events.mjs'
import { useSpring } from '@/lib/motion'
import { Switch } from '@/components/ui/switch'
import { HexColorSwatchPicker } from './hex-color-swatch-picker'
import {
  eventColor,
  NOTE_COLORS,
  useNotesGallery,
  type GalleryEvent,
} from '@/lib/store/notes-gallery'
import { cn } from '@/lib/utils'
import { HOLIDAYS, HOLIDAY_DAYS } from '@/lib/calendar/holidays'
import {
  createNotePage,
  LinkedPages,
  openRecord,
  recordHue,
  recordIcon,
  RecordList,
  useCalendarRecords,
  type CalRecord,
} from './calendar-records'

type Records = Record<string, CalRecord[]>

type Occ = { ev: GalleryEvent; start: string; end: string }

const HOUR_H = 48
const LANE_H = 22
const CELL_HEAD = 28
const WEEKDAYS_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const WEEKDAYS_NE = ['आइत', 'सोम', 'मंगल', 'बुध', 'बिही', 'शुक्र', 'शनि']
const REPEATS: { value: Repeat | ''; label: string }[] = [
  { value: '', label: 'No repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly (AD date)' },
  { value: 'yearly', label: 'Yearly (AD date)' },
  { value: 'monthly-bs', label: 'Monthly (BS date)' },
  { value: 'yearly-bs', label: 'Yearly (BS date)' },
]

const today = () => keyOf(new Date())
const other = (s: CalSystem): CalSystem => (s === 'ad' ? 'bs' : 'ad')
const fmtTime = (t: string) => format(new Date(`2000-01-01T${t}`), 'h:mm a')
const fmtHour = (h: number) => format(new Date(2000, 0, 1, h), 'h a')

/** A day's number in `system` — Devanagari for BS. */
function dayNumber(system: CalSystem, key: string) {
  const d = partsIn(system, key).d
  return system === 'bs' && toBS(key) ? nepaliDigits(d) : String(d)
}

/** "Asoj 7, 2083" / "23 Sep 2026" — used under date inputs and in lists. */
function longDate(system: CalSystem, key: string) {
  if (system === 'bs') {
    const b = toBS(key)
    return b ? `${monthName('bs', b.m)} ${b.d}, ${b.y}` : ''
  }
  return format(new Date(`${key}T00:00`), 'EEE d MMM yyyy')
}

/** longDate without the year: "Asoj 11" / "Sun 27 Sep". */
const shortDate = (system: CalSystem, key: string) => longDate(system, key).replace(/,? \d{4}$/, '')

function barBg(color: string) {
  return `color-mix(in oklch, ${eventColor(color)} 30%, var(--background))`
}

/** Every element under the pointer, first `[data-day]` wins — elementsFromPoint
 *  (plural) so the bar being dragged, which floats over the grid, can't hide
 *  the day cell beneath it. */
function hitDay(x: number, y: number): { day: string; el: HTMLElement } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const day = (el as HTMLElement).dataset?.day
    if (day) return { day, el: el as HTMLElement }
  }
  return null
}

// ── Dragging events ────────────────────────────────────────────────────────
// One drag model for both views. A drag is a pure transform of the stored
// event (applyDrag), so the live preview and the commit are the same code.

type DragMode = 'move' | 'move-timed' | 'resize-end' | 'resize-time'
type Drag = { id: string; mode: DragMode; dayDelta: number; minDelta: number }

function applyDrag(ev: GalleryEvent, d: Drag): GalleryEvent {
  if (d.mode === 'resize-end') {
    const len = Math.max(0, extraDays(ev) + d.dayDelta)
    return { ...ev, endDate: len ? addDays(ev.date, len) : undefined }
  }
  if (d.mode === 'resize-time') {
    const end = Math.min(24 * 60 - 1, Math.max(toMin(ev.time) + 15, endMin(ev) + d.minDelta))
    return { ...ev, endTime: fromMin(end) }
  }
  const out = {
    ...ev,
    date: addDays(ev.date, d.dayDelta),
    endDate: ev.endDate ? addDays(ev.endDate, d.dayDelta) : undefined,
  }
  if (d.mode === 'move-timed' && ev.time) {
    const s = toMin(ev.time)
    const dur = endMin(ev) - s
    const ns = Math.max(0, Math.min(24 * 60 - 1 - dur, s + d.minDelta))
    out.time = fromMin(ns)
    out.endTime = fromMin(ns + dur)
  }
  return out
}

function useEventDrag(onClick: (occ: Occ) => void) {
  const updateEvent = useNotesGallery((s) => s.updateEvent)
  const [drag, setDrag] = useState<Drag | null>(null)

  const begin = (e: React.PointerEvent, occ: Occ, mode: DragMode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    // Public holidays are fixed — a press just opens them.
    if (occ.ev.holiday) {
      onClick(occ)
      return
    }
    // Listeners go on window, not the bar: a bar dragged into another week
    // row remounts under a new parent, and a listener on the old element
    // would never hear the pointerup.
    const target = window
    const x0 = e.clientX
    const y0 = e.clientY
    const origin = hitDay(x0, y0)?.day
    let cur: Drag | null = null

    const move = (ev: PointerEvent) => {
      if (!cur && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
      const day = hitDay(ev.clientX, ev.clientY)?.day
      cur = {
        id: occ.ev.id,
        mode,
        dayDelta: day && origin ? dayNum(day) - dayNum(origin) : (cur?.dayDelta ?? 0),
        minDelta: Math.round(((ev.clientY - y0) / HOUR_H) * 4) * 15,
      }
      setDrag(cur)
    }
    const end = (commit: boolean) => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', cancel)
      setDrag(null)
      if (!commit) return
      if (cur) {
        const { id: _id, ...patch } = applyDrag(occ.ev, cur)
        updateEvent(occ.ev.id, patch)
      } else onClick(occ)
    }
    const up = () => end(true)
    const cancel = () => end(false)
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', cancel)
  }

  return { drag, begin }
}

// ── Editor ────────────────────────────────────────────────────────────────

type Draft = {
  id?: string
  title: string
  location: string
  notes: string
  allDay: boolean
  date: string
  endDate: string
  time: string
  endTime: string
  repeat: Repeat | ''
  color: string
  links: string[]
}

function draftFor(ev: GalleryEvent): Draft {
  return {
    id: ev.id,
    title: ev.title,
    location: ev.location ?? '',
    notes: ev.notes ?? '',
    allDay: !ev.time,
    date: ev.date,
    endDate: ev.endDate ?? ev.date,
    time: ev.time ?? '09:00',
    endTime: ev.time ? fromMin(endMin(ev)) : '10:00',
    repeat: ev.repeat ?? '',
    color: ev.color,
    links: ev.links ?? [],
  }
}

function newDraft(date: string, endDate = date, time?: string, endTime?: string): Draft {
  const count = useNotesGallery.getState().events.length
  return {
    title: '',
    location: '',
    notes: '',
    allDay: !time,
    date,
    endDate,
    time: time ?? '09:00',
    endTime: endTime ?? (time ? fromMin(toMin(time) + 60) : '10:00'),
    repeat: '',
    color: NOTE_COLORS[count % NOTE_COLORS.length],
    links: [],
  }
}

const FIELD = cn(
  'w-full rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 text-ui-sm',
  'outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-[var(--accent-blue)]/70'
)

function EventEditor({ draft: initial, onClose }: { draft: Draft; onClose: () => void }) {
  const addEvent = useNotesGallery((s) => s.addEvent)
  const updateEvent = useNotesGallery((s) => s.updateEvent)
  const removeEvent = useNotesGallery((s) => s.removeEvent)
  const eventColors = useNotesGallery((s) => s.eventColors)
  const addEventColor = useNotesGallery((s) => s.addEventColor)
  const [d, setD] = useState(initial)
  const set = (patch: Partial<Draft>) => setD((v) => ({ ...v, ...patch }))
  const isCustom = !(NOTE_COLORS as string[]).includes(d.color) && !eventColors.includes(d.color)

  const save = () => {
    const endDate = d.endDate > d.date ? d.endDate : undefined
    let endTime = d.endTime
    if (!endDate && toMin(endTime) <= toMin(d.time)) endTime = fromMin(toMin(d.time) + 60)
    const ev: Omit<GalleryEvent, 'id'> = {
      title: d.title.trim() || 'Untitled event',
      date: d.date,
      endDate,
      time: d.allDay ? undefined : d.time,
      endTime: d.allDay ? undefined : endTime,
      location: d.location.trim() || undefined,
      notes: d.notes.trim() || undefined,
      repeat: d.repeat || undefined,
      color: d.color,
      links: d.links.length ? d.links : undefined,
    }
    if (d.id) updateEvent(d.id, ev)
    else addEvent(ev)
    onClose()
  }

  const dateRow = (label: string, dateKey: 'date' | 'endDate', timeKey: 'time' | 'endTime') => (
    <div className="flex items-center gap-3 border-b border-border/40 px-3 py-2 last:border-b-0">
      <span className="w-12 shrink-0 text-ui-sm">{label}</span>
      <div className="flex min-w-0 flex-1 flex-col items-end gap-0.5">
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            required
            value={d[dateKey]}
            onChange={(e) => {
              const v = e.target.value
              if (!v) return
              // Moving the start drags the end along, keeping the length.
              if (dateKey === 'date')
                set({ date: v, endDate: addDays(v, Math.max(0, dayNum(d.endDate) - dayNum(d.date))) })
              else set({ endDate: v < d.date ? d.date : v })
            }}
            className={cn(FIELD, 'w-auto py-1 tabular-nums')}
          />
          {!d.allDay && (
            <input
              type="time"
              value={d[timeKey]}
              onChange={(e) => e.target.value && set({ [timeKey]: e.target.value })}
              className={cn(FIELD, 'w-auto py-1 tabular-nums')}
            />
          )}
        </div>
        <span className="text-ui-2xs text-muted-foreground">
          {longDate('bs', d[dateKey])}
        </span>
      </div>
    </div>
  )

  return (
    <fm.div
      className="absolute inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[6vh]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <fm.form
        role="dialog"
        aria-label={d.id ? 'Edit event' : 'New event'}
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="glass w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2.5 py-1 text-ui-sm transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: eventColor(d.color) }} />
            <span className="truncate text-ui-sm font-semibold">{d.id ? 'Edit Event' : 'New Event'}</span>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent-blue)] px-3 py-1 text-ui-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Save
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={d.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Title"
              className={cn(FIELD, 'text-ui-md font-medium')}
            />
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={d.location}
                onChange={(e) => set({ location: e.target.value })}
                placeholder="Location"
                className={cn(FIELD, 'pl-8')}
              />
            </div>
          </div>

          <div>
            <h4 className="mb-1.5 text-ui-xs font-semibold text-muted-foreground">Schedule</h4>
            <div className="rounded-xl border border-border/50 bg-background/40">
              <label className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                <span className="text-ui-sm">All day</span>
                <Switch checked={d.allDay} onCheckedChange={(v) => set({ allDay: v })} />
              </label>
              {dateRow('Starts', 'date', 'time')}
              {dateRow('Ends', 'endDate', 'endTime')}
              <label className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-ui-sm">Repeat</span>
                <select
                  value={d.repeat}
                  onChange={(e) => set({ repeat: e.target.value as Repeat | '' })}
                  className={cn(FIELD, 'w-auto py-1')}
                >
                  {REPEATS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {d.id && d.repeat && (
              <p className="mt-1 text-ui-2xs text-muted-foreground">
                Changes apply to every occurrence in the series.
              </p>
            )}
          </div>

          <div>
            <h4 className="mb-1.5 text-ui-xs font-semibold text-muted-foreground">Colour</h4>
            {/* The theme accents, then your own colours, then the same
                "+" hex picker every other colour control in the app uses. */}
            <div className="flex flex-wrap items-center gap-2">
              {[...NOTE_COLORS, ...eventColors, ...(isCustom ? [d.color] : [])].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={d.color === c}
                  onClick={() => set({ color: c })}
                  className={cn(
                    'h-6 w-6 rounded-full ring-offset-2 ring-offset-card transition-transform active:scale-90',
                    d.color === c && 'ring-2 ring-foreground/60'
                  )}
                  style={{ background: eventColor(c) }}
                />
              ))}
              <HexColorSwatchPicker
                label="Custom event colour"
                size="md"
                initial={d.color.startsWith('#') ? d.color : undefined}
                onChange={(hex) => set({ color: hex })}
                onCommit={(hex) => {
                  set({ color: hex })
                  addEventColor(hex)
                }}
                documentSwatches={eventColors}
              />
            </div>
          </div>

          <div>
            <h4 className="mb-1.5 text-ui-xs font-semibold text-muted-foreground">Linked pages &amp; notes</h4>
            <LinkedPages
              links={d.links}
              onChange={(links) => set({ links })}
              noteTitle={`${d.title.trim() || 'Note'} — ${longDate('ad', d.date)}`}
              calendarAt={d.allDay ? d.date : `${d.date}T${d.time}`}
              field={FIELD}
            />
          </div>

          <div>
            <h4 className="mb-1.5 text-ui-xs font-semibold text-muted-foreground">Notes</h4>
            <textarea
              value={d.notes}
              onChange={(e) => set({ notes: e.target.value })}
              rows={4}
              placeholder="Details, links, agenda…"
              className={cn(FIELD, 'resize-y')}
            />
          </div>

          {d.id && (
            <button
              type="button"
              onClick={() => {
                removeEvent(d.id!)
                onClose()
              }}
              className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-ui-sm text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete event
            </button>
          )}
        </div>
      </fm.form>
    </fm.div>
  )
}

// ── Bars ──────────────────────────────────────────────────────────────────

function EventBar({
  occ,
  clipStart,
  clipEnd,
  onDragStart,
}: {
  occ: Occ
  clipStart?: boolean
  clipEnd?: boolean
  onDragStart: (e: React.PointerEvent, occ: Occ, mode: DragMode) => void
}) {
  const ev = occ.ev
  const timed = isTimedSingle(ev)
  return (
    <div
      data-ev
      onPointerDown={(e) => onDragStart(e, occ, 'move')}
      title={ev.title}
      className={cn(
        'group/bar pointer-events-auto relative flex h-[19px] cursor-grab touch-none select-none items-center gap-1 overflow-hidden px-1.5',
        'text-ui-2xs leading-none text-foreground active:cursor-grabbing',
        !clipStart && 'rounded-l-md',
        !clipEnd && 'rounded-r-md',
        ev.holiday && 'cursor-pointer active:cursor-pointer'
      )}
      style={timed ? undefined : { background: barBg(ev.color) }}
    >
      {timed ? (
        <>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: eventColor(ev.color) }} />
          <span className="shrink-0 tabular-nums text-muted-foreground">{fmtTime(ev.time!)}</span>
        </>
      ) : (
        clipStart && <ChevronLeft className="-ml-1 h-3 w-3 shrink-0 opacity-60" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{ev.title}</span>
      {!!ev.links?.length && <Link2 className="h-2.5 w-2.5 shrink-0 opacity-60" />}
      {ev.repeat && <RepeatIcon className="h-2.5 w-2.5 shrink-0 opacity-50" />}
      {!timed && !clipEnd && !ev.holiday && (
        <div
          aria-hidden
          onPointerDown={(e) => onDragStart(e, occ, 'resize-end')}
          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize opacity-0 group-hover/bar:opacity-100"
          style={{ background: `linear-gradient(to right, transparent, ${eventColor(ev.color)})` }}
        />
      )}
    </div>
  )
}

/** "3 things made this day" — opens the day panel. Stops the pointerdown so
 *  it doesn't also start a create-drag on the cell underneath. */
function RecordBadge({ records, onClick }: { records?: CalRecord[]; onClick: () => void }) {
  if (!records?.length) return null
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={`${records.length} page${records.length === 1 ? '' : 's'}/notes made this day`}
      className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-ui-2xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <FileText className="h-3 w-3" />
      {records.length}
    </button>
  )
}

// ── Month view ────────────────────────────────────────────────────────────

function MonthView({
  system,
  cursor,
  events,
  records,
  selected,
  onSelect,
  onOpen,
  onCreate,
  onShowDay,
}: {
  system: CalSystem
  cursor: string
  events: GalleryEvent[]
  records: Records
  selected: string
  onSelect: (key: string) => void
  onOpen: (occ: Occ) => void
  onCreate: (from: string, to: string) => void
  onShowDay: (key: string) => void
}) {
  const { first, last } = monthOf(system, cursor)
  const gridStart = addDays(first, -weekday(first))
  const weeks = Math.ceil((dayNum(last) - dayNum(gridStart) + 1) / 7)
  const gridEnd = addDays(gridStart, weeks * 7 - 1)

  const { drag, begin } = useEventDrag(onOpen)
  const shown = useMemo(
    () => (drag ? events.map((e) => (e.id === drag.id ? applyDrag(e, drag) : e)) : events),
    [events, drag]
  )
  const occs = useMemo(() => expand(shown, gridStart, gridEnd) as Occ[], [shown, gridStart, gridEnd])

  // How many lanes fit in a row decides where "+N more" kicks in.
  const gridRef = useRef<HTMLDivElement>(null)
  const [rowH, setRowH] = useState(120)
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setRowH(el.clientHeight / weeks))
    ro.observe(el)
    return () => ro.disconnect()
  }, [weeks])
  const maxLanes = Math.max(1, Math.floor((rowH - CELL_HEAD - 16) / LANE_H))

  // Click a day to create an event on it; drag across days for a range.
  const [sel, setSel] = useState<{ a: string; b: string } | null>(null)
  const beginSelect = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const a = hitDay(e.clientX, e.clientY)?.day
    if (!a) return
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    let b = a
    setSel({ a, b })
    const move = (ev: PointerEvent) => {
      const h = hitDay(ev.clientX, ev.clientY)?.day
      if (h && h !== b) setSel({ a, b: (b = h) })
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      setSel(null)
      // A plain click on a day is "new event on this day"; a drag, a range.
      onSelect(a)
      onCreate(a < b ? a : b, a < b ? b : a)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }
  const inSel = (k: string) => !!sel && k >= (sel.a < sel.b ? sel.a : sel.b) && k <= (sel.a < sel.b ? sel.b : sel.a)

  const t = today()
  const sec = other(system)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-border/50">
        {WEEKDAYS_EN.map((w, i) => (
          <div
            key={w}
            className={cn(
              'px-2 py-1.5 text-ui-2xs font-semibold tracking-wide text-muted-foreground',
              system === 'bs' && i === 6 && 'text-[var(--accent-rose)]'
            )}
          >
            {system === 'bs' ? (
              <>
                {WEEKDAYS_NE[i]} <span className="font-normal opacity-60">{w}</span>
              </>
            ) : (
              w
            )}
          </div>
        ))}
      </div>

      <div ref={gridRef} className="flex min-h-0 flex-1 flex-col">
        {Array.from({ length: weeks }, (_, w) => {
          const rowStart = addDays(gridStart, w * 7)
          const bars = layoutRow(occs, rowStart)
          const hiddenPerCol = Array(7).fill(0)
          for (const b of bars)
            if (b.lane >= maxLanes) for (let c = b.col; c < b.col + b.span; c++) hiddenPerCol[c]++
          return (
            <div key={rowStart} className="relative min-h-0 flex-1 border-b border-border/40 last:border-b-0">
              <div className="grid h-full grid-cols-7" onPointerDown={beginSelect}>
                {Array.from({ length: 7 }, (_, c) => {
                  const key = addDays(rowStart, c)
                  const inMonth = key >= first && key <= last
                  const p = partsIn(system, key)
                  const s = partsIn(sec, key)
                  const isToday = key === t
                  return (
                    <div
                      key={key}
                      data-day={key}
                      className={cn(
                        'relative cursor-pointer select-none border-r border-border/40 last:border-r-0',
                        'transition-colors duration-100',
                        !inMonth && 'bg-muted/40',
                        key === selected && 'bg-[var(--accent-blue)]/[0.07]',
                        inSel(key) && 'bg-[var(--accent-blue)]/15'
                      )}
                    >
                      <div className="flex h-7 items-center gap-1 px-2">
                        <span
                          className={cn(
                            'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-ui-xs tabular-nums',
                            inMonth ? 'text-foreground' : 'text-muted-foreground/50',
                            ((system === 'bs' && c === 6) || HOLIDAY_DAYS.has(key)) &&
                              inMonth &&
                              'text-[var(--accent-rose)]',
                            isToday && 'bg-[var(--accent-blue)] font-semibold text-white'
                          )}
                        >
                          {dayNumber(system, key)}
                        </span>
                        {p.d === 1 && (
                          <span className={cn('text-ui-2xs font-medium', !inMonth && 'text-muted-foreground/50')}>
                            {monthName(system, p.m, true)}
                          </span>
                        )}
                        <RecordBadge records={records[key]} onClick={() => onShowDay(key)} />
                      </div>
                      {/* The other calendar, in the corner — its month name on its 1st. */}
                      <span
                        className={cn(
                          'pointer-events-none absolute bottom-1 right-1.5 text-ui-xs tabular-nums',
                          s.d === 1
                            ? 'rounded bg-[var(--accent-violet)]/15 px-1 font-medium text-[var(--accent-violet)]'
                            : 'text-muted-foreground',
                          !inMonth && 'opacity-50'
                        )}
                      >
                        {s.d === 1 && `${monthName(sec, s.m, true)} `}
                        {dayNumber(sec, key)}
                      </span>
                      {hiddenPerCol[c] > 0 && (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => onShowDay(key)}
                          className="absolute bottom-0.5 left-1.5 rounded px-1 text-ui-2xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          +{hiddenPerCol[c]} more
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="pointer-events-none absolute inset-x-0" style={{ top: CELL_HEAD }}>
                {bars
                  .filter((b) => b.lane < maxLanes)
                  .map((b) => (
                    <div
                      key={`${b.occ.ev.id}:${b.occ.start}`}
                      className="absolute px-[3px]"
                      style={{
                        left: `${(b.col / 7) * 100}%`,
                        width: `${(b.span / 7) * 100}%`,
                        top: b.lane * LANE_H,
                        opacity: drag?.id === b.occ.ev.id ? 0.85 : 1,
                      }}
                    >
                      <EventBar occ={b.occ} clipStart={b.clipStart} clipEnd={b.clipEnd} onDragStart={begin} />
                    </div>
                  ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Week view ─────────────────────────────────────────────────────────────

function WeekView({
  system,
  cursor,
  events,
  records,
  onOpen,
  onCreate,
  onShowDay,
}: {
  system: CalSystem
  cursor: string
  events: GalleryEvent[]
  records: Records
  onOpen: (occ: Occ) => void
  onCreate: (from: string, to: string, time?: string, endTime?: string) => void
  onShowDay: (key: string) => void
}) {
  const start = addDays(cursor, -weekday(cursor))
  const end = addDays(start, 6)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))

  const { drag, begin } = useEventDrag(onOpen)
  const shown = useMemo(
    () => (drag ? events.map((e) => (e.id === drag.id ? applyDrag(e, drag) : e)) : events),
    [events, drag]
  )
  const occs = useMemo(() => expand(shown, start, end) as Occ[], [shown, start, end])
  const longBars = layoutRow(occs.filter((o) => !isTimedSingle(o.ev)), start)
  const lanes = Math.max(1, ...longBars.map((b) => b.lane + 1))

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: HOUR_H * 7 })
  }, [])

  // Drag down an empty column to create a timed event over that range.
  const [sel, setSel] = useState<{ day: string; a: number; b: number } | null>(null)
  const minuteAt = (el: HTMLElement, y: number) =>
    Math.max(0, Math.min(24 * 60, Math.floor(((y - el.getBoundingClientRect().top) / HOUR_H) * 4) * 15))
  const beginSelect = (e: React.PointerEvent<HTMLDivElement>, day: string) => {
    if (e.button !== 0) return
    const col = e.currentTarget
    col.setPointerCapture(e.pointerId)
    const a = minuteAt(col, e.clientY)
    let b = a
    setSel({ day, a, b })
    const move = (ev: PointerEvent) => {
      b = minuteAt(col, ev.clientY)
      setSel({ day, a, b })
    }
    const up = () => {
      col.removeEventListener('pointermove', move)
      col.removeEventListener('pointerup', up)
      setSel(null)
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      onCreate(day, day, fromMin(lo), fromMin(hi - lo < 15 ? lo + 60 : hi))
    }
    col.addEventListener('pointermove', move)
    col.addEventListener('pointerup', up)
  }

  const t = today()
  const sec = other(system)
  const nowMin = now.getHours() * 60 + now.getMinutes()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Day headers + the all-day lanes, which never scroll away. */}
      {/* Both halves reserve the scrollbar's gutter so the header columns
          line up with the scrolling hour grid on classic-scrollbar systems. */}
      <div
        className="shrink-0 border-b border-border/50"
        style={{ overflowY: 'hidden', scrollbarGutter: 'stable' }}
      >
        <div className="flex">
          <div className="w-14 shrink-0" />
          {days.map((key, i) => {
            const s = partsIn(sec, key)
            return (
              <div key={key} className="min-w-0 flex-1 border-l border-border/40 px-2 pb-1 pt-1.5">
                <div
                  className={cn(
                    'flex items-center text-ui-2xs font-semibold tracking-wide text-muted-foreground',
                    key === t && 'text-[var(--accent-blue)]',
                    system === 'bs' && i === 6 && 'text-[var(--accent-rose)]'
                  )}
                >
                  {system === 'bs' ? WEEKDAYS_NE[i] : WEEKDAYS_EN[i]}
                  <RecordBadge records={records[key]} onClick={() => onShowDay(key)} />
                </div>
                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className={cn(
                      'text-ui-xl font-semibold tabular-nums',
                      key === t && 'text-[var(--accent-blue)]'
                    )}
                  >
                    {dayNumber(system, key)}
                  </span>
                  <span className="truncate text-ui-2xs tabular-nums text-muted-foreground">
                    {s.d === 1 && `${monthName(sec, s.m, true)} `}
                    {dayNumber(sec, key)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
        <div className="relative flex" style={{ height: lanes * LANE_H + 6 }}>
          <div className="flex w-14 shrink-0 items-start justify-end pr-2 pt-1 text-ui-3xs text-muted-foreground">
            all-day
          </div>
          <div className="relative flex flex-1">
            {days.map((key) => (
              <div
                key={key}
                data-day={key}
                onClick={() => onCreate(key, key)}
                className="flex-1 cursor-pointer border-l border-border/40"
              />
            ))}
            <div className="pointer-events-none absolute inset-0 top-[3px]">
              {longBars.map((b) => (
                <div
                  key={`${b.occ.ev.id}:${b.occ.start}`}
                  className="absolute px-[3px]"
                  style={{ left: `${(b.col / 7) * 100}%`, width: `${(b.span / 7) * 100}%`, top: b.lane * LANE_H }}
                >
                  <EventBar occ={b.occ} clipStart={b.clipStart} clipEnd={b.clipEnd} onDragStart={begin} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        <div className="relative flex" style={{ height: HOUR_H * 24 }}>
          <div className="relative w-14 shrink-0">
            {Array.from({ length: 23 }, (_, h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-ui-3xs tabular-nums text-muted-foreground"
                style={{ top: (h + 1) * HOUR_H }}
              >
                {fmtHour(h + 1)}
              </span>
            ))}
          </div>
          {days.map((key) => {
            const items = layoutDay(occs.filter((o) => isTimedSingle(o.ev) && o.start === key))
            return (
              <div
                key={key}
                data-day={key}
                onPointerDown={(e) => beginSelect(e, key)}
                className={cn(
                  'relative min-w-0 flex-1 touch-none select-none border-l border-border/40',
                  key === t && 'bg-[var(--accent-blue)]/[0.04]'
                )}
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_H - 1}px, color-mix(in oklch, var(--border) 45%, transparent) ${HOUR_H - 1}px ${HOUR_H}px)`,
                }}
              >
                {sel?.day === key && (
                  <div
                    className="absolute inset-x-1 rounded-md bg-[var(--accent-blue)]/20"
                    style={{
                      top: (Math.min(sel.a, sel.b) / 60) * HOUR_H,
                      height: Math.max(12, (Math.abs(sel.b - sel.a) / 60) * HOUR_H),
                    }}
                  />
                )}
                {items.map(({ occ, top, bottom, col, cols }) => (
                  <div
                    key={occ.ev.id}
                    data-ev
                    onPointerDown={(e) => begin(e, occ, 'move-timed')}
                    className={cn(
                      'group/tev absolute cursor-grab overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5',
                      'text-ui-2xs leading-tight active:cursor-grabbing',
                      drag?.id === occ.ev.id && 'shadow-lg ring-1 ring-foreground/10'
                    )}
                    style={{
                      top: (top / 60) * HOUR_H + 1,
                      height: Math.max(18, ((bottom - top) / 60) * HOUR_H - 2),
                      left: `calc(${(col / cols) * 100}% + 2px)`,
                      width: `calc(${100 / cols}% - 4px)`,
                      background: barBg(occ.ev.color),
                      borderColor: eventColor(occ.ev.color),
                    }}
                    title={occ.ev.title}
                  >
                    <div className="truncate font-medium">{occ.ev.title}</div>
                    <div className="truncate tabular-nums text-muted-foreground">
                      {fmtTime(fromMin(top))} – {fmtTime(fromMin(bottom))}
                    </div>
                    {occ.ev.location && (
                      <div className="truncate text-muted-foreground">{occ.ev.location}</div>
                    )}
                    <div
                      aria-hidden
                      onPointerDown={(e) => begin(e, occ, 'resize-time')}
                      className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                    />
                  </div>
                ))}
                {/* What you made at this hour — a pin on the column's right edge. */}
                {records[key]
                  ?.filter((r) => r.min !== null)
                  .map((r) => {
                    const Icon = recordIcon(r)
                    return (
                      <button
                        key={`${r.kind}:${r.id}`}
                        type="button"
                        title={r.title}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => openRecord(r)}
                        className="absolute right-0.5 z-[5] flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-card shadow-sm transition-transform hover:scale-110"
                        style={{ top: (r.min! / 60) * HOUR_H }}
                      >
                        <Icon className="h-3 w-3" style={{ color: recordHue(r) }} />
                      </button>
                    )
                  })}
                {key === t && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-[var(--accent-blue)]"
                    style={{ top: (nowMin / 60) * HOUR_H }}
                  >
                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-[var(--accent-blue)]" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────

function MiniMonth({
  system,
  cursor,
  setCursor,
  events,
  selected,
  onPick,
}: {
  system: CalSystem
  cursor: string
  setCursor: (key: string) => void
  events: GalleryEvent[]
  selected: string
  onPick: (key: string) => void
}) {
  const [view, setView] = useState(cursor)
  useEffect(() => setView(cursor), [cursor])
  const { first, last, y, m } = monthOf(system, view)
  const start = addDays(first, -weekday(first))
  const end = addDays(start, 41)
  const busy = useMemo(() => {
    const set = new Set<string>()
    for (const o of expand(events, start, end) as Occ[])
      for (let k = o.start; k <= o.end; k = addDays(k, 1)) set.add(k)
    return set
  }, [events, start, end])
  const t = today()

  return (
    <div>
      <div className="mb-1 flex items-center">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setView(monthOf(system, view, -1).first)}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setCursor(view)}
          className="flex-1 truncate text-center text-ui-sm font-semibold hover:text-[var(--accent-blue)]"
        >
          {monthName(system, m)} {system === 'bs' ? nepaliDigits(y) : y}
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setView(monthOf(system, view, 1).first)}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {(system === 'bs' ? WEEKDAYS_NE : WEEKDAYS_EN).map((w, i) => (
          <div key={i} className="pb-1 text-ui-3xs font-medium text-muted-foreground/70">
            {system === 'bs' ? w.slice(0, 2) : w[0]}
          </div>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const key = addDays(start, i)
          const inMonth = key >= first && key <= last
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className={cn(
                'relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-ui-xs tabular-nums transition-colors',
                inMonth ? 'text-foreground' : 'text-muted-foreground/40',
                key === selected && key !== t && 'bg-accent font-medium',
                key === t ? 'bg-[var(--accent-blue)] font-semibold text-white' : 'hover:bg-accent'
              )}
            >
              {dayNumber(system, key)}
              {busy.has(key) && (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-current opacity-60" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AgendaList({
  title,
  occs,
  system,
  onOpen,
  showDate,
}: {
  title: string
  occs: Occ[]
  system: CalSystem
  onOpen: (occ: Occ) => void
  showDate?: boolean
}) {
  if (!occs.length) return null
  return (
    <div>
      <h4 className="mb-1 text-ui-2xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <div className="flex flex-col gap-1">
        {occs.map((o) => (
          <button
            key={`${o.ev.id}:${o.start}`}
            type="button"
            onClick={() => onOpen(o)}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-ui-xs transition-opacity hover:opacity-80"
            style={{ background: barBg(o.ev.color) }}
          >
            <span className="min-w-0 flex-1 truncate">{o.ev.title}</span>
            <span className="shrink-0 text-ui-2xs text-muted-foreground">
              {[
                showDate && shortDate(system, o.start),
                o.ev.time ? fmtTime(o.ev.time) : o.end > o.start && `→ ${shortDate(system, o.end)}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Day panel ─────────────────────────────────────────────────────────────
// One day, everything on it: its events, what you made that day, and a note
// page written for it (optionally for a time). Opened from a day's record
// badge or "+N more", so it works on phones where the sidebar is hidden.

function DayPanel({
  day,
  system,
  events,
  records,
  onClose,
  onOpenOcc,
  onCreate,
}: {
  day: string
  system: CalSystem
  events: GalleryEvent[]
  records: Records
  onClose: () => void
  onOpenOcc: (occ: Occ) => void
  onCreate: (from: string, to: string) => void
}) {
  const occs = useMemo(() => expand(events, day, day) as Occ[], [events, day])
  const [noteTitle, setNoteTitle] = useState(`Note — ${longDate('ad', day)}`)
  const [noteTime, setNoteTime] = useState('')

  return (
    <fm.div
      className="absolute inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <fm.div
        role="dialog"
        aria-label={`Day ${day}`}
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="glass flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border/60 bg-card p-4 shadow-2xl"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-ui-lg font-semibold">{longDate(system, day)}</h3>
            <p className="text-ui-2xs text-muted-foreground">{longDate(other(system), day)}</p>
          </div>
          <button
            type="button"
            aria-label="Close day"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <section>
          <div className="mb-1 flex items-center">
            <h4 className="flex-1 text-ui-2xs font-semibold uppercase tracking-wide text-muted-foreground">Events</h4>
            <button
              type="button"
              onClick={() => onCreate(day, day)}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> New event
            </button>
          </div>
          {occs.length === 0 ? (
            <p className="text-ui-2xs text-muted-foreground">No events.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {occs.map((o) => (
                <button
                  key={`${o.ev.id}:${o.start}`}
                  type="button"
                  onClick={() => onOpenOcc(o)}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-ui-xs transition-opacity hover:opacity-80"
                  style={{ background: barBg(o.ev.color) }}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{o.ev.title}</span>
                  {!!o.ev.links?.length && <Link2 className="h-3 w-3 shrink-0 opacity-60" />}
                  <span className="shrink-0 text-ui-2xs text-muted-foreground">
                    {o.ev.time ? fmtTime(o.ev.time) : 'All day'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-1 text-ui-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Made this day
          </h4>
          <RecordList records={records[day] ?? []} empty="Nothing made or noted on this day yet." />
        </section>

        <section className="flex flex-col gap-1.5">
          <h4 className="text-ui-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Write a note for this day
          </h4>
          <div className="flex gap-1.5">
            <input
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              className={cn(FIELD, 'min-w-0 flex-1')}
              aria-label="Note title"
            />
            <input
              type="time"
              value={noteTime}
              onChange={(e) => setNoteTime(e.target.value)}
              className={cn(FIELD, 'w-auto tabular-nums')}
              aria-label="Time (optional)"
              title="Time (optional)"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              const id = createNotePage(noteTitle.trim() || 'Note', noteTime ? `${day}T${noteTime}` : day)
              openRecord({ id, kind: 'page' })
            }}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-blue)] py-1.5 text-ui-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <NotebookPen className="h-3.5 w-3.5" /> Create note &amp; open
          </button>
        </section>
      </fm.div>
    </fm.div>
  )
}

// ── Shell ─────────────────────────────────────────────────────────────────

export function CalendarFull() {
  const open = useNotesGallery((s) => s.calendarOpen)
  return <AnimatePresence>{open && <CalendarScreen />}</AnimatePresence>
}

function CalendarScreen() {
  const motion = useSpring()
  const stored = useNotesGallery((s) => s.events)
  const events = useMemo(() => [...stored, ...HOLIDAYS], [stored])
  const system = useNotesGallery((s) => s.calendarSystem)
  const view = useNotesGallery((s) => s.calendarView)
  const setSystem = useNotesGallery((s) => s.setCalendarSystem)
  const setView = useNotesGallery((s) => s.setCalendarView)
  const setOpen = useNotesGallery((s) => s.setCalendarOpen)

  const [cursor, setCursor] = useState(today)
  const [selected, setSelected] = useState(today)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dayPanel, setDayPanel] = useState<string | null>(null)
  const records = useCalendarRecords()

  // A holiday has nothing to edit — it opens its day instead.
  const openOcc = (o: Occ) => (o.ev.holiday ? showDay(o.start) : setDraft(draftFor(o.ev)))
  const create = (from: string, to: string, time?: string, endTime?: string) =>
    setDraft(newDraft(from, to, time, endTime))

  const showDay = (k: string) => {
    setSelected(k)
    setDayPanel(k)
  }

  const step = (dir: 1 | -1) =>
    setCursor((c) => (view === 'week' ? addDays(c, 7 * dir) : monthOf(system, c, dir).first))

  // Keyboard: the calendar is modal, so it owns the keys while open — and
  // stops them reaching the canvas's window-level shortcuts underneath.
  const draftRef = useRef(draft)
  draftRef.current = draft
  const panelRef = useRef(dayPanel)
  panelRef.current = dayPanel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        if (draftRef.current) setDraft(null)
        else if (panelRef.current) setDayPanel(null)
        else setOpen(false)
        return
      }
      // Typing reaches its field untouched (the canvas already ignores
      // editable targets); every other key stops here.
      if (typing) return
      e.stopImmediatePropagation()
      if (draftRef.current || panelRef.current || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      const act: Record<string, () => void> = {
        t: () => {
          setCursor(today())
          setSelected(today())
        },
        arrowleft: () => step(-1),
        arrowright: () => step(1),
        m: () => setView('month'),
        w: () => setView('week'),
        n: () => create(selected, selected),
        s: () => setSystem(other(system)),
      }
      if (act[k]) {
        e.preventDefault()
        act[k]()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // Title: the leading calendar's month(s); the other one underneath.
  const range =
    view === 'week'
      ? { first: addDays(cursor, -weekday(cursor)), last: addDays(cursor, 6 - weekday(cursor)) }
      : monthOf(system, cursor)
  const title = rangeLabel(system, range.first, range.last)
  const subtitle = rangeLabel(other(system), range.first, range.last)
  const bsMonthNe = system === 'bs' && toBS(range.first) ? BS_MONTHS_NE[partsIn('bs', range.first).m] : null

  const t = today()
  const todayOccs = useMemo(() => expand(events, t, t) as Occ[], [events, t])
  const upcoming = useMemo(
    () => (expand(events, addDays(t, 1), addDays(t, 14)) as Occ[]).filter((o) => o.start > t).slice(0, 8),
    [events, t]
  )

  const seg = (active: boolean) =>
    cn(
      'rounded-md px-3 py-1 text-ui-sm font-medium transition-colors',
      active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
    )

  return (
    <fm.div
      role="dialog"
      aria-label="Calendar"
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={motion}
      className="fixed inset-0 z-[90] flex bg-background text-foreground"
    >
      <aside className="hidden w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border/50 bg-muted/30 p-3 lg:flex">
        <div className="flex h-9 items-center gap-2 px-1">
          <CalendarDays className="h-4 w-4 text-[var(--accent-violet)]" />
          <span className="text-ui-sm font-semibold">Calendar</span>
        </div>
        <MiniMonth
          system={system}
          cursor={cursor}
          setCursor={setCursor}
          events={events}
          selected={selected}
          onPick={(k) => {
            setSelected(k)
            setCursor(k)
          }}
        />
        <div className="rounded-lg border border-border/50 bg-background/50 p-2 text-ui-2xs text-muted-foreground">
          <div className="text-ui-xs font-medium text-foreground">Today</div>
          <div>{longDate('ad', t)}</div>
          <div>
            {longDate('bs', t)} · {BS_MONTHS_NE[partsIn('bs', t).m]}
          </div>
        </div>
        <AgendaList title="Today" occs={todayOccs} system={system} onOpen={openOcc} />
        <AgendaList title="Upcoming" occs={upcoming} system={system} onOpen={openOcc} showDate />
        <div>
          <div className="mb-1 flex items-center">
            <h4 className="flex-1 text-ui-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Made on {shortDate(system, selected)}
            </h4>
            <button
              type="button"
              onClick={() => setDayPanel(selected)}
              title="Open this day — events, records, new note"
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <NotebookPen className="h-3 w-3" /> Note
            </button>
          </div>
          <RecordList records={records[selected] ?? []} empty="Nothing made on this day." />
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setCursor(today())
              setSelected(today())
            }}
            className="rounded-lg border border-border/60 px-3 py-1 text-ui-sm font-medium transition-colors hover:bg-accent"
          >
            Today
          </button>
          <div className="flex">
            <button
              type="button"
              aria-label="Previous"
              onClick={() => step(-1)}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => step(1)}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <h2 className="truncate text-ui-lg font-semibold text-[var(--accent-blue)]">
              {title}
              {bsMonthNe && <span className="ml-2 text-ui-sm font-normal text-muted-foreground">{bsMonthNe}</span>}
            </h2>
            <p className="truncate text-ui-2xs text-muted-foreground">{subtitle}</p>
          </div>

          <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === 'week'} className={seg(view === 'week')} onClick={() => setView('week')}>
              Week
            </button>
            <button type="button" role="tab" aria-selected={view === 'month'} className={seg(view === 'month')} onClick={() => setView('month')}>
              Month
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSystem(other(system))}
            title="Swap which calendar leads (S)"
            className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-ui-sm font-medium transition-colors hover:bg-accent"
          >
            <span className={system === 'ad' ? 'text-foreground' : 'text-muted-foreground'}>AD</span>
            <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className={system === 'bs' ? 'text-foreground' : 'text-muted-foreground'}>BS</span>
          </button>

          <button
            type="button"
            aria-label="New event"
            title="New event (N)"
            onClick={() => create(selected, selected)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Close calendar"
            title="Close (Esc)"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {view === 'month' ? (
          <MonthView
            system={system}
            cursor={cursor}
            events={events}
            records={records}
            selected={selected}
            onSelect={setSelected}
            onOpen={openOcc}
            onCreate={create}
            onShowDay={showDay}
          />
        ) : (
          <WeekView
            system={system}
            cursor={cursor}
            events={events}
            records={records}
            onOpen={openOcc}
            onCreate={create}
            onShowDay={showDay}
          />
        )}

        <AnimatePresence>
          {dayPanel && (
            <DayPanel
              day={dayPanel}
              system={system}
              events={events}
              records={records}
              onClose={() => setDayPanel(null)}
              onOpenOcc={openOcc}
              onCreate={create}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {draft && <EventEditor key={draft.id ?? 'new'} draft={draft} onClose={() => setDraft(null)} />}
        </AnimatePresence>
      </div>
    </fm.div>
  )
}
