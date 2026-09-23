'use client'

// Notification center: shares received, assignments (new work for students,
// new submissions for teachers) and room announcements, aggregated live from
// the data layer. Read state is tracked per user on this device.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, ClipboardList, Inbox, Megaphone, Share2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth/store'
import { listIncomingShares, subscribeShares } from '@/lib/data/shares'
import {
  listMyAssignments,
  listInstitutionSubmissions,
  subscribeAssignments,
  subscribeSubmissions,
} from '@/lib/data/assignments'
import { listMyAnnouncements, subscribeAnnouncements } from '@/lib/data/announcements'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Notice {
  id: string
  icon: typeof Bell
  title: string
  detail: string
  at: string
  href?: string
}

const readKey = (userId: string) => `simblip-read-notices:${userId}`

const loadRead = (userId: string): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(readKey(userId)) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function NotificationCenter() {
  const router = useRouter()
  const profile = useAuthStore((s) => s.profile)
  const [notices, setNotices] = useState<Notice[]>([])
  const [read, setRead] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!profile) return
    const items: Notice[] = []
    const [shares, assignments, announcements] = await Promise.all([
      listIncomingShares(),
      listMyAssignments(),
      listMyAnnouncements(),
    ])
    for (const s of shares) {
      items.push({
        id: `share:${s.id}`,
        icon: Share2,
        title: `${s.sender_name} shared “${s.title}”`,
        detail: 'The copy is in your “Shared with me” notebook.',
        at: s.created_at,
      })
    }
    if (profile.role === 'student') {
      for (const a of assignments) {
        items.push({
          id: `assignment:${a.id}`,
          icon: ClipboardList,
          title: `Assignment: ${a.title}`,
          detail: a.due_at ? `Due ${new Date(a.due_at).toLocaleString()}` : 'No due date',
          at: a.created_at,
          href: '/assignments',
        })
      }
    } else if (profile.role === 'teacher' || profile.role === 'admin') {
      // One request for the whole tenant, then match locally — NOT one
      // request per assignment (see listInstitutionSubmissions).
      const byId = new Map(assignments.map((a) => [a.id, a]))
      const subs = (await listInstitutionSubmissions()).filter((s) => byId.has(s.assignment_id))
      for (const sub of subs) {
        if (sub.status === 'submitted' || sub.status === 'late') {
          items.push({
            id: `submission:${sub.id}:${sub.status}`,
            icon: ClipboardList,
            title: `${sub.student_name} submitted “${byId.get(sub.assignment_id)!.title}”`,
            detail: sub.status === 'late' ? 'Submitted late' : 'Ready for review',
            at: sub.submitted_at ?? sub.updated_at,
            href: '/assignments',
          })
        }
      }
    }
    for (const an of announcements) {
      items.push({
        id: `announcement:${an.id}`,
        icon: Megaphone,
        title: `${an.author_name}: ${an.body.slice(0, 80)}${an.body.length > 80 ? '…' : ''}`,
        detail: 'Announcement',
        at: an.created_at,
      })
    }
    items.sort((x, y) => y.at.localeCompare(x.at))
    setNotices(items.slice(0, 40))
  }, [profile])

  useEffect(() => {
    if (!profile) return
    setRead(loadRead(profile.id))
    void refresh()
    // All four tables drive the SAME refresh(), and they tick on the same
    // shared interval — so a naive one-callback-each wiring ran refresh()
    // four times per tick, quadrupling every request it makes. Coalesce to
    // one run per tick; a microtask flag is enough because the ticks land
    // synchronously in one batch.
    let queued = false
    const tick = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        void refresh()
      })
    }
    const unsubs = [
      subscribeShares(tick),
      subscribeAssignments(tick),
      subscribeSubmissions(tick),
      subscribeAnnouncements(tick),
    ]
    return () => unsubs.forEach((u) => u())
  }, [profile, refresh])

  const unread = useMemo(() => notices.filter((n) => !read.has(n.id)).length, [notices, read])

  const markAllRead = () => {
    if (!profile) return
    const all = new Set(notices.map((n) => n.id))
    setRead(all)
    localStorage.setItem(readKey(profile.id), JSON.stringify([...all]))
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) markAllRead()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
          className="relative rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-rose)] px-1 text-ui-3xs font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <span className="text-ui-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Notifications
          </span>
          {notices.length > 0 && (
            <button
              type="button"
              className="text-ui-xs text-muted-foreground hover:text-foreground"
              onClick={markAllRead}
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notices.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <Inbox className="h-5 w-5 text-muted-foreground/50" />
              <p className="text-ui-sm text-muted-foreground">Nothing yet — you're all caught up.</p>
            </div>
          )}
          {notices.map((n) => (
            <button
              key={n.id}
              type="button"
              className={cn(
                'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/60',
                !read.has(n.id) && 'bg-[color-mix(in_oklch,var(--accent-blue)_6%,transparent)]'
              )}
              onClick={() => {
                setOpen(false)
                markAllRead()
                if (n.href) router.push(n.href)
              }}
            >
              <n.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
              <span className="min-w-0">
                <span className="block truncate text-ui-sm font-medium">{n.title}</span>
                <span className="block text-ui-xs text-muted-foreground">
                  {n.detail} · {new Date(n.at).toLocaleString()}
                </span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
