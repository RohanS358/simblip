'use client'

// Settings → Privacy. The full privacy policy, rendered from lib/legal.ts so
// it always matches the text shown at first sign-in, plus the two controls the
// user actually holds: the analytics opt-in and re-reading the terms.

import { useState } from 'react'
import { ChevronDown, ExternalLink, ShieldCheck } from 'lucide-react'
import { useConsent } from '@/lib/store/consent'
import {
  DATA_CATEGORIES,
  PRIVACY_COMMITMENTS,
  TERMS_ITEMS,
  EFFECTIVE_DATE,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from '@/lib/legal'
import { SettingCard, ObsidianPrefRow } from './settings-fields'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

function Disclosure({
  title,
  summary,
  children,
}: {
  title: string
  summary: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border/30 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 py-3 text-left"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8125rem] font-medium">{title}</span>
          {!open && (
            <span className="mt-0.5 block truncate text-[0.75rem] text-muted-foreground">
              {summary}
            </span>
          )}
        </span>
      </button>
      {open && <div className="pb-3 pl-6 pr-1">{children}</div>}
    </div>
  )
}

export function PrivacySettings() {
  const analytics = useConsent((s) => s.analytics)
  const setAnalytics = useConsent((s) => s.setAnalytics)
  const acceptedAt = useConsent((s) => s.acceptedAt)
  const acceptedVersion = useConsent((s) => s.acceptedVersion)
  const resetTerms = useConsent((s) => s.resetTerms)

  const accepted = acceptedAt
    ? new Date(acceptedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <div className="space-y-4">
      {/* What SIMBLIP will not do — the headline, stated before the detail */}
      <SettingCard title="In short">
        <div className="space-y-2 pt-0.5">
          {PRIVACY_COMMITMENTS.map((c) => (
            <div key={c} className="flex gap-2.5">
              <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0 text-[var(--accent-mint)]" />
              <p className="text-[0.75rem] leading-relaxed text-muted-foreground">{c}</p>
            </div>
          ))}
        </div>
      </SettingCard>

      {/* Your controls */}
      <SettingCard title="Your choices">
        <ObsidianPrefRow
          label="Anonymous usage analytics"
          detail="Aggregate page views and performance timings via Vercel Analytics. No cookies, no personal identification. Off unless you turn it on."
          action={<Switch checked={analytics} onCheckedChange={setAnalytics} />}
        />
        <div className="flex items-center justify-between gap-4 pt-3.5">
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-medium">Terms of use</p>
            <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
              {accepted
                ? `Accepted ${accepted}${acceptedVersion ? ` · v${acceptedVersion}` : ''}`
                : 'Not yet accepted on this device.'}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={resetTerms}>
            Review again
          </Button>
        </div>
      </SettingCard>

      {/* The policy proper */}
      <SettingCard title={`What data SIMBLIP holds`}>
        <p className="pt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">
          Every category of data the app stores, why it exists, where it physically goes, and how
          long it stays. Expand any row for the detail.
        </p>
        <div className="pt-1">
          {DATA_CATEGORIES.map((c) => (
            <Disclosure key={c.id} title={c.title} summary={c.what}>
              <dl className="space-y-2 text-[0.75rem] leading-relaxed">
                {(
                  [
                    ['What', c.what],
                    ['Why', c.why],
                    ['Where it goes', c.where],
                    ['How long', c.retention],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-mono text-[0.6875rem] uppercase tracking-wide text-muted-foreground/70">
                      {k}
                    </dt>
                    <dd className="mt-0.5 text-muted-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            </Disclosure>
          ))}
        </div>
      </SettingCard>

      {/* Terms text, re-readable */}
      <SettingCard title="Terms you accepted">
        <div className="pt-0.5">
          {TERMS_ITEMS.map((t) => (
            <Disclosure key={t.id} title={t.title} summary={t.body}>
              <p className="text-[0.75rem] leading-relaxed text-muted-foreground">{t.body}</p>
            </Disclosure>
          ))}
        </div>
      </SettingCard>

      {/* Asking for your data back */}
      <SettingCard title="Your rights">
        <div className="space-y-2.5 pt-0.5 text-[0.75rem] leading-relaxed text-muted-foreground">
          <p>
            You can ask for a copy of your data, ask for it to be corrected, or ask for the account
            to be deleted. Your institution&rsquo;s admin handles these requests — they control the
            account, not SIMBLIP.
          </p>
          <p>
            You can export your own notebooks yourself at any time from{' '}
            <span className="font-medium text-foreground">Settings → Files and links</span>.
          </p>
        </div>
      </SettingCard>

      <p className="px-1 pb-2 font-mono text-[0.6875rem] text-muted-foreground">
        Privacy policy v{PRIVACY_VERSION} · Terms v{TERMS_VERSION} · Effective {EFFECTIVE_DATE}
      </p>
    </div>
  )
}
