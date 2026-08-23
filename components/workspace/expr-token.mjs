// Caret math for expression autocomplete. Plain .mjs on purpose: this is the
// part with real edge cases, and the repo has no TS-aware test runner — so
// the tests import THIS file, and expr-scope.ts re-exports it. One source of
// truth, actually tested, instead of a hand-mirrored copy that drifts.

/**
 * The token the user is currently typing, if any.
 *
 * Two token shapes, both looking BACKWARDS from the caret:
 *   • an unclosed `[` — `2*[volt` is a live query for "volt", while
 *     `2*[A(V)] + ` is not a query at all (that bracket closed);
 *   • a bare word — `2*vol` queries "vol" too.
 * Returns null when the caret isn't inside either.
 */
export function activeToken(text, caret) {
  const before = text.slice(0, caret)
  const open = before.lastIndexOf('[')
  // A `]` after the last `[` means that token is finished, not being typed.
  if (open !== -1 && before.indexOf(']', open) === -1) {
    return { start: open, query: before.slice(open + 1) }
  }
  // A bare word is just as much a query as `[word` — requiring the bracket
  // meant you had to already know the syntax to search for anything, which
  // is the discovery failure this whole feature exists to fix.
  //
  // It must START with a letter, so a number is never a query: typing `9.81`
  // into a numeric field must stay a plain number with no popover.
  const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)
  return word ? { start: word.index, query: word[0] } : null
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

/** How well an item answers `q`. Lower is better; the list is rendered in
 *  this order and row 0 is what Enter picks, so this IS "the best match". */
function rank(item, q) {
  const name = (item.label ?? '').toLowerCase()
  if (name === q) return 0
  if (name.startsWith(q)) return 1
  if (item.search.startsWith(q)) return 2
  return 3
}

/** Plain substring filter — predictable beats clever for a 10-row list —
 *  ordered so the closest name lands first. Array#sort is stable, so equally
 *  ranked items keep scopeItems' variables-before-channels order. */
export function filterScope(items, query) {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) => i.search.includes(q)).sort((a, b) => rank(a, q) - rank(b, q))
}
