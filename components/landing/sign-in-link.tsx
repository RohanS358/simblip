'use client'

// The landing page's "Sign in" buttons default to /login, but a returning
// user with a valid (or offline-grace) session should go straight to their
// workspace instead of back through the login form — same session check
// AuthRedirect already does for a full-page auto-redirect, just applied to
// the button itself so it's correct even before/without that redirect firing.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/lib/auth/store'
import { homeFor } from '@/lib/auth/types'

export function SignInLink({
  className,
  signedOutLabel,
  signedInLabel = 'Open notebook',
}: {
  className?: string
  signedOutLabel: string
  signedInLabel?: string
}) {
  const [ready, setReady] = useState(false)
  const status = useAuthStore((s) => s.status)
  const profile = useAuthStore((s) => s.profile)

  useEffect(() => {
    void useAuthStore.getState().init().then(() => setReady(true))
  }, [])

  const signedIn = ready && status === 'authed' && profile
  const href = signedIn ? homeFor(profile.role) : '/login'

  return (
    <Link href={href} className={className}>
      {signedIn ? signedInLabel : signedOutLabel}
    </Link>
  )
}
