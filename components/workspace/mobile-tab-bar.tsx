'use client'

// Persistent bottom nav for the touch shell — Home / Notebooks /
// Assignments / More, always visible except inside the editor (full-bleed
// canvas, same as the old drawer collapsed away there). Assignments is a
// real route (/assignments); the other three are in-place views inside
// MobileShell — see mobile-tab.ts for how the active tab stays in sync
// across that route boundary.

import { useRouter, usePathname } from 'next/navigation'
import { BookOpen, ClipboardList, Home, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobileTabStore, type MobileTab } from '@/lib/store/mobile-tab'

const TABS: { id: MobileTab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'notebooks', label: 'Notebooks', icon: BookOpen },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'more', label: 'More', icon: MoreHorizontal },
]

export function MobileTabBar() {
  const router = useRouter()
  const pathname = usePathname()
  const tab = useMobileTabStore((s) => s.tab)
  const setTab = useMobileTabStore((s) => s.setTab)

  const go = (id: MobileTab) => {
    setTab(id)
    if (id === 'assignments' && pathname !== '/assignments') {
      router.push('/assignments')
    } else if (id !== 'assignments' && pathname !== '/notebook') {
      router.push('/notebook')
    }
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
              'flex flex-1 flex-col items-center justify-center gap-1',
              active ? 'text-[var(--accent-blue)]' : 'text-muted-foreground'
            )}
            onClick={() => go(id)}
          >
            <Icon className="h-[18px] w-[18px]" />
            <span className="text-[0.625rem] font-semibold">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
