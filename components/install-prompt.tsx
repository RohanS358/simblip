'use client'

// Custom "Install SIMBLIP" affordance. Native install prompts are
// unreliable — Chrome/Edge only fire beforeinstallprompt after their own
// engagement heuristics, and iOS Safari never fires it at all (Add to Home
// Screen is a manual Share-sheet action there). This surfaces one dismissible
// nudge per platform instead of relying entirely on browser chrome.

import { useEffect } from 'react'
import { toast } from 'sonner'

const DISMISSED_KEY = 'simblip-install-dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}

export function InstallPrompt() {
  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISSED_KEY)) return

    const dismiss = () => localStorage.setItem(DISMISSED_KEY, '1')

    if (isIos()) {
      toast('Install SIMBLIP: tap Share, then "Add to Home Screen".', {
        duration: 10_000,
        onDismiss: dismiss,
        onAutoClose: dismiss,
      })
      return
    }

    const onPrompt = (e: Event) => {
      e.preventDefault()
      const installEvent = e as BeforeInstallPromptEvent
      toast('Install SIMBLIP for a faster, full-screen launch.', {
        duration: 10_000,
        action: {
          label: 'Install',
          onClick: () => void installEvent.prompt(),
        },
        onDismiss: dismiss,
        onAutoClose: dismiss,
      })
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  return null
}
