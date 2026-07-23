'use client'

// GSAP scroll choreography for the landing page. Declarative: mark any
// element with a data-fx attribute and it animates when scrolled into view.
//
//   data-fx="rise"    — the element rises and fades in
//   data-fx="domino"  — its CHILDREN rise in one after another
//   data-fx="hero"    — its children cascade on first paint (no scroll)

import { useEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

export function ScrollFx({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-fx="hero"]').forEach((el) => {
        gsap.from(el.children, {
          y: 36,
          opacity: 0,
          duration: 0.9,
          ease: 'power3.out',
          stagger: 0.12,
        })
      })
      gsap.utils.toArray<HTMLElement>('[data-fx="rise"]').forEach((el) => {
        gsap.from(el, {
          y: 56,
          opacity: 0,
          duration: 0.9,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 86%' },
        })
      })
      gsap.utils.toArray<HTMLElement>('[data-fx="domino"]').forEach((el) => {
        gsap.from(el.children, {
          y: 28,
          opacity: 0,
          duration: 0.6,
          ease: 'power3.out',
          stagger: 0.08,
          scrollTrigger: { trigger: el, start: 'top 80%' },
        })
      })
    })
    return () => ctx.revert()
  }, [])

  return <>{children}</>
}
