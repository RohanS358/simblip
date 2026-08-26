// The timing core of RichTextArea's debounced persistence
// (components/objects/text.tsx), extracted so it can be tested without a
// React harness. The component holds pendingRef/timerRef in refs and calls
// exactly these two operations.
//
// The invariant that matters: NO KEYSTROKE IS EVER LOST. A burst of edits
// collapses into one write, but the write always carries the LAST value, and
// a flush on the way out (blur, leave-edit-mode, unmount) commits whatever
// is still pending.

export function createCommitter(write, delay = 250, timers = globalThis) {
  let pending = null
  let timer = null

  function flush() {
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
    const next = pending
    pending = null
    // null means nothing outstanding — flushing twice must not re-write.
    if (next !== null) write(next)
  }

  function queue(next) {
    pending = next
    if (timer !== null) timers.clearTimeout(timer)
    timer = timers.setTimeout(flush, delay)
  }

  return { queue, flush, get pending() { return pending } }
}
