// Every font the picker OFFERS must actually render as something distinct —
// the bug this guards is a font appearing in the menu, being selectable, and
// then doing nothing because its whole stack was families the machine does
// not have ("web-safe" is a Windows/macOS assumption).
//
// Run: node lib/text/fonts.test.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const marks = readFileSync(new URL('./marks.ts', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../../app/layout.tsx', import.meta.url), 'utf8')
// --font-sans / --font-mono are Tailwind theme tokens defined in CSS rather
// than next/font variables, so both sources count as "defined".
const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')

/** Pulls a `key: 'value',` block out of a TS object literal by name. */
function objectBlock(src, name) {
  const start = src.indexOf(`export const ${name}`)
  assert.notEqual(start, -1, `${name} not found`)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error(`unterminated ${name}`)
}

const fontsBlock = objectBlock(marks, 'TEXT_FONTS')

/** key -> stack, ignoring comment lines. */
const stacks = new Map()
for (const line of fontsBlock.split('\n')) {
  const m = line.match(/^\s*([A-Za-z][A-Za-z0-9]*):\s*'([^']+)',/)
  if (m) stacks.set(m[1], m[2])
}
assert.ok(stacks.size >= 27, `expected the full font list, got ${stacks.size}`)

// Every font in the picker's groups must exist in TEXT_FONTS and have a label.
{
  const groups = marks.slice(marks.indexOf('export const FONT_GROUPS'))
  const keys = [...groups.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1])
  const offered = keys.filter((k) => stacks.has(k))
  assert.ok(offered.length >= 27, 'FONT_GROUPS should offer every defined font')
  for (const k of offered) {
    assert.ok(stacks.get(k).length > 0, `${k} has an empty stack`)
  }
}

// THE REGRESSION: a stack made only of families that may not be installed,
// ending in a generic keyword, renders as the generic and the font silently
// does nothing. Every such stack must name a loaded webfont (a --font-* var)
// or an app font.
{
  const GENERIC = new Set(['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui'])
  const offenders = []
  for (const [key, stack] of stacks) {
    if (stack.includes('var(--font-')) continue // backed by a loaded webfont
    // Everything else must be composed ONLY of generics to be honest about
    // what it renders as; any named family here is a machine-dependent bet.
    const named = stack
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''))
      .filter((s) => !GENERIC.has(s))
    if (named.length > 0) offenders.push(`${key}: ${stack}`)
  }
  assert.deepEqual(
    offenders,
    [],
    'these fonts rely on families that may not be installed, with no webfont fallback:\n  ' +
      offenders.join('\n  ')
  )
}

// Every --font-* variable referenced by a stack must actually be defined in
// the layout, or the reference is inert and we are back to the generic.
{
  const referenced = new Set([...fontsBlock.matchAll(/var\((--font-[a-z0-9-]+)\)/g)].map((m) => m[1]))
  assert.ok(referenced.size > 0, 'expected webfont-backed stacks')
  for (const v of referenced) {
    assert.ok(
      layout.includes(`variable: '${v}'`) || css.includes(`${v}:`),
      `${v} is used in a font stack but is neither loaded in app/layout.tsx nor defined in globals.css`
    )
  }
}

// Every loaded font variable must be applied to <body>, or the var resolves
// to nothing at runtime even though the font was defined.
{
  const defined = [...layout.matchAll(/const (\w+) = \w+\(\{[^}]*variable: '(--font-[a-z0-9-]+)'/g)]
  assert.ok(defined.length >= 19, `expected the full font set, got ${defined.length}`)
  const bodyStart = layout.indexOf('<body className={[')
  const body = layout.slice(bodyStart, layout.indexOf(']', bodyStart))
  for (const [, ident] of defined) {
    assert.ok(body.includes(`${ident}.variable`), `${ident} is loaded but not applied to <body>`)
  }
}

// Widening a stack orphans documents saved with the OLD string, because the
// exporters recover a font id by exact-matching the stack. Every legacy stack
// must still map to a real font id.
{
  const legacy = objectBlock(marks, 'LEGACY_FONT_STACKS')
  const pairs = [...legacy.matchAll(/'([^']+)':\s*'([A-Za-z][A-Za-z0-9]*)'/g)]
  assert.ok(pairs.length >= 17, `expected every changed stack listed, got ${pairs.length}`)
  for (const [, stack, id] of pairs) {
    assert.ok(stacks.has(id), `legacy stack maps to unknown font id "${id}"`)
    assert.notEqual(stack, stacks.get(id), `${id}'s legacy stack equals its current one — drop it`)
  }
  // Each web-safe font whose stack we widened must have a legacy entry.
  const ids = new Set(pairs.map((p) => p[2]))
  for (const key of ['arial', 'impact', 'timesNewRoman', 'courier', 'papyrus', 'comic']) {
    assert.ok(ids.has(key), `${key}'s stack changed but has no LEGACY_FONT_STACKS entry`)
  }
}

console.log(`fonts: all checks passed (${stacks.size} fonts)`)
