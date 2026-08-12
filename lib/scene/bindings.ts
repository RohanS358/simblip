'use client'

// One place that knows how "this component reads a value from that one" works.
//
// Three consumers used to each invent their own version of this: the graph
// stored "objId:channel" pairs and guessed channels from behaviors, the truth
// table kept parallel symbol allowlists, and formulas referenced objects by
// NAME (so renaming an object silently broke them). They now share:
//
//   - one encoding      → "objectId:channel; …"      (parse/serialize)
//   - one discovery     → lib/scene/channels.ts      (channelsFor + roles)
//   - one resolution    → live bus sample, else 0
//
// Bindings are by ID, never by name. Names are for humans and change; ids
// don't. The formula surface syntax [Name(channel)] stays name-based because
// users type it, but renames rewrite those tokens (see renameInExpr).

import { readBuffer } from '@/lib/physics/bus'
import { channelsFor } from './channels'
import type { SceneObject } from './types'

export interface Binding {
  objectId: string
  channel: string
}

/** "a:x; b:V" → bindings. Malformed entries are dropped, not thrown on. */
export function parseBindings(raw: string): Binding[] {
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const i = entry.indexOf(':')
      if (i <= 0) return null
      const channel = entry.slice(i + 1).trim()
      return channel ? { objectId: entry.slice(0, i).trim(), channel } : null
    })
    .filter((b): b is Binding => b !== null)
}

export const serializeBindings = (list: Binding[]): string =>
  list.map((b) => `${b.objectId}:${b.channel}`).join('; ')

/** Split a ";"-separated id list (truth table inputs/outputs, etc.). */
export const splitIds = (raw: string): string[] =>
  raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * Objects on this page a picker should offer: anything that publishes at
 * least one channel and isn't scaffolding. This is THE list — the graph, the
 * variables panel and any future consumer all ask this question here.
 */
export const bindableObjects = (objects: SceneObject[]): SceneObject[] =>
  objects.filter((o) => o.metadata.render !== 'system' && channelsFor(o).length > 0)

/**
 * The channels to offer for one object. A live buffer wins when the sim has
 * produced one (it reflects what's ACTUALLY streaming); otherwise the static
 * registry answers, so binding works before Play has ever run.
 */
export function channelOptions(obj: SceneObject | undefined): string[] {
  if (!obj) return []
  const live = readBuffer(obj.id)?.channelNames
  return live && live.length > 0 ? live : channelsFor(obj)
}

/** Latest value on a bound channel, or 0 when the sim hasn't produced one. */
export function resolveBinding(b: Binding): number {
  const buf = readBuffer(b.objectId)
  const last = buf?.samples[buf.samples.length - 1]
  return last?.channels[b.channel] ?? 0
}

// ── Formula token rewriting ─────────────────────────────────────────────────
// [Name(channel)] is the user-typed surface syntax. It resolves by name, so a
// rename would orphan every token pointing at the old name. Renames instead
// rewrite the tokens — one pass over any expression, done in the store's
// rename path so every caller is covered.

/** Same shape as LIVE_RE in lib/formula/engine.ts — object name, channel. */
const TOKEN_RE = /\[\s*([^\[\]()]+?)\s*\(\s*([^()]+?)\s*\)\s*\]/g

/** Rewrite [old(ch)] → [next(ch)] in one expression. Returns it unchanged
 *  when no token mentions `old`, so callers can cheaply skip no-op writes. */
export function renameInExpr(expr: string, old: string, next: string): string {
  if (!expr.includes('[')) return expr
  return expr.replace(TOKEN_RE, (m, name: string, channel: string) =>
    name.trim() === old ? `[${next}(${channel.trim()})]` : m
  )
}
