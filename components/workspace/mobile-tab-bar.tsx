'use client'

// Persistent bottom nav for the touch shell — Home / Notebooks /
// Assignments / Shared / More, crafted in Google Material 3 / Pixel
// design language with animated active pills, tactile haptics, and
// fluid transitions.

import { useRouter, usePathname } from 'next/navigation'
import { motion as fm } from 'framer-motion'
import {
  ClipboardList,
  Compass,
  Home,
  LayoutGrid,
  Share2,
  Sparkles,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobileTabStore, type MobileTab } from '@/lib/store/mobile-tab'
import { useAuthStore } from '@/lib/auth/store'
import { haptic } from '@/lib/haptics'

const TABS: { id: MobileTab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'assignments', label: 'Tasks', icon: ClipboardList },
  { id: 'shared', label: 'Shared', icon: Share2 },
]

export function MobileTabBar() {
  const router = useRouter()
  const pathname = usePathname()
  const tab = useMobileTabStore((s) => s.tab)
  const setTab = useMobileTabStore((s) => s.setTab)
  const profile = useAuthStore((s) => s.profile)

  const go = (id: MobileTab) => {
    if (id !== tab) haptic('tick')
    setTab(id)
    if (pathname !== '/notebook') router.push('/notebook')
  }

  return (
    <nav
      className="relative z-40 flex h-[68px] shrink-0 items-center justify-around border-t border-border/40 bg-background/85 px-2 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 shadow-[0_-4px_24px_rgba(0,0,0,0.03)]"
      aria-label="Primary navigation"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = tab === id
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className="group relative flex flex-1 flex-col items-center justify-center py-1 transition-transform active:scale-95"
            onClick={() => go(id)}
          >
            <div className="relative flex h-8 w-16 items-center justify-center">
              {active && (
                <fm.div
                  layoutId="m3-active-tab-pill"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  className="absolute inset-0 rounded-full bg-[color-mix(in_oklch,var(--accent-blue)_18%,transparent)]"
                />
              )}
              <Icon
                className={cn(
                  'relative z-10 h-5 w-5 transition-all duration-200',
                  active
                    ? 'scale-110 text-[var(--accent-blue)] stroke-[2.25]'
                    : 'text-muted-foreground stroke-[1.75] group-hover:text-foreground'
                )}
              />
            </div>
            <span
              className={cn(
                'mt-0.5 text-[0.6875rem] font-semibold tracking-tight transition-colors duration-150',
                active ? 'text-[var(--accent-blue)] font-bold' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
          </button>
        )
      })}
      <button
        type="button"
        aria-label="Profile & settings"
        aria-current={tab === 'more' ? 'page' : undefined}
        className="group relative flex flex-1 flex-col items-center justify-center py-1 transition-transform active:scale-95"
        onClick={() => go('more')}
      >
        <div className="relative flex h-8 w-16 items-center justify-center">
          {tab === 'more' && (
            <fm.div
              layoutId="m3-active-tab-pill"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              className="absolute inset-0 rounded-full bg-[color-mix(in_oklch,var(--accent-blue)_18%,transparent)]"
            />
          )}
          <span
            className={cn(
              'relative z-10 flex h-5 w-5 items-center justify-center rounded-full text-[0.625rem] font-bold text-white shadow-xs transition-transform duration-200',
              tab === 'more'
                ? 'scale-110 bg-[var(--accent-blue)] ring-2 ring-[var(--accent-blue)]/30'
                : 'bg-muted-foreground/70'
            )}
          >
            {profile?.full_name?.charAt(0) || 'U'}
          </span>
        </div>
        <span
          className={cn(
            'mt-0.5 text-[0.6875rem] font-semibold tracking-tight transition-colors duration-150',
            tab === 'more' ? 'text-[var(--accent-blue)] font-bold' : 'text-muted-foreground'
          )}
        >
          More
        </span>
      </button>
    </nav>
  )
}

