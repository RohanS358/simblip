'use client'

// What an expression field can offer as autocomplete.
//
// The Variables panel used to be the ONLY place you could discover that a
// parameter accepts more than a number: it held the prose explaining the
// [Name(channel)] syntax and the one button that could write it. That put
// discovery in the wrong room — a user editing a Mass wants THAT field to
// follow something, and will never go build a variable first.
//
// So the knowledge moves here, where any ExprInput can reach it. The caret
// math lives in ./expr-token.mjs so it can be tested without a TS runner.

import { bindableObjects, channelOptions } from '@/lib/scene/bindings'
import { CHANNEL_LABELS } from '@/lib/scene/channels'
import type { SceneObject, Variable } from '@/lib/scene/types'
// Plain .mjs sibling so the caret math stays testable without a TS runner.
import {
  activeToken as _activeToken,
  spliceItem as _spliceItem,
  filterScope as _filterScope,
} from './expr-token.mjs'

export interface ScopeItem {
  /** Text spliced into the expression — `g` or `[Voltmeter 1(V)]`. */
  insert: string
  /** What the row shows as its name. */
  label: string
  /** Right-hand hint: a variable's value, a channel's unit. */
  hint: string
  kind: 'variable' | 'channel'
  /** Lowercased haystack for filtering — label plus hint. */
  search: string
}

export interface Splice {
  /** The full expression after inserting. */
  text: string
  /** Where the caret belongs afterwards. */
  caret: number
}

export const activeToken = _activeToken as (
  text: string,
  caret: number
) => { start: number; query: string } | null

export const spliceItem = _spliceItem as (
  text: string,
  caret: number,
  item: ScopeItem
) => Splice

export const filterScope = _filterScope as (items: ScopeItem[], query: string) => ScopeItem[]

/**
 * Everything nameable on this page, variables first.
 *
 * Variables lead because they're the user's own vocabulary; live channels
 * follow. A page with neither yields [] and the field silently stays a plain
 * number box — no empty popover, no dead affordance.
 */
export function scopeItems(
  variables: readonly Variable[],
  objects: readonly SceneObject[]
): ScopeItem[] {
  const items: ScopeItem[] = variables.map((v) => ({
    insert: v.name,
    label: v.name,
    hint: v.error ? '—' : String(+v.value.toFixed(3)),
    kind: 'variable' as const,
    search: v.name.toLowerCase(),
  }))

  for (const o of bindableObjects(objects as SceneObject[])) {
    for (const c of channelOptions(o)) {
      const hint = CHANNEL_LABELS[c] ?? c
      items.push({
        insert: `[${o.name}(${c})]`,
        label: `${o.name} · ${c}`,
        hint,
        kind: 'channel',
        // Both halves searchable: "volt" finds the object, "current" the unit.
        search: `${o.name} ${c} ${hint}`.toLowerCase(),
      })
    }
  }

  // Two objects can carry the same name (duplicate a BJT and you have two
  // "BJT (NPN) 3"), which produced two IDENTICAL rows: same label, same hint,
  // and the same text spliced in either way. Useless to pick between, and it
  // collided React's keys in the autocomplete list.
  //
  // Deduping here rather than at the one call site keeps every consumer of
  // scopeItems honest. NOTE this only hides the ambiguity in the picker — the
  // token `[BJT (NPN) 3(V)]` still resolves to whichever object the binding
  // layer finds first. Making same-named objects individually bindable is a
  // model change (stable ids in the token), not a UI one.
  const seen = new Set<string>()
  return items.filter((it) => (seen.has(it.insert) ? false : (seen.add(it.insert), true)))
}
