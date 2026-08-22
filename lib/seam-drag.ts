/**
 * Pointer drag for resize seams (sidebar width, pane splits).
 *
 * The point: a resize drag must NOT re-render React on every pointermove.
 * Committing to state (or worse, to the zustand workspace store) 100×/second
 * re-renders every canvas under the seam and the drag visibly lags the
 * cursor. So `preview` does raw DOM writes, coalesced to one per animation
 * frame, and `commit` runs exactly once on pointerup.
 */
export function startSeamDrag(
  e: React.PointerEvent,
  compute: (ev: { clientX: number; clientY: number }) => number,
  preview: (v: number) => void,
  commit: (v: number) => void,
  cursor: 'col-resize' | 'row-resize' = 'col-resize'
) {
  e.preventDefault()
  let latest = compute(e.nativeEvent)
  let raf = 0
  const flush = () => {
    raf = 0
    preview(latest)
  }
  const move = (ev: PointerEvent) => {
    latest = compute(ev)
    if (!raf) raf = requestAnimationFrame(flush)
  }
  const up = () => {
    if (raf) cancelAnimationFrame(raf)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    commit(latest)
  }
  // Keep the resize cursor and kill text selection for the whole gesture —
  // otherwise both flicker as the pointer crosses the panes.
  document.body.style.cursor = cursor
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
