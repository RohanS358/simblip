'use client'

// Settings → Privacy. The full privacy policy, rendered from lib/legal.ts so
// it always matches the text shown at first sign-in, plus the two controls the
// user actually holds: the analytics opt-in and re-reading the terms.

import { useState } from 'react'
import { ChevronDown, ExternalLink, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useConsent } from '@/lib/store/consent'
import { getAccessToken, useAuthStore } from '@/lib/auth/store'
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
          <span className="block text-ui-md font-medium">{title}</span>
          {!open && (
            <span className="mt-0.5 block truncate text-ui-sm text-muted-foreground">
              {summary}
            </span>
          )}
        </span>
      </button>
      {open && <div className="pb-3 pl-6 pr-1">{children}</div>}
    </div>
  )
}

const REQUESTS = [
  ['copy', 'Send me a copy of my data'],
  ['correct', 'Correct my data'],
  ['delete', 'Delete my account and data'],
] as const

/**
 * Files a data request into the bug-report queue the operator already reads
 * on /dev. Deliberately carries no browser/screen context — only the account
 * id and what was asked for.
 * ponytail: operator acts on it by hand; add a status mail-back when volume warrants.
 */
function useDataRequest() {
  const profile = useAuthStore((s) => s.profile)
  const [sent, setSent] = useState<string | null>(null)
  const send = async (kind: string, label: string) => {
    if (kind === 'delete' && !confirm('Ask for this account and all its data to be deleted? This cannot be undone once acted on.')) return
    try {
      const token = getAccessToken()
      const res = await fetch('/api/pg/simblip_bug_reports', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            reporter_id: profile?.id ?? null,
            institution_id: profile?.institution_id ?? null,
            title: `[Privacy request] ${label}`,
            body: `Account ${profile?.email ?? profile?.id ?? 'unknown'} requested: ${kind}.`,
            context: { kind: 'privacy-request', request: kind, at: new Date().toISOString() },
            status: 'open',
          },
        ]),
      })
      if (!res.ok) throw new Error(String(res.status))
      setSent(kind)
      toast.success('Request sent. Your institution admin or the operator will follow up.')
    } catch {
      toast.error("Couldn't send the request — try again, or ask your institution admin.")
    }
  }
  return { sent, send }
}

export function PrivacySettings() {
  const request = useDataRequest()
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
              <p className="text-ui-sm leading-relaxed text-muted-foreground">{c}</p>
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
            <p className="text-ui-md font-medium">Terms of use</p>
            <p className="mt-0.5 text-ui-sm text-muted-foreground">
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
        <p className="pt-0.5 text-ui-sm leading-relaxed text-muted-foreground">
          Every category of data the app stores, why it exists, where it physically goes, and how
          long it stays. Expand any row for the detail.
        </p>
        <div className="pt-1">
          {DATA_CATEGORIES.map((c) => (
            <Disclosure key={c.id} title={c.title} summary={c.what}>
              <dl className="space-y-2 text-ui-sm leading-relaxed">
                {(
                  [
                    ['What', c.what],
                    ['Why', c.why],
                    ['Where it goes', c.where],
                    ['How long', c.retention],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-mono text-ui-xs uppercase tracking-wide text-muted-foreground/70">
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
              <p className="text-ui-sm leading-relaxed text-muted-foreground">{t.body}</p>
            </Disclosure>
          ))}
        </div>
      </SettingCard>

      {/* Asking for your data back */}
      <SettingCard title="Your rights">
        <div className="space-y-2.5 pt-0.5 text-ui-sm leading-relaxed text-muted-foreground">
          <p>
            You can ask for a copy of your data, ask for it to be corrected, or ask for the account
            to be deleted. Send the request here — it goes to the operator, and your
            institution&rsquo;s admin can act on it too, since they control the account.
          </p>
          <div className="flex flex-wrap gap-2 py-1">
            {REQUESTS.map(([kind, label]) => (
              <Button
                key={kind}
                size="sm"
                variant="outline"
                disabled={request.sent === kind}
                onClick={() => request.send(kind, label)}
              >
                {request.sent === kind ? 'Requested' : label}
              </Button>
            ))}
          </div>
          <p>
            You can export your own notebooks yourself at any time from{' '}
            <span className="font-medium text-foreground">Settings → Files and links</span>.
          </p>
        </div>
      </SettingCard>

      <p className="px-1 pb-2 font-mono text-ui-xs text-muted-foreground">
        <a href="/legal" target="_blank" rel="noreferrer" className="underline underline-offset-2">
          Public copy
        </a>{' '}
        · Privacy policy v{PRIVACY_VERSION} · Terms v{TERMS_VERSION} · Effective {EFFECTIVE_DATE}
      </p>
    </div>
  )
}
