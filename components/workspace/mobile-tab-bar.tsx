'use client'

// Persistent bottom nav for the touch shell — Home / Notebooks /
// Assignments / Shared / More, always visible except inside the editor
// (full-bleed canvas). All five are in-place views inside MobileShell; none
// of them are separate routes.

import { useRouter, usePathname } from 'next/navigation'
import { BookOpen, ClipboardList, Home, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobileTabStore, type MobileTab } from '@/lib/store/mobile-tab'
import { useAuthStore } from '@/lib/auth/store'

const TABS: { id: MobileTab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'notebooks', label: 'Notebooks', icon: BookOpen },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'shared', label: 'Shared', icon: Share2 },
]

export function MobileTabBar() {
  const router = useRouter()
  const pathname = usePathname()
  const tab = useMobileTabStore((s) => s.tab)
  const setTab = useMobileTabStore((s) => s.setTab)
  const profile = useAuthStore((s) => s.profile)

  const go = (id: MobileTab) => {
    setTab(id)
    if (pathname !== '/notebook') router.push('/notebook')
  }

  return (
    <nav
      className="flex h-16 shrink-0 border-t border-border/50 bg-background pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = tab === id
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 transition-transform duration-100 ease-out active:scale-95',
              active ? 'text-[var(--accent-blue)]' : 'text-muted-foreground'
            )}
            onClick={() => go(id)}
          >
            <Icon className="h-[18px] w-[18px]" />
            <span className="text-[0.625rem] font-semibold">{label}</span>
          </button>
        )
      })}
      <button
        type="button"
        aria-label="Profile & settings"
        aria-current={tab === 'more' ? 'page' : undefined}
        className={cn(
          'flex flex-1 flex-col items-center justify-center gap-1 transition-transform duration-100 ease-out active:scale-95',
          tab === 'more' ? 'text-[var(--accent-blue)]' : 'text-muted-foreground'
        )}
        onClick={() => go('more')}
      >
        <span
          className={cn(
            'flex h-[18px] w-[18px] items-center justify-center rounded-full text-[0.5625rem] font-bold text-white',
            tab === 'more' ? 'bg-[var(--accent-blue)]' : 'bg-muted-foreground/60'
          )}
        >
          {profile?.full_name?.charAt(0) || 'U'}
        </span>
        <span className="text-[0.625rem] font-semibold">Profile</span>
      </button>
    </nav>
  )
}
