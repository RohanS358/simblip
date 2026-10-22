'use client'

// "Try it now" — a throwaway student account, no institution needed. Used on
// the landing hero and under the sign-in form. A signed-in visitor is not
// offered a second account: they just see their own way back in.

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth/store'
import { homeFor } from '@/lib/auth/types'

export function TryDemoButton({ className, label = 'Try it now — no sign-up' }: { className?: string; label?: string }) {
  const [busy, setBusy] = useState(false)
  const error = useAuthStore((s) => s.error)

  const start = async () => {
    setBusy(true)
    const profile = await useAuthStore.getState().loginDemo()
    if (profile) {
      // Full navigation so the per-user notebook stores hydrate fresh.
      window.location.href = homeFor(profile.role)
      return
    }
    setBusy(false)
  }

  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      <button type="button" onClick={() => void start()} disabled={busy} className={className}>
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Starting…
          </span>
        ) : (
          label
        )}
      </button>
      {error && !busy && (
        <span role="alert" className="text-ui-xs text-[var(--accent-rose)]">
          {error}
        </span>
      )}
    </span>
  )
}
