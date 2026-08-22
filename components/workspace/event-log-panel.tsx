'use client'

// Accessible simulation event log (UX masterplan §16 ADD): a screen-reader
// user has no visual channel for "the mass collided with the ground at
// t=1.4s" today — it's a flash on the canvas at best. The aria-live region
// below is always mounted (no action needed to start hearing events); the
// visible scrollable log is collapsed by default for sighted users who want
// to read back what happened.

import { useState, useSyncExternalStore } from 'react'
import { Ear, X } from 'lucide-react'
import { getEvents, subscribe, type LogEvent } from '@/lib/physics/event-log'
import { cn } from '@/lib/utils'

// Stable reference for the pre-hydration/no-events snapshot — same reason
// lib/physics/event-log.ts's own EMPTY constant exists (useSyncExternalStore
// loops forever if getSnapshot ever returns a fresh array).
const EMPTY: LogEvent[] = []

export function EventLogPanel({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false)
  const events = useSyncExternalStore(
    (fn) => subscribe(pageId, fn),
    () => getEvents(pageId),
    () => EMPTY
  )
  const latest = events[events.length - 1]

  return (
    <>
      {/* Screen-reader announcer — deliberately separate from the visible
          panel below so it works whether or not that panel is open. */}
      <div aria-live="polite" className="sr-only">
        {latest?.text}
      </div>

      {!open ? (
        events.length > 0 && (
          <button
            type="button"
            aria-label={`Simulation event log, ${events.length} event${events.length === 1 ? '' : 's'}`}
            onClick={() => setOpen(true)}
            className="glass fixed bottom-4 left-4 z-30 flex h-6 items-center gap-1 rounded-full px-2 text-ui-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Ear className="h-3 w-3" />
            {events.length}
          </button>
        )
      ) : (
        <div className="glass-strong fixed bottom-4 left-4 z-30 flex max-h-48 w-64 flex-col gap-1 rounded-xl p-2">
          <div className="flex items-center gap-1.5">
            <Ear className="h-3 w-3 text-muted-foreground" />
            <span className="flex-1 text-ui-xs font-semibold">Event log</span>
            <button
              type="button"
              aria-label="Close event log"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto font-mono text-ui-2xs text-muted-foreground">
            {events.length === 0 && <p>No events yet — press Play.</p>}
            {[...events].reverse().map((e, i) => (
              <p key={events.length - i} className={cn(i === 0 && 'text-foreground')}>
                {e.text}
              </p>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
