'use client'

// First sign-in terms checklist.
//
// Accounts are provisioned by an admin or the platform operator, so the user
// never passed through a sign-up flow where terms would normally appear. This
// is where they see them: once per account, before the app opens, with each
// term acknowledged individually rather than behind one blanket "I agree".
//
// Room boards are exempt — `board` is a classroom display signing itself in,
// not a person who can meaningfully accept anything.

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, ShieldCheck } from 'lucide-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { useAuthStore } from '@/lib/auth/store'
import { useConsent, termsOutstanding } from '@/lib/store/consent'
import { TERMS_ITEMS, EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/legal'
import { useMotionOff, useSpring } from '@/lib/motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function TermsGate() {
  const status = useAuthStore((s) => s.status)
  const role = useAuthStore((s) => s.profile?.role)
  const name = useAuthStore((s) => s.profile?.full_name)
  const outstanding = useConsent(termsOutstanding)
  const acceptTerms = useConsent((s) => s.acceptTerms)
  const motionOff = useMotionOff()
  const transition = useSpring('soft')

  const [checked, setChecked] = useState<Set<string>>(new Set())
  // Hydration guard: the persisted store reads localStorage on the client, so
  // rendering the gate during SSR would flash it for users who already accepted.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  const show = ready && status === 'authed' && role !== 'board' && outstanding
  if (!show) return null

  const allChecked = checked.size === TERMS_ITEMS.length
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const firstName = name?.trim().split(/\s+/)[0]

  return (
    <DialogPrimitive.Root open modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[120] bg-black/55 backdrop-blur-sm" />
        <DialogPrimitive.Content
          // No outside-click or Escape dismissal: this is a gate, and closing it
          // without an answer would drop the user into the app unacknowledged.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[121] flex max-h-[88dvh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Accept the SIMBLIP terms</DialogPrimitive.Title>
          </VisuallyHidden.Root>

          {/* Header */}
          <div className="border-b border-border px-6 py-5">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="size-[1.125rem] text-[var(--accent-blue)]" />
              <span className="text-ui-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Before you start
              </span>
            </div>
            <h2 className="mt-2.5 text-ui-3xl font-bold tracking-tight">
              {firstName ? `Welcome, ${firstName}.` : 'Welcome to SIMBLIP.'}
            </h2>
            <p className="mt-1.5 text-ui-md leading-relaxed text-muted-foreground">
              Your institution set this account up for you. Confirm each point below — they cover
              what you can expect from SIMBLIP and what it expects from you.
            </p>
          </div>

          {/* Checklist */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <ul className="space-y-2">
              {TERMS_ITEMS.map((item, i) => {
                const on = checked.has(item.id)
                return (
                  <motion.li
                    key={item.id}
                    initial={motionOff ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={motionOff ? { duration: 0 } : { ...transition, delay: i * 0.04 }}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(item.id)}
                      aria-pressed={on}
                      className={cn(
                        'flex w-full gap-3 rounded-xl border p-3.5 text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                        on
                          ? 'border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/[0.06]'
                          : 'border-border hover:bg-muted/50',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 flex size-[1.125rem] shrink-0 items-center justify-center rounded-[0.3rem] border transition-colors',
                          on
                            ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                            : 'border-muted-foreground/40',
                        )}
                      >
                        {on && <Check className="size-3 stroke-[3]" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-ui-md font-semibold">{item.title}</span>
                        <span className="mt-1 block text-ui-sm leading-relaxed text-muted-foreground">
                          {item.body}
                        </span>
                      </span>
                    </button>
                  </motion.li>
                )
              })}
            </ul>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
            <p className="font-mono text-ui-xs text-muted-foreground">
              v{TERMS_VERSION} · {EFFECTIVE_DATE}
              <span className="mx-1.5">·</span>
              <span className={allChecked ? 'text-[var(--accent-mint)]' : undefined}>
                {checked.size}/{TERMS_ITEMS.length} confirmed
              </span>
            </p>
            <Button size="sm" disabled={!allChecked} onClick={acceptTerms} className="min-w-28">
              {allChecked ? 'Start using SIMBLIP' : 'Confirm each point'}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
