'use client'

// Header account chip. Signed out: a small email/password popover — plain
// Supabase auth, no OAuth provider to configure. Signed in: avatar + menu.
// Only rendered when Supabase is configured.

import { useState } from 'react'
import { LogIn, LogOut } from 'lucide-react'
import { signInWithEmail, signUpWithEmail, signOut, syncConfigured, useSyncStore } from '@/lib/sync/supabase'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function SignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (mode: 'in' | 'up') => {
    if (!email.trim() || password.length < 6) {
      setNotice('Enter your email and a password of 6+ characters.')
      return
    }
    setBusy(true)
    setNotice(null)
    const err = await (mode === 'in' ? signInWithEmail : signUpWithEmail)(email.trim(), password)
    setBusy(false)
    setNotice(err) // null on success — the popover just flips to the avatar
  }

  const field =
    'w-full rounded-md border border-input bg-background/60 px-2 py-1.5 text-[12.5px] outline-none focus:border-[var(--ring)]'

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        void submit('in')
      }}
    >
      <p className="text-[12px] font-semibold">Sync your notebooks</p>
      <input
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        aria-label="Email"
        className={field}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        aria-label="Password"
        className={field}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {notice && <p className="text-[11px] leading-snug text-[var(--accent-rose)]">{notice}</p>}
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-md bg-foreground px-2 py-1.5 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Sign in
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit('up')}
          className="flex-1 rounded-md border border-border px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-[var(--ring)] hover:text-foreground disabled:opacity-50"
        >
          Create account
        </button>
      </div>
    </form>
  )
}

export function AccountButton() {
  const user = useSyncStore((s) => s.user)
  if (!syncConfigured) return null

  if (!user) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:border-[var(--ring)] hover:text-foreground"
          >
            <LogIn className="h-3.5 w-3.5" />
            Sign in
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="glass-strong w-64 p-3">
          <SignInForm />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Account: ${user.email}`} className="rounded-full">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-blue)] text-[11px] font-bold text-primary-foreground">
            {(user.email || '?').charAt(0).toUpperCase()}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass-strong w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-[12.5px] font-medium">{user.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuItem onClick={() => void signOut()} className="gap-2 text-[12.5px]">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
