// A C++ teaching-subset interpreter that runs code line by line and records
// a visual trace: every variable is a memory cell with a real address,
// arrays are consecutive cells (so pointer arithmetic is honest), structs
// and heap allocations are first-class blocks, and every call builds a node
// in the call tree. The DSA Lab object replays the trace.
//
// Deliberately NOT a full C++ compiler — it covers what a DSA / algorithms
// course writes: scalars, arrays (incl. 2D), pointers & references,
// struct/class with fields + methods + constructor, new/delete,
// vector/stack/queue, std::string, cout, control flow, recursion.

import {
  type CallNode,
  type Counters,
  type FrameSnap,
  type GraphEdge,
  type GraphSnap,
  type Invocation,
  type SnapBlock,
  type SnapCell,
  type StepKind,
  type TraceResult,
  type TraceStep,
  type TreeNodeSnap,
  type TreeSnap,
  emptyCounters,
} from './trace'

const INT_LIKE = new Set(['int', 'long', 'short', 'size_t'])

/** string::npos — the real value (size_t(-1) for a 32-bit size_t, matching
 *  sizeOfType('size_t') === 4 elsewhere) so the standard
 *  `if (s.find(x) != string::npos)` idiom compares correctly. */
const STRING_NPOS = 4294967295

const MAX_STEPS = 3000
const MAX_OPS = 500_000

// ── Lexer ───────────────────────────────────────────────────────────────────

type TokKind = 'id' | 'kw' | 'num' | 'str' | 'chr' | 'op' | 'eof'
interface Tok {
  k: TokKind
  v: string
  line: number
}

const KEYWORDS = new Set([
  'int', 'long', 'float', 'double', 'char', 'bool', 'void', 'auto', 'unsigned', 'signed', 'short',
  'string', 'size_t', 'struct', 'class', 'public', 'private', 'protected', 'return', 'if', 'else',
  'while', 'do', 'for', 'break', 'continue', 'switch', 'case', 'default', 'new', 'delete', 'true',
  'false', 'nullptr', 'using', 'namespace', 'const', 'sizeof', 'this', 'vector', 'stack', 'queue',
  'pair', 'deque', 'priority_queue', 'map', 'unordered_map', 'set', 'unordered_set',
])

const THREE_OPS = ['<<=', '>>='] as const
const TWO_OPS = [
  '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '++', '--', '+=', '-=', '*=', '/=', '%=', '->',
  '&=', '|=', '^=', '::',
] as const

class ParseError extends Error {
  line: number
  constructor(message: string, line: number) {
    super(message)
    this.line = line
  }
}

function lex(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  let line = 1
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '\n') { line++; i++; continue }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    // preprocessor lines — skip entirely
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++ }
      i += 2
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < n && /[0-9a-fA-FxX.uUlLfF]/.test(src[j])) j++
      toks.push({ k: 'num', v: src.slice(i, j), line })
      i = j
      continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i
      while (j < n && /[a-zA-Z0-9_]/.test(src[j])) j++
      const v = src.slice(i, j)
      toks.push({ k: KEYWORDS.has(v) ? 'kw' : 'id', v, line })
      i = j
      continue
    }
    if (c === '"') {
      let j = i + 1
      let out = ''
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') {
          const e = src[j + 1]
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e === '\\' ? '\\' : e === '"' ? '"' : e === '0' ? '\0' : e
          j += 2
        } else {
          out += src[j]
          j++
        }
      }
      toks.push({ k: 'str', v: out, line })
      i = j + 1
      continue
    }
    if (c === "'") {
      let j = i + 1
      let ch = ''
      if (src[j] === '\\') {
        const e = src[j + 1]
        ch = e === 'n' ? '\n' : e === 't' ? '\t' : e === '\\' ? '\\' : e === "'" ? "'" : e === '0' ? '\0' : e
        j += 2
      } else {
        ch = src[j]
        j++
      }
      toks.push({ k: 'chr', v: ch, line })
      i = j + 1
      continue
    }
    const three = src.slice(i, i + 3)
    if ((THREE_OPS as readonly string[]).includes(three)) { toks.push({ k: 'op', v: three, line }); i += 3; continue }
    const two = src.slice(i, i + 2)
    if ((TWO_OPS as readonly string[]).includes(two)) { toks.push({ k: 'op', v: two, line }); i += 2; continue }
    if ('+-*/%=<>!&|^~?:;,.(){}[]'.includes(c)) { toks.push({ k: 'op', v: c, line }); i++; continue }
    throw new ParseError(`Unexpected character '${c}'`, line)
  }
  toks.push({ k: 'eof', v: '', line })
  return toks
}

// ── AST ─────────────────────────────────────────────────────────────────────

interface TypeRef {
  base: string // 'int' | 'double' | … | 'vector' | user type
  targs: TypeRef[]
  ptr: number
  ref: boolean
}

type Expr =
  | { k: 'num'; v: number; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'chr'; v: string; line: number }
  | { k: 'bool'; v: boolean; line: number }
  | { k: 'null'; line: number }
  | { k: 'this'; line: number }
  | { k: 'id'; name: string; line: number }
  | { k: 'bin'; op: string; l: Expr; r: Expr; line: number }
  | { k: 'un'; op: string; e: Expr; prefix: boolean; line: number }
  | { k: 'assign'; op: string; target: Expr; value: Expr; line: number }
  | { k: 'cond'; c: Expr; t: Expr; f: Expr; line: number }
  | { k: 'call'; callee: Expr; args: Expr[]; line: number }
  | { k: 'index'; base: Expr; idx: Expr; line: number }
  | { k: 'member'; base: Expr; name: string; arrow: boolean; line: number }
  | { k: 'new'; type: TypeRef; args: Expr[]; count?: Expr; line: number }
  | { k: 'initlist'; items: Expr[]; line: number }
  | { k: 'sizeof'; arg: { kind: 'type'; type: TypeRef } | { kind: 'expr'; e: Expr } | null; line: number }
  | { k: 'ctorcall'; type: TypeRef; args: Expr[]; line: number }

interface Declarator {
  name: string
  ptr: number
  ref: boolean
  arrDims: (Expr | null)[]
  init?: Expr
  ctorArgs?: Expr[]
}

type Stmt =
  | { k: 'decl'; type: TypeRef; decls: Declarator[]; line: number }
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'if'; c: Expr; t: Stmt; f?: Stmt; line: number }
  | { k: 'while'; c: Expr; body: Stmt; line: number }
  | { k: 'do'; c: Expr; body: Stmt; line: number }
  | { k: 'for'; init?: Stmt; c?: Expr; inc?: Expr; body: Stmt; line: number }
  | { k: 'forRange'; type: TypeRef; name: string; ref: boolean; iter: Expr; body: Stmt; line: number }
  | { k: 'block'; body: Stmt[]; line: number }
  | { k: 'return'; e?: Expr; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'switch'; disc: Expr; cases: { match: Expr | null; body: Stmt[] }[]; line: number }
  | { k: 'delete'; e: Expr; arr: boolean; line: number }

interface Param {
  type: TypeRef
  name: string
}

interface FuncDef {
  name: string
  ret: TypeRef
  params: Param[]
  body: Stmt
  line: number
}

interface TypeDef {
  name: string
  fields: { type: TypeRef; name: string; ptr: number; arrDims: (Expr | null)[]; init?: Expr }[]
  methods: Map<string, FuncDef>
  ctor?: FuncDef
}

interface Program {
  types: Map<string, TypeDef>
  funcs: Map<string, FuncDef>
  globals: Stmt[]
  top: Stmt[] // loose top-level statements (script mode)
}

// ── Parser ──────────────────────────────────────────────────────────────────

const BUILTIN_TYPES = new Set([
  'int', 'long', 'float', 'double', 'char', 'bool', 'void', 'auto', 'unsigned', 'signed', 'short',
  'string', 'size_t', 'vector', 'stack', 'queue',
  'pair', 'deque', 'priority_queue', 'map', 'unordered_map', 'set', 'unordered_set',
])

/** Container/adaptor base names whose runtime cell is a single flat `arr`
 *  Cell (see Cell's `t: 'arr'` variant) — vector/stack/queue plus the newer
 *  deque/priority_queue, all differing only in which methods are exposed
 *  and how push/pop pick an end, never in storage shape. */
const ARR_CTAGS = new Set(['vector', 'stack', 'queue', 'deque', 'priority_queue'])

/** <algorithm> functions taking an iterator/pointer [first, last) range as
 *  their first two arguments — the one shared dispatch block in evalCall. */
const RANGE_ALGO_NAMES = new Set([
  'sort', 'reverse', 'find', 'min_element', 'max_element',
  'count', 'fill', 'unique', 'binary_search', 'lower_bound', 'upper_bound', 'copy',
])

class Parser {
  toks: Tok[]
  pos = 0
  typeNames = new Set<string>()

  constructor(toks: Tok[]) {
    this.toks = toks
  }

  peek(o = 0): Tok { return this.toks[Math.min(this.pos + o, this.toks.length - 1)] }
  next(): Tok { return this.toks[this.pos++] ?? this.toks[this.toks.length - 1] }
  at(v: string): boolean { const t = this.peek(); return (t.k === 'op' || t.k === 'kw') && t.v === v }
  eat(v: string): boolean { if (this.at(v)) { this.pos++; return true } return false }
  expect(v: string): Tok {
    const t = this.peek()
    if ((t.k === 'op' || t.k === 'kw') && t.v === v) return this.next()
    throw new ParseError(`Expected '${v}' but found '${t.v || 'end of file'}'`, t.line)
  }

  isTypeStart(o = 0): boolean {
    const t = this.peek(o)
    if (t.k === 'kw' && (BUILTIN_TYPES.has(t.v) || t.v === 'const' || t.v === 'struct' || t.v === 'class')) return true
    if (t.k === 'id' && this.typeNames.has(t.v)) return true
    // std::vector<…>, std::string — but NOT std::cout / std::endl, which are
    // expressions: only a type name after the '::' makes this a declaration.
    if (t.k === 'id' && t.v === 'std' && this.peek(o + 1).v === '::') {
      const n = this.peek(o + 2)
      return BUILTIN_TYPES.has(n.v) || this.typeNames.has(n.v)
    }
    return false
  }

  parseProgram(): Program {
    const prog: Program = { types: new Map(), funcs: new Map(), globals: [], top: [] }
    while (this.peek().k !== 'eof') {
      const t = this.peek()
      if (t.k === 'kw' && t.v === 'using') {
        // using namespace std; / using std::…;
        while (!this.eat(';') && this.peek().k !== 'eof') this.next()
        continue
      }
      if (t.k === 'kw' && (t.v === 'struct' || t.v === 'class') && this.peek(2).v === '{') {
        const td = this.parseStruct()
        prog.types.set(td.name, td)
        continue
      }
      if (this.isTypeStart()) {
        // type name ( → function; else declaration
        const save = this.pos
        this.eat('const')
        const type = this.parseType()
        let ptr = 0
        while (this.eat('*')) ptr++
        this.eat('&')
        const nameTok = this.peek()
        if (nameTok.k === 'id' || (nameTok.k === 'kw' && nameTok.v === 'main')) {
          if (this.peek(1).v === '(') {
            this.pos = save
            const fn = this.parseFunction()
            prog.funcs.set(fn.name, fn)
            continue
          }
        }
        this.pos = save
        prog.globals.push(this.parseStatement())
        continue
      }
      // Loose top-level statement — script mode
      prog.top.push(this.parseStatement())
    }
    return prog
  }

  parseStruct(): TypeDef {
    this.next() // struct/class
    const name = this.next().v
    this.typeNames.add(name)
    this.expect('{')
    const td: TypeDef = { name, fields: [], methods: new Map() }
    while (!this.at('}') && this.peek().k !== 'eof') {
      if ((this.at('public') || this.at('private') || this.at('protected')) && this.peek(1).v === ':') {
        this.next(); this.next()
        continue
      }
      // constructor: Name ( … ) { … }
      if (this.peek().k === 'id' && this.peek().v === name && this.peek(1).v === '(') {
        const line = this.peek().line
        this.next()
        const params = this.parseParams()
        // member-init list  : x(a), y(b)  — translate to assignments
        const inits: Stmt[] = []
        if (this.eat(':')) {
          do {
            const f = this.next().v
            this.expect('(')
            const e = this.parseExpr()
            this.expect(')')
            inits.push({ k: 'expr', e: { k: 'assign', op: '=', target: { k: 'member', base: { k: 'this', line }, name: f, arrow: true, line }, value: e, line }, line })
          } while (this.eat(','))
        }
        const body = this.parseBlock()
        if (body.k === 'block') body.body = [...inits, ...body.body]
        td.ctor = { name, ret: { base: 'void', targs: [], ptr: 0, ref: false }, params, body, line }
        continue
      }
      this.eat('const')
      const type = this.parseType()
      let ptr = 0
      while (this.eat('*')) ptr++
      const fname = this.next().v
      if (this.at('(')) {
        // method
        const params = this.parseParams()
        this.eat('const')
        const body = this.parseBlock()
        td.methods.set(fname, { name: fname, ret: { ...type, ptr }, params, body, line: this.peek().line })
        continue
      }
      const arrDims: (Expr | null)[] = []
      while (this.eat('[')) {
        arrDims.push(this.at(']') ? null : this.parseExpr())
        this.expect(']')
      }
      let init: Expr | undefined
      if (this.eat('=')) init = this.parseAssignExpr()
      td.fields.push({ type, name: fname, ptr, arrDims, init })
      // extra declarators on the same line
      while (this.eat(',')) {
        let p2 = 0
        while (this.eat('*')) p2++
        const f2 = this.next().v
        let i2: Expr | undefined
        if (this.eat('=')) i2 = this.parseAssignExpr()
        td.fields.push({ type, name: f2, ptr: p2, arrDims: [], init: i2 })
      }
      this.expect(';')
    }
    this.expect('}')
    this.eat(';')
    return td
  }

  parseType(): TypeRef {
    // optional std::
    if (this.peek().v === 'std' && this.peek(1).v === '::') { this.next(); this.next() }
    this.eat('const')
    let base = this.next().v
    if (base === 'unsigned' || base === 'signed') {
      if (this.at('int') || this.at('long') || this.at('short') || this.at('char')) base = this.next().v
      else base = 'int'
    }
    if (base === 'long' && (this.at('long') || this.at('int'))) this.next()
    if (base === 'short' && this.at('int')) this.next()
    const targs: TypeRef[] = []
    // Any templated identifier — a known container (vector/pair/map/…) AND
    // an unrecognized one too (e.g. a comparator functor like `greater<int>`
    // inside `priority_queue<T, vector<T>, greater<T>>`): parseType is only
    // ever called once we're already committed to parsing a TYPE (the type-
    // vs-expression call is made by the caller via isTypeStart before this
    // runs), so a `<` here is never a "less than" — always a template open.
    // Unrecognized template args are kept (so the syntax parses) but never
    // interpreted, same spirit as headers being stripped without being
    // individually understood.
    if (this.eat('<')) {
      targs.push(this.parseTypeWithPtr())
      while (this.eat(',')) targs.push(this.parseTypeWithPtr())
      // `vector<vector<int>>` lexes its closing `>>` as ONE token shared by
      // both template arg lists. Splitting it into two separate '>' tokens
      // (rather than relabeling it in place) leaves one for THIS call's
      // own expect('>') and one still in the stream for whichever
      // enclosing parseType() called us — otherwise the outer close has
      // nothing left to consume and `vector<vector<int>>` never parses at
      // all, which is exactly the 2D-matrix declaration this interpreter
      // most needs to support.
      if (this.peek().v === '>>') {
        const line = this.peek().line
        this.toks.splice(this.pos, 1, { k: 'op', v: '>', line }, { k: 'op', v: '>', line })
      }
      this.expect('>')
    }
    return { base, targs, ptr: 0, ref: false }
  }

  parseTypeWithPtr(): TypeRef {
    const t = this.parseType()
    let ptr = 0
    while (this.eat('*')) ptr++
    return { ...t, ptr }
  }

  parseParams(): Param[] {
    this.expect('(')
    const params: Param[] = []
    if (!this.at(')')) {
      do {
        if (this.at(')')) break
        this.eat('const')
        const t = this.parseType()
        let ptr = 0
        while (this.eat('*')) ptr++
        const ref = this.eat('&')
        const name = this.peek().k === 'id' ? this.next().v : `arg${params.length}`
        // int a[]  → pointer
        let p = ptr
        while (this.eat('[')) { this.eat(']') || (this.parseExpr(), this.expect(']')); p++ }
        params.push({ type: { ...t, ptr: p, ref }, name })
        if (this.eat('=')) this.parseAssignExpr() // default value — ignored
      } while (this.eat(','))
    }
    this.expect(')')
    return params
  }

  parseFunction(): FuncDef {
    this.eat('const')
    const ret = this.parseType()
    let ptr = 0
    while (this.eat('*')) ptr++
    this.eat('&')
    const nameTok = this.next()
    const params = this.parseParams()
    const line = nameTok.line
    const body = this.parseBlock()
    return { name: nameTok.v, ret: { ...ret, ptr }, params, body, line }
  }

  parseBlock(): Stmt {
    const line = this.peek().line
    this.expect('{')
    const body: Stmt[] = []
    while (!this.at('}') && this.peek().k !== 'eof') body.push(this.parseStatement())
    this.expect('}')
    return { k: 'block', body, line }
  }

  parseStatement(): Stmt {
    const t = this.peek()
    const line = t.line
    if (this.at('{')) return this.parseBlock()
    if (this.eat(';')) return { k: 'block', body: [], line }
    if (this.eat('if')) {
      this.expect('(')
      const c = this.parseExpr()
      this.expect(')')
      const then = this.parseStatement()
      let f: Stmt | undefined
      if (this.eat('else')) f = this.parseStatement()
      return { k: 'if', c, t: then, f, line }
    }
    if (this.eat('while')) {
      this.expect('(')
      const c = this.parseExpr()
      this.expect(')')
      return { k: 'while', c, body: this.parseStatement(), line }
    }
    if (this.eat('do')) {
      const body = this.parseStatement()
      this.expect('while')
      this.expect('(')
      const c = this.parseExpr()
      this.expect(')')
      this.expect(';')
      return { k: 'do', c, body, line }
    }
    if (this.eat('for')) {
      this.expect('(')
      // range-for:  for (type name : expr)
      const save = this.pos
      if (this.isTypeStart()) {
        try {
          const ty = this.parseType()
          let ptr = 0
          while (this.eat('*')) ptr++
          const ref = this.eat('&')
          const name = this.next()
          if (name.k === 'id' && this.eat(':')) {
            const iter = this.parseExpr()
            this.expect(')')
            return { k: 'forRange', type: { ...ty, ptr }, name: name.v, ref, iter, body: this.parseStatement(), line }
          }
        } catch { /* fall through to classic for */ }
        this.pos = save
      }
      let init: Stmt | undefined
      if (!this.eat(';')) init = this.parseStatement() // consumes its own ';'
      let c: Expr | undefined
      if (!this.at(';')) c = this.parseExpr()
      this.expect(';')
      let inc: Expr | undefined
      if (!this.at(')')) inc = this.parseExpr()
      this.expect(')')
      return { k: 'for', init, c, inc, body: this.parseStatement(), line }
    }
    if (this.eat('return')) {
      if (this.eat(';')) return { k: 'return', line }
      const e = this.parseExpr()
      this.expect(';')
      return { k: 'return', e, line }
    }
    if (this.eat('break')) { this.expect(';'); return { k: 'break', line } }
    if (this.eat('continue')) { this.expect(';'); return { k: 'continue', line } }
    if (this.eat('switch')) {
      this.expect('(')
      const disc = this.parseExpr()
      this.expect(')')
      this.expect('{')
      const cases: { match: Expr | null; body: Stmt[] }[] = []
      while (!this.at('}') && this.peek().k !== 'eof') {
        if (this.eat('case')) {
          const m = this.parseExpr()
          this.expect(':')
          cases.push({ match: m, body: [] })
        } else if (this.eat('default')) {
          this.expect(':')
          cases.push({ match: null, body: [] })
        } else {
          if (cases.length === 0) throw new ParseError('Statement before first case label', this.peek().line)
          cases[cases.length - 1].body.push(this.parseStatement())
        }
      }
      this.expect('}')
      return { k: 'switch', disc, cases, line }
    }
    if (this.eat('delete')) {
      let arr = false
      if (this.eat('[')) { this.expect(']'); arr = true }
      const e = this.parseExpr()
      this.expect(';')
      return { k: 'delete', e, arr, line }
    }
    if (this.at('struct') || this.at('class')) {
      throw new ParseError('Define structs/classes at the top level, before main()', line)
    }
    // declaration?
    if (this.isTypeStart() && !this.at('sizeof')) {
      // Disambiguate `x * y;` style: builtin kw types always win; user types
      // need `Name id` or `Name *` or `Name &`.
      const type = this.parseType()
      const decls: Declarator[] = []
      do {
        let ptr = 0
        while (this.eat('*')) ptr++
        const ref = this.eat('&')
        const nameTok = this.next()
        if (nameTok.k !== 'id') throw new ParseError(`Expected a variable name, found '${nameTok.v}'`, nameTok.line)
        const d: Declarator = { name: nameTok.v, ptr, ref, arrDims: [] }
        while (this.eat('[')) {
          d.arrDims.push(this.at(']') ? null : this.parseExpr())
          this.expect(']')
        }
        if (this.eat('=')) {
          d.init = this.at('{') ? this.parseInitList() : this.parseAssignExpr()
        } else if (this.at('(')) {
          this.next()
          d.ctorArgs = []
          if (!this.at(')')) {
            do { d.ctorArgs.push(this.parseAssignExpr()) } while (this.eat(','))
          }
          this.expect(')')
        } else if (this.at('{')) {
          d.init = this.parseInitList()
        }
        decls.push(d)
      } while (this.eat(','))
      this.expect(';')
      return { k: 'decl', type, decls, line }
    }
    const e = this.parseExpr()
    this.expect(';')
    return { k: 'expr', e, line }
  }

  parseInitList(): Expr {
    const line = this.peek().line
    this.expect('{')
    const items: Expr[] = []
    if (!this.at('}')) {
      do {
        items.push(this.at('{') ? this.parseInitList() : this.parseAssignExpr())
      } while (this.eat(','))
    }
    this.expect('}')
    return { k: 'initlist', items, line }
  }

  parseExpr(): Expr {
    let e = this.parseAssignExpr()
    while (this.at(',')) {
      // comma operator — evaluate both, keep right
      this.next()
      const r = this.parseAssignExpr()
      e = { k: 'bin', op: ',', l: e, r, line: e.line }
    }
    return e
  }

  parseAssignExpr(): Expr {
    const l = this.parseTernary()
    const t = this.peek()
    if (t.k === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='].includes(t.v)) {
      this.next()
      const r = this.parseAssignExpr()
      return { k: 'assign', op: t.v, target: l, value: r, line: t.line }
    }
    return l
  }

  parseTernary(): Expr {
    const c = this.parseBinary(0)
    if (this.eat('?')) {
      const t = this.parseAssignExpr()
      this.expect(':')
      const f = this.parseAssignExpr()
      return { k: 'cond', c, t, f, line: c.line }
    }
    return c
  }

  // precedence table, low → high
  static LEVELS: string[][] = [
    ['||'],
    ['&&'],
    ['|'],
    ['^'],
    ['&'],
    ['==', '!='],
    ['<', '>', '<=', '>='],
    ['<<', '>>'],
    ['+', '-'],
    ['*', '/', '%'],
  ]

  parseBinary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.parseUnary()
    let l = this.parseBinary(level + 1)
    for (;;) {
      const t = this.peek()
      if (t.k === 'op' && Parser.LEVELS[level].includes(t.v)) {
        // don't treat '&' before an identifier-in-arg-position specially; C++ ambiguity is fine here
        this.next()
        const r = this.parseBinary(level + 1)
        l = { k: 'bin', op: t.v, l, r, line: t.line }
      } else return l
    }
  }

  parseUnary(): Expr {
    const t = this.peek()
    if (t.k === 'op' && ['!', '~', '-', '+', '*', '&', '++', '--'].includes(t.v)) {
      this.next()
      const e = this.parseUnary()
      return { k: 'un', op: t.v, e, prefix: true, line: t.line }
    }
    if (t.k === 'kw' && t.v === 'new') {
      this.next()
      const type = this.parseType()
      let ptr = 0
      while (this.eat('*')) ptr++
      if (this.eat('[')) {
        const count = this.parseExpr()
        this.expect(']')
        return { k: 'new', type: { ...type, ptr }, args: [], count, line: t.line }
      }
      const args: Expr[] = []
      if (this.eat('(')) {
        if (!this.at(')')) {
          do { args.push(this.parseAssignExpr()) } while (this.eat(','))
        }
        this.expect(')')
      } else if (this.at('{')) {
        const il = this.parseInitList()
        if (il.k === 'initlist') args.push(...il.items)
      }
      return { k: 'new', type: { ...type, ptr }, args, line: t.line }
    }
    if (t.k === 'kw' && t.v === 'sizeof') {
      this.next()
      if (this.eat('(')) {
        // sizeof(Type) vs sizeof(expr) — a type name unambiguously starts a
        // type (builtin keyword, or an already-declared struct/class name);
        // anything else (a variable, an index/member expression, …) is an
        // expression whose runtime SHAPE determines the size.
        const arg = this.isTypeStart()
          ? { kind: 'type' as const, type: this.parseTypeWithPtr() }
          : { kind: 'expr' as const, e: this.parseExpr() }
        this.expect(')')
        return { k: 'sizeof', arg, line: t.line }
      }
      return { k: 'sizeof', arg: null, line: t.line }
    }
    return this.parsePostfix()
  }

  parsePostfix(): Expr {
    let e = this.parsePrimary()
    for (;;) {
      const t = this.peek()
      if (this.eat('(')) {
        const args: Expr[] = []
        if (!this.at(')')) {
          do { args.push(this.parseAssignExpr()) } while (this.eat(','))
        }
        this.expect(')')
        e = { k: 'call', callee: e, args, line: t.line }
      } else if (this.eat('[')) {
        const idx = this.parseExpr()
        this.expect(']')
        e = { k: 'index', base: e, idx, line: t.line }
      } else if (this.eat('.')) {
        e = { k: 'member', base: e, name: this.next().v, arrow: false, line: t.line }
      } else if (this.eat('->')) {
        e = { k: 'member', base: e, name: this.next().v, arrow: true, line: t.line }
      } else if (t.k === 'op' && (t.v === '++' || t.v === '--')) {
        this.next()
        e = { k: 'un', op: t.v, e, prefix: false, line: t.line }
      } else return e
    }
  }

  parsePrimary(): Expr {
    // A bare brace-init used INLINE as an expression, not just a decl-init —
    // e.g. `pq.push({dist, node});` / `v.push_back({3, 4});`, the standard
    // way to build a pair/struct/container value in one call argument. `{`
    // never otherwise starts a valid expression, so this is unambiguous.
    if (this.at('{')) return this.parseInitList()
    // vector<T>(...), stack<T>(...), queue<T>(...) used as an EXPRESSION —
    // the standard `vector<vector<int>> grid(rows, vector<int>(cols, 0))`
    // matrix-init idiom needs the inner `vector<int>(cols, 0)` to parse as a
    // value, not just as a top-level declaration (which parseStatement
    // already handles separately via parseType + declarators). Also covers
    // the fully-qualified `std::vector<int>(cols, 0)` spelling — textbook
    // code almost always writes the inner ctor-call with the `std::` prefix
    // too (`std::vector<std::vector<int>> grid(rows, std::vector<int>(...))`),
    // and without this branch it fell through to plain identifier parsing,
    // leaving the `<int>(...)` unconsumed and erroring on the stray `int`.
    const p0 = this.peek()
    const isBareCtor = p0.k === 'kw' && (p0.v === 'vector' || p0.v === 'stack' || p0.v === 'queue') && this.peek(1).v === '<'
    const isStdCtor =
      p0.k === 'id' &&
      p0.v === 'std' &&
      this.peek(1).v === '::' &&
      (this.peek(2).v === 'vector' || this.peek(2).v === 'stack' || this.peek(2).v === 'queue') &&
      this.peek(3).v === '<'
    if (isBareCtor || isStdCtor) {
      const type = this.parseType()
      this.expect('(')
      const args: Expr[] = []
      if (!this.at(')')) {
        do { args.push(this.parseAssignExpr()) } while (this.eat(','))
      }
      this.expect(')')
      return { k: 'ctorcall', type, args, line: p0.line }
    }
    const t = this.next()
    if (t.k === 'num') {
      let v = t.v.replace(/[uUlL]+$/, '')
      if (/[fF]$/.test(v) && !v.startsWith('0x')) v = v.slice(0, -1)
      const num = v.startsWith('0x') || v.startsWith('0X') ? parseInt(v, 16) : parseFloat(v)
      if (Number.isNaN(num)) throw new ParseError(`Bad number literal '${t.v}'`, t.line)
      return { k: 'num', v: num, line: t.line }
    }
    if (t.k === 'str') return { k: 'str', v: t.v, line: t.line }
    if (t.k === 'chr') return { k: 'chr', v: t.v, line: t.line }
    if (t.k === 'kw') {
      if (t.v === 'true') return { k: 'bool', v: true, line: t.line }
      if (t.v === 'false') return { k: 'bool', v: false, line: t.line }
      if (t.v === 'nullptr') return { k: 'null', line: t.line }
      if (t.v === 'this') return { k: 'this', line: t.line }
      if (t.v === 'string' && this.eat('::')) {
        const n = this.next()
        if (n.v === 'npos') return { k: 'num', v: STRING_NPOS, line: t.line }
        throw new ParseError(`Unknown string:: member '${n.v}'`, n.line)
      }
    }
    if (t.k === 'id') {
      if (t.v === 'NULL') return { k: 'null', line: t.line }
      if (t.v === 'std' && this.eat('::')) {
        const n = this.next()
        return { k: 'id', name: n.v, line: n.line }
      }
      return { k: 'id', name: t.v, line: t.line }
    }
    if (t.v === '(') {
      const e = this.parseExpr()
      this.expect(')')
      return e
    }
    throw new ParseError(`Unexpected '${t.v || 'end of file'}'`, t.line)
  }
}

// ── Expression pretty-printer (for step descriptions) ───────────────────────

function pe(e: Expr): string {
  switch (e.k) {
    case 'num': return String(e.v)
    case 'str': return JSON.stringify(e.v)
    case 'chr': return `'${e.v}'`
    case 'bool': return String(e.v)
    case 'null': return 'nullptr'
    case 'this': return 'this'
    case 'id': return e.name
    case 'bin': return e.op === ',' ? `${pe(e.l)}, ${pe(e.r)}` : `${pe(e.l)} ${e.op} ${pe(e.r)}`
    case 'un': return e.prefix ? `${e.op}${pe(e.e)}` : `${pe(e.e)}${e.op}`
    case 'assign': return `${pe(e.target)} ${e.op} ${pe(e.value)}`
    case 'cond': return `${pe(e.c)} ? ${pe(e.t)} : ${pe(e.f)}`
    case 'call': return `${pe(e.callee)}(${e.args.map(pe).join(', ')})`
    case 'index': return `${pe(e.base)}[${pe(e.idx)}]`
    case 'member': return `${pe(e.base)}${e.arrow ? '->' : '.'}${e.name}`
    case 'new': return `new ${e.type.base}${e.count ? `[${pe(e.count)}]` : ''}`
    case 'initlist': return `{${e.items.map(pe).join(', ')}}`
    case 'sizeof': return e.arg ? `sizeof(${e.arg.kind === 'type' ? typeName(e.arg.type) : pe(e.arg.e)})` : 'sizeof()'
    case 'ctorcall': return `${e.type.base}<...>(${e.args.map(pe).join(', ')})`
  }
}

// ── Runtime model ───────────────────────────────────────────────────────────

// An iterator is index-based (header + idx into the arr cell's `elems` list)
// rather than a raw address, unlike a decayed array pointer — vector elems
// aren't guaranteed contiguous once push_back interleaves with other
// allocations, so `++it` walking real memory addresses would silently skip
// or alias the wrong cell. Indexing through `elems` is honest regardless of
// allocation order and works identically for nested containers (matrix rows).
type Cell =
  | { t: 'num'; v: number; ct: string }
  | { t: 'bool'; v: boolean }
  | { t: 'char'; v: string }
  | { t: 'str'; v: string }
  | { t: 'ptr'; v: number; pt: string } // v === 0 → nullptr
  | {
      t: 'arr'
      elems: number[]
      et: string
      dyn: boolean
      // map/unordered_map elements are `pair` objects (key=first, value=
      // second); set/unordered_set elements are plain scalar keys — both
      // reuse this same flat-list Cell shape, just with different element
      // shapes and key-based (not index-based) method semantics.
      ctag?: 'vector' | 'stack' | 'queue' | 'deque' | 'priority_queue' | 'map' | 'unordered_map' | 'set' | 'unordered_set'
    }
  | { t: 'obj'; type: string; fields: Record<string, number> }
  | { t: 'iter'; header: number; idx: number; et: string }

type Val =
  | { t: 'num'; v: number; ct: string }
  | { t: 'bool'; v: boolean }
  | { t: 'char'; v: string }
  | { t: 'str'; v: string }
  | { t: 'ptr'; v: number; pt: string }
  | { t: 'iter'; header: number; idx: number; et: string }
  | { t: 'void' }
  | { t: 'stream' }

interface Frame {
  id: number
  fn: string
  args: string
  scopes: Map<string, number>[]
  callNodeId: string
  thisAddr: number | null
  invocation: Invocation
}

class RuntimeError extends Error {
  line: number
  constructor(message: string, line: number) {
    super(message)
    this.line = line
  }
}

class BreakSig { }
class ContinueSig { }
class ReturnSig {
  v: Val
  constructor(v: Val) { this.v = v }
}
class StepsExhausted { }

// ── Interpreter ─────────────────────────────────────────────────────────────

class Interp {
  prog: Program
  mem = new Map<number, Cell>()
  nextAddr = 1
  heapOrder: number[] = [] // header addrs of live heap blocks, in alloc order
  heapNames = new Map<number, string>()
  frames: Frame[] = []
  globalFrame: Frame
  steps: TraceStep[] = []
  callNodes: Record<string, CallNode> = {}
  rootCalls: string[] = []
  counters: Counters = emptyCounters()
  invocations: Invocation[] = []
  output = ''
  truncated = false
  ops = 0
  loopDepth = 0
  frameSeq = 0
  callSeq = 0
  curChanged: number[] = []
  curReads: number[] = []
  randState = 0x2f6e2b1
  // Raw stdin + a character cursor — NOT pre-split into whitespace tokens,
  // because getline() needs LINE boundaries, which a token split discards
  // (`cin >>` and getline() must share one cursor into the same buffer, the
  // same way real cin/getline interleave on one input stream).
  stdinRaw = ''
  stdinPos = 0

  constructor(prog: Program, stdin = '') {
    this.prog = prog
    this.stdinRaw = stdin
    this.globalFrame = this.pushFrame('globals', '', '_root')
  }

  /** Next whitespace-separated token for `cin >>` — mirrors real cin's
   *  behavior of skipping whitespace and reading one token at a time. */
  nextInputToken(line: number): string {
    while (this.stdinPos < this.stdinRaw.length && /\s/.test(this.stdinRaw[this.stdinPos])) this.stdinPos++
    if (this.stdinPos >= this.stdinRaw.length) {
      throw new RuntimeError('cin: no more input available — add values to the Input field above Run', line)
    }
    const start = this.stdinPos
    while (this.stdinPos < this.stdinRaw.length && !/\s/.test(this.stdinRaw[this.stdinPos])) this.stdinPos++
    return this.stdinRaw.slice(start, this.stdinPos)
  }

  /** Next full LINE for getline() — up to (and consuming) the next '\n', or
   *  to the end of input. Returns null at EOF (no more input) rather than
   *  throwing, so `while (getline(cin, s))` terminates the loop naturally
   *  the way real end-of-stream failure does, instead of erroring out. */
  nextInputLineOrNull(): string | null {
    if (this.stdinPos >= this.stdinRaw.length) return null
    const nl = this.stdinRaw.indexOf('\n', this.stdinPos)
    const end = nl === -1 ? this.stdinRaw.length : nl
    const out = this.stdinRaw.slice(this.stdinPos, end)
    this.stdinPos = nl === -1 ? this.stdinRaw.length : nl + 1
    return out
  }

  /** `cin.ignore()` — the standard fix-up for mixing `cin >>` with a
   *  following getline() (the leftover '\n' after a `>>` read would
   *  otherwise make the next getline() return an empty line). Simplified to
   *  "skip to just past the next newline" regardless of arguments — the
   *  real overload's exact count/delimiter isn't modeled, but this is what
   *  the idiom is reached for in practice. */
  skipToNextLine() {
    const nl = this.stdinRaw.indexOf('\n', this.stdinPos)
    this.stdinPos = nl === -1 ? this.stdinRaw.length : nl + 1
  }

  // ── memory helpers ──
  alloc(cell: Cell): number {
    const a = this.nextAddr++
    this.mem.set(a, cell)
    this.curChanged.push(a)
    return a
  }

  allocConsecutive(cells: Cell[]): number[] {
    return cells.map((c) => this.alloc(c))
  }

  cellAt(addr: number, line: number): Cell {
    const c = this.mem.get(addr)
    if (!c) throw new RuntimeError(`Invalid memory access at freed/unknown address (dangling pointer?)`, line)
    return c
  }

  write(addr: number, v: Val, line: number) {
    const cur = this.mem.get(addr)
    if (!cur) throw new RuntimeError('Write to freed/unknown memory (dangling pointer?)', line)
    if (v.t === 'void' || v.t === 'stream') throw new RuntimeError('Cannot store a void value', line)
    let next: Cell
    if (cur.t === 'num') next = { t: 'num', v: v.t === 'num' ? v.v : v.t === 'bool' ? (v.v ? 1 : 0) : v.t === 'char' ? v.v.charCodeAt(0) : 0, ct: cur.ct }
    else if (cur.t === 'bool') next = { t: 'bool', v: truthy(v) }
    else if (cur.t === 'char') next = { t: 'char', v: v.t === 'char' ? v.v : v.t === 'num' ? String.fromCharCode(v.v | 0) : '?' }
    else if (cur.t === 'str') next = { t: 'str', v: v.t === 'str' ? v.v : fmtVal(v) }
    else if (cur.t === 'ptr') {
      if (v.t === 'ptr') next = { t: 'ptr', v: v.v, pt: cur.pt }
      else if (v.t === 'num' && v.v === 0) next = { t: 'ptr', v: 0, pt: cur.pt }
      else throw new RuntimeError('Cannot assign a non-pointer value to a pointer', line)
    } else if (cur.t === 'iter') {
      if (v.t !== 'iter') throw new RuntimeError('Cannot assign a non-iterator value to an iterator', line)
      next = { t: 'iter', header: v.header, idx: v.idx, et: v.et }
    } else throw new RuntimeError('Cannot assign to an array/object as a whole here', line)
    // int truncation
    if (next.t === 'num' && ['int', 'long', 'short', 'size_t', 'char'].includes(next.ct)) next = { ...next, v: Math.trunc(next.v) }
    this.mem.set(addr, next)
    this.curChanged.push(addr)
    this.counters.assignments++
    this.op()
  }

  readCell(addr: number, line: number): Val {
    const c = this.cellAt(addr, line)
    this.curReads.push(addr)
    this.op()
    if (c.t === 'arr') return { t: 'ptr', v: c.elems[0] ?? 0, pt: c.et }
    if (c.t === 'obj') throw new RuntimeError('An object cannot be used as a plain value here', line)
    return c
  }

  op() {
    this.ops++
    const inv = this.frames[this.frames.length - 1]?.invocation
    if (inv) inv.exclusiveOps++
    if (this.ops > MAX_OPS) throw new RuntimeError('Too many operations — possible infinite loop. Reduce the input size.', 0)
  }

  // ── frames / scopes ──
  pushFrame(fn: string, args: string, callNodeId: string, thisAddr: number | null = null): Frame {
    const invocation: Invocation = { fn, nums: [], childNums: [], exclusiveOps: 0 }
    const f: Frame = { id: this.frameSeq++, fn, args, scopes: [new Map()], callNodeId, thisAddr, invocation }
    this.frames.push(f)
    return f
  }

  declare(name: string, addr: number) {
    const f = this.frames[this.frames.length - 1]
    f.scopes[f.scopes.length - 1].set(name, addr)
  }

  lookup(name: string): number | null {
    const f = this.frames[this.frames.length - 1]
    for (let i = f.scopes.length - 1; i >= 0; i--) {
      const a = f.scopes[i].get(name)
      if (a !== undefined) return a
    }
    // implicit this->field
    if (f.thisAddr !== null) {
      const objCell = this.mem.get(f.thisAddr)
      if (objCell?.t === 'obj' && name in objCell.fields) return objCell.fields[name]
    }
    for (const s of this.globalFrame.scopes) {
      const a = s.get(name)
      if (a !== undefined) return a
    }
    return null
  }

  // ── trace steps ──
  emit(kind: StepKind, line: number, desc: string) {
    if (this.steps.length >= MAX_STEPS) {
      this.truncated = true
      throw new StepsExhausted()
    }
    const top = this.frames[this.frames.length - 1] ?? this.globalFrame
    this.steps.push({
      line,
      kind,
      desc,
      changed: [...new Set(this.curChanged)],
      reads: [...new Set(this.curReads)],
      frames: this.snapshotFrames(),
      heapBlocks: this.snapshotHeap(),
      output: this.output,
      activeCall: top.callNodeId,
      graph: this.snapshotGraph(),
      tree: this.snapshotTree(),
    })
    this.curChanged = []
    this.curReads = []
  }

  snapshotCellValue(c: Cell): { value: string; ptrTo: number | null } {
    if (c.t === 'ptr') {
      if (c.v === 0) return { value: 'null', ptrTo: null }
      if (!this.mem.has(c.v) && !this.findHeaderFor(c.v)) return { value: 'dangling', ptrTo: null }
      return { value: '•', ptrTo: c.v }
    }
    if (c.t === 'iter') {
      const arrCell = this.mem.get(c.header)
      const elemAddr = arrCell?.t === 'arr' ? arrCell.elems[c.idx] : undefined
      if (elemAddr === undefined) return { value: 'end', ptrTo: null }
      return { value: '•', ptrTo: elemAddr }
    }
    return { value: fmtCell(c), ptrTo: null }
  }

  /** If addr is an element inside a live array, return its header addr. */
  findHeaderFor(addr: number): number | null {
    for (const [a, c] of this.mem) {
      if (c.t === 'arr' && c.elems.includes(addr)) return a
    }
    return null
  }

  blockFor(name: string, addr: number, heap: boolean): SnapBlock | null {
    const c = this.mem.get(addr)
    if (!c) return null
    if (c.t === 'arr') {
      // Matrix: every element is itself an array of scalar/pointer cells —
      // a raw `T[R][C]` or a `vector<vector<T>>` built via push_back/ctor.
      // Render it as an actual 2D grid instead of a strip of opaque "[C]"
      // placeholders (what the flat 'array' path below would otherwise do).
      const rowCells = c.elems.map((ea) => this.mem.get(ea))
      const isMatrix =
        c.elems.length > 0 &&
        rowCells.every(
          (rc) => rc?.t === 'arr' && rc.elems.every((ce) => {
            const cc = this.mem.get(ce)
            return cc && cc.t !== 'arr' && cc.t !== 'obj'
          })
        )
      if (isMatrix) {
        const rows: SnapCell[][] = c.elems.map((ea) => {
          const rc = this.mem.get(ea) as Extract<Cell, { t: 'arr' }>
          return rc.elems.map((ce, ci) => {
            const cc = this.mem.get(ce)
            const s = cc ? this.snapshotCellValue(cc) : { value: '?', ptrTo: null }
            return { addr: ce, value: s.value, ptrTo: s.ptrTo, index: ci }
          })
        })
        const firstRow = rowCells[0] as Extract<Cell, { t: 'arr' }> | undefined
        const cCount = Math.max(0, ...rows.map((r) => r.length))
        const typeName =
          c.ctag && firstRow?.ctag
            ? `${c.ctag}<${firstRow.ctag}<${firstRow.et}>>`
            : `${firstRow?.et ?? c.et}[${c.elems.length}][${cCount}]`
        return { id: `b${addr}`, name, type: typeName, kind: 'matrix', heap, addr, cells: [], rows }
      }
      const cells: SnapCell[] = c.elems.map((ea, i) => {
        const ec = this.mem.get(ea)
        const s = ec ? this.snapshotCellValue(ec) : { value: '?', ptrTo: null }
        return { addr: ea, value: s.value, ptrTo: s.ptrTo, index: i }
      })
      const typeName = c.ctag ? `${c.ctag}<${c.et}>` : `${c.et}[${c.elems.length}]`
      return { id: `b${addr}`, name, type: typeName, kind: 'array', heap, addr, cells }
    }
    if (c.t === 'obj') {
      const cells: SnapCell[] = Object.entries(c.fields).map(([fname, fa]) => {
        const fc = this.mem.get(fa)
        const s = fc ? this.snapshotCellValue(fc) : { value: '?', ptrTo: null }
        return { addr: fa, value: s.value, ptrTo: s.ptrTo, field: fname }
      })
      return { id: `b${addr}`, name, type: c.type, kind: 'object', heap, addr, cells }
    }
    const s = this.snapshotCellValue(c)
    const type = c.t === 'num' ? c.ct : c.t === 'ptr' ? `${c.pt}*` : c.t === 'iter' ? `${c.et}*` : c.t === 'str' ? 'string' : c.t
    return { id: `b${addr}`, name, type, kind: 'scalar', heap, addr, cells: [{ addr, value: s.value, ptrTo: s.ptrTo }] }
  }

  snapshotFrames(): FrameSnap[] {
    const out: FrameSnap[] = []
    const all = [this.globalFrame, ...this.frames.filter((f) => f !== this.globalFrame)]
    for (const f of all) {
      const blocks: SnapBlock[] = []
      const seen = new Set<number>()
      for (const scope of f.scopes) {
        for (const [name, addr] of scope) {
          if (seen.has(addr)) continue
          seen.add(addr)
          const b = this.blockFor(name, addr, false)
          if (b) blocks.push(b)
        }
      }
      if (f === this.globalFrame && blocks.length === 0) continue
      out.push({ id: f.id, fn: f.fn, args: f.args, blocks })
    }
    return out
  }

  snapshotHeap(): SnapBlock[] {
    const out: SnapBlock[] = []
    for (const addr of this.heapOrder) {
      if (!this.mem.has(addr)) continue
      const b = this.blockFor(this.heapNames.get(addr) ?? 'heap', addr, true)
      if (b) out.push(b)
    }
    return out
  }

  /** Finds an adjacency-list graph anywhere in live memory — a
   *  `vector<vector<int>>`/`int[][]` shape — regardless of whether it's a
   *  bare local or, as in the textbook `class Graph { vector<vector<int>>
   *  adjList; }` idiom, a field nested inside an object. Scanning raw memory
   *  (rather than the already-built SnapBlock tree) is what makes the nested
   *  case work: blockFor only gives object fields a flattened summary
   *  string, never a full nested block. Paired `visited`/`queue`|`stack`
   *  companions are matched the same way, purely by shape (bool array of the
   *  same length; int queue/stack) — there's no way to know the user's
   *  variable names, so shape is the only signal available. */
  snapshotGraph(): GraphSnap | null {
    // The outer cell's `et` is the row type's own base ('vector' for
    // `vector<vector<int>>`), not 'int' — only the ROWS are int arrays, so
    // the outer cell itself is matched purely by shape (mirrors blockFor's
    // own matrix-detection heuristic).
    let adj: Extract<Cell, { t: 'arr' }> | null = null
    for (const c of this.mem.values()) {
      if (c.t !== 'arr' || c.elems.length === 0) continue
      const isMatrix = c.elems.every((ea) => {
        const rc = this.mem.get(ea)
        return rc?.t === 'arr' && INT_LIKE.has(rc.et)
      })
      if (isMatrix) { adj = c; break }
    }
    if (!adj) return null

    const nodeCount = adj.elems.length
    const seen = new Set<string>()
    for (let i = 0; i < nodeCount; i++) {
      const row = this.mem.get(adj.elems[i])
      if (row?.t !== 'arr') continue
      for (const ea of row.elems) {
        const cc = this.mem.get(ea)
        if (cc?.t !== 'num') continue
        const j = cc.v
        if (Number.isInteger(j) && j >= 0 && j < nodeCount && j !== i) seen.add(`${i}>${j}`)
      }
    }
    const edges: GraphEdge[] = []
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const fwd = seen.has(`${i}>${j}`)
        const bwd = seen.has(`${j}>${i}`)
        if (fwd && bwd) edges.push({ a: i, b: j, directed: false })
        else if (fwd) edges.push({ a: i, b: j, directed: true })
        else if (bwd) edges.push({ a: j, b: i, directed: true })
      }
    }

    let visited: boolean[] | null = null
    let visitedNode: number | null = null
    for (const c of this.mem.values()) {
      if (c.t !== 'arr' || c.et !== 'bool' || c.elems.length !== nodeCount) continue
      visited = c.elems.map((ea) => {
        const bc = this.mem.get(ea)
        return bc?.t === 'bool' ? bc.v : false
      })
      for (let i = 0; i < c.elems.length; i++) {
        if (this.curChanged.includes(c.elems[i])) visitedNode = i
      }
      break
    }

    let queue: number[] | null = null
    let queueKind: 'queue' | 'stack' | null = null
    for (const c of this.mem.values()) {
      if (c.t !== 'arr' || (c.ctag !== 'queue' && c.ctag !== 'stack') || !INT_LIKE.has(c.et)) continue
      queue = c.elems.map((ea) => {
        const nc = this.mem.get(ea)
        return nc?.t === 'num' ? nc.v : NaN
      })
      queueKind = c.ctag
      break
    }

    return { nodeCount, edges, visited, visitedNode, queue, queueKind }
  }

  /** Finds a struct with (at least) two self-referential pointer fields —
   *  the `Node* left; Node* right;` binary-tree idiom, whatever the fields
   *  are actually named — then locates a live instance that ISN'T
   *  referenced as anyone's child (the root) and walks it. Purely
   *  shape-based, same spirit as snapshotGraph: there's no way to know
   *  which struct/variable the student intends as "the tree." A
   *  doubly-linked list (`Node* prev; Node* next;`) also has two
   *  self-pointer fields but doesn't misfire here — every node in a
   *  doubly-linked list ends up referenced by SOME neighbor via one field
   *  or the other, so no root candidate is ever found and this correctly
   *  returns null instead of rendering nonsense. */
  snapshotTree(): TreeSnap | null {
    let treeType: TypeDef | null = null
    let leftField = ''
    let rightField = ''
    for (const td of this.prog.types.values()) {
      const selfPtrFields = td.fields.filter((f) => f.ptr === 1 && f.arrDims.length === 0 && f.type.base === td.name)
      if (selfPtrFields.length >= 2) {
        treeType = td
        leftField = selfPtrFields[0].name
        rightField = selfPtrFields[1].name
        break
      }
    }
    if (!treeType) return null

    const instances: number[] = []
    const referenced = new Set<number>()
    for (const [addr, c] of this.mem) {
      if (c.t !== 'obj' || c.type !== treeType.name) continue
      instances.push(addr)
      const lc = this.mem.get(c.fields[leftField])
      const rc = this.mem.get(c.fields[rightField])
      if (lc?.t === 'ptr' && lc.v !== 0) referenced.add(lc.v)
      if (rc?.t === 'ptr' && rc.v !== 0) referenced.add(rc.v)
    }
    const rootAddr = instances.find((a) => !referenced.has(a))
    if (rootAddr === undefined) return null

    const labelFields = treeType.fields.filter((f) => f.name !== leftField && f.name !== rightField)
    const labelOf = (fields: Record<string, number>): string => {
      const parts = labelFields.map((f) => {
        const fc = this.mem.get(fields[f.name])
        return fc ? fmtCell(fc) : '?'
      })
      return labelFields.length <= 1 ? (parts[0] ?? '') : labelFields.map((f, i) => `${f.name}=${parts[i]}`).join(', ')
    }

    let touchedAddr: number | null = null
    const seen = new Set<number>()
    const walk = (addr: number): TreeNodeSnap | null => {
      if (seen.has(addr)) return null // malformed/cyclic structure — don't hang
      seen.add(addr)
      const c = this.mem.get(addr)
      if (!c || c.t !== 'obj') return null
      if (this.curChanged.includes(addr)) touchedAddr = addr
      const lc = this.mem.get(c.fields[leftField])
      const rc = this.mem.get(c.fields[rightField])
      const left = lc?.t === 'ptr' && lc.v !== 0 ? walk(lc.v) : null
      const right = rc?.t === 'ptr' && rc.v !== 0 ? walk(rc.v) : null
      return { addr, label: labelOf(c.fields), left, right }
    }
    const root = walk(rootAddr)
    return root ? { root, touchedAddr } : null
  }

  // ── construction of storage from types ──
  defaultCell(t: TypeRef, line: number): Cell {
    if (t.ptr > 0) return { t: 'ptr', v: 0, pt: t.base }
    switch (t.base) {
      case 'int': case 'long': case 'short': case 'size_t': case 'auto': return { t: 'num', v: 0, ct: t.base === 'auto' ? 'int' : t.base }
      case 'float': case 'double': return { t: 'num', v: 0, ct: t.base }
      case 'bool': return { t: 'bool', v: false }
      case 'char': return { t: 'char', v: '\0' }
      case 'string': return { t: 'str', v: '' }
      case 'vector': case 'stack': case 'queue': case 'deque': case 'priority_queue':
        return { t: 'arr', elems: [], et: t.targs[0]?.base ?? 'int', dyn: true, ctag: t.base }
      case 'map': case 'unordered_map':
        return { t: 'arr', elems: [], et: t.targs[1]?.base ?? 'int', dyn: true, ctag: t.base }
      case 'set': case 'unordered_set':
        return { t: 'arr', elems: [], et: t.targs[0]?.base ?? 'int', dyn: true, ctag: t.base }
      case 'pair': {
        const t1 = t.targs[0] ?? { base: 'int', targs: [], ptr: 0, ref: false }
        const t2 = t.targs[1] ?? { base: 'int', targs: [], ptr: 0, ref: false }
        const first = this.alloc(this.defaultCell(t1, line))
        const second = this.alloc(this.defaultCell(t2, line))
        return { t: 'obj', type: 'pair', fields: { first, second } }
      }
      default: {
        const td = this.prog.types.get(t.base)
        if (!td) throw new RuntimeError(`Unknown type '${t.base}'`, line)
        return this.buildObject(td, line)
      }
    }
  }

  buildObject(td: TypeDef, line: number): Extract<Cell, { t: 'obj' }> {
    const fields: Record<string, number> = {}
    for (const f of td.fields) {
      let cell: Cell
      if (f.arrDims.length > 0) {
        const dim = f.arrDims[0] ? this.asNum(this.evalR(f.arrDims[0]), line) : 0
        const elemT: TypeRef = { ...f.type, ptr: f.ptr }
        const elems = this.allocConsecutive(Array.from({ length: dim }, () => this.defaultCell(elemT, line)))
        cell = { t: 'arr', elems, et: f.type.base, dyn: false }
      } else {
        cell = this.defaultCell({ ...f.type, ptr: f.ptr }, line)
      }
      const fa = this.alloc(cell)
      fields[f.name] = fa
      if (f.init) {
        const v = this.evalR(f.init)
        this.write(fa, v, line)
      }
    }
    return { t: 'obj', type: td.name, fields }
  }

  // ── sizeof ──
  // Approximate, conventional byte sizes (gcc/x86-64-ish: int=4, long/
  // double/pointer=8, …) — real C++'s sizeof is implementation-defined, so
  // there's no single "correct" answer; what matters for the standard
  // teaching idiom `sizeof(arr)/sizeof(arr[0])` is that these are INTERNALLY
  // consistent (same element size used on both sides of that division).
  sizeOfType(t: TypeRef): number {
    if (t.ptr > 0) return 8
    switch (t.base) {
      case 'char': case 'bool': return 1
      case 'short': return 2
      case 'int': case 'float': case 'size_t': case 'auto': return 4
      case 'long': case 'double': return 8
      case 'string': return 32
      case 'pair': {
        const t1 = t.targs[0] ?? { base: 'int', targs: [], ptr: 0, ref: false }
        const t2 = t.targs[1] ?? { base: 'int', targs: [], ptr: 0, ref: false }
        return this.sizeOfType(t1) + this.sizeOfType(t2)
      }
      case 'vector': case 'stack': case 'queue': case 'deque': case 'priority_queue': return 24
      case 'map': case 'unordered_map': case 'set': case 'unordered_set': return 48
      default: {
        const td = this.prog.types.get(t.base)
        if (!td) return 4
        let sum = 0
        for (const f of td.fields) {
          if (f.ptr > 0) sum += 8
          else if (f.arrDims.length > 0) sum += this.sizeOfType({ ...f.type, ptr: 0 }) // length unknown statically here — element size only
          else sum += this.sizeOfType({ ...f.type, ptr: f.ptr })
        }
        return sum || 4
      }
    }
  }

  sizeOfCell(c: Cell): number {
    switch (c.t) {
      case 'num': return this.sizeOfType({ base: c.ct, targs: [], ptr: 0, ref: false })
      case 'bool': return 1
      case 'char': return 1
      case 'str': return 32
      case 'ptr': return 8
      case 'iter': return 8
      case 'arr': {
        const elemSize = c.elems.length > 0 ? this.sizeOfCell(this.cellAt(c.elems[0], 0)) : this.sizeOfType({ base: c.et, targs: [], ptr: 0, ref: false })
        // A raw/static array's sizeof is its full byte footprint (what makes
        // `sizeof(arr)/sizeof(arr[0])` recover the element count); a dynamic
        // container (vector/…) instead reports its own small control-block
        // size, same as real C++ — its footprint doesn't grow with content.
        return c.dyn ? this.sizeOfType({ base: c.ctag ?? 'vector', targs: [], ptr: 0, ref: false }) : elemSize * c.elems.length
      }
      case 'obj': {
        if (c.type === 'pair') {
          return Object.values(c.fields).reduce((sum, fa) => sum + this.sizeOfCell(this.cellAt(fa, 0)), 0)
        }
        const td = this.prog.types.get(c.type)
        if (!td) return 4
        return Object.values(c.fields).reduce((sum, fa) => sum + this.sizeOfCell(this.cellAt(fa, 0)), 0)
      }
    }
  }

  sizeOfExpr(e: Expr, line: number): number {
    const addr = this.addrOfOrNull(e)
    if (addr !== null) {
      const c = this.mem.get(addr)
      if (c) return this.sizeOfCell(c)
    }
    const v = this.evalR(e)
    if (v.t === 'void' || v.t === 'stream') return 0
    return this.sizeOfCell(this.cellForVal(v))
  }

  asNum(v: Val, line: number): number {
    if (v.t === 'num') return v.v
    if (v.t === 'bool') return v.v ? 1 : 0
    if (v.t === 'char') return v.v.charCodeAt(0)
    if (v.t === 'ptr') return v.v
    throw new RuntimeError('Expected a numeric value', line)
  }

  // ── container / object VALUE semantics ──
  // `Val` (the type evalR returns) is scalars-only — it always was, because
  // C++ arrays historically decayed to a pointer. But vector/stack/queue and
  // struct/class instances are VALUE types: `b = a`, `v.push_back(row)`, and
  // passing one by value must each produce an independent deep copy, not a
  // pointer alias and not a crash. These three helpers are the one place
  // that understands "this expression's value might be a whole structure",
  // used by decl-init, push_back's argument, plain `=` assignment, and
  // by-value function/method parameters.

  /** Recursively clone a cell (and everything it owns) into FRESH addresses. */
  deepCopyCell(srcAddr: number, line: number): number {
    const c = this.cellAt(srcAddr, line)
    if (c.t === 'arr') {
      const elems = c.elems.map((ea) => this.deepCopyCell(ea, line))
      return this.alloc({ ...c, elems })
    }
    if (c.t === 'obj') {
      const fields: Record<string, number> = {}
      for (const [k, fa] of Object.entries(c.fields)) fields[k] = this.deepCopyCell(fa, line)
      return this.alloc({ ...c, fields })
    }
    return this.alloc({ ...c })
  }

  /** Overwrite dst IN PLACE with a deep copy of src's structure — dst keeps
   *  its own address, so anything already pointing at it sees the new
   *  contents (matches `existingVector = otherVector` semantics). */
  copyCellInto(dstAddr: number, srcAddr: number, line: number) {
    const src = this.cellAt(srcAddr, line)
    if (src.t === 'arr') {
      const elems = src.elems.map((ea) => this.deepCopyCell(ea, line))
      this.mem.set(dstAddr, { ...src, elems })
    } else if (src.t === 'obj') {
      const fields: Record<string, number> = {}
      for (const [k, fa] of Object.entries(src.fields)) fields[k] = this.deepCopyCell(fa, line)
      this.mem.set(dstAddr, { ...src, fields })
    } else {
      this.mem.set(dstAddr, { ...src })
    }
    this.curChanged.push(dstAddr)
  }

  /** `vector<T>(n)` / `vector<T>(n, fill)` / `vector<T>()` — also stack and
   *  queue. `fill` may itself be a container expression, which is what makes
   *  `vector<vector<int>> grid(rows, vector<int>(cols, 0))` — the standard
   *  one-liner matrix idiom — actually build a real 2D structure. */
  buildContainer(t: TypeRef, ctorArgs: Expr[], line: number): number {
    const et: TypeRef = t.targs[0] ?? { base: 'int', targs: [], ptr: 0, ref: false }
    const n = ctorArgs[0] ? Math.max(0, this.asNum(this.evalR(ctorArgs[0]), line) | 0) : 0
    const fillExpr = ctorArgs[1]
    const elems: number[] = []
    for (let i = 0; i < n; i++) {
      elems.push(fillExpr ? this.copyOfExprValue(fillExpr, et, line) : this.alloc(this.defaultCell(et, line)))
    }
    return this.alloc({ t: 'arr', elems, et: et.base, dyn: true, ctag: t.base as 'vector' | 'stack' | 'queue' | 'deque' | 'priority_queue' })
  }

  /** `Node n = {1, 2};` — brace aggregate-init for a struct/class (or
   *  `pair<T1,T2> p = {1, 2};`), field-order like `evalNew`'s own aggregate-
   *  init for `new Node(args)` (which this mirrors — neither handles a
   *  nested-braces field, matching real C++ aggregate-init depth this
   *  interpreter otherwise supports). */
  buildStructFromInitList(t: TypeRef, items: Expr[], line: number): number {
    if (t.base === 'pair') {
      const t1 = t.targs[0] ?? { base: 'int', targs: [], ptr: 0, ref: false }
      const t2 = t.targs[1] ?? { base: 'int', targs: [], ptr: 0, ref: false }
      const first = items[0] ? this.copyOfExprValue(items[0], t1, line) : this.alloc(this.defaultCell(t1, line))
      const second = items[1] ? this.copyOfExprValue(items[1], t2, line) : this.alloc(this.defaultCell(t2, line))
      return this.alloc({ t: 'obj', type: 'pair', fields: { first, second } })
    }
    const td = this.prog.types.get(t.base)
    if (!td) throw new RuntimeError(`Unknown type '${t.base}'`, line)
    const objCell = this.buildObject(td, line)
    const addr = this.alloc(objCell)
    td.fields.forEach((f, i) => {
      if (i < items.length) this.write(objCell.fields[f.name], this.evalR(items[i]), line)
    })
    return addr
  }

  /** `map<K,V> m = {{"a",1}, {"b",2}};` — each item is a `{key, value}`
   *  brace pair (unlike a set's flat `{1,2,3}`, reused via buildFromInitList
   *  below). Kept sorted by key on construction, same as insert(). */
  buildMapFromInitList(t: TypeRef, items: Expr[], line: number): number {
    const kt = t.targs[0] ?? { base: 'int', targs: [], ptr: 0, ref: false }
    const vt = t.targs[1] ?? { base: 'int', targs: [], ptr: 0, ref: false }
    const elems = items.map((it) => {
      if (it.k !== 'initlist' || it.items.length !== 2) throw new RuntimeError('Expected a {key, value} pair', line)
      const first = this.copyOfExprValue(it.items[0], kt, line)
      const second = this.copyOfExprValue(it.items[1], vt, line)
      return this.alloc({ t: 'obj', type: 'pair', fields: { first, second } })
    })
    return this.alloc({
      t: 'arr',
      elems: this.sortAddrsAscending(elems, line),
      et: vt.base,
      dyn: true,
      ctag: t.base as 'map' | 'unordered_map',
    })
  }

  /** Resolve an expression that should produce a `pair`-shaped value — a
   *  `make_pair(...)` call, an existing pair variable, or an inline `{k, v}`
   *  literal (map::insert's usual argument shapes) — into its (first,
   *  second) field addresses, without needing to know the pair's element
   *  types ahead of time: each field's cell shapes itself from the
   *  literal's own runtime value, same `auto`-inference convention used
   *  elsewhere (cellForVal). */
  resolveAsPairFields(e: Expr, line: number): { first: number; second: number } {
    if (e.k === 'initlist') {
      if (e.items.length !== 2) throw new RuntimeError('Expected a {key, value} pair', line)
      return {
        first: this.alloc(this.cellForVal(this.evalR(e.items[0]) as Exclude<Val, { t: 'void' } | { t: 'stream' }>)),
        second: this.alloc(this.cellForVal(this.evalR(e.items[1]) as Exclude<Val, { t: 'void' } | { t: 'stream' }>)),
      }
    }
    const src = this.resolveObjectSource(e, line)
    if (src !== null) {
      const c = this.cellAt(src, line)
      if (c.t === 'obj' && c.type === 'pair') return { first: c.fields.first, second: c.fields.second }
    }
    throw new RuntimeError('Expected a pair (e.g. make_pair(k, v) or {k, v})', line)
  }

  /** `set<T> s = {5, 3, 3, 1, 4};` — unlike a vector's flat initlist, a set
   *  must deduplicate and stay sorted, so this inserts one at a time through
   *  the same exists-check `insert()` uses rather than bulk-building then
   *  reconciling duplicates after the fact. */
  buildSetFromInitList(t: TypeRef, items: Expr[], line: number): number {
    const et: TypeRef = t.targs[0] ?? { base: 'int', targs: [], ptr: 0, ref: false }
    const header = this.alloc({ t: 'arr', elems: [], et: et.base, dyn: true, ctag: t.base as 'set' | 'unordered_set' })
    for (const it of items) {
      const v = this.evalR(it)
      if (v.t === 'void' || v.t === 'stream') throw new RuntimeError('Cannot insert a void value into a set', line)
      const cell = this.cellAt(header, line)
      if (cell.t !== 'arr') continue
      const exists = cell.elems.some((ea) => this.valsEqual(this.readCell(ea, line), v, line))
      if (exists) continue
      const a = this.alloc(this.cellForVal(v))
      this.mem.set(header, { ...cell, elems: this.sortAddrsAscending([...cell.elems, a], line) })
    }
    return header
  }

  /** `{1, 2, 3}` (or nested, `{{1,2},{3,4}}`) for a vector/stack/queue decl. */
  buildFromInitList(t: TypeRef, items: Expr[], line: number): number {
    const et: TypeRef = t.targs[0] ?? { base: 'int', targs: [], ptr: 0, ref: false }
    const isContainerEt = ARR_CTAGS.has(et.base)
    const elems = items.map((it) =>
      it.k === 'initlist' && isContainerEt ? this.buildFromInitList(et, it.items, line) : this.copyOfExprValue(it, et, line)
    )
    return this.alloc({ t: 'arr', elems, et: et.base, dyn: true, ctag: t.base as 'vector' | 'stack' | 'queue' | 'deque' | 'priority_queue' })
  }

  /** Resolve one call argument against its parameter (builtins/ctors have no
   *  declared params, hence `| undefined`): a reference param aliases the
   *  caller's own cell (`&ref`, unchanged from before); a vector/stack/queue
   *  or struct/class VALUE param (no `*`, and `int arr[]` params already
   *  parse as pointers — see parseParams) is deep-copied into a fresh,
   *  independent cell and tagged `&byval` — callFunction recognizes that tag
   *  and binds the frame's param straight to it. A raw array/pointer param
   *  deliberately keeps the classic decay-to-pointer behavior below (plain
   *  evalR): that's what lets `bubbleSort(int arr[], int n)` mutate the
   *  CALLER's array in place, which is the entire point of passing one. A
   *  plain scalar also goes through evalR exactly as before: no extra
   *  allocation, so recursion-analytics (numericArgs, keyed off
   *  `Val.t === 'num'`) and the changed-cell highlight trail are untouched
   *  for the common case. */
  bindArg(argExpr: Expr, param: Param | undefined, line: number): Val {
    if (param?.type.ref) return { t: 'ptr', v: this.addrOf(argExpr), pt: '&ref' }
    const isValueContainer = param !== undefined && param.type.ptr === 0 && this.isValueTypeBase(param.type.base)
    if (isValueContainer) {
      const src = this.resolveObjectSource(argExpr, line)
      if (src !== null) return { t: 'ptr', v: this.deepCopyCell(src, line), pt: '&byval' }
    }
    return this.evalR(argExpr)
  }

  /** Reorders a list of element ADDRESSES (not their values — the addresses
   *  themselves, so this works for `priority_queue`'s own `elems` list
   *  without needing to write anything into a fixed slot the way the
   *  `sort()` builtin does) into ascending order by value. A `pair` element
   *  sorts by its `.first` field — real C++ pairs compare lexicographically
   *  (first, then second), but `.first` alone is the dominant case (a
   *  priority_queue<pair<int,int>> keyed by distance/weight, the standard
   *  Dijkstra/Prim idiom) and covers it without needing full tuple
   *  comparison. */
  sortAddrsAscending(addrs: number[], line: number): number[] {
    const keyOf = (addr: number): number | string => {
      const c = this.cellAt(addr, line)
      if (c.t === 'obj' && c.type === 'pair' && 'first' in c.fields) {
        const fv = this.readCell(c.fields.first, line)
        return fv.t === 'str' ? fv.v : this.asNum(fv, line)
      }
      const v = this.readCell(addr, line)
      return v.t === 'str' ? v.v : this.asNum(v, line)
    }
    const withKey = addrs.map((addr) => ({ addr, key: keyOf(addr) }))
    withKey.sort((x, y) =>
      typeof x.key === 'string'
        ? x.key < (y.key as string) ? -1 : x.key > (y.key as string) ? 1 : 0
        : (x.key as number) - (y.key as number)
    )
    return withKey.map((w) => w.addr)
  }

  /** readCell, but a whole object VALUE (a `pair`/struct/class instance)
   *  decays to a pointer at its own address instead of throwing — needed by
   *  container accessors (`top`/`front`/`back`/`at`) that must be able to
   *  hand back a container-of-objects' element, not just a scalar. Matches
   *  the decay convention `new`/ctor-calls/`make_pair` already use; scoped
   *  to these accessors rather than folded into `readCell` itself, which
   *  elsewhere deliberately THROWS on a bare object read as a guard against
   *  treating a whole struct as a scalar somewhere unsupported. */
  readOrDecayCell(addr: number, line: number): Val {
    const c = this.cellAt(addr, line)
    if (c.t === 'obj') {
      this.curReads.push(addr)
      this.op()
      return { t: 'ptr', v: addr, pt: c.type }
    }
    return this.readCell(addr, line)
  }

  /** True for any base type whose VALUE is a whole structure (a container
   *  or a struct/class instance) rather than a scalar — these always need
   *  deep-copy value semantics (assignment, by-value params, decl-init),
   *  never a bare scalar write. */
  isValueTypeBase(base: string): boolean {
    return (
      ARR_CTAGS.has(base) ||
      base === 'pair' ||
      base === 'map' ||
      base === 'unordered_map' ||
      base === 'set' ||
      base === 'unordered_set' ||
      this.prog.types.has(base)
    )
  }

  /** Address of a whole container/object VALUE ready to copy from — a
   *  `vector<T>(…)`/`pair<T,T>(…)` ctor-call, a variable naming an existing
   *  container/object, or a CALL expression that produces one BY VALUE
   *  (e.g. `make_pair(a, b)`), which decays to a pointer at its own address
   *  the same way `new`/a ctor-call already do. Returns null if `e` isn't
   *  any of these — callers fall back to their own plain-scalar path then. */
  resolveObjectSource(e: Expr, line: number): number | null {
    if (e.k === 'ctorcall') return this.buildContainer(e.type, e.args, line)
    const srcAddr = this.addrOfOrNull(e)
    if (srcAddr !== null) {
      const c = this.mem.get(srcAddr)
      if (c && (c.t === 'arr' || c.t === 'obj')) return srcAddr
    } else if (e.k === 'call') {
      const v = this.evalR(e)
      if (v.t === 'ptr' && v.v !== 0) {
        const c = this.mem.get(v.v)
        if (c && (c.t === 'arr' || c.t === 'obj')) return v.v
      }
    }
    return null
  }

  /** The value of `e`, materialized into a FRESH address of type `target`:
   *  a deep copy if `e` is a `vector<T>(…)` ctor-call or names an existing
   *  container/object variable AND `target` itself is declared as that value
   *  type (not a pointer — `int* p = arr;` must still DECAY to a pointer
   *  aliasing the same memory, never copy it, or in-place mutation through
   *  `p` would silently stop reaching `arr`). Otherwise a plain scalar cell
   *  (unchanged behavior — evalR + write, exactly as every call site did
   *  before this existed). Used anywhere a value (not a reference) is
   *  needed: decl init, a container's fill element, push_back's argument. */
  copyOfExprValue(e: Expr, target: TypeRef, line: number): number {
    // Brace-init used inline as a value (`push_back({3, 4})`, a fill/resize
    // arg, …) — same aggregate-build the decl-init path uses, just reached
    // from a container-method/argument site instead of `execDecl` directly.
    if (e.k === 'initlist' && target.ptr === 0) {
      if (ARR_CTAGS.has(target.base)) return this.buildFromInitList(target, e.items, line)
      if (target.base === 'pair' || this.prog.types.has(target.base)) return this.buildStructFromInitList(target, e.items, line)
    }
    const isValueTarget = target.ptr === 0 && this.isValueTypeBase(target.base)
    if (isValueTarget) {
      const src = this.resolveObjectSource(e, line)
      if (src !== null) return this.deepCopyCell(src, line)
    }
    // `auto x = expr;` (bare, no `*`) can't pre-build a cell shape the way
    // every other declared type can — `defaultCell` used to guess 'int' and
    // then silently coerce/zero whatever the initializer actually was. That
    // was invisible for numeric inits but corrupted anything else: `auto p =
    // &y;` and `auto it = v.begin();` both stored 0. Evaluate first and let
    // the real Val shape decide the cell.
    if (target.base === 'auto' && target.ptr === 0) {
      const v = this.evalR(e)
      if (v.t === 'void' || v.t === 'stream') throw new RuntimeError('Cannot initialize a variable from a void expression', line)
      return this.alloc(this.cellForVal(v))
    }
    const addr = this.alloc(this.defaultCell(target, line))
    this.write(addr, this.evalR(e), line)
    return addr
  }

  /** Build a Cell that exactly matches a scalar/pointer/iterator Val's shape
   *  — used for `auto` inference, where the declared type can't be known
   *  ahead of evaluating the initializer. */
  cellForVal(v: Exclude<Val, { t: 'void' } | { t: 'stream' }>): Cell {
    switch (v.t) {
      case 'num': return { t: 'num', v: v.v, ct: v.ct }
      case 'bool': return { t: 'bool', v: v.v }
      case 'char': return { t: 'char', v: v.v }
      case 'str': return { t: 'str', v: v.v }
      case 'ptr': return { t: 'ptr', v: v.v, pt: v.pt }
      case 'iter': return { t: 'iter', header: v.header, idx: v.idx, et: v.et }
    }
  }

  /** Resolve a `[first, last)` argument pair — either vector iterators
   *  (index-based, via the array's elems list) or raw decayed pointers
   *  (address-based, contiguous by construction) — into the ordered list of
   *  real element addresses in between. The one place sort/find/reverse/
   *  min_element/max_element share, so both `sort(v.begin(), v.end())` and
   *  the classic `sort(arr, arr + n)` work. */
  resolveRange(a: Val, b: Val, line: number): number[] {
    if (a.t === 'iter' && b.t === 'iter') {
      if (a.header !== b.header) throw new RuntimeError('Iterators are from different containers', line)
      const c = this.cellAt(a.header, line)
      if (c.t !== 'arr') throw new RuntimeError('Invalid iterator range', line)
      const lo = Math.max(0, Math.min(a.idx, b.idx, c.elems.length))
      const hi = Math.max(0, Math.min(Math.max(a.idx, b.idx), c.elems.length))
      return c.elems.slice(lo, hi)
    }
    if (a.t === 'ptr' && b.t === 'ptr') {
      const lo = Math.min(a.v, b.v)
      const hi = Math.max(a.v, b.v)
      const out: number[] = []
      for (let addr = lo; addr < hi; addr++) out.push(addr)
      return out
    }
    throw new RuntimeError('Expected a matching pair of iterators/pointers (e.g. v.begin(), v.end())', line)
  }

  /** Same equality real C++ `==` would use for the scalar element types this
   *  interpreter supports (numbers, chars, bools, strings). */
  valsEqual(a: Val, b: Val, line: number): boolean {
    if (a.t === 'str' || b.t === 'str') return fmtVal(a, true) === fmtVal(b, true)
    return this.asNum(a, line) === this.asNum(b, line)
  }

  /** Ordering compare for the same scalar element types — negative/zero/
   *  positive like a normal comparator. Shared by binary_search/lower_bound/
   *  upper_bound (all assume an ascending-sorted range, same as real C++). */
  cmpVals(a: Val, b: Val, line: number): number {
    if (a.t === 'str' || b.t === 'str') {
      const as = fmtVal(a, true)
      const bs = fmtVal(b, true)
      return as < bs ? -1 : as > bs ? 1 : 0
    }
    return this.asNum(a, line) - this.asNum(b, line)
  }

  // ── declaration execution ──
  execDecl(s: Extract<Stmt, { k: 'decl' }>) {
    for (const d of s.decls) {
      const t: TypeRef = { ...s.type, ptr: s.type.ptr + d.ptr }
      // Reference variable: `int &a = b;` / `Node &curr = node;` — alias the
      // initializer's OWN address rather than allocating a fresh cell, same
      // convention reference PARAMETERS already use (bindArg/callFunction).
      if (d.ref) {
        if (!d.init) throw new RuntimeError(`Reference '${d.name}' must be initialized`, s.line)
        const addr = this.addrOf(d.init)
        this.declare(d.name, addr)
        this.emit('decl', s.line, `${typeName(t)}& ${d.name} = ${pe(d.init)}`)
        continue
      }
      let addr: number
      let descVal = ''
      const isContainerType = ARR_CTAGS.has(t.base)
      if (d.arrDims.length > 0) {
        addr = this.allocArray(t, d.arrDims, d.init, s.line)
        const c = this.mem.get(addr)
        descVal = c?.t === 'arr' ? fmtArrShort(c, this.mem) : ''
      } else if (d.init && d.init.k === 'initlist' && isContainerType) {
        // {1,2,3} — items may themselves be nested initlists (a matrix
        // literal like `vector<vector<int>> grid = {{1,2},{3,4}};`).
        addr = this.buildFromInitList(t, d.init.items, s.line)
        descVal = `{${d.init.items.map(pe).join(', ')}}`
      } else if (d.init && d.init.k === 'initlist' && t.ptr === 0 && (t.base === 'pair' || this.prog.types.has(t.base))) {
        // Node n = {1, 2};  /  pair<int,int> p = {1, 2};
        addr = this.buildStructFromInitList(t, d.init.items, s.line)
        descVal = `{${d.init.items.map(pe).join(', ')}}`
      } else if (d.init && d.init.k === 'initlist' && (t.base === 'map' || t.base === 'unordered_map')) {
        // map<K,V> m = {{"a",1}, {"b",2}};
        addr = this.buildMapFromInitList(t, d.init.items, s.line)
        descVal = `{${d.init.items.map(pe).join(', ')}}`
      } else if (d.init && d.init.k === 'initlist' && (t.base === 'set' || t.base === 'unordered_set')) {
        // set<T> s = {5, 3, 3, 1, 4}; — deduplicates, stays sorted.
        addr = this.buildSetFromInitList(t, d.init.items, s.line)
        descVal = `{${d.init.items.map(pe).join(', ')}}`
      } else if (d.ctorArgs && isContainerType) {
        // vector<T> v(n) / v(n, fill) — fill may be a nested `vector<T>(…)`
        // ctorcall, which is what actually builds a 2D matrix in one line.
        addr = this.buildContainer(t, d.ctorArgs, s.line)
        const c = this.mem.get(addr)
        descVal = c?.t === 'arr' ? fmtArrShort(c, this.mem) : ''
      } else if (d.ctorArgs && t.base === 'pair') {
        // pair<int,int> p(1, 2);
        addr = this.buildStructFromInitList(t, d.ctorArgs, s.line)
        descVal = `{${d.ctorArgs.map(pe).join(', ')}}`
      } else if (d.init) {
        // Deep-copies when the RHS is a container/object (variable or a
        // `vector<T>(…)` ctorcall); plain evalR+write otherwise — same as
        // before for every scalar/pointer initializer.
        addr = this.copyOfExprValue(d.init, t, s.line)
        const c = this.mem.get(addr)
        descVal = c?.t === 'arr' ? fmtArrShort(c, this.mem) : c?.t === 'obj' ? c.type : c ? fmtCell(c) : ''
      } else {
        const cell = this.defaultCell(t, s.line)
        addr = this.alloc(cell)
        if (d.ctorArgs && cell.t === 'obj') {
          const td = this.prog.types.get(t.base)
          if (td?.ctor) this.callFunction(td.ctor, d.ctorArgs.map((a) => this.evalR(a)), s.line, addr, d.ctorArgs.map(pe).join(', '))
        } else if (d.ctorArgs && d.ctorArgs.length === 1) {
          const v = this.evalR(d.ctorArgs[0])
          this.write(addr, v, s.line)
          descVal = fmtVal(v)
        }
        // run user constructor for plain `Node n;`
        if (cell.t === 'obj' && !d.ctorArgs) {
          const td = this.prog.types.get(t.base)
          if (td?.ctor && td.ctor.params.length === 0) this.callFunction(td.ctor, [], s.line, addr, '')
        }
      }
      this.declare(d.name, addr)
      const tn = typeName(t)
      // A declaration whose initializer allocates on the heap reads as an
      // allocation event first and a plain decl second — same distinction
      // the 'alloc' step kind exists for (heap-tracker color in dsa.tsx).
      const kind: StepKind = d.init?.k === 'new' ? 'alloc' : 'decl'
      this.emit(kind, s.line, descVal ? `${tn} ${d.name} = ${descVal}` : `${tn} ${d.name}`)
    }
  }

  allocArray(t: TypeRef, dims: (Expr | null)[], init: Expr | undefined, line: number): number {
    const dimVals = dims.map((d) => (d ? Math.max(0, this.asNum(this.evalR(d), line) | 0) : -1))
    const initItems = init?.k === 'initlist' ? init.items : undefined
    if (dimVals[0] === -1) dimVals[0] = initItems ? initItems.length : 0
    const buildLevel = (level: number, items: Expr[] | undefined): number => {
      const count = dimVals[level] === -1 ? (items?.length ?? 0) : dimVals[level]
      const isLeaf = level === dimVals.length - 1
      const elems: number[] = []
      if (isLeaf) {
        const cells = Array.from({ length: count }, () => this.defaultCell(t, line))
        elems.push(...this.allocConsecutive(cells))
        if (items) {
          items.slice(0, count).forEach((it, i) => {
            this.write(elems[i], this.evalR(it), line)
          })
        }
      } else {
        for (let i = 0; i < count; i++) {
          const sub = items?.[i]
          elems.push(buildLevel(level + 1, sub?.k === 'initlist' ? sub.items : undefined))
        }
      }
      return this.alloc({ t: 'arr', elems, et: t.base, dyn: false })
    }
    return buildLevel(0, initItems)
  }

  // ── statements ──
  execStmt(s: Stmt): void {
    switch (s.k) {
      case 'decl': return this.execDecl(s)
      case 'block': {
        const f = this.frames[this.frames.length - 1]
        f.scopes.push(new Map())
        try {
          for (const st of s.body) this.execStmt(st)
        } finally {
          f.scopes.pop()
        }
        return
      }
      case 'expr': {
        const hadOutput = this.output.length
        const isBareUserCall = s.e.k === 'call' && s.e.callee.k === 'id' && this.prog.funcs.has(s.e.callee.name)
        const v = this.evalR(s.e)
        if (isBareUserCall) return // entry/return steps already emitted
        const isIO = this.output.length > hadOutput
        // `p = new Node();` (an assignment INTO an existing pointer, not a
        // fresh decl — that case is handled in execDecl) is an allocation
        // event first, same distinction as there.
        const isAlloc = s.e.k === 'new' || (s.e.k === 'assign' && s.e.value.k === 'new')
        const kind: StepKind = isIO ? 'io' : isAlloc ? 'alloc' : s.e.k === 'assign' || s.e.k === 'un' ? 'assign' : 'flow'
        let desc = pe(s.e)
        if (s.e.k === 'assign') desc = `${pe(s.e.target)} ${s.e.op} ${fmtValOrExpr(v, s.e.value)}`
        if (isIO) desc = `cout ≪ ${JSON.stringify(this.output.slice(hadOutput))}`
        this.emit(kind, s.line, desc)
        return
      }
      case 'if': {
        const c = truthy(this.evalR(s.c))
        this.counters.comparisons++
        this.emit('compare', s.line, `if (${pe(s.c)}) → ${c}`)
        if (c) this.execStmt(s.t)
        else if (s.f) this.execStmt(s.f)
        return
      }
      case 'while': {
        this.loopDepth++
        this.counters.maxLoopDepth = Math.max(this.counters.maxLoopDepth, this.loopDepth)
        try {
          for (;;) {
            const c = truthy(this.evalR(s.c))
            this.counters.comparisons++
            this.emit('compare', s.line, `while (${pe(s.c)}) → ${c}`)
            if (!c) break
            this.counters.iterations++
            try {
              this.execStmt(s.body)
            } catch (e) {
              if (e instanceof BreakSig) break
              if (!(e instanceof ContinueSig)) throw e
            }
          }
        } finally {
          this.loopDepth--
        }
        return
      }
      case 'do': {
        this.loopDepth++
        this.counters.maxLoopDepth = Math.max(this.counters.maxLoopDepth, this.loopDepth)
        try {
          for (;;) {
            this.counters.iterations++
            try {
              this.execStmt(s.body)
            } catch (e) {
              if (e instanceof BreakSig) break
              if (!(e instanceof ContinueSig)) throw e
            }
            const c = truthy(this.evalR(s.c))
            this.counters.comparisons++
            this.emit('compare', s.line, `do…while (${pe(s.c)}) → ${c}`)
            if (!c) break
          }
        } finally {
          this.loopDepth--
        }
        return
      }
      case 'for': {
        const f = this.frames[this.frames.length - 1]
        f.scopes.push(new Map())
        this.loopDepth++
        this.counters.maxLoopDepth = Math.max(this.counters.maxLoopDepth, this.loopDepth)
        try {
          if (s.init) this.execStmt(s.init)
          for (;;) {
            if (s.c) {
              const c = truthy(this.evalR(s.c))
              this.counters.comparisons++
              this.emit('compare', s.line, `for: ${pe(s.c)} → ${c}`)
              if (!c) break
            }
            this.counters.iterations++
            try {
              this.execStmt(s.body)
            } catch (e) {
              if (e instanceof BreakSig) break
              if (!(e instanceof ContinueSig)) throw e
            }
            if (s.inc) {
              this.evalR(s.inc)
              this.emit('assign', s.line, pe(s.inc))
            }
          }
        } finally {
          this.loopDepth--
          f.scopes.pop()
        }
        return
      }
      case 'forRange': {
        const iterV = s.iter
        const baseAddr = this.addrOfOrNull(iterV)
        const cell = baseAddr !== null ? this.mem.get(baseAddr) : undefined
        if (!cell || cell.t !== 'arr') throw new RuntimeError('Range-for needs an array or vector', s.line)
        const f = this.frames[this.frames.length - 1]
        f.scopes.push(new Map())
        this.loopDepth++
        this.counters.maxLoopDepth = Math.max(this.counters.maxLoopDepth, this.loopDepth)
        // `for (auto w : words)` over a vector<string> (or bool/char) hit the
        // same shape-inference gap as bare `auto x = expr;` — defaultCell
        // guessed 'int' before seeing an element, so a string element wrote
        // as 0. Peek the first element's actual (scalar) shape instead.
        const firstCell = cell.elems.length > 0 ? this.mem.get(cell.elems[0]) : undefined
        const isContainerElem = firstCell !== undefined && (firstCell.t === 'arr' || firstCell.t === 'obj')
        // Elements that are themselves vectors/objects (the standard
        // `for (auto& row : grid)` matrix walk, then `for (auto& cell :
        // row)` inside it) can't be represented by copying a VALUE into a
        // fixed scalar cell the way `int x : vec` can — there's no scalar to
        // copy. `&` aliases the loop var directly onto each element's own
        // address (so nested range-for sees a real array, and mutations
        // through the loop var reach the source container, matching C++
        // reference semantics); without `&`, deep-copy each element into a
        // fresh cell instead, matching by-value semantics.
        const byRef = s.ref
        let varAddr = -1
        if (!byRef && !isContainerElem) {
          // Plain scalar `auto`/typed loop var: one cell, overwritten via
          // write() below each iteration (existing behavior, unchanged) —
          // `auto` infers the element's own shape; an explicit type (e.g.
          // `double x : intVec`) keeps its declared cell so values convert
          // into it the same way an assignment would.
          const varCell =
            s.type.base === 'auto' && s.type.ptr === 0 && firstCell && firstCell.t !== 'arr' && firstCell.t !== 'obj'
              ? this.cellForVal(firstCell)
              : this.defaultCell(s.type, s.line)
          varAddr = this.alloc(varCell)
          this.declare(s.name, varAddr)
        }
        try {
          for (const ea of [...cell.elems]) {
            this.counters.iterations++
            if (byRef || isContainerElem) {
              const addr = byRef ? ea : this.deepCopyCell(ea, s.line)
              this.declare(s.name, addr)
              this.emit('assign', s.line, `${s.name} ${byRef ? '&= ' : '= '}${pe(iterV)}[…]`)
            } else {
              const v = this.readCell(ea, s.line)
              this.write(varAddr, v, s.line)
              this.emit('assign', s.line, `${s.name} = ${fmtVal(v)}`)
            }
            try {
              this.execStmt(s.body)
            } catch (e) {
              if (e instanceof BreakSig) break
              if (!(e instanceof ContinueSig)) throw e
            }
          }
        } finally {
          this.loopDepth--
          f.scopes.pop()
        }
        return
      }
      case 'return': {
        const v: Val = s.e ? this.evalR(s.e) : { t: 'void' }
        throw new ReturnSig(v)
      }
      case 'break':
        this.emit('flow', s.line, 'break')
        throw new BreakSig()
      case 'continue':
        this.emit('flow', s.line, 'continue')
        throw new ContinueSig()
      case 'switch': {
        const d = this.evalR(s.disc)
        this.counters.comparisons++
        this.emit('compare', s.line, `switch (${pe(s.disc)}) → ${fmtVal(d)}`)
        let matched = false
        try {
          for (const c of s.cases) {
            if (!matched) {
              if (c.match === null) matched = true
              else {
                const m = this.evalR(c.match)
                if (this.asNum(m, s.line) === this.asNum(d, s.line)) matched = true
              }
            }
            if (matched) for (const st of c.body) this.execStmt(st)
          }
        } catch (e) {
          if (!(e instanceof BreakSig)) throw e
        }
        return
      }
      case 'delete': {
        const v = this.evalR(s.e)
        if (v.t !== 'ptr' || v.v === 0) {
          this.emit('free', s.line, `delete ${pe(s.e)} (null — no effect)`)
          return
        }
        this.freeAt(v.v)
        this.counters.frees++
        this.emit('free', s.line, `delete${s.arr ? '[]' : ''} ${pe(s.e)}`)
        return
      }
    }
  }

  freeAt(addr: number) {
    // pointer may target a header, an object, or the first element of a new[] block
    let header = this.mem.get(addr)
    let headerAddr = addr
    if (!header || (header.t !== 'arr' && header.t !== 'obj')) {
      const h = this.findHeaderFor(addr)
      if (h !== null && this.heapOrder.includes(h)) {
        headerAddr = h
        header = this.mem.get(h)
      }
    }
    const c = header
    if (c?.t === 'arr') for (const ea of c.elems) this.mem.delete(ea)
    if (c?.t === 'obj') {
      for (const fa of Object.values(c.fields)) {
        const fc = this.mem.get(fa)
        if (fc?.t === 'arr') for (const ea of fc.elems) this.mem.delete(ea)
        this.mem.delete(fa)
      }
    }
    this.mem.delete(headerAddr)
    this.heapOrder = this.heapOrder.filter((a) => a !== headerAddr)
  }

  // ── expressions ──
  addrOfOrNull(e: Expr): number | null {
    try {
      return this.addrOf(e)
    } catch {
      return null
    }
  }

  addrOf(e: Expr): number {
    switch (e.k) {
      case 'id': {
        const a = this.lookup(e.name)
        if (a === null) throw new RuntimeError(`'${e.name}' is not declared`, e.line)
        return a
      }
      case 'index': {
        const baseAddr = this.addrOfOrNull(e.base)
        const baseCell = baseAddr !== null ? this.mem.get(baseAddr) : undefined
        // map/unordered_map's operator[] takes a KEY, not a numeric index —
        // must be checked (and e.idx evaluated as a plain Val, not eagerly
        // coerced to a number below) before the generic numeric-index path.
        if (baseCell?.t === 'arr' && (baseCell.ctag === 'map' || baseCell.ctag === 'unordered_map')) {
          const key = this.evalR(e.idx)
          if (key.t === 'void' || key.t === 'stream') throw new RuntimeError('Cannot use a void value as a map key', e.line)
          const existing = baseCell.elems.find((ea) => {
            const pc = this.cellAt(ea, e.line)
            return pc.t === 'obj' && this.valsEqual(this.readCell(pc.fields.first, e.line), key, e.line)
          })
          if (existing !== undefined) {
            const pc = this.cellAt(existing, e.line)
            if (pc.t === 'obj') return pc.fields.second
          }
          // Not found: operator[] auto-inserts a default-valued entry —
          // matches real std::map::operator[] semantics.
          const valueT: TypeRef = { base: baseCell.et, targs: [], ptr: 0, ref: false }
          const keyAddr = this.alloc(this.cellForVal(key))
          const valAddr = this.alloc(this.defaultCell(valueT, e.line))
          const pairAddr = this.alloc({ t: 'obj', type: 'pair', fields: { first: keyAddr, second: valAddr } })
          this.mem.set(baseAddr!, { ...baseCell, elems: this.sortAddrsAscending([...baseCell.elems, pairAddr], e.line) })
          this.curChanged.push(baseAddr!)
          return valAddr
        }
        const idx = this.asNum(this.evalR(e.idx), e.line) | 0
        this.counters.arrayAccesses++
        if (baseCell?.t === 'arr') {
          if (idx < 0 || idx >= baseCell.elems.length)
            throw new RuntimeError(`Index ${idx} out of bounds (size ${baseCell.elems.length}) on '${pe(e.base)}'`, e.line)
          return baseCell.elems[idx]
        }
        // pointer subscript: consecutive addresses
        const p = this.evalR(e.base)
        if (p.t === 'ptr') {
          const target = p.v + idx
          if (!this.mem.has(target)) throw new RuntimeError(`Pointer index ${idx} reaches invalid memory`, e.line)
          return target
        }
        if (p.t === 'str') throw new RuntimeError('Use string as a value; indexing gives a copy (read-only)', e.line)
        throw new RuntimeError(`Cannot index into '${pe(e.base)}'`, e.line)
      }
      case 'member': {
        let objAddr: number
        if (e.arrow) {
          const p = this.evalR(e.base)
          if (p.t === 'iter') {
            // `it->first`/`it->second` — the standard map-iteration idiom.
            // Real C++ overloads `->` for iterators the same as `*it` plus
            // a field access; mirror that by dereferencing exactly like the
            // unary `*` case above does, instead of requiring a raw pointer.
            const ac = this.cellAt(p.header, e.line)
            if (ac.t !== 'arr') throw new RuntimeError('Invalid iterator', e.line)
            if (p.idx < 0 || p.idx >= ac.elems.length) {
              throw new RuntimeError('Dereferencing an out-of-range iterator (did you dereference end()?)', e.line)
            }
            objAddr = ac.elems[p.idx]
          } else if (p.t === 'ptr') {
            if (p.v === 0) throw new RuntimeError(`Null pointer dereference: '${pe(e.base)}' is nullptr`, e.line)
            objAddr = p.v
          } else {
            throw new RuntimeError(`'${pe(e.base)}' is not a pointer or iterator`, e.line)
          }
        } else {
          objAddr = this.addrOf(e.base)
        }
        const oc = this.mem.get(objAddr)
        if (!oc) throw new RuntimeError('Access through a dangling pointer', e.line)
        if (oc.t !== 'obj') throw new RuntimeError(`'${pe(e.base)}' is not an object`, e.line)
        if (!(e.name in oc.fields)) throw new RuntimeError(`No field '${e.name}' in '${oc.type}'`, e.line)
        return oc.fields[e.name]
      }
      case 'un':
        if (e.op === '*') {
          const p = this.evalR(e.e)
          if (p.t === 'iter') {
            const c = this.cellAt(p.header, e.line)
            if (c.t !== 'arr') throw new RuntimeError('Invalid iterator', e.line)
            if (p.idx < 0 || p.idx >= c.elems.length) {
              throw new RuntimeError('Dereferencing an out-of-range iterator (did you dereference end()?)', e.line)
            }
            return c.elems[p.idx]
          }
          if (p.t !== 'ptr') throw new RuntimeError(`Cannot dereference non-pointer '${pe(e.e)}'`, e.line)
          if (p.v === 0) throw new RuntimeError('Null pointer dereference', e.line)
          return p.v
        }
        break
      case 'this': {
        const f = this.frames[this.frames.length - 1]
        if (f.thisAddr === null) throw new RuntimeError("'this' outside a method", e.line)
        return f.thisAddr
      }
      default:
        break
    }
    throw new RuntimeError(`'${pe(e)}' is not assignable (not an l-value)`, e.line)
  }

  evalR(e: Expr): Val {
    this.op()
    switch (e.k) {
      case 'num': return { t: 'num', v: e.v, ct: Number.isInteger(e.v) ? 'int' : 'double' }
      case 'str': return { t: 'str', v: e.v }
      case 'chr': return { t: 'char', v: e.v }
      case 'bool': return { t: 'bool', v: e.v }
      case 'null': return { t: 'ptr', v: 0, pt: 'void' }
      case 'sizeof': {
        if (!e.arg) return { t: 'num', v: 4, ct: 'size_t' }
        const v = e.arg.kind === 'type' ? this.sizeOfType(e.arg.type) : this.sizeOfExpr(e.arg.e, e.line)
        return { t: 'num', v, ct: 'size_t' }
      }
      case 'this': {
        const f = this.frames[this.frames.length - 1]
        if (f.thisAddr === null) throw new RuntimeError("'this' outside a method", e.line)
        return { t: 'ptr', v: f.thisAddr, pt: 'object' }
      }
      case 'id': {
        if (e.name === 'cout' || e.name === 'cerr') return { t: 'stream' }
        if (e.name === 'endl') return { t: 'str', v: '\n' }
        if (e.name === 'INT_MAX') return { t: 'num', v: 2147483647, ct: 'int' }
        if (e.name === 'INT_MIN') return { t: 'num', v: -2147483648, ct: 'int' }
        if (e.name === 'cin') return { t: 'stream' }
        const a = this.lookup(e.name)
        if (a === null) throw new RuntimeError(`'${e.name}' is not declared`, e.line)
        return this.readCell(a, e.line)
      }
      case 'initlist':
        throw new RuntimeError('Initializer list only allowed in a declaration', e.line)
      case 'index': {
        // string indexing returns a char copy
        const baseAddr = this.addrOfOrNull(e.base)
        const baseCell = baseAddr !== null ? this.mem.get(baseAddr) : undefined
        if (baseCell?.t === 'str') {
          const idx = this.asNum(this.evalR(e.idx), e.line) | 0
          this.counters.arrayAccesses++
          return { t: 'char', v: baseCell.v[idx] ?? '\0' }
        }
        return this.readCell(this.addrOf(e), e.line)
      }
      case 'member': {
        // container/string pseudo-methods handled in 'call'; bare member read:
        return this.readCell(this.addrOf(e), e.line)
      }
      case 'un': return this.evalUnary(e)
      case 'bin': return this.evalBinary(e)
      case 'assign': {
        const addr = this.addrOf(e.target)
        if (e.op === '=') {
          const tcell = this.cellAt(addr, e.line)
          if (tcell.t === 'arr' || tcell.t === 'obj') {
            // `existingVector = otherVector`, `grid[i] = row`, `n2 = n1` —
            // whole-structure assignment: deep-copy INTO the target's own
            // address so anything else already pointing at it sees the new
            // contents, same value semantics as a declaration-init copy.
            const srcAddr = this.resolveObjectSource(e.value, e.line)
            if (srcAddr === null) throw new RuntimeError(`Cannot assign '${pe(e.value)}' to '${pe(e.target)}'`, e.line)
            this.copyCellInto(addr, srcAddr, e.line)
            const c = this.mem.get(addr)!
            return c.t === 'arr' ? { t: 'ptr', v: c.elems[0] ?? 0, pt: c.et } : { t: 'ptr', v: addr, pt: c.t === 'obj' ? c.type : 'object' }
          }
        }
        let v = this.evalR(e.value)
        if (e.op !== '=') {
          const cur = this.readCell(addr, e.line)
          v = this.numericBinop(e.op.slice(0, -1), cur, v, e.line)
        }
        this.write(addr, v, e.line)
        return this.readCell(addr, e.line)
      }
      case 'cond': {
        const c = truthy(this.evalR(e.c))
        this.counters.comparisons++
        return c ? this.evalR(e.t) : this.evalR(e.f)
      }
      case 'new': return this.evalNew(e)
      case 'call': return this.evalCall(e)
      case 'ctorcall': {
        // Reached only when a `vector<T>(…)` expression shows up somewhere
        // that isn't already handled by copyOfExprValue/buildContainer
        // (decl-init, push_back's arg, a container's fill, an assignment
        // RHS, a by-value call argument). Build it and decay to a pointer,
        // same convention arrays already use when read as a plain Val.
        const addr = this.buildContainer(e.type, e.args, e.line)
        const c = this.mem.get(addr)
        return c?.t === 'arr' ? { t: 'ptr', v: c.elems[0] ?? addr, pt: c.et } : { t: 'ptr', v: addr, pt: e.type.base }
      }
    }
  }

  evalUnary(e: Extract<Expr, { k: 'un' }>): Val {
    if (e.op === '++' || e.op === '--') {
      const addr = this.addrOf(e.e)
      const cur = this.readCell(addr, e.line)
      const delta = e.op === '++' ? 1 : -1
      let next: Val
      if (cur.t === 'ptr') next = { t: 'ptr', v: cur.v + delta, pt: cur.pt }
      else if (cur.t === 'iter') next = { t: 'iter', header: cur.header, idx: cur.idx + delta, et: cur.et }
      else next = { t: 'num', v: this.asNum(cur, e.line) + delta, ct: cur.t === 'num' ? cur.ct : 'int' }
      this.write(addr, next, e.line)
      return e.prefix ? next : cur
    }
    if (e.op === '&') {
      const addr = this.addrOf(e.e)
      return { t: 'ptr', v: addr, pt: 'auto' }
    }
    if (e.op === '*') {
      return this.readCell(this.addrOf(e), e.line)
    }
    const v = this.evalR(e.e)
    switch (e.op) {
      case '-': return { t: 'num', v: -this.asNum(v, e.line), ct: v.t === 'num' ? v.ct : 'int' }
      case '+': return v
      case '!': return { t: 'bool', v: !truthy(v) }
      case '~': return { t: 'num', v: ~this.asNum(v, e.line), ct: 'int' }
    }
    throw new RuntimeError(`Unsupported unary '${e.op}'`, e.line)
  }

  numericBinop(op: string, l: Val, r: Val, line: number): Val {
    // pointer arithmetic
    if (l.t === 'ptr' && r.t !== 'ptr' && (op === '+' || op === '-')) {
      const d = this.asNum(r, line)
      return { t: 'ptr', v: op === '+' ? l.v + d : l.v - d, pt: l.pt }
    }
    if (l.t === 'ptr' && r.t === 'ptr' && op === '-') return { t: 'num', v: l.v - r.v, ct: 'int' }
    // iterator arithmetic: `it + n` / `it - n` advances by index, `it2 - it1`
    // is a distance — same shape as pointer arithmetic above, index-based.
    if (l.t === 'iter' && r.t !== 'iter' && (op === '+' || op === '-')) {
      const d = this.asNum(r, line)
      return { t: 'iter', header: l.header, idx: op === '+' ? l.idx + d : l.idx - d, et: l.et }
    }
    if (l.t === 'iter' && r.t === 'iter' && op === '-') return { t: 'num', v: l.idx - r.idx, ct: 'int' }
    // string concat
    if (op === '+' && (l.t === 'str' || r.t === 'str')) return { t: 'str', v: fmtVal(l, true) + fmtVal(r, true) }
    const a = this.asNum(l, line)
    const b = this.asNum(r, line)
    const bothInt = (l.t !== 'num' || ['int', 'long', 'short', 'size_t'].includes(l.ct)) && (r.t !== 'num' || ['int', 'long', 'short', 'size_t'].includes(r.ct))
    const ct = bothInt ? 'int' : 'double'
    switch (op) {
      case '+': return { t: 'num', v: a + b, ct }
      case '-': return { t: 'num', v: a - b, ct }
      case '*': return { t: 'num', v: a * b, ct }
      case '/': {
        if (b === 0) throw new RuntimeError('Division by zero', line)
        const q = a / b
        return { t: 'num', v: bothInt ? Math.trunc(q) : q, ct }
      }
      case '%': {
        if (b === 0) throw new RuntimeError('Modulo by zero', line)
        return { t: 'num', v: a % b, ct: 'int' }
      }
      case '&': return { t: 'num', v: a & b, ct: 'int' }
      case '|': return { t: 'num', v: a | b, ct: 'int' }
      case '^': return { t: 'num', v: a ^ b, ct: 'int' }
      case '<<': return { t: 'num', v: a << b, ct: 'int' }
      case '>>': return { t: 'num', v: a >> b, ct: 'int' }
    }
    throw new RuntimeError(`Unsupported operator '${op}'`, line)
  }

  evalBinary(e: Extract<Expr, { k: 'bin' }>): Val {
    if (e.op === ',') {
      this.evalR(e.l)
      return this.evalR(e.r)
    }
    if (e.op === '&&') {
      this.counters.comparisons++
      if (!truthy(this.evalR(e.l))) return { t: 'bool', v: false }
      return { t: 'bool', v: truthy(this.evalR(e.r)) }
    }
    if (e.op === '||') {
      this.counters.comparisons++
      if (truthy(this.evalR(e.l))) return { t: 'bool', v: true }
      return { t: 'bool', v: truthy(this.evalR(e.r)) }
    }
    // cout << …
    if (e.op === '<<') {
      const l = this.evalR(e.l)
      if (l.t === 'stream') {
        const r = this.evalR(e.r)
        this.output += fmtVal(r, true)
        return { t: 'stream' }
      }
      const r = this.evalR(e.r)
      return this.numericBinop('<<', l, r, e.line)
    }
    if (e.op === '>>') {
      const l = this.evalR(e.l)
      if (l.t === 'stream') {
        // cin >> x — read the next whitespace-separated token from the
        // Input panel's stdin buffer and coerce it to x's cell type, same
        // convention cout << uses on the output side (fmtVal/write).
        const addr = this.addrOf(e.r)
        const cell = this.cellAt(addr, e.line)
        const raw = this.nextInputToken(e.line)
        let v: Val
        if (cell.t === 'num') v = { t: 'num', v: Number(raw), ct: cell.ct }
        else if (cell.t === 'bool') v = { t: 'bool', v: raw === '1' || raw.toLowerCase() === 'true' }
        else if (cell.t === 'char') v = { t: 'char', v: raw[0] ?? '\0' }
        else if (cell.t === 'str') v = { t: 'str', v: raw }
        else throw new RuntimeError(`cin >> '${pe(e.r)}' needs a plain int/double/char/bool/string variable`, e.line)
        this.write(addr, v, e.line)
        return { t: 'stream' }
      }
      const r = this.evalR(e.r)
      return this.numericBinop('>>', l, r, e.line)
    }
    const l = this.evalR(e.l)
    const r = this.evalR(e.r)
    if (['==', '!=', '<', '>', '<=', '>='].includes(e.op)) {
      this.counters.comparisons++
      let res: boolean
      if (l.t === 'iter' || r.t === 'iter') {
        if (l.t !== 'iter' || r.t !== 'iter') throw new RuntimeError('Cannot compare an iterator with a non-iterator', e.line)
        const a = l.idx
        const b = r.idx
        res = e.op === '==' ? a === b : e.op === '!=' ? a !== b : e.op === '<' ? a < b : e.op === '>' ? a > b : e.op === '<=' ? a <= b : a >= b
      } else if (l.t === 'str' || r.t === 'str') {
        const a = fmtVal(l, true)
        const b = fmtVal(r, true)
        res = e.op === '==' ? a === b : e.op === '!=' ? a !== b : e.op === '<' ? a < b : e.op === '>' ? a > b : e.op === '<=' ? a <= b : a >= b
      } else {
        const a = this.asNum(l, e.line)
        const b = this.asNum(r, e.line)
        res = e.op === '==' ? a === b : e.op === '!=' ? a !== b : e.op === '<' ? a < b : e.op === '>' ? a > b : e.op === '<=' ? a <= b : a >= b
      }
      return { t: 'bool', v: res }
    }
    return this.numericBinop(e.op, l, r, e.line)
  }

  evalNew(e: Extract<Expr, { k: 'new' }>): Val {
    this.counters.allocations++
    if (e.count) {
      const n = Math.max(0, this.asNum(this.evalR(e.count), e.line) | 0)
      const cells = Array.from({ length: n }, () => this.defaultCell(e.type, e.line))
      const elems = this.allocConsecutive(cells)
      const header = this.alloc({ t: 'arr', elems, et: e.type.base, dyn: true })
      this.heapOrder.push(header)
      this.heapNames.set(header, `new ${e.type.base}[${n}]`)
      return { t: 'ptr', v: elems[0] ?? header, pt: e.type.base }
    }
    const td = this.prog.types.get(e.type.base)
    if (td) {
      const objCell = this.buildObject(td, e.line)
      const header = this.alloc(objCell)
      this.heapOrder.push(header)
      this.heapNames.set(header, `new ${td.name}`)
      if (td.ctor) {
        const args = e.args.map((a) => this.evalR(a))
        this.callFunction(td.ctor, args, e.line, header, e.args.map(pe).join(', '))
      } else if (e.args.length > 0) {
        // aggregate init in field order
        td.fields.forEach((f, i) => {
          if (i < e.args.length) this.write(objCell.fields[f.name], this.evalR(e.args[i]), e.line)
        })
      }
      return { t: 'ptr', v: header, pt: td.name }
    }
    // scalar new
    const cell = this.defaultCell(e.type, e.line)
    const addr = this.alloc(cell)
    this.heapOrder.push(addr)
    this.heapNames.set(addr, `new ${e.type.base}`)
    if (e.args.length === 1) this.write(addr, this.evalR(e.args[0]), e.line)
    return { t: 'ptr', v: addr, pt: e.type.base }
  }

  evalCall(e: Extract<Expr, { k: 'call' }>): Val {
    // method / container calls: obj.m(…) or p->m(…)
    if (e.callee.k === 'member') {
      return this.evalMethodCall(e.callee, e.args, e.line)
    }
    if (e.callee.k !== 'id') throw new RuntimeError('Only named functions can be called', e.line)
    const name = e.callee.name

    // builtins that need l-values
    if (name === 'swap') {
      if (e.args.length !== 2) throw new RuntimeError('swap(a, b) takes two variables', e.line)
      const a = this.addrOf(e.args[0])
      const b = this.addrOf(e.args[1])
      const av = this.readCell(a, e.line)
      const bv = this.readCell(b, e.line)
      this.write(a, bv, e.line)
      this.write(b, av, e.line)
      this.counters.swaps++
      return { t: 'void' }
    }

    // make_pair(a, b) — builds a pair<...> object and decays to a pointer at
    // its own address, the same convention `new`/a ctor-call already use for
    // any value-returning-by-object expression. cellForVal shapes each field
    // from the ARGUMENT's own runtime value rather than a declared type, so
    // this works before pair's own T1/T2 are known anywhere syntactically —
    // exactly like `auto` inference elsewhere in this file.
    if (name === 'make_pair') {
      if (e.args.length !== 2) throw new RuntimeError('make_pair(a, b) takes two arguments', e.line)
      const av = this.evalR(e.args[0])
      const bv = this.evalR(e.args[1])
      if (av.t === 'void' || av.t === 'stream' || bv.t === 'void' || bv.t === 'stream') {
        throw new RuntimeError('Cannot build a pair from a void/stream value', e.line)
      }
      const first = this.alloc(this.cellForVal(av))
      const second = this.alloc(this.cellForVal(bv))
      const addr = this.alloc({ t: 'obj', type: 'pair', fields: { first, second } })
      return { t: 'ptr', v: addr, pt: 'pair' }
    }

    // getline(cin, str) — reads a whole LINE (embedded spaces included,
    // unlike cin >>) into str. Returns a bool standing in for the real
    // istream& result: true on success, false at end-of-input, so the
    // standard `while (getline(cin, line))` read-everything idiom
    // terminates naturally instead of erroring out.
    if (name === 'getline') {
      if (e.args.length !== 2) throw new RuntimeError('getline(cin, str) takes a stream and a string variable', e.line)
      const streamV = this.evalR(e.args[0])
      if (streamV.t !== 'stream') throw new RuntimeError("getline()'s first argument must be cin", e.line)
      const addr = this.addrOf(e.args[1])
      const cell = this.cellAt(addr, e.line)
      if (cell.t !== 'str') throw new RuntimeError('getline() needs a plain string variable', e.line)
      const lineStr = this.nextInputLineOrNull()
      if (lineStr === null) return { t: 'bool', v: false }
      this.write(addr, { t: 'str', v: lineStr }, e.line)
      return { t: 'bool', v: true }
    }

    const fn = this.prog.funcs.get(name)
    if (fn) {
      const args = e.args.map((a, i) => this.bindArg(a, fn.params[i], e.line))
      return this.callFunction(fn, args, e.line, null, e.args.map((a) => this.fmtArg(a)).join(', '))
    }

    // STL algorithms over an iterator/pointer [first, last) range.
    if (RANGE_ALGO_NAMES.has(name)) {
      if (name === 'sort' && e.args.length > 2) {
        throw new RuntimeError('sort() with a custom comparator is not supported — only ascending sort(first, last)', e.line)
      }
      const a = this.evalR(e.args[0])
      const b = this.evalR(e.args[1])
      const addrs = this.resolveRange(a, b, e.line)
      const iterAt = (i: number): Val => {
        if (a.t === 'iter') return { t: 'iter', header: a.header, idx: a.idx + i, et: a.et }
        if (a.t === 'ptr') return { t: 'ptr', v: addrs[i], pt: a.pt }
        throw new RuntimeError(`${name}() needs a pair of iterators/pointers`, e.line)
      }
      if (name === 'sort') {
        const withKey = addrs.map((addr) => {
          const v = this.readCell(addr, e.line)
          return { v, key: v.t === 'str' ? v.v : this.asNum(v, e.line) }
        })
        withKey.sort((x, y) => (typeof x.key === 'string' ? (x.key < (y.key as string) ? -1 : x.key > (y.key as string) ? 1 : 0) : (x.key as number) - (y.key as number)))
        withKey.forEach((item, i) => this.write(addrs[i], item.v, e.line))
        return { t: 'void' }
      }
      if (name === 'reverse') {
        const vals = addrs.map((addr) => this.readCell(addr, e.line))
        vals.reverse().forEach((v, i) => this.write(addrs[i], v, e.line))
        return { t: 'void' }
      }
      if (name === 'find') {
        const target = this.evalR(e.args[2])
        for (let i = 0; i < addrs.length; i++) {
          if (this.valsEqual(this.readCell(addrs[i], e.line), target, e.line)) return iterAt(i)
        }
        return b // std::find returns `last` on failure
      }
      if (name === 'count') {
        const target = this.evalR(e.args[2])
        let n = 0
        for (const addr of addrs) if (this.valsEqual(this.readCell(addr, e.line), target, e.line)) n++
        return { t: 'num', v: n, ct: 'int' }
      }
      if (name === 'fill') {
        const v = this.evalR(e.args[2])
        for (const addr of addrs) this.write(addr, v, e.line)
        return { t: 'void' }
      }
      if (name === 'unique') {
        // Collapses each run of consecutive equal elements to one, written
        // into the FRONT of the range (real std::unique semantics) — the
        // rest of the range is left as-is (unspecified in real C++ too).
        // Returns an iterator to the new logical end; combine with
        // resize() (not erase(), which isn't supported here) to shrink:
        // `int n = unique(v.begin(), v.end()) - v.begin(); v.resize(n);`
        let w = 0
        for (let i = 0; i < addrs.length; i++) {
          const v = this.readCell(addrs[i], e.line)
          if (w === 0 || !this.valsEqual(v, this.readCell(addrs[w - 1], e.line), e.line)) {
            if (i !== w) this.write(addrs[w], v, e.line)
            w++
          }
        }
        return iterAt(w)
      }
      if (name === 'binary_search' || name === 'lower_bound' || name === 'upper_bound') {
        const target = this.evalR(e.args[2])
        let lo = 0
        let hi = addrs.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          const cmp = this.cmpVals(this.readCell(addrs[mid], e.line), target, e.line)
          const goLeft = name === 'upper_bound' ? cmp > 0 : cmp >= 0
          if (goLeft) hi = mid
          else lo = mid + 1
        }
        if (name === 'binary_search') {
          return { t: 'bool', v: lo < addrs.length && this.valsEqual(this.readCell(addrs[lo], e.line), target, e.line) }
        }
        return iterAt(lo)
      }
      if (name === 'copy') {
        const destV = this.evalR(e.args[2])
        let destAddrOf: (i: number) => number
        if (destV.t === 'iter') {
          const dc = this.cellAt(destV.header, e.line)
          if (dc.t !== 'arr') throw new RuntimeError('copy() needs a valid destination iterator', e.line)
          destAddrOf = (i) => {
            const idx = destV.idx + i
            if (idx < 0 || idx >= dc.elems.length) throw new RuntimeError('copy() destination range is too short', e.line)
            return dc.elems[idx]
          }
        } else if (destV.t === 'ptr') {
          destAddrOf = (i) => destV.v + i
        } else {
          throw new RuntimeError('copy() needs an iterator/pointer destination', e.line)
        }
        addrs.forEach((srcAddr, i) => this.write(destAddrOf(i), this.readCell(srcAddr, e.line), e.line))
        return destV.t === 'iter'
          ? { t: 'iter', header: destV.header, idx: destV.idx + addrs.length, et: destV.et }
          : { t: 'ptr', v: destV.v + addrs.length, pt: destV.pt }
      }
      // min_element / max_element
      if (addrs.length === 0) return b
      let bestI = 0
      let bestVal = this.readCell(addrs[0], e.line)
      for (let i = 1; i < addrs.length; i++) {
        const v = this.readCell(addrs[i], e.line)
        const better = name === 'min_element' ? this.asNum(v, e.line) < this.asNum(bestVal, e.line) : this.asNum(v, e.line) > this.asNum(bestVal, e.line)
        if (better) { bestVal = v; bestI = i }
      }
      return iterAt(bestI)
    }

    // math / misc builtins
    const nums = () => e.args.map((a) => this.asNum(this.evalR(a), e.line))
    switch (name) {
      case 'abs': case 'fabs': return { t: 'num', v: Math.abs(nums()[0] ?? 0), ct: 'double' }
      case 'sqrt': return { t: 'num', v: Math.sqrt(nums()[0] ?? 0), ct: 'double' }
      case 'pow': { const [a, b] = nums(); return { t: 'num', v: Math.pow(a ?? 0, b ?? 0), ct: 'double' } }
      case 'floor': return { t: 'num', v: Math.floor(nums()[0] ?? 0), ct: 'int' }
      case 'ceil': return { t: 'num', v: Math.ceil(nums()[0] ?? 0), ct: 'int' }
      case 'min': { const [a, b] = nums(); return { t: 'num', v: Math.min(a ?? 0, b ?? 0), ct: 'int' } }
      case 'max': { const [a, b] = nums(); return { t: 'num', v: Math.max(a ?? 0, b ?? 0), ct: 'int' } }
      case 'rand': {
        this.randState = (this.randState * 1103515245 + 12345) & 0x7fffffff
        return { t: 'num', v: this.randState % 32768, ct: 'int' }
      }
      case 'srand': { this.randState = (nums()[0] ?? 1) | 1; return { t: 'void' } }
      case 'printf': {
        const fmt = e.args[0] ? this.evalR(e.args[0]) : { t: 'str', v: '' } as Val
        const rest = e.args.slice(1).map((a) => this.evalR(a))
        let i = 0
        const out = (fmt.t === 'str' ? fmt.v : '').replace(/%[difscl]+/g, () => fmtVal(rest[i++] ?? { t: 'str', v: '' }, true))
        this.output += out
        return { t: 'void' }
      }
      case 'main': throw new RuntimeError('Do not call main() yourself', e.line)
    }
    throw new RuntimeError(`Unknown function '${name}'`, e.line)
  }

  fmtArg(a: Expr): string {
    try {
      const v = this.evalR(a)
      if (v.t === 'ptr') return pe(a)
      return fmtVal(v)
    } catch {
      return pe(a)
    }
  }

  evalMethodCall(m: Extract<Expr, { k: 'member' }>, args: Expr[], line: number): Val {
    // cin.ignore() — cin has no address of its own (it's a special
    // identifier, not a declared variable), so it must be caught before the
    // generic receiver-resolution below, which would otherwise fail to find
    // any cell for it and report "cannot call ignore() on cin".
    if (m.base.k === 'id' && m.base.name === 'cin' && m.name === 'ignore') {
      this.skipToNextLine()
      return { t: 'void' }
    }
    // resolve the receiver
    let recvAddr: number | null = null
    if (m.arrow) {
      const p = this.evalR(m.base)
      if (p.t !== 'ptr') throw new RuntimeError(`'${pe(m.base)}' is not a pointer`, line)
      if (p.v === 0) throw new RuntimeError(`Null pointer dereference on '${pe(m.base)}'`, line)
      recvAddr = p.v
    } else {
      recvAddr = this.addrOfOrNull(m.base)
    }
    const cell = recvAddr !== null ? this.mem.get(recvAddr) : undefined

    // string methods
    if (recvAddr !== null && cell?.t === 'str') {
      if (m.name === 'length' || m.name === 'size') return { t: 'num', v: cell.v.length, ct: 'int' }
      if (m.name === 'empty') return { t: 'bool', v: cell.v.length === 0 }
      if (m.name === 'substr') {
        const pos = args[0] ? this.asNum(this.evalR(args[0]), line) | 0 : 0
        const len = args[1] !== undefined ? this.asNum(this.evalR(args[1]), line) | 0 : undefined
        return { t: 'str', v: len !== undefined ? cell.v.slice(pos, pos + len) : cell.v.slice(pos) }
      }
      if (m.name === 'find') {
        const needleV = this.evalR(args[0])
        const needle = needleV.t === 'char' ? needleV.v : fmtVal(needleV, true)
        const from = args[1] ? this.asNum(this.evalR(args[1]), line) | 0 : 0
        const idx = cell.v.indexOf(needle, from)
        return { t: 'num', v: idx === -1 ? STRING_NPOS : idx, ct: 'size_t' }
      }
      if (m.name === 'erase') {
        const pos = args[0] ? this.asNum(this.evalR(args[0]), line) | 0 : 0
        const len = args[1] !== undefined ? this.asNum(this.evalR(args[1]), line) | 0 : cell.v.length - pos
        this.mem.set(recvAddr, { t: 'str', v: cell.v.slice(0, pos) + cell.v.slice(pos + len) })
        this.curChanged.push(recvAddr)
        return { t: 'void' }
      }
      if (m.name === 'insert') {
        const pos = this.asNum(this.evalR(args[0]), line) | 0
        const insV = this.evalR(args[1])
        const insStr = insV.t === 'char' ? insV.v : fmtVal(insV, true)
        this.mem.set(recvAddr, { t: 'str', v: cell.v.slice(0, pos) + insStr + cell.v.slice(pos) })
        this.curChanged.push(recvAddr)
        return { t: 'void' }
      }
      if (m.name === 'append') {
        const appV = this.evalR(args[0])
        const appStr = appV.t === 'char' ? appV.v : fmtVal(appV, true)
        this.mem.set(recvAddr, { t: 'str', v: cell.v + appStr })
        this.curChanged.push(recvAddr)
        return { t: 'void' }
      }
      if (m.name === 'compare') {
        const other = fmtVal(this.evalR(args[0]), true)
        return { t: 'num', v: cell.v < other ? -1 : cell.v > other ? 1 : 0, ct: 'int' }
      }
      throw new RuntimeError(`string::${m.name} is not supported`, line)
    }

    // container methods
    if (recvAddr !== null && cell?.t === 'arr') {
      const c = cell
      const et: TypeRef = { base: c.et, targs: [], ptr: 0, ref: false }
      // Args are resolved lazily per-case below (via copyOfExprValue for
      // anything that stores a value, asNum for anything that wants a plain
      // number) — NOT eagerly evalR'd up front, which used to blow up the
      // instant you pushed a struct or a row (another vector) into this
      // container: evalR on an 'obj' id throws, and on an 'arr' id it
      // decayed to a pointer instead of copying — see copyOfExprValue.
      switch (m.name) {
        case 'size': case 'length': return { t: 'num', v: c.elems.length, ct: 'int' }
        case 'empty': return { t: 'bool', v: c.elems.length === 0 }
        case 'begin': case 'end': {
          // stack/queue/priority_queue are container ADAPTORS in real C++
          // — no iterators (deque, unlike those three, is a real iterable
          // container, so it's deliberately not excluded here).
          if (c.ctag === 'stack' || c.ctag === 'queue' || c.ctag === 'priority_queue') {
            throw new RuntimeError(`${c.ctag} has no ${m.name}() — it isn't an iterable container in real C++`, line)
          }
          return { t: 'iter', header: recvAddr, idx: m.name === 'begin' ? 0 : c.elems.length, et: c.et }
        }
        case 'push_back': case 'push': {
          const a = args[0] ? this.copyOfExprValue(args[0], et, line) : this.alloc(this.defaultCell(et, line))
          // priority_queue keeps itself sorted ascending on every insert —
          // top()/pop() then read from the END, same convention `stack`
          // already uses, giving a default MAX-heap.
          const elems = c.ctag === 'priority_queue' ? this.sortAddrsAscending([...c.elems, a], line) : [...c.elems, a]
          this.mem.set(recvAddr, { ...c, elems })
          this.curChanged.push(recvAddr)
          return { t: 'void' }
        }
        case 'push_front': {
          const a = args[0] ? this.copyOfExprValue(args[0], et, line) : this.alloc(this.defaultCell(et, line))
          this.mem.set(recvAddr, { ...c, elems: [a, ...c.elems] })
          this.curChanged.push(recvAddr)
          return { t: 'void' }
        }
        case 'pop_back': {
          const last = c.elems[c.elems.length - 1]
          if (last !== undefined) {
            this.mem.delete(last)
            this.mem.set(recvAddr, { ...c, elems: c.elems.slice(0, -1) })
            this.curChanged.push(recvAddr)
          }
          return { t: 'void' }
        }
        case 'pop_front': {
          const first = c.elems[0]
          if (first !== undefined) {
            this.mem.delete(first)
            this.mem.set(recvAddr, { ...c, elems: c.elems.slice(1) })
            this.curChanged.push(recvAddr)
          }
          return { t: 'void' }
        }
        case 'pop': {
          // stack/priority_queue pop the back (the max, for a p_queue, since
          // push kept `elems` sorted ascending); queue pops the front.
          const fromFront = c.ctag === 'queue'
          const victim = fromFront ? c.elems[0] : c.elems[c.elems.length - 1]
          if (victim !== undefined) {
            this.mem.delete(victim)
            this.mem.set(recvAddr, { ...c, elems: fromFront ? c.elems.slice(1) : c.elems.slice(0, -1) })
            this.curChanged.push(recvAddr)
          }
          return { t: 'void' }
        }
        case 'top': case 'back': {
          const a = c.elems[c.elems.length - 1]
          if (a === undefined) throw new RuntimeError(`${m.name}() on empty container`, line)
          return this.readOrDecayCell(a, line)
        }
        case 'front': {
          const a = c.elems[0]
          if (a === undefined) throw new RuntimeError('front() on empty container', line)
          return this.readOrDecayCell(a, line)
        }
        case 'at': {
          const i = (args[0] ? this.asNum(this.evalR(args[0]), line) : 0) | 0
          if (i < 0 || i >= c.elems.length) throw new RuntimeError(`at(${i}) out of range (size ${c.elems.length})`, line)
          this.counters.arrayAccesses++
          return this.readOrDecayCell(c.elems[i], line)
        }
        case 'clear': {
          for (const a of c.elems) this.mem.delete(a)
          this.mem.set(recvAddr, { ...c, elems: [] })
          this.curChanged.push(recvAddr)
          return { t: 'void' }
        }
        case 'resize': {
          const n = Math.max(0, (args[0] ? this.asNum(this.evalR(args[0]), line) : 0) | 0)
          let elems = [...c.elems]
          while (elems.length > n) {
            const victim = elems.pop()
            if (victim !== undefined) this.mem.delete(victim)
          }
          while (elems.length < n) elems.push(args[1] ? this.copyOfExprValue(args[1], et, line) : this.alloc(this.defaultCell(et, line)))
          this.mem.set(recvAddr, { ...c, elems })
          this.curChanged.push(recvAddr)
          return { t: 'void' }
        }
        // ── map/set-only methods (key-based, not index-based) ──
        case 'insert': {
          const isMap = c.ctag === 'map' || c.ctag === 'unordered_map'
          const isSet = c.ctag === 'set' || c.ctag === 'unordered_set'
          if (isMap) {
            const { first, second } = this.resolveAsPairFields(args[0], line)
            const keyVal = this.readCell(first, line)
            const exists = c.elems.some((ea) => {
              const pc = this.cellAt(ea, line)
              return pc.t === 'obj' && this.valsEqual(this.readCell(pc.fields.first, line), keyVal, line)
            })
            if (exists) return { t: 'bool', v: false } // real map::insert no-ops on an existing key
            const pairAddr = this.alloc({
              t: 'obj',
              type: 'pair',
              fields: { first: this.deepCopyCell(first, line), second: this.deepCopyCell(second, line) },
            })
            this.mem.set(recvAddr, { ...c, elems: this.sortAddrsAscending([...c.elems, pairAddr], line) })
            this.curChanged.push(recvAddr)
            return { t: 'bool', v: true }
          }
          if (isSet) {
            const v = this.evalR(args[0])
            if (v.t === 'void' || v.t === 'stream') throw new RuntimeError('Cannot insert a void value into a set', line)
            const exists = c.elems.some((ea) => this.valsEqual(this.readCell(ea, line), v, line))
            if (exists) return { t: 'bool', v: false }
            const a = this.alloc(this.cellForVal(v))
            this.mem.set(recvAddr, { ...c, elems: this.sortAddrsAscending([...c.elems, a], line) })
            this.curChanged.push(recvAddr)
            return { t: 'bool', v: true }
          }
          throw new RuntimeError('insert() is only supported on map/set — use push_back for a vector', line)
        }
        case 'erase': {
          const isMap = c.ctag === 'map' || c.ctag === 'unordered_map'
          const isSet = c.ctag === 'set' || c.ctag === 'unordered_set'
          if (!isMap && !isSet) {
            throw new RuntimeError('erase() by iterator (vector/deque) is not supported — only map/set erase(key)', line)
          }
          const key = this.evalR(args[0])
          const idx = c.elems.findIndex((ea) => {
            const pc = this.cellAt(ea, line)
            const kv = isMap && pc.t === 'obj' ? this.readCell(pc.fields.first, line) : this.readCell(ea, line)
            return this.valsEqual(kv, key, line)
          })
          if (idx === -1) return { t: 'num', v: 0, ct: 'size_t' }
          this.mem.delete(c.elems[idx])
          this.mem.set(recvAddr, { ...c, elems: c.elems.filter((_, i) => i !== idx) })
          this.curChanged.push(recvAddr)
          return { t: 'num', v: 1, ct: 'size_t' }
        }
        case 'find': {
          const isMap = c.ctag === 'map' || c.ctag === 'unordered_map'
          const isSet = c.ctag === 'set' || c.ctag === 'unordered_set'
          if (!isMap && !isSet) {
            throw new RuntimeError('find() as a method needs a map/set — for a vector use the free function std::find(first, last, val)', line)
          }
          const key = this.evalR(args[0])
          const idx = c.elems.findIndex((ea) => {
            const pc = this.cellAt(ea, line)
            const kv = isMap && pc.t === 'obj' ? this.readCell(pc.fields.first, line) : this.readCell(ea, line)
            return this.valsEqual(kv, key, line)
          })
          return { t: 'iter', header: recvAddr, idx: idx === -1 ? c.elems.length : idx, et: c.et }
        }
        case 'count': {
          const isMap = c.ctag === 'map' || c.ctag === 'unordered_map'
          const isSet = c.ctag === 'set' || c.ctag === 'unordered_set'
          if (!isMap && !isSet) throw new RuntimeError('count() is only supported on map/set', line)
          const key = this.evalR(args[0])
          const n = c.elems.filter((ea) => {
            const pc = this.cellAt(ea, line)
            const kv = isMap && pc.t === 'obj' ? this.readCell(pc.fields.first, line) : this.readCell(ea, line)
            return this.valsEqual(kv, key, line)
          }).length
          return { t: 'num', v: n, ct: 'int' }
        }
      }
      throw new RuntimeError(`Container method '${m.name}' is not supported`, line)
    }

    // user-defined method
    if (recvAddr !== null && cell?.t === 'obj') {
      const td = this.prog.types.get(cell.type)
      const fn = td?.methods.get(m.name)
      if (!fn) throw new RuntimeError(`No method '${m.name}' on '${cell.type}'`, line)
      const argVals = args.map((a, i) => this.bindArg(a, fn.params[i], line))
      return this.callFunction(fn, argVals, line, recvAddr, args.map((a) => this.fmtArg(a)).join(', '))
    }
    throw new RuntimeError(`Cannot call '${m.name}' on '${pe(m.base)}'`, line)
  }

  callFunction(fn: FuncDef, args: Val[], line: number, thisAddr: number | null, argDesc: string): Val {
    if (this.frames.length > 128) throw new RuntimeError(`Stack overflow — '${fn.name}' recursed too deep`, line)
    this.counters.calls++

    // record recursion analytics on the parent
    const parentFrame = this.frames[this.frames.length - 1]
    const numericArgs = args.map((a) => (a.t === 'num' ? a.v : a.t === 'bool' ? (a.v ? 1 : 0) : NaN))
    if (parentFrame && parentFrame.fn === fn.name) {
      parentFrame.invocation.childNums.push(numericArgs)
    }

    const parentId = parentFrame?.callNodeId ?? '_root'
    const nodeId = `c${this.callSeq++}`
    const depth = (this.callNodes[parentId]?.depth ?? -1) + 1
    const node: CallNode = {
      id: nodeId,
      fn: fn.name,
      args: argDesc,
      parent: parentId === '_root' ? null : parentId,
      children: [],
      startStep: this.steps.length,
      depth,
    }
    this.callNodes[nodeId] = node
    if (parentId === '_root') this.rootCalls.push(nodeId)
    else this.callNodes[parentId]?.children.push(nodeId)

    const frame = this.pushFrame(fn.name, argDesc, nodeId, thisAddr)
    frame.invocation.nums = numericArgs
    this.invocations.push(frame.invocation)

    // bind params
    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i]
      const a = args[i]
      if (p.type.ref && a && a.t === 'ptr' && a.pt === '&ref') {
        // reference param: alias the caller's cell
        frame.scopes[0].set(p.name, a.v)
        continue
      }
      if (a && a.t === 'ptr' && a.pt === '&byval') {
        // by-value container/object arg: bindArg already deep-copied it
        // into a fresh, independent cell — use that cell directly.
        frame.scopes[0].set(p.name, a.v)
        continue
      }
      const cell = this.defaultCell(p.type, line)
      const addr = this.alloc(cell)
      if (a) this.write(addr, a.t === 'void' || a.t === 'stream' ? { t: 'num', v: 0, ct: 'int' } : a, line)
      frame.scopes[0].set(p.name, addr)
    }
    this.emit('call', fn.line, `${fn.name}(${argDesc})`)

    let ret: Val = { t: 'void' }
    try {
      this.execStmt(fn.body)
    } catch (sig) {
      if (sig instanceof ReturnSig) ret = sig.v
      else {
        this.frames.pop()
        throw sig
      }
    }
    node.ret = ret.t === 'void' ? 'void' : fmtVal(ret)
    node.endStep = this.steps.length
    this.frames.pop()
    this.emit('return', fn.line, `${fn.name}(${argDesc}) → ${node.ret}`)
    return ret
  }

  run() {
    try {
      // globals
      for (const g of this.prog.globals) this.execStmt(g)
      const main = this.prog.funcs.get('main')
      if (main) {
        this.callFunction(main, [], main.line, null, '')
      } else if (this.prog.top.length > 0) {
        // script mode
        const node: CallNode = { id: 'c_top', fn: 'top-level', args: '', parent: null, children: [], startStep: 0, depth: 0 }
        this.callNodes['c_top'] = node
        this.rootCalls.push('c_top')
        const f = this.pushFrame('top-level', '', 'c_top')
        this.invocations.push(f.invocation)
        for (const s of this.prog.top) this.execStmt(s)
        node.endStep = this.steps.length
        this.frames.pop()
      } else {
        throw new RuntimeError('No main() found and no top-level statements to run', 1)
      }
    } catch (err) {
      if (err instanceof StepsExhausted) {
        this.truncated = true
      } else if (err instanceof RuntimeError || err instanceof ParseError) {
        this.curChanged = []
        this.curReads = []
        try {
          this.emit('error', err.line, `⚠ ${err.message}`)
        } catch { /* step cap reached while reporting */ }
        return { line: err.line, message: err.message }
      } else if (err instanceof ReturnSig || err instanceof BreakSig || err instanceof ContinueSig) {
        // stray control flow at top level — ignore
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        return { line: 0, message: msg }
      }
    }
    return undefined
  }
}

// ── formatting helpers ──────────────────────────────────────────────────────

function truthy(v: Val): boolean {
  switch (v.t) {
    case 'num': return v.v !== 0
    case 'bool': return v.v
    case 'char': return v.v !== '\0'
    case 'str': return v.v.length > 0
    case 'ptr': return v.v !== 0
    default: return false
  }
}

function fmtVal(v: Val, forOutput = false): string {
  switch (v.t) {
    case 'num': return Number.isInteger(v.v) ? String(v.v) : String(Math.round(v.v * 10000) / 10000)
    case 'bool': return forOutput ? (v.v ? '1' : '0') : String(v.v)
    case 'char': return forOutput ? v.v : `'${v.v}'`
    case 'str': return forOutput ? v.v : JSON.stringify(v.v)
    case 'ptr': return v.v === 0 ? (forOutput ? '0' : 'null') : `@${v.v}`
    case 'iter': return `it@${v.idx}`
    case 'void': return 'void'
    case 'stream': return ''
  }
}

function fmtValOrExpr(v: Val, e: Expr): string {
  if (v.t === 'ptr') return v.v === 0 ? 'nullptr' : pe(e)
  return fmtVal(v)
}

function fmtCell(c: Cell): string {
  switch (c.t) {
    case 'num': return Number.isInteger(c.v) ? String(c.v) : String(Math.round(c.v * 10000) / 10000)
    case 'bool': return String(c.v)
    case 'char': return c.v === '\0' ? "'\\0'" : `'${c.v}'`
    case 'str': return JSON.stringify(c.v)
    case 'ptr': return c.v === 0 ? 'null' : '•'
    case 'iter': return `it@${c.idx}`
    case 'arr': return `[${c.elems.length}]`
    case 'obj': return c.type
  }
}

function fmtArrShort(c: Extract<Cell, { t: 'arr' }>, mem: Map<number, Cell>): string {
  const vals = c.elems.slice(0, 8).map((a) => {
    const ec = mem.get(a)
    return ec ? fmtCell(ec) : '?'
  })
  return `{${vals.join(', ')}${c.elems.length > 8 ? ', …' : ''}}`
}

function typeName(t: TypeRef): string {
  const stars = '*'.repeat(t.ptr)
  if (t.targs.length > 0) return `${t.base}<${t.targs.map(typeName).join(', ')}>${stars}`
  return `${t.base}${stars}`
}

// ── entry point ─────────────────────────────────────────────────────────────

export function runCpp(source: string, stdin = ''): TraceResult {
  const base: TraceResult = {
    steps: [],
    callNodes: {},
    rootCalls: [],
    counters: emptyCounters(),
    invocations: [],
    output: '',
    truncated: false,
    leaked: [],
  }
  let prog: Program
  try {
    prog = new Parser(lex(source)).parseProgram()
  } catch (err) {
    const line = err instanceof ParseError ? err.line : 0
    const message = err instanceof Error ? err.message : String(err)
    return { ...base, error: { line, message } }
  }
  const interp = new Interp(prog, stdin)
  const error = interp.run()
  return {
    steps: interp.steps,
    callNodes: interp.callNodes,
    rootCalls: interp.rootCalls,
    counters: interp.counters,
    invocations: interp.invocations,
    output: interp.output,
    error,
    truncated: interp.truncated,
    // Any heap block delete never reached by the time the program ended —
    // reported only on a clean finish (an error mid-run leaves memory in an
    // arbitrary half-finished state, not a meaningful leak report).
    leaked: error
      ? []
      : interp.heapOrder
          .filter((addr) => interp.mem.has(addr))
          .map((addr) => ({ addr, name: interp.heapNames.get(addr) ?? 'heap' })),
  }
}
