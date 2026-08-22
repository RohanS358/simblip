'use client'

// Route guard: every workspace surface sits behind this. Boots the auth
// store, blocks anonymous access, and enforces role access.
//
// It no longer applies the institution's brand accent — see the note by the
// removed effect below.

import { useNav } from '@/lib/use-nav'
import { BounceLoader } from '@/components/ui/bounce-loader'
import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/lib/auth/store'
import { homeFor, type Role } from '@/lib/auth/types'

export function RequireAuth({
  allow,
  children,
}: {
  /** roles permitted here; omit to allow any signed-in user */
  allow?: Role[]
  children: React.ReactNode
}) {
  const router = useNav()
  const status = useAuthStore((s) => s.status)
  const profile = useAuthStore((s) => s.profile)
  const booted = useRef(false)

  useEffect(() => {
    if (!booted.current) {
      booted.current = true
      void useAuthStore.getState().init()
    }
  }, [])

  useEffect(() => {
    if (status === 'anon') router.replace('/login')
    else if (status === 'authed' && profile && allow && !allow.includes(profile.role)) {
      router.replace(homeFor(profile.role))
    }
  }, [status, profile, allow, router])

  // Institution branding no longer applies --accent-blue here: it fought the
  // user's own Accent Tint over the same inline property and won, because this
  // mounts below ThemeProvider. AccentApplier (components/theme-provider.tsx)
  // is now the single writer and reads the brand colour itself.

  if (status !== 'authed' || !profile || (allow && !allow.includes(profile.role))) {
    return (
      <div className="canvas-dots flex h-dvh flex-col items-center justify-center gap-3 bg-background [background-size:24px_24px]">
        <BounceLoader size={240} />
        <span className="text-ui-md font-extrabold tracking-tight">
          SIM<span className="text-[var(--accent-blue)]">BLIP</span>
        </span>
        <span className="text-ui-xs text-muted-foreground">
          {status === 'loading' ? 'Checking your session…' : 'Redirecting to sign in…'}
        </span>
      </div>
    )
  }

  return <>{children}</>
}
