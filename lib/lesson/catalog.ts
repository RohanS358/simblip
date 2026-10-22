// What the simulator can actually SHOW, built from the real registries — so the lesson planner is never working from
// a hand-written (and stale) list. Today: every Step Lab engine (~70 algorithm steppers). The DSA Lab is described
// as a capability (the director writes a C++ program for it). Pure.

import { ENGINES } from '@/lib/steplab/registry'
import { bm25, tokenize, type Doc } from '@/lib/learning/bm25'

export interface LabCapability { id: string; label: string; group: string; blurb: string; algos: string[]; settings: string[] }

/** Short codes students and engines use, spelled out so "depth first search" finds the engine that says "dfs". */
const ALIASES: Record<string, string> = {
  dfs: 'depth first search', bfs: 'breadth first search', ucs: 'uniform cost search', astar: 'a star search', greedy: 'greedy best first search',
  rr: 'round robin', fcfs: 'first come first served', sjf: 'shortest job first', srtf: 'shortest remaining time first', sstf: 'shortest seek time first',
  scan: 'elevator scan', cscan: 'circular scan', look: 'look disk scheduling', lru: 'least recently used', fifo: 'first in first out', lfu: 'least frequently used', opt: 'optimal page replacement',
  kruskal: 'kruskal minimum spanning tree', prim: 'prim minimum spanning tree', topo: 'topological sort', dijkstra: 'dijkstra shortest path', bellman: 'bellman ford shortest path',
  bst: 'binary search tree', avl: 'avl tree rotation', heap: 'heap priority queue', dp: 'dynamic programming', lcs: 'longest common subsequence', knapsack: 'knapsack dynamic programming',
  dfa: 'deterministic finite automaton', nfa: 'nondeterministic finite automaton', pda: 'pushdown automaton', tm: 'turing machine', cpu8085: '8085 microprocessor assembly',
  tcp: 'tcp transmission control protocol', arp: 'address resolution protocol', crc: 'cyclic redundancy check', hamming: 'hamming error correcting code', kmap: 'karnaugh map',
}

const algosOf = (e: (typeof ENGINES)[number]): string[] => e.params.find((p) => p.name === 'algo')?.options ?? []

export function labCapabilities(): LabCapability[] {
  return ENGINES.map((e) => ({ id: e.id, label: e.label, group: e.group, blurb: e.blurb, algos: algosOf(e), settings: e.params.map((p) => p.name) }))
}

const textOf = (c: LabCapability) => [c.id, c.label, c.group, c.blurb, ...c.algos, ...c.algos.map((a) => ALIASES[a] ?? ''), ALIASES[c.id] ?? ''].join(' ')

/** The engines most relevant to a topic, best first. Empty when nothing in the registry is about it. */
export function relevantLabs(topic: string, k = 6): LabCapability[] {
  const caps = labCapabilities()
  const docs: Doc[] = caps.map((c) => ({ id: c.id, title: c.label, text: textOf(c) }))
  const byId = new Map(caps.map((c) => [c.id, c]))
  return bm25(docs, topic, k).map((r) => byId.get(r.doc.id)!)
}

/** The capability block shown to the planner: only what is relevant to THIS topic, so it costs ~200 tokens, not 2,000. */
export function capabilityPrompt(topic: string): string {
  const labs = relevantLabs(topic, 5)
  const lines = labs.map((c) => `- ${c.id}: ${c.label} — ${c.blurb}${c.algos.length ? ` (algo: ${c.algos.join(' | ')})` : ''}${c.settings.length ? ` [settings: ${c.settings.join(', ')}]` : ''}`)
  return [
    lines.length ? `Step Lab engines that match this topic — each animates an algorithm step by step with its own commentary:\n${lines.join('\n')}` : 'No Step Lab engine matches this topic.',
    'DSA Lab: runs a short C++ program (arrays, vectors, stacks, queues, maps, recursion, linked lists, trees) and shows memory, the call tree and the output as it executes.',
  ].join('\n')
}

// ── Routing a topic to the stepper that shows it ─────────────────────────────
// A prompt that says "use the lab" is a suggestion the planner model often ignores (it wrote physics scenes for DFS), so
// the routing is code: the topic either NAMES something a registry engine shows, or it does not.

/** Words too generic to identify an engine on their own: "binary search" must not select the maze-search stepper. */
const WEAK = new Set(['search', 'sort', 'sorting', 'tree', 'graph', 'algorithm', 'algorithms', 'simulation', 'data', 'structure', 'structures', 'system', 'systems', 'method', 'methods', 'network', 'networks', 'machine', 'code', 'function', 'model'])

const subset = (phrase: string[], topic: Set<string>) => phrase.length > 0 && phrase.some((w) => !WEAK.has(w)) && phrase.every((w) => topic.has(w))

export interface LabMatch { cap: LabCapability; settings: Record<string, string> }

/** Engines the topic NAMES (every word of some engine / algorithm name is in the topic), best first, at most `max`. */
export function matchLabs(topic: string, max = 2): LabMatch[] {
  const words = new Set(tokenize(topic))
  const out: LabMatch[] = []
  for (const c of relevantLabs(topic, 8)) {
    const names = [c.label, ...c.algos.flatMap((a) => [a, ALIASES[a] ?? ''])].concat(ALIASES[c.id] ? [c.id, ALIASES[c.id]] : [])
    const named = names.some((n) => subset(tokenize(n), words))
    if (!named) continue
    const algo = c.algos.find((a) => subset(tokenize(a), words) || (ALIASES[a] && subset(tokenize(ALIASES[a]), words)))
    out.push({ cap: c, settings: algo ? { algo } : {} })
    if (out.length >= max) break
  }
  return out
}

/** Topics that are about computing — where a physics scene is the wrong picture and a program or a stepper is the right one. */
const COMPUTING = /\b(sort(ing)?|search(ing)?|stack|queue|array|linked list|recursion|recursive|pointer|hash(ing| table| map)?|binary tree|bst|heap|graph|dfs|bfs|dijkstra|dynamic programming|memoi[sz]ation|big[- ]?o|time complexity|algorithm|data structure|c\+\+|loops?|sliding window|two pointers?|backtracking|greedy)\b/i
export const isComputing = (topic: string) => COMPUTING.test(topic)
