// A one-function bridge so the inspector (a button on a picture) can ask the canvas (which owns the preview
// state) to read that picture. The canvas registers the handler while it is mounted.

type Handler = (pageId: string, objectId: string) => void
let handler: Handler | null = null

export const setPhotoReadHandler = (h: Handler | null): void => {
  handler = h
}

/** True when a canvas is listening. */
export const canReadPhoto = (): boolean => handler !== null

export const requestPhotoRead = (pageId: string, objectId: string): boolean => {
  if (!handler) return false
  handler(pageId, objectId)
  return true
}
