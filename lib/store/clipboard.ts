// In-memory copy/paste clipboard — deliberately a plain module, not part of
// useDocStore: it must survive Canvas unmounting/remounting as the user
// switches pages (copy on page A, paste on page B), but has no reason to
// persist across a reload or sync anywhere (same "session-only" scope as
// undo history).

import type { SceneObject } from '@/lib/scene/types'

let clipboard: SceneObject[] = []
let pasteCount = 0
let sourcePageId: string | null = null
let writtenText: string | null = null

/** Remember the page copied from and the text mirrored to the OS clipboard,
 * so a later paste can tell "our own copy" from foreign clipboard text. */
export function noteCopyOrigin(pageId: string, text: string) {
  sourcePageId = pageId
  writtenText = text
}

export function getSourcePageId(): string | null {
  return sourcePageId
}

/** True when the OS clipboard still holds exactly what our last copy wrote. */
export function isOwnText(text: string): boolean {
  return writtenText !== null && text === writtenText
}

export function setClipboard(objects: SceneObject[]) {
  clipboard = objects.map((o) => JSON.parse(JSON.stringify(o)) as SceneObject)
  pasteCount = 0
}

export function getClipboard(): SceneObject[] {
  return clipboard
}

export function hasClipboard(): boolean {
  return clipboard.length > 0
}

/** Each successive paste (without re-copying) nudges further, the same way
 * repeated pastes in most editors avoid stacking exact duplicates. */
export function nextPasteOffset(): number {
  pasteCount += 1
  return pasteCount * 24
}
