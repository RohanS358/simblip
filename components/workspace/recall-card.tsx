'use client'

// Recall: the flash card that is due, as a card that flips. Lives in the Note Gallery, with the rest of what belongs to the
// person rather than to the page. Front is the question (and a hint); a tap turns it over to the answer, then you say how
// it went and FSRS schedules the next one — deterministic, no model (docs/ai-plans §6.3).

import { useState } from 'react'
import { AnimatePresence, motion as fm } from 'framer-motion'
import { RotateCw } from 'lucide-react'
import { useLearner } from '@/lib/learning/store'
import type { Rating } from '@/lib/learning/fsrs'
import { cn } from '@/lib/utils'

const RATINGS: [Rating, string][] = [[1, 'Again'], [2, 'Hard'], [3, 'Good'], [4, 'Easy']]

export function RecallCard() {
  const cards = useLearner((s) => s.cards)
  const grade = useLearner((s) => s.grade)
  const [flipped, setFlipped] = useState(false)
  const now = Date.now()
  const total = Object.keys(cards).length
  const due = Object.values(cards).filter((c) => c.fsrs.due <= now).sort((a, b) => a.fsrs.due - b.fsrs.due)
  const card = due[0]
  if (total === 0) return null

  return (
    <section aria-label="Recall" className="mb-2 mt-1">
      <div className="mb-1 flex items-center justify-between px-1 text-ui-2xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>Recall</span>
        <span className="tabular-nums normal-case tracking-normal">{due.length} due · {total} saved</span>
      </div>
      {!card ? (
        <div className="rounded-xl border border-border/60 bg-card/60 px-3 py-4 text-center text-ui-xs text-muted-foreground">
          Nothing due. Saved cards come back when you are about to forget them.
        </div>
      ) : (
        // A flip is a turn about the vertical axis in two halves: edge-on, swap the face, turn back. It ends at the identity
        // transform, so the text is never left sitting in a 3-D layer where it would render soft.
        <div style={{ perspective: 800 }}>
          <AnimatePresence mode="wait" initial={false}>
            <fm.div
              key={`${card.id}-${flipped}`}
              initial={{ rotateY: 90 }}
              animate={{ rotateY: 0 }}
              exit={{ rotateY: -90 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className={cn(
                'rounded-xl border p-3 text-ui-sm shadow-sm',
                flipped
                  ? 'border-[color-mix(in_oklch,var(--accent-mint)_40%,transparent)] bg-[color-mix(in_oklch,var(--accent-mint)_8%,var(--card))]'
                  : 'border-border/60 bg-card'
              )}
            >
              {!flipped ? (
                <button type="button" onClick={() => setFlipped(true)} className="block w-full text-left" aria-label="Flip the card to see the answer">
                  <p className="font-medium">{card.front}</p>
                  {card.hint && <p className="mt-1 text-ui-xs text-muted-foreground">Hint: {card.hint}</p>}
                  <p className="mt-2 flex items-center gap-1 text-ui-2xs text-muted-foreground"><RotateCw className="h-3 w-3" /> Tap to flip</p>
                </button>
              ) : (
                <>
                  <p className="text-ui-2xs uppercase tracking-wide text-muted-foreground">Answer</p>
                  <p className="mt-0.5">{card.back}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {RATINGS.map(([r, label]) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => { grade(card.id, r, 'recall'); setFlipped(false) }}
                        className="rounded-full border border-border/70 px-2.5 py-0.5 text-ui-xs transition-colors hover:bg-accent"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </fm.div>
          </AnimatePresence>
        </div>
      )}
    </section>
  )
}
