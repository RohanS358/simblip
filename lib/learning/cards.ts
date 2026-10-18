// Card shape + the card lint (docs/ai-plans §6.2 "rules that make cards good").
import { newFsrs, type Fsrs } from './fsrs'

export type CardType = 'basic' | 'cloze' | 'predict' | 'diagram' | 'derive'

export interface Card {
  id: string
  conceptId: string
  type: CardType
  front: string
  back: string
  hint?: string
  /** Deep link: "see it again" opens the simulation / lesson. */
  link?: { pageId?: string; objectIds?: string[]; lessonId?: string; sectionId?: string }
  mnemonic?: string
  fsrs: Fsrs
  createdBy: 'ai' | 'user'
}

const PRONOUN_START = /^(?:it|this|that|they|these|those|he|she)\b/i

/** Problems that make a card useless months later. Empty array = good. */
export function lintCard(c: Pick<Card, 'type' | 'front' | 'back' | 'link'>): string[] {
  const out: string[] = []
  const front = c.front.trim()
  if (front.length < 8) out.push('front is too short to be a question')
  if (!c.back.trim()) out.push('back is empty')
  if (PRONOUN_START.test(front)) out.push('front starts with a pronoun with no referent — name the thing')
  if (c.type === 'cloze' && !/\[[^\]]+\]/.test(front)) out.push('cloze card needs a [blank] in the front')
  if (c.type === 'predict' && !c.link?.pageId) out.push('predict card must link to its simulation')
  if ((front.match(/\?/g) ?? []).length > 1) out.push('more than one question — one fact per card')
  return out
}

export const makeCard = (c: Omit<Card, 'fsrs' | 'id' | 'createdBy'> & { createdBy?: Card['createdBy'] }, id: string, now: number): Card => ({
  createdBy: 'ai',
  ...c,
  id,
  fsrs: newFsrs(now),
})

/** Maximum new cards per session — avoids review debt across five subjects. */
export const MAX_NEW_PER_SESSION = 12
