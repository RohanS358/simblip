'use client'

// Placeable interactive Slider object.
// Binds to page variables or target object parameters in real time.
// Updates values live as the slider thumb moves.

import { useDocStore } from '@/lib/store/document'
import { getNumber, getString, type ObjectRendererProps } from './types'
import { Slider as UISlider } from '@/components/ui/slider'
import { Sliders } from 'lucide-react'
import { getTargetValue, writeTargetValue } from '@/lib/scene/control-targets'

export function SliderObject({ pageId, object }: ObjectRendererProps) {
  const page = useDocStore((s) => s.pages[pageId])

  const label = getString(object, 'label', object.name || 'Slider')
  const targetType = getString(object, 'targetType', 'variable')
  const targetObjectId = getString(object, 'targetObjectId', '')
  const targetParamName = getString(object, 'targetParamName', 'x')
  const min = getNumber(object, 'min', 0)
  const max = getNumber(object, 'max', 100)
  const step = getNumber(object, 'step', 1)

  const defaultValue = (min + max) / 2
  const sliderSelfVal = getNumber(object, 'value', defaultValue)
  const currentValue = getTargetValue(page, targetType, targetObjectId, targetParamName, sliderSelfVal)

  const handleChange = (val: number) => {
    // Write value to slider self
    useDocStore.getState().updateObjectParameter(pageId, object.id, 'value', val)
    // Write to target variable, spatial property, behavior param, or object param
    writeTargetValue(pageId, page, targetType, targetObjectId, targetParamName, val)
  }

  return (
    <div className="flex h-full w-full flex-col justify-between rounded-xl border border-border/80 bg-card/90 p-3 shadow-sm backdrop-blur-md select-none">
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <div className="flex items-center gap-1.5 font-medium text-foreground min-w-0">
          <Sliders className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
          <span className="truncate">{label}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            ({targetParamName || 'unbound'})
          </span>
        </div>
        <span className="font-mono text-[12px] font-bold text-[var(--accent-blue)]">
          {Number.isFinite(currentValue) ? Number(currentValue.toFixed(2)) : 0}
        </span>
      </div>

      <div className="my-auto pt-1">
        <UISlider
          value={[Number.isFinite(currentValue) ? currentValue : min]}
          min={min}
          max={max > min ? max : min + 1}
          step={step > 0 ? step : 1}
          onValueChange={([v]) => handleChange(v)}
          className="cursor-pointer"
        />
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground/80">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
