'use client'

// Light chrome for the non-canvas surfaces (assignments, admin console):
// top bar with brand + institution, notifications and identity, then a
// scrollable content column and the platform status bar.

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
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="z-40 flex h-12 shrink-0 items-center gap-2 px-4">
        {backHref && (
          <Link
            href={backHref}
            aria-label="Back to notebook"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <span className="text-[14px] font-extrabold tracking-tight">
          SIM<span className="text-[var(--accent-blue)]">BLIP</span>
        </span>
        <span className="text-muted-foreground/50">/</span>
        <span className="truncate text-[13px] font-semibold">{title}</span>
        {institution && (
          <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">
            · {institution.name}
          </span>
        )}
        <div className="flex-1" />
        <NotificationCenter />
        <ProfileMenu />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 md:px-8">
        <div className="mx-auto w-full max-w-4xl">{children}</div>
      </main>

      <footer className="z-40 flex h-6 shrink-0 items-center gap-3 border-t border-border/40 px-4 text-[10.5px] text-muted-foreground">
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
