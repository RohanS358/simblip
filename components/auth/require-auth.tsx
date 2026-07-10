'use client'

// Route guard: every workspace surface sits behind this. Boots the auth
// store, blocks anonymous access, enforces role access, and applies the
// institution's branding (accent color) to the shell.

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
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
  const router = useRouter()
  const status = useAuthStore((s) => s.status)
  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)
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

  // Institution branding: accent color drives the shell's primary accent.
  useEffect(() => {
    const accent = institution?.accent_color
    if (typeof accent === 'string' && accent) {
      document.documentElement.style.setProperty('--accent-blue', accent)
      return () => {
        document.documentElement.style.removeProperty('--accent-blue')
      }
    }
  }, [institution])

  if (status !== 'authed' || !profile || (allow && !allow.includes(profile.role))) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-background">
        <span className="text-[14px] font-extrabold tracking-tight">
          SIM<span className="text-[var(--accent-blue)]">BLIP</span>
        </span>
        <span className="text-[12px] text-muted-foreground">
          {status === 'loading' ? 'Checking your session…' : 'Redirecting to sign in…'}
        </span>
      </div>
    )
  }

  return <>{children}</>
}
