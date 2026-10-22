'use client'

// First sign-in terms checklist.
//
// Accounts are provisioned by an admin or the platform operator, so the user
// never passed through a sign-up flow where terms would normally appear. This
// is where they see them: once per account, before the app opens, with a single
// checkbox; the full text opens separately on /legal.
//
// Room boards are exempt — `board` is a classroom display signing itself in,
// not a person who can meaningfully accept anything.

import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { useAuthStore } from '@/lib/auth/store'
import { useConsent, termsOutstanding } from '@/lib/store/consent'
import { EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/legal'
import { Button } from '@/components/ui/button'

export function TermsGate() {
  const status = useAuthStore((s) => s.status)
  const role = useAuthStore((s) => s.profile?.role)
  const name = useAuthStore((s) => s.profile?.full_name)
  const isDemo = useAuthStore((s) => s.profile?.department === 'demo')
  const outstanding = useConsent(termsOutstanding)
  const acceptTerms = useConsent((s) => s.acceptTerms)

  const [agreed, setAgreed] = useState(false)
  // Hydration guard: the persisted store reads localStorage on the client, so
  // rendering the gate during SSR would flash it for users who already accepted.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  const show = ready && status === 'authed' && role !== 'board' && outstanding
  if (!show) return null

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
              {isDemo
                ? 'This is a free demo account. Please accept the terms to start exploring.'
                : 'Your institution set this account up for you. Please accept the terms to continue.'}
            </p>
          </div>

          {/* One-click acceptance; full text lives on /legal */}
          <div className="px-6 py-5">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 size-[1.125rem] shrink-0 accent-[var(--accent-blue)]"
              />
              <span className="text-ui-md leading-relaxed">
                I accept the{' '}
                <a
                  href="/legal#terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[var(--accent-blue)] underline underline-offset-2"
                >
                  Terms &amp; Conditions
                </a>{' '}
                and{' '}
                <a
                  href="/legal"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[var(--accent-blue)] underline underline-offset-2"
                >
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
            <p className="font-mono text-ui-xs text-muted-foreground">
              v{TERMS_VERSION} · {EFFECTIVE_DATE}
            </p>
            <Button size="sm" disabled={!agreed} onClick={acceptTerms} className="min-w-28">
              Start using SIMBLIP
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
