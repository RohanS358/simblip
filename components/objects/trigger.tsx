'use client'

// Placeable interactive Trigger object.
// Evaluates condition operators against target monitored source values and fires target actions.

import { useEffect, useRef } from 'react'
import { useDocStore } from '@/lib/store/document'
import { getNumber, getString, type ObjectRendererProps } from './types'
import { Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getTargetValue, writeTargetValue } from '@/lib/scene/control-targets'

export function TriggerObject({ pageId, object }: ObjectRendererProps) {
  const page = useDocStore((s) => s.pages[pageId])
  const prevTriggered = useRef(false)

  const label = getString(object, 'label', object.name || 'Trigger')
  const sourceType = getString(object, 'sourceType', 'variable')
  const sourceObjectId = getString(object, 'sourceObjectId', '')
  const sourceParamName = getString(object, 'sourceParamName', 'x')
  const condition = getString(object, 'condition', '>')
  const threshold = getNumber(object, 'threshold', 50)

  const targetType = getString(object, 'targetType', 'variable')
  const targetObjectId = getString(object, 'targetObjectId', '')
  const targetParamName = getString(object, 'targetParamName', 'y')
  const actionType = getString(object, 'actionType', 'toggle')
  const targetValue = getNumber(object, 'targetValue', 1)

  const sourceVal = getTargetValue(page, sourceType, sourceObjectId, sourceParamName, 0)

  let isTriggered = false
  switch (condition) {
    case '==':
      isTriggered = sourceVal === threshold
      break
    case '>':
      isTriggered = sourceVal > threshold
      break
    case '<':
      isTriggered = sourceVal < threshold
      break
    case '>=':
      isTriggered = sourceVal >= threshold
      break
    case '<=':
      isTriggered = sourceVal <= threshold
      break
    case '!=':
      isTriggered = sourceVal !== threshold
      break
    default:
      isTriggered = sourceVal > threshold
  }

  // Fire action on transition from false -> true
  useEffect(() => {
    if (isTriggered && !prevTriggered.current) {
      if (page && targetParamName) {
        const currentTargetVal = getTargetValue(page, targetType, targetObjectId, targetParamName, 0)
        let newVal = targetValue
        if (actionType === 'toggle') {
          newVal = currentTargetVal > 0 ? 0 : 1
        }
        writeTargetValue(pageId, page, targetType, targetObjectId, targetParamName, newVal)
      }
    }
    prevTriggered.current = isTriggered
  }, [isTriggered, page, targetType, targetObjectId, targetParamName, actionType, targetValue, pageId])

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col justify-between rounded-xl border p-2.5 shadow-sm backdrop-blur-md select-none transition-colors duration-200',
        isTriggered
          ? 'border-[var(--accent-amber)] bg-[var(--accent-amber)]/15 text-foreground'
          : 'border-border/80 bg-card/90 text-muted-foreground'
      )}
    >
      <div className="flex items-center justify-between gap-1.5 text-[11.5px]">
        <div className="flex items-center gap-1.5 font-medium truncate">
          <Zap
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform',
              isTriggered ? 'text-[var(--accent-amber)] scale-110' : 'text-muted-foreground'
            )}
          />
          <span className="truncate">{label}</span>
        </div>
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide',
            isTriggered
              ? 'bg-[var(--accent-amber)] text-black'
              : 'bg-accent/80 text-muted-foreground'
          )}
        >
          {isTriggered ? 'ACTIVE' : 'IDLE'}
        </span>
      </div>

      <div className="my-auto font-mono text-[10.5px] leading-tight opacity-90 truncate">
        <span className="font-semibold text-foreground">{sourceParamName || 'src'}</span> {condition} {threshold}
      </div>

      <div className="flex items-center justify-between border-t border-border/40 pt-1 text-[9.5px] font-mono opacity-75">
        <span>val: {Number.isFinite(sourceVal) ? Number(sourceVal.toFixed(2)) : 0}</span>
        <span className="truncate">→ {targetParamName || 'target'}</span>
      </div>
    </div>
  )
}
