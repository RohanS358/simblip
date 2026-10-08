'use client'
// Dev-only: a bare canvas seeded with circuit parts, to try pin-drag wiring.
import { useEffect, useState } from 'react'
import { InfiniteCanvas } from '@/components/workspace/canvas'
import { useDocStore } from '@/lib/store/document'
import { componentById } from '@/lib/scene/factory'

const PAGE = 'dev-wire'
export default function Wire() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const s = useDocStore.getState()
    s.ensurePage(PAGE)
    {
      useDocStore.getState().removeObjects(PAGE, Object.keys(useDocStore.getState().pages[PAGE]?.objects ?? {}))
      const add = (id: string, x: number, y: number) => {
        const o = componentById(id)!.create({ x, y })
        useDocStore.getState().addObject(PAGE, o)
      }
      add('battery', 120, 200)
      add('resistor', 360, 120)
      add('led', 360, 300)
      add('gnd', 600, 220)
      add('bjt', 520, 380)
    }
    setReady(true)
  }, [])
  return <div style={{ position: 'fixed', inset: 0 }}>{ready && <InfiniteCanvas pageId={PAGE} />}</div>
}
