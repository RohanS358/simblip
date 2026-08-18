'use client'

// Drop-in replacement for next/navigation's useRouter that lights the global
// route loader before navigating. Same API — swap the import at the call site
// and every push/replace in that file gets feedback instead of a frozen
// screen while the destination loads.

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'

import { startRouteLoading } from '@/components/route-loader'

export function useNav() {
  const router = useRouter()
  return useMemo(
    () => ({
      ...router,
      push: (href: string) => {
        if (href !== location.pathname + location.search) startRouteLoading()
        router.push(href)
      },
      replace: (href: string) => {
        if (href !== location.pathname + location.search) startRouteLoading()
        router.replace(href)
      },
    }),
    [router],
  )
}
