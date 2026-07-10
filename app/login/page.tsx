'use client'

// Sign in. There is deliberately no sign-up path: SIMBLIP is licensed to
// institutions, and accounts are provisioned by the institution admin.
// In local demo mode the seeded tenant's accounts are offered as one-click
// chips so every role can be explored instantly.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GraduationCap, Loader2, Lock, Mail, MonitorPlay, ShieldCheck, UserRound } from 'lucide-react'
import { useAuthStore } from '@/lib/auth/store'
import { homeFor } from '@/lib/auth/types'
import { cloudConfigured } from '@/lib/data/db'
import { DEMO_INSTITUTION } from '@/lib/auth/demo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const DEMO_CHIPS = [
  { email: 'admin@demo.edu', password: 'admin', label: 'Admin', icon: ShieldCheck },
  { email: 'teacher@demo.edu', password: 'teacher', label: 'Teacher', icon: GraduationCap },
  { email: 'student@demo.edu', password: 'student', label: 'Student', icon: UserRound },
  { email: 'board-201@demo.edu', password: 'board201', label: 'Room 201 Board', icon: MonitorPlay },
]

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
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-[22px] font-extrabold tracking-tight">
            SIM<span className="text-[var(--accent-blue)]">BLIP</span>
          </span>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            The engineering education platform for institutions.
            <br />
            Sign in with the account your institution issued you.
          </p>
        </div>

        <form
          className="glass space-y-4 rounded-2xl p-5"
          onSubmit={(e) => {
            e.preventDefault()
            void signIn(email, password)
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-[12px]">
              Email
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                className="pl-8"
                placeholder="you@institution.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-[12px]">
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
            <p role="alert" className="text-[12px] leading-relaxed text-[var(--accent-rose)]">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
          </Button>

          <p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
            Forgot your password? Ask your institution admin to reset it.
          </p>
        </form>

        {!cloudConfigured && (
          <div className="mt-6">
            <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Demo tenant — {DEMO_INSTITUTION.name}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_CHIPS.map((chip) => (
                <button
                  key={chip.email}
                  type="button"
                  disabled={busy}
                  className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-medium transition-colors hover:bg-accent"
                  onClick={() => void signIn(chip.email, chip.password)}
                >
                  <chip.icon className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-8 text-center text-[11px] leading-relaxed text-muted-foreground">
          Institutions license SIMBLIP directly — there is no public sign-up.{' '}
          <Link href="/#pricing" className="underline underline-offset-2 hover:text-foreground">
            Licensing
          </Link>
          {' · '}Built by Rohan Singh
        </p>
      </div>
    </div>
  )
}
