'use client'

// Chrome for the non-canvas surfaces (admin console, dev console): a
// floating liquid-glass top bar over a full-width scrollable content
// column with progressive blur where content meets chrome, and the
// platform status bar. Content takes the whole viewport — wide screens get
// working space, not margins.

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useAuthStore } from '@/lib/auth/store'
import { ROLE_LABEL } from '@/lib/auth/types'
import { NotificationCenter } from '@/components/workspace/notifications'
import { ProfileMenu } from '@/components/workspace/profile-menu'

export function PageShell({
  title,
  backHref = '/notebook',
  children,
}: {
  title: string
  backHref?: string | null
  children: React.ReactNode
}) {
  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
      <header className="absolute inset-x-0 top-0 z-40">
        <div className="progressive-blur-top !h-20" />
        <div className="relative m-3 mb-0 flex h-11 items-center gap-2 rounded-2xl px-3 liquid-glass sm:mx-4">
          {backHref && (
            <Link
              href={backHref}
              aria-label="Back to notebook"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <span className="text-ui-md font-extrabold tracking-tight">
            SIM<span className="text-[var(--accent-blue)]">BLIP</span>
          </span>
          <span className="text-muted-foreground/50">/</span>
          <span className="truncate text-ui-sm font-semibold">{title}</span>
          {institution && (
            <span className="hidden truncate text-ui-xs text-muted-foreground sm:inline">
              · {institution.name}
            </span>
          )}
          <div className="flex-1" />
          <NotificationCenter />
          <ProfileMenu />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 pb-10 pt-20 sm:px-4 md:px-6 lg:px-10">
        <h1 className="mb-6 text-[clamp(1.5rem,3vw,2.4rem)] font-bold leading-tight tracking-[-0.02em]">
          {title}
        </h1>
        {children}
      </main>

      <footer className="z-40 flex h-6 shrink-0 items-center gap-3 border-t border-border/40 px-4 text-ui-2xs text-muted-foreground">
        {profile && (
          <span className="font-medium">
            {profile.full_name} · {ROLE_LABEL[profile.role]}
          </span>
        )}
        <div className="flex-1" />
        <span>SIMBLIP · Built by Rohan Singh</span>
      </footer>
    </div>
  )
}
