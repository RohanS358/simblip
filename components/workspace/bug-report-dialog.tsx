'use client'

// "Report a bug" — filed from the account menu, read on /dev.
//
// The environment block is captured automatically rather than asked for:
// browser, OS, viewport and the route it was filed from are exactly what
// makes a report reproducible, and exactly what a reporter never thinks to
// include. Everything else is two fields, because a form that takes five
// minutes is a report that never gets filed.

import { useState } from 'react'
import { Bug, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getAccessToken, useAuthStore } from '@/lib/auth/store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Everything about the environment worth knowing, gathered without asking. */
function captureContext(): Record<string, unknown> {
  if (typeof window === 'undefined') return {}
  return {
    url: window.location.pathname + window.location.search,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${window.screen.width}x${window.screen.height}`,
    dpr: window.devicePixelRatio,
    online: navigator.onLine,
    // Which theme/appearance was active — several bugs so far have been
    // theme-specific (a token defined in one palette and not another).
    theme: document.documentElement.className || null,
    at: new Date().toISOString(),
  }
}

export function BugReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const profile = useAuthStore((s) => s.profile)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async () => {
    if (!title.trim() || sending) return
    setSending(true)
    try {
      const token = getAccessToken()
      const res = await fetch('/api/pg/simblip_bug_reports', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            reporter_id: profile?.id ?? null,
            institution_id: profile?.institution_id ?? null,
            title: title.trim(),
            body: body.trim(),
            context: captureContext(),
            status: 'open',
          },
        ]),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success('Bug reported — thank you')
      setTitle('')
      setBody('')
      onOpenChange(false)
    } catch {
      // Keep the text: losing what someone just typed because the network
      // blipped is how you train people never to report anything again.
      toast.error("Couldn't send the report. Your text is still here — try again.")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-4 w-4" /> Report a bug
          </DialogTitle>
          <DialogDescription>
            Your browser, screen size and current page are attached automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-ui-sm font-semibold text-muted-foreground">What went wrong?</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Slides don't scroll on my phone"
              className="rounded-lg border border-border/60 bg-background px-3 py-2 text-ui-lg outline-none focus-visible:border-[var(--accent-blue)]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-ui-sm font-semibold text-muted-foreground">
              Steps to reproduce <span className="font-normal">(optional)</span>
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="1. Open a presentation&#10;2. Try to drag the slide&#10;3. Nothing moves"
              className="resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-ui-lg outline-none focus-visible:border-[var(--accent-blue)]"
            />
          </label>
        </div>

        <DialogFooter>
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-ui-md font-medium text-muted-foreground transition-colors hover:bg-accent"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!title.trim() || sending}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-blue)] px-4 py-2 text-ui-md font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
            onClick={() => void submit()}
          >
            {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {sending ? 'Sending…' : 'Send report'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
