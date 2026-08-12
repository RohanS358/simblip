'use client'

// Vercel Analytics, gated on the account's choice.
//
// The storage notice promises analytics stay off until turned on, so the
// component must not mount (and its script must not load) unless consent is
// actually recorded. Rendering nothing keeps the promise literally true.

import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/next'
import { useConsent } from '@/lib/store/consent'

export function ConsentedAnalytics() {
  const analytics = useConsent((s) => s.analytics)

  // The consent store hydrates from localStorage on the client; render nothing
  // until then so the script never loads for a user who has opted out.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  if (!ready || !analytics) return null
  return <Analytics />
}
