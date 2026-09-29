import type { Metadata } from 'next'
import Link from 'next/link'
import {
  DATA_CATEGORIES,
  PRIVACY_COMMITMENTS,
  LOCAL_STORAGE_USES,
  TERMS_ITEMS,
  EFFECTIVE_DATE,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from '@/lib/legal'

// Public, signed-out copy of the terms and privacy policy. Same source as the
// first-run gate and Settings → Privacy (lib/legal.ts), so the three can't
// drift. It has to be reachable before sign-in: a policy you can only read
// after agreeing to it isn't disclosure.

export const metadata: Metadata = {
  title: 'Privacy & terms',
  description: 'What SIMBLIP stores, why, where it goes, and the terms of use.',
  alternates: { canonical: '/legal' },
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-6 text-ui-2xl font-bold tracking-tight">
      {children}
    </h2>
  )
}

export default function LegalPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-ui-md leading-relaxed sm:py-16">
      <Link href="/" className="text-ui-sm text-muted-foreground hover:text-foreground">
        ← SIMBLIP
      </Link>
      <h1 className="mt-4 text-ui-3xl font-bold tracking-tight">Privacy &amp; terms</h1>
      <p className="mt-2 font-mono text-ui-xs text-muted-foreground">
        Privacy v{PRIVACY_VERSION} · Terms v{TERMS_VERSION} · Effective {EFFECTIVE_DATE}
      </p>
      <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-ui-sm">
        {[
          ['#privacy', 'Privacy policy'],
          ['#storage', 'Cookies & local storage'],
          ['#rights', 'Your rights'],
          ['#terms', 'Terms of use'],
          ['#licenses', 'Open-source licenses'],
        ].map(([href, label]) => (
          <a key={href} href={href} className="text-[var(--accent-blue)] hover:underline">
            {label}
          </a>
        ))}
      </nav>

      <H2 id="privacy">Privacy policy</H2>
      <ul className="mt-4 list-disc space-y-1.5 pl-5 text-muted-foreground">
        {PRIVACY_COMMITMENTS.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {DATA_CATEGORIES.map((c) => (
        <section key={c.id} className="mt-6">
          <h3 className="text-ui-lg font-semibold">{c.title}</h3>
          <dl className="mt-1.5 space-y-1.5 text-ui-sm text-muted-foreground">
            {(
              [
                ['What', c.what],
                ['Why', c.why],
                ['Where it goes', c.where],
                ['How long', c.retention],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="inline font-medium text-foreground">{k}: </dt>
                <dd className="inline">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <H2 id="storage">Cookies &amp; local storage</H2>
      <p className="mt-3 text-muted-foreground">
        SIMBLIP sets no cookies. It uses your browser&rsquo;s local storage, which is strictly
        necessary for the service, for:
      </p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
        {LOCAL_STORAGE_USES.map((u) => (
          <li key={u.title}>
            <span className="font-medium text-foreground">{u.title}.</span> {u.body}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-muted-foreground">
        Anonymous analytics are off by default and only load if you turn them on after signing in.
      </p>

      <H2 id="rights">Your rights</H2>
      <p className="mt-3 text-muted-foreground">
        You can ask for a copy of your data, for it to be corrected, or for your account and data
        to be deleted. Signed in, use <span className="font-medium text-foreground">Settings →
        Privacy → Your rights</span> to send the request; your institution&rsquo;s admin can also
        act on it, since they control the account. You can export your own notebooks yourself at
        any time from Settings → Files and links.
      </p>

      <H2 id="terms">Terms of use</H2>
      <ol className="mt-4 list-decimal space-y-4 pl-5">
        {TERMS_ITEMS.map((t) => (
          <li key={t.id}>
            <span className="font-semibold">{t.title}.</span>{' '}
            <span className="text-muted-foreground">{t.body}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-ui-sm text-muted-foreground">
        Institutions license SIMBLIP under a separate agreement; fees, refunds and cancellation are
        set by that agreement. Individual users are never charged.
      </p>

      <H2 id="licenses">Open-source licenses</H2>
      <p className="mt-3 text-muted-foreground">
        SIMBLIP is built on open-source software and fonts. Their copyright notices and license
        texts are listed in{' '}
        <a href="/third-party-licenses.txt" className="text-[var(--accent-blue)] hover:underline">
          third-party-licenses.txt
        </a>
        .
      </p>

      <p className="mt-16 border-t border-border/40 pt-6 text-ui-xs text-muted-foreground">
        © {new Date().getFullYear()} SIMBLIP · Built by Rohan Singh
      </p>
    </main>
  )
}
