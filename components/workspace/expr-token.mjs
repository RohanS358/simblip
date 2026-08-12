// Caret math for expression autocomplete. Plain .mjs on purpose: this is the
// part with real edge cases, and the repo has no TS-aware test runner — so
// the tests import THIS file, and expr-scope.ts re-exports it. One source of
// truth, actually tested, instead of a hand-mirrored copy that drifts.

/**
 * The token the user is currently typing, if any.
 *
 * Autocomplete opens on `[` and stays open while they narrow it down. We look
 * BACKWARDS from the caret for an unclosed `[` — so `2*[volt` is a live query
 * for "volt", while `2*[A(V)] + ` is not a query at all (that bracket closed).
 * Returns null when the caret isn't inside a token.
 */
export function activeToken(text, caret) {
  const before = text.slice(0, caret)
  const open = before.lastIndexOf('[')
  if (open === -1) return null
  // A `]` after the last `[` means that token is finished, not being typed.
  if (before.indexOf(']', open) !== -1) return null
  return { start: open, query: before.slice(open + 1) }
}

/**
 * Splice a picked item into the expression.
 *
 * Two paths, because the user arrives two ways:
 *   • mid-token (`2*[vol` + pick) → the partial token is REPLACED
 *   • from the chip button (no token) → inserted at the caret, and if the
 *     expression is empty or a placeholder `0`, it replaces that outright
 *     rather than producing `0[A(V)]`.
 *
 * The old Insert button always appended ` * token`, which guessed at
 * multiplication — right for a coefficient, wrong for everything else, and
 * silently unfixable if you didn't know the syntax. Inserting exactly what
 * was asked for and leaving the caret after it lets the user type their own
 * operator, which is the only thing that's always correct.
 */
export function spliceItem(text, caret, item) {
  const token = activeToken(text, caret)
  if (token) {
    const next = text.slice(0, token.start) + item.insert + text.slice(caret)
    return { text: next, caret: token.start + item.insert.length }
  }
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === '0') {
    return { text: item.insert, caret: item.insert.length }
  }
  const next = text.slice(0, caret) + item.insert + text.slice(caret)
  return { text: next, caret: caret + item.insert.length }
}

/** Plain substring filter — predictable beats clever for a 10-row list. */
export function filterScope(items, query) {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) => i.search.includes(q))
}
