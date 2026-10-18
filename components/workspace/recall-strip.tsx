'use client'

// Learn / Answer switch and the flash-card review, in the AI panel.
// Learn = hint ladder on (never the bare answer first); Answer = direct, for
// teachers and last-minute checks. The mode is explicit, never inferred
// (docs/ai-plans §6.3). Review is deterministic: FSRS schedules, no model.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLearner } from '@/lib/learning/store'
import type { Rating } from '@/lib/learning/fsrs'
import { segmentedTab, segmentedTrack } from './panel-header'

const RATINGS: [Rating, string][] = [[1, 'Again'], [2, 'Hard'], [3, 'Good'], [4, 'Easy']]

export function RecallStrip() {
  const mode = useLearner((s) => s.prefs.mode)
  const setPrefs = useLearner((s) => s.setPrefs)
  const cards = useLearner((s) => s.cards)
  const grade = useLearner((s) => s.grade)
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)
  const now = Date.now()
  const due = Object.values(cards).filter((c) => c.fsrs.due <= now).sort((a, b) => a.fsrs.due - b.fsrs.due)
  const total = Object.keys(cards).length
  const card = due[0]

  return (
    <div className="mb-1.5 flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <div className={cn(segmentedTrack(2), 'w-fit shrink-0')}>
          {(['learn', 'answer'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              title={m === 'learn' ? 'Learn — hints first, never the bare answer' : 'Answer — direct answers'}
              onClick={() => setPrefs({ mode: m })}
              className={segmentedTab(mode === m)}
            >
              {m === 'learn' ? 'Learn' : 'Answer'}
            </button>
          ))}
        </div>
        {total > 0 && (
          <Button size="sm" variant="ghost" className="h-7 text-ui-xs" aria-expanded={open} onClick={() => { setOpen(!open); setShown(false) }}>
            Recall · {due.length} due
          </Button>
        )}
      </div>
      {open && (
        <div className="rounded-lg border border-border/60 bg-card/60 p-2.5 text-ui-sm" role="region" aria-label="Flash card review">
          {!card ? (
            <p className="text-muted-foreground">Nothing due. {total} card{total === 1 ? '' : 's'} saved — they come back when you are about to forget them.</p>
          ) : (
            <>
              <p className="font-medium">{card.front}</p>
              {card.hint && !shown && <p className="mt-1 text-ui-xs text-muted-foreground">Hint: {card.hint}</p>}
              {shown ? (
                <>
                  <p className="mt-2 text-muted-foreground">{card.back}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {RATINGS.map(([r, label]) => (
                      <Button key={r} size="sm" variant="outline" className="h-7 text-ui-xs" onClick={() => { grade(card.id, r, 'recall'); setShown(false) }}>
                        {label}
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <Button size="sm" className="mt-2 h-7 text-ui-xs" onClick={() => setShown(true)}>Show answer</Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
