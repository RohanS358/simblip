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
  /** array element index (array blocks only) */
  index?: number
  /** field name (object blocks only) */
  field?: string
}

/** A visual block: one variable, array, or object (stack or heap). */
export interface SnapBlock {
  /** stable identity for animations: `b${headerAddr}` */
  id: string
  /** variable name; heap blocks get a synthetic name like "new Node" */
  name: string
  /** display type, e.g. "int", "int[6]", "Node*", "vector<int>" */
  type: string
  kind: 'scalar' | 'array' | 'object'
  heap: boolean
  /** header address (shown at the bottom of the block) */
  addr: number
  cells: SnapCell[]
}

export interface FrameSnap {
  id: number
  fn: string
  /** pretty argument list, e.g. "lo=0, hi=5" */
  args: string
  blocks: SnapBlock[]
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

export interface TraceResult {
  steps: TraceStep[]
  callNodes: Record<string, CallNode>
  rootCalls: string[]
  counters: Counters
  invocations: Invocation[]
  output: string
  error?: { line: number; message: string }
  truncated: boolean
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
