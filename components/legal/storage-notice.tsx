'use client'

// Storage & analytics notice.
//
// SIMBLIP sets no cookies: sessions live in this browser's local storage and
// the only third party is Vercel Analytics. So this is not a cookie banner —
// it says what is actually stored on the device and offers the one choice that
// is genuinely a choice (analytics), which stays off until turned on.
//
// It does not block the app. Strictly-necessary storage needs no consent, and
// pretending otherwise would train people to click through a meaningless wall.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Database } from 'lucide-react'
import { useAuthStore } from '@/lib/auth/store'
import { useConsent, termsOutstanding } from '@/lib/store/consent'
import { LOCAL_STORAGE_USES } from '@/lib/legal'
import { useMotionOff, useSpring } from '@/lib/motion'
import { Button } from '@/components/ui/button'

export function StorageNotice() {
  const status = useAuthStore((s) => s.status)
  const role = useAuthStore((s) => s.profile?.role)
  const seen = useConsent((s) => s.storageNoticeSeen)
  const termsPending = useConsent(termsOutstanding)
  const setAnalytics = useConsent((s) => s.setAnalytics)
  const motionOff = useMotionOff()
  const transition = useSpring('soft')

  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  // Wait for the terms gate to clear first — two stacked prompts on first run
  // is one too many.
  const show = ready && status === 'authed' && role !== 'board' && !termsPending && !seen

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={motionOff ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={motionOff ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={motionOff ? { duration: 0 } : transition}
          role="region"
          aria-label="Storage and analytics"
          className="fixed inset-x-0 bottom-0 z-[110] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <div className="w-full max-w-[34rem] overflow-hidden rounded-2xl border border-border bg-background/95 shadow-xl backdrop-blur-md">
            <div className="px-5 pt-4">
              <div className="flex items-center gap-2">
                <Database className="size-4 text-[var(--accent-blue)]" />
                <h2 className="text-[0.875rem] font-semibold">What SIMBLIP keeps on this device</h2>
              </div>
              <p className="mt-2 text-[0.75rem] leading-relaxed text-muted-foreground">
                SIMBLIP sets no cookies and runs no ad trackers. It uses this browser&rsquo;s local
                storage for three things:
              </p>
              <ul className="mt-2.5 space-y-1.5">
                {LOCAL_STORAGE_USES.map((u) => (
                  <li key={u.title} className="flex gap-2 text-[0.75rem] leading-relaxed">
                    <span aria-hidden className="mt-[0.4rem] size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    <span>
                      <span className="font-medium">{u.title}.</span>{' '}
                      <span className="text-muted-foreground">{u.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.75rem] leading-relaxed text-muted-foreground">
                Anonymous usage analytics are <span className="font-medium text-foreground">off</span>.
                Turn them on to help find slow pages — you can change this any time in Settings →
                Privacy.
              </p>
            </div>
            <div className="mt-4 flex gap-2 border-t border-border px-5 py-3">
              <Button size="sm" variant="ghost" className="flex-1" onClick={() => setAnalytics(false)}>
                Keep analytics off
              </Button>
              <Button size="sm" className="flex-1" onClick={() => setAnalytics(true)}>
                Turn analytics on
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
