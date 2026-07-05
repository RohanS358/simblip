'use client'

// Registers the service worker that makes SIMBLIP installable ("Add to
// Home Screen" / install icon in the address bar) and offline-capable.

import { useEffect } from 'react'

export function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Install prompt just won't appear; the app itself is unaffected.
      })
    }
  }, [])
  return null
}
