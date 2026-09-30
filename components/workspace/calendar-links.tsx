'use client'

// Settings → Calendar: follow your Google / Outlook / Apple / Yahoo calendar by
// its private "iCal address". Events show in the calendar read-only and
// refresh on their own. The link is a bearer secret, so it's shown masked.

import { useState } from 'react'
import { Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NOTE_COLORS, eventColor, useNotesGallery, type CalendarSubscription } from '@/lib/store/notes-gallery'
import { loadFeed, refreshFeed, useFeedStatus } from '@/lib/calendar/subscriptions'

import { cn } from '@/lib/utils'

const mask = (url: string) => {
  try {
    return new URL(url.replace(/^webcals?:\/\//i, 'https://')).hostname + '/…'
  } catch {
    return '…'
  }
}

function Row({ sub }: { sub: CalendarSubscription }) {
  const remove = useNotesGallery((s) => s.removeSubscription)
  const feed = useFeedStatus(sub.id)
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: eventColor(sub.color) }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui-md font-medium">{sub.name}</p>
        <p className={cn('truncate text-ui-xs', feed?.error ? 'text-destructive' : 'text-muted-foreground')}>
          {feed?.error ?? `${mask(sub.url)} · ${feed ? `${feed.events.length} events` : 'loading…'}`}
        </p>
      </div>
      <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void refreshFeed(sub)}>
        <RefreshCw className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => remove(sub.id)}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

export function CalendarLinks() {
  const subs = useNotesGallery((s) => s.subscriptions)
  const add = useNotesGallery((s) => s.addSubscription)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [color, setColor] = useState<string>('blue')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await loadFeed(url, 'test', color) // validate before saving
      add({ name: name.trim() || 'Calendar', url: url.trim(), color })
      setName('')
      setUrl('')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {subs.map((s) => (
        <Row key={s.id} sub={s} />
      ))}
      <div className="space-y-2 pt-1">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Work Gmail)" />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Secret iCal address (https:// or webcal://)" />
        <div className="flex items-center gap-2">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn('h-5 w-5 rounded-full ring-offset-2 ring-offset-background', color === c && 'ring-2 ring-foreground')}
              style={{ background: eventColor(c) }}
            />
          ))}
          <Button className="ml-auto" size="sm" disabled={busy || !url.trim()} onClick={submit}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Add calendar
          </Button>
        </div>
      </div>
      <p className="text-ui-xs text-muted-foreground">
        Google: Calendar settings → your calendar → “Secret address in iCal format”. Outlook: Settings → Calendar →
        Shared calendars → Publish → ICS link. Apple: share the calendar publicly and copy its webcal:// link. Anyone
        with the link can read that calendar, so keep it private.
      </p>
    </div>
  )
}
