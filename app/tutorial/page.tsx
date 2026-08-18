'use client'

import { useNav } from '@/lib/use-nav'
import { useEffect } from 'react'

export default function TutorialPage() {
  const router = useNav()
  useEffect(() => {
    router.replace('/notebook')
  }, [router])

  return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <span className="text-[0.8125rem] tracking-wide text-muted-foreground">Redirecting to SIMBLIP Notebook...</span>
    </div>
  )
}
