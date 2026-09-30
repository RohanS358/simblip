'use client'

// Events from calendars followed by link (Settings → Calendar). Fetched via
// /api/calendar/fetch, parsed with parseIcs, held in memory only — the store
// keeps just the link. Events come back flagged `holiday` so the calendar
// treats them as read-only, tinted with the subscription's colour.

import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { getAccessToken } from '@/lib/auth/store'
import { useNotesGallery, type CalendarSubscription, type GalleryEvent } from '@/lib/store/notes-gallery'
import { parseIcs } from './ics.mjs'

const STALE_MS = 30 * 60 * 1000

interface Feed {
  events: GalleryEvent[]
  error?: string
  at: number
}

const useFeeds = create<{ feeds: Record<string, Feed> }>(() => ({ feeds: {} }))
const inflight = new Set<string>()

/** Fetch + parse one link; resolves with the event count or throws a message. */
export async function loadFeed(url: string, id: string, color: string): Promise<GalleryEvent[]> {
  const token = getAccessToken()
  const res = await fetch('/api/calendar/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Couldn’t fetch that calendar (${res.status})`)
  }
  const { events } = parseIcs(await res.text(), { idPrefix: `sub:${id}` }) as { events: GalleryEvent[] }
  return events.map((e) => ({ ...e, color, holiday: true }))
}

export async function refreshFeed(sub: CalendarSubscription): Promise<void> {
  if (inflight.has(sub.id)) return
  inflight.add(sub.id)
  try {
    const events = await loadFeed(sub.url, sub.id, sub.color)
    useFeeds.setState((s) => ({ feeds: { ...s.feeds, [sub.id]: { events, at: Date.now() } } }))
  } catch (err) {
    const prev = useFeeds.getState().feeds[sub.id]
    useFeeds.setState((s) => ({
      feeds: { ...s.feeds, [sub.id]: { events: prev?.events ?? [], error: (err as Error).message, at: Date.now() } },
    }))
  } finally {
    inflight.delete(sub.id)
  }
}

export const useFeedStatus = (id: string) => useFeeds((s) => s.feeds[id])

/** Every subscribed calendar's events, refreshed when missing or stale. */
export function useSubscribedEvents(): GalleryEvent[] {
  const subs = useNotesGallery((s) => s.subscriptions)
  const feeds = useFeeds((s) => s.feeds)

  useEffect(() => {
    for (const sub of subs) {
      const f = feeds[sub.id]
      if (!f || Date.now() - f.at > STALE_MS) void refreshFeed(sub)
    }
  }, [subs, feeds])

  return useMemo(
    () =>
      subs.flatMap((sub) =>
        (feeds[sub.id]?.events ?? []).map((e) => (e.color === sub.color ? e : { ...e, color: sub.color }))
      ),
    [subs, feeds]
  )
}
