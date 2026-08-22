'use client'

// The signed-in identity, top-right of every shell. Role-aware navigation
// (admin console, assignments), settings, and sign-out.

import { useNav } from '@/lib/use-nav'
import { useState } from 'react'
import { Bug, ClipboardList, LogOut, NotebookPen, Settings, ShieldCheck } from 'lucide-react'
import { BugReportDialog } from './bug-report-dialog'
import { BugSwarm, useBugHold } from './bug-swarm'
import { useAuthStore } from '@/lib/auth/store'
import { ROLE_LABEL } from '@/lib/auth/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

export function ProfileMenu({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const router = useNav()
  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)
  const [bugOpen, setBugOpen] = useState(false)
  const [swarm, setSwarm] = useState(false)
  // Hold the bug item for five seconds — see bug-swarm.tsx.
  const bugHold = useBugHold(() => setSwarm(true))
  if (!profile) return null

  const isStaff = profile.role === 'teacher' || profile.role === 'admin'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Account menu" className="rounded-full transition-opacity hover:opacity-80">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-[color-mix(in_oklch,var(--accent-blue)_18%,transparent)] text-ui-2xs font-bold">
              {initials(profile.full_name)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block text-ui-md font-semibold">{profile.full_name}</span>
          <span className="block text-ui-xs font-normal text-muted-foreground">{profile.email}</span>
          <span className="mt-1 inline-block rounded-md bg-accent px-1.5 py-0.5 text-ui-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            {ROLE_LABEL[profile.role]}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {profile.role !== 'board' && (
          <DropdownMenuItem onClick={() => router.push('/notebook')}>
            <NotebookPen className="h-4 w-4" /> Notebook
          </DropdownMenuItem>
        )}
        {(isStaff || profile.role === 'student') && (
          <DropdownMenuItem onClick={() => router.push('/assignments')}>
            <ClipboardList className="h-4 w-4" /> Assignments
          </DropdownMenuItem>
        )}
        {profile.role === 'admin' && (
          <DropdownMenuItem onClick={() => router.push('/admin')}>
            <ShieldCheck className="h-4 w-4" /> Admin console
          </DropdownMenuItem>
        )}
        {onOpenSettings && (
          <DropdownMenuItem onClick={onOpenSettings} className="gap-1.5">
            <Settings className="h-4 w-4 scale-125" /> Settings
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          {...bugHold.handlers}
          onSelect={(e) => {
            // A completed hold already did its thing; don't also open the form.
            if (bugHold.fired.current) {
              e.preventDefault()
              return
            }
            setBugOpen(true)
          }}
        >
          <Bug className="h-4 w-4" /> Report a bug
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => useAuthStore.getState().logout()}>
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
      <BugReportDialog open={bugOpen} onOpenChange={setBugOpen} />
      {swarm && <BugSwarm onEnd={() => setSwarm(false)} />}
    </DropdownMenu>
  )
}
