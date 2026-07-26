'use client'

// Placeable interactive Button object.
// Executes actions ('set', 'toggle', 'step') on target page variables or component parameters when clicked.

import { useState } from 'react'
import { useDocStore } from '@/lib/store/document'
import { getNumber, getString, type ObjectRendererProps } from './types'
import { MousePointerClick } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getTargetValue, writeTargetValue } from '@/lib/scene/control-targets'

export function ButtonObject({ pageId, object }: ObjectRendererProps) {
  const [clicked, setClicked] = useState(false)
  const page = useDocStore((s) => s.pages[pageId])

  const label = getString(object, 'label', object.name || 'Button')
  const targetType = getString(object, 'targetType', 'variable')
  const targetObjectId = getString(object, 'targetObjectId', '')
  const targetParamName = getString(object, 'targetParamName', 'x')
  const actionType = getString(object, 'actionType', 'set')
  const targetValue = getNumber(object, 'targetValue', 1)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setClicked(true)
    setTimeout(() => setClicked(false), 200)

    if (!page || !targetParamName) return

    const currentVal = getTargetValue(page, targetType, targetObjectId, targetParamName, 0)

    let newVal = targetValue
    if (actionType === 'toggle') {
      newVal = currentVal > 0 ? 0 : 1
    } else if (actionType === 'step') {
      newVal = currentVal + targetValue
    }

    writeTargetValue(pageId, page, targetType, targetObjectId, targetParamName, newVal)
  }

  return (
    <div className="flex h-full w-full items-center justify-center rounded-xl border border-border/80 bg-card/90 p-2 shadow-sm backdrop-blur-md select-none">
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'flex h-full w-full items-center justify-center gap-2 rounded-lg border border-border bg-accent/60 px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition-all duration-150 active:scale-95 hover:bg-accent hover:border-[var(--accent-blue)]',
          clicked && 'scale-95 bg-[var(--accent-blue)] text-primary-foreground'
        )}
      >
        <MousePointerClick className="h-4 w-4 shrink-0 text-[var(--accent-blue)]" />
        <span className="truncate">{label}</span>
      </button>
    </div>
  )
}
