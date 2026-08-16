'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function TutorialPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/notebook')
  }, [router])

  return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <span className="text-[0.8125rem] tracking-wide text-muted-foreground">Redirecting to SIMBLIP Notebook...</span>
    </div>
  )
}
