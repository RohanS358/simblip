'use client'

// Sign in. There is deliberately no sign-up path: SIMBLIP is licensed to
// institutions, and accounts are provisioned by the institution admin
// (in local mode, by the platform operator via the /dev console).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Lock, Mail } from 'lucide-react'
import { useAuthStore } from '@/lib/auth/store'
import { homeFor } from '@/lib/auth/types'
import { cloudConfigured } from '@/lib/data/db'
import { Button } from '@/components/ui/button'
import { HeroBallpit } from '@/components/landing/hero-ballpit'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const error = useAuthStore((s) => s.error)

  // Already signed in? Straight to the role's home.
  useEffect(() => {
    void useAuthStore.getState().init().then(() => {
      const { status, profile } = useAuthStore.getState()
      if (status === 'authed' && profile) window.location.href = homeFor(profile.role)
    })
  }, [])

  const signIn = async (em: string, pw: string) => {
    setBusy(true)
    const profile = await useAuthStore.getState().login(em, pw)
    if (profile) {
      // Full navigation so the per-user notebook stores hydrate fresh.
      window.location.href = homeFor(profile.role)
      return
    }
    setBusy(false)
  }

  return (
    <div className="relative grid min-h-dvh overflow-hidden bg-background lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      {/* Brand panel — full-height statement, not a centered logo */}
      <div className="canvas-dots relative hidden flex-col justify-between overflow-hidden p-10 [background-size:24px_24px] lg:flex">
        <HeroBallpit />
        <span className="relative text-ui-2xl font-extrabold tracking-tight">
          SIM<span className="text-[var(--accent-blue)]">BLIP</span>
        </span>
        <div className="relative">
          <h1 className="max-w-[14ch] text-[clamp(2rem,4vw,3.4rem)] font-bold leading-[1.02] tracking-[-0.025em]">
            Where <span className="text-[var(--accent-blue)]">drawings</span> become{' '}
            <span className="text-[var(--accent-mint)]">experiments</span>
          </h1>
          <p className="mt-4 max-w-md text-ui-md leading-relaxed text-muted-foreground">
            The engineering education platform for institutions — mechanics, circuits, logic,
            optics and quantum on one living canvas.
          </p>
        </div>
        <p className="relative text-ui-2xs text-muted-foreground">
          © {new Date().getFullYear()} SIMBLIP · Built by Rohan Singh
        </p>
        <div className="progressive-blur-bottom !h-16" />
      </div>

      {/* Form panel */}
      <div className="relative flex items-center justify-center px-4 py-10 lg:border-l lg:border-border/50">
      <div className="pointer-events-none absolute inset-0 opacity-40 lg:hidden"><HeroBallpit className="absolute inset-0" /></div>
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center lg:text-left">
          <span className="text-ui-3xl font-extrabold tracking-tight lg:hidden">
            SIM<span className="text-[var(--accent-blue)]">BLIP</span>
          </span>
          <p className="mt-2 text-ui-sm leading-relaxed text-muted-foreground">
            Sign in with the account your institution issued you.
          </p>
        </div>

        <form
          className="liquid-glass space-y-4 rounded-2xl p-5"
          onSubmit={(e) => {
            e.preventDefault()
            void signIn(email, password)
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-ui-xs">
              Email
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                type="text"
                inputMode="email"
                autoComplete="username"
                required
                className="pl-8"
                placeholder="you@institution.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-ui-xs">
              Password
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                className="pl-8"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-ui-xs leading-relaxed text-[var(--accent-rose)]">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
          </Button>

          <p className="text-center text-ui-2xs leading-relaxed text-muted-foreground">
            Forgot your password? Ask your institution admin to reset it.
          </p>
        </form>

        {!cloudConfigured && (
          <p className="mt-6 text-center text-ui-2xs leading-relaxed text-muted-foreground">
            Local mode — accounts live in this browser. Sign in as the platform
            operator to provision your institution from the dev console.
          </p>
        )}

        <p className="mt-8 text-center text-ui-2xs leading-relaxed text-muted-foreground">
          Institutions license SIMBLIP directly — there is no public sign-up.{' '}
          <Link href="/#pricing" className="underline underline-offset-2 hover:text-foreground">
            Licensing
          </Link>
          {' · '}Built by Rohan Singh
        </p>
      </div>
      </div>
    </div>
  )
}
