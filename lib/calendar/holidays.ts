// Nepal's public holidays as read-only calendar events — the same layer for
// every user, shipped with the app rather than stored per person.
//
// Data: nepal-holidays.json, converted from the Office Holidays "Nepal
// Holidays" .ics feed (2026–2027): date + name only. Regenerate from a newer
// .ics when these years run out — the calendar needs nothing else changed.

import type { GalleryEvent } from '@/lib/store/notes-gallery'
import data from './nepal-holidays.json'

export const HOLIDAYS: GalleryEvent[] = (data as { date: string; endDate?: string; title: string }[]).map(
  (h, i) => ({ ...h, id: `holiday:${h.date}:${i}`, color: 'rose', holiday: true })
)

/** Every holiday's day — for colouring the day number. */
export const HOLIDAY_DAYS = new Set(HOLIDAYS.map((h) => h.date))
