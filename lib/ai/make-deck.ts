'use client'

// An AI answer becomes a real .pptx-kind page: the SAME SceneObject[]-per-slide
// shape AddPageDialog's own templates use, so the deck edits, exports and runs
// Present mode exactly like a hand-built one. Lands beside the page you are on.
// Shared by the chat panel's "Make slides" and the slides.* tools.

import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { blocksToSlides, deckTitle } from '@/lib/ai/slides'
import { toAnswerBlocks, type AnswerBlock } from '@/lib/ai/explain'

export function createDeck(
  anchorPageId: string | null,
  blocks: AnswerBlock[],
  prompt: string
): { id: string; slides: number; title: string } | null {
  const ws = useWorkspaceStore.getState()
  const parentId = anchorPageId ? ws.nodes[anchorPageId]?.parentId : null
  if (!parentId || blocks.length === 0) return null
  // Named after the deck's subject, not the request.
  const title = deckTitle(blocks.map((b) => b.content).join('\n\n'), prompt) || 'Untitled Presentation'
  const id = ws.addPageIn(parentId, title, 'pptx')
  const slides = blocksToSlides(blocks, prompt)
  for (const objects of slides) {
    const slideId = useWorkspaceStore.getState().addDocSheet(id)
    for (const obj of objects) useDocStore.getState().addObject(slideId, obj)
  }
  return { id, slides: slides.length, title }
}

export const createDeckFromMarkdown = (anchorPageId: string | null, markdown: string, prompt: string) =>
  createDeck(anchorPageId, toAnswerBlocks(markdown), prompt)
