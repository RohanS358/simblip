'use client'

// Automatic share delivery. Pages shared to the signed-in user (directly or
// to one of their rooms) are imported as owned copies into a "Shared with me"
// notebook, one section per sender — no manual distribution step. Each share
// is imported at most once per device.

import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth/store'
import { importedShareIds, listIncomingShares, markShareImported, subscribeShares } from '@/lib/data/shares'
import { importPageDoc } from '@/lib/store/import-page'

export function useShareInbox() {
  const profile = useAuthStore((s) => s.profile)

  useEffect(() => {
    if (!profile) return
    let cancelled = false

    const deliver = async () => {
      const shares = await listIncomingShares()
      if (cancelled) return
      const seen = importedShareIds(profile.id)
      for (const share of shares) {
        if (seen.has(share.id)) continue
        importPageDoc({
          notebookName: 'Shared with me',
          notebookEmoji: '📥',
          sectionName: share.sender_name,
          pageName: share.title,
          content: share.content,
        })
        markShareImported(profile.id, share.id)
        toast(`“${share.title}” shared by ${share.sender_name}`, {
          description: 'Added to your “Shared with me” notebook. The copy is yours.',
        })
      }
    }

    void deliver()
    const unsub = subscribeShares(() => void deliver())
    return () => {
      cancelled = true
      unsub()
    }
  }, [profile])
}
