'use client'

// Logged-in users landing on / (the marketing page — e.g. it's a browser
// homepage, or a bookmark) get sent straight to their workspace instead of
// seeing the pitch page again. init() resolves the session from localStorage
// first (refresh token + offline grace period, see lib/auth/store.ts), so
// this redirects without a network round-trip when there's nothing to
// refresh — consistent with the rest of the app being local-first. Anon
// visitors just fall through and see the landing page normally.

import { useEffect } from 'react'
import { useAuthStore } from '@/lib/auth/store'
import { homeFor } from '@/lib/auth/types'

export function AuthRedirect() {
  useEffect(() => {
    void useAuthStore.getState().init().then(() => {
      const { status, profile } = useAuthStore.getState()
      if (status === 'authed' && profile) window.location.href = homeFor(profile.role)
    })
  }, [])

  return null
}
