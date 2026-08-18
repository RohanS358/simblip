'use client'

// Global route-transition overlay. Next's app/loading.tsx only covers the
// initial server render of a segment — a client-side navigation into a page
// that then fetches its own data leaves the old screen frozen with no
// feedback, which reads as "stuck". This watches for a navigation starting
// and paints the bounce loader until the URL actually changes.
//
// Starts are picked up two ways: any click on an internal <a href> (covers
// every next/link), and startRouteLoading() for programmatic router.push
// call sites. Clears on pathname/search change, plus a failsafe timeout so a
// cancelled navigation can never strand the overlay.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

import { BounceLoader } from '@/components/ui/bounce-loader'

const EVENT = 'simblip:route-start'
const DELAY = 300 // don't flash on navigations that resolve instantly
const FAILSAFE = 12_000

/** Call right before a programmatic router.push/replace to a new page. */
export function startRouteLoading() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

/**
 * Does clicking this anchor start an in-app route change? Pure so it can be
 * exercised without a DOM — see route-loader.test.mjs.
 */
export function isRouteNav(
  href: string | null | undefined,
  here: string,
  opts: { target?: string; download?: boolean } = {},
): boolean {
  if (!href) return false
  if (opts.download) return false
  if (opts.target && opts.target !== '_self') return false
  if (/^(#|mailto:|tel:|javascript:|blob:|data:)/i.test(href)) return false
  let url: URL
  try {
    url = new URL(href, here)
  } catch {
    return false
  }
  const cur = new URL(here)
  if (url.origin !== cur.origin) return false
  return url.pathname !== cur.pathname || url.search !== cur.search
}

export function RouteLoader() {
  const pathname = usePathname()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let show = 0
    let fail = 0

    const start = () => {
      window.clearTimeout(show)
      window.clearTimeout(fail)
      show = window.setTimeout(() => setPending(true), DELAY)
      fail = window.setTimeout(() => setPending(false), FAILSAFE)
    }

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement | null)?.closest?.('a')
      if (!a) return
      if (isRouteNav(a.getAttribute('href'), location.href, { target: a.target, download: a.hasAttribute('download') })) {
        start()
      }
    }

    document.addEventListener('click', onClick, true)
    window.addEventListener(EVENT, start)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener(EVENT, start)
      window.clearTimeout(show)
      window.clearTimeout(fail)
    }
  }, [])

  // The destination rendered — whatever we were waiting for has arrived.
  useEffect(() => {
    setPending(false)
  }, [pathname])

  if (!pending) return null

  return (
    <div className="canvas-dots animate-in fade-in-0 fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-background duration-150 [background-size:24px_24px]">
      <BounceLoader size={240} />
      <span className="text-[15px] font-extrabold tracking-tight">
        SIM<span className="text-[var(--accent-blue)]">BLIP</span>
      </span>
      <span className="text-[11px] tracking-wide text-muted-foreground">loading…</span>
    </div>
  )
}
