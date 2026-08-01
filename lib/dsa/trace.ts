// Shared types for the DSA Lab: the C++ interpreter emits a step-by-step
// trace (lib/dsa/interpreter.ts), the analysis engine reduces it to
// complexity estimates (lib/dsa/analysis.ts), and the renderer replays it
// (components/objects/dsa.tsx). Everything the visualization needs lives in
// plain-JSON snapshots so stepping backwards is free.

/** One memory cell as the visualizer sees it at a given step. */
export interface SnapCell {
  addr: number
  /** formatted value, e.g. "5", "'a'", "true", "→0x7f04", "null" */
  value: string
  /** address this cell points to (pointer cells only) */
  ptrTo: number | null
  /** array element index (array blocks only) — column index for matrix blocks */
  index?: number
  /** field name (object blocks only) */
  field?: string
}

/** A visual block: one variable, array, object, or matrix (stack or heap). */
export interface SnapBlock {
  /** stable identity for animations: `b${headerAddr}` */
  id: string
  /** variable name; heap blocks get a synthetic name like "new Node" */
  name: string
  /** display type, e.g. "int", "int[6]", "Node*", "vector<int>" */
  type: string
  kind: 'scalar' | 'array' | 'object' | 'matrix'
  heap: boolean
  /** header address (shown at the bottom of the block) */
  addr: number
  cells: SnapCell[]
  /** matrix blocks only: row-major grid — a raw `T[R][C]` or a
   *  `vector<vector<T>>`, rendered as an actual 2D plot instead of a strip
   *  of opaque "[C]" placeholders. Rows may be jagged (ragged vectors). */
  rows?: SnapCell[][]
}

export interface FrameSnap {
  id: number
  fn: string
  /** pretty argument list, e.g. "lo=0, hi=5" */
  args: string
  blocks: SnapBlock[]
}

/** One edge in a detected adjacency-list graph. Undirected when both
 *  directions are present in the adjacency list (the common `addEdge` idiom
 *  that pushes each side), directed when only one is. */
export interface GraphEdge {
  a: number
  b: number
  directed: boolean
}

/** Adjacency-list graph found anywhere in live memory at this step — a
 *  `vector<vector<int>>` regardless of whether it's a bare local or, as in
 *  the textbook `class Graph { vector<vector<int>> adjList; }` shape, a
 *  field nested inside an object. Scanned straight off interpreter memory
 *  (lib/dsa/interpreter.ts `snapshotGraph`), not the display-only SnapBlock
 *  tree, since object fields there only get a flattened summary string. */
export interface GraphSnap {
  nodeCount: number
  edges: GraphEdge[]
  /** a same-length `vector<bool>`/`bool[]`, if one exists — e.g. BFS/DFS `visited` */
  visited: boolean[] | null
  /** index into `visited` written at this exact step, for a "just visited" highlight */
  visitedNode: number | null
  /** contents of a `queue<int>`/`stack<int>` in front→back / bottom→top order, if one exists */
  queue: number[] | null
  queueKind: 'queue' | 'stack' | null
}

/** One node of a detected binary tree (BST/AVL/heap-as-tree/…) anywhere in
 *  live memory at this step — a struct with two self-referential pointer
 *  fields (`Node* left; Node* right;`, whatever they're actually named),
 *  found the same "shape not name" way `GraphSnap` finds an adjacency list.
 *  Nested (not a flat list) since a tree renders as a tree, not a table. */
export interface TreeNodeSnap {
  addr: number
  /** compact display of the node's own non-pointer field(s), e.g. "5" for a
   *  single `int data` field, or "data=5, ht=2" if there's more than one. */
  label: string
  left: TreeNodeSnap | null
  right: TreeNodeSnap | null
}

export interface TreeSnap {
  root: TreeNodeSnap
  /** address written at this exact step, for a "just touched" highlight —
   *  mirrors GraphSnap's visitedNode. */
  touchedAddr: number | null
}

export type StepKind =
  | 'decl'
  | 'assign'
  | 'compare'
  | 'call'
  | 'return'
  | 'alloc'
  | 'free'
  | 'io'
  | 'flow'
  | 'error'

export interface TraceStep {
  line: number
  kind: StepKind
  /** human sentence for the step strip, e.g. `a[2] = 8` or `fib(4) → 3` */
  desc: string
  /** addresses written at this step (strong highlight) */
  changed: number[]
  /** addresses read at this step (soft highlight) */
  reads: number[]
  frames: FrameSnap[]
  heapBlocks: SnapBlock[]
  /** cumulative console output up to and including this step */
  output: string
  /** id of the call-tree node currently executing */
  activeCall: string
  /** the first adjacency-list graph found in memory, if any — null when the
   *  program isn't working with a `vector<vector<int>>` shape */
  graph: GraphSnap | null
  /** the first binary tree found in memory, if any — null when the program
   *  isn't working with a self-referential two-pointer-field struct */
  tree: TreeSnap | null
}

export interface CallNode {
  id: string
  fn: string
  args: string
  parent: string | null
  children: string[]
  /** pretty return value once the call finished */
  ret?: string
  startStep: number
  endStep?: number
  depth: number
}

export interface Counters {
  comparisons: number
  assignments: number
  arrayAccesses: number
  allocations: number
  frees: number
  calls: number
  swaps: number
  iterations: number
  maxLoopDepth: number
}

/** Per-invocation record used by the recurrence detector. */
export interface Invocation {
  fn: string
  /** numeric argument values of this invocation */
  nums: number[]
  /** numeric argument vectors of direct recursive children (same fn) */
  childNums: number[][]
  /** ops executed inside this call, excluding descendants */
  exclusiveOps: number
}

export interface RecurrenceReport {
  fn: string
  /** e.g. "T(n) = 2·T(n/2) + O(n)" */
  formula: string
  /** e.g. "O(n log n)" */
  bigO: string
  /** how the size metric was inferred, e.g. "n = hi − lo" */
  sizeNote: string
  /** e.g. "master theorem, case 2" */
  method: string
  calls: number
  maxDepth: number
}

/** One heap block still live (never delete'd) when the program finished —
 *  a straightforward leak-detection summary distinct from the per-cell
 *  "dangling pointer" highlight, which flags the opposite mistake (using a
 *  pointer AFTER its target was freed). */
export interface LeakedBlock {
  addr: number
  name: string
}

export interface TraceResult {
  steps: TraceStep[]
  callNodes: Record<string, CallNode>
  rootCalls: string[]
  counters: Counters
  invocations: Invocation[]
  output: string
  error?: { line: number; message: string }
  truncated: boolean
  /** Heap blocks never freed by program end (empty if none, or if the
   *  program never reached a normal end — e.g. it errored out first). */
  leaked: LeakedBlock[]
}

export const emptyCounters = (): Counters => ({
  comparisons: 0,
  assignments: 0,
  arrayAccesses: 0,
  allocations: 0,
  frees: 0,
  calls: 0,
  swaps: 0,
  iterations: 0,
  maxLoopDepth: 0,
})

/** Display address: stack cells look like 0x7ffc…, heap cells like 0x55e1…. */
export const fmtAddr = (addr: number, heap: boolean): string =>
  (heap ? '0x' + (0x55e10000 + addr * 4).toString(16) : '0x' + (0x7ffc0000 + addr * 4).toString(16)).replace(
    /^0x(....)(....)$/,
    '0x$1$2'
  )
