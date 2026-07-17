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
  type Invocation,
  type SnapBlock,
  type SnapCell,
  type StepKind,
  type TraceResult,
  type TraceStep,
  emptyCounters,
} from './trace'

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
  | { k: 'sizeof'; line: number }

interface Declarator {
  name: string
  ptr: number
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
  | { k: 'forRange'; type: TypeRef; name: string; iter: Expr; body: Stmt; line: number }
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
    // std::vector<…>, std::string
    if (t.k === 'id' && t.v === 'std' && this.peek(o + 1).v === '::') return true
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
    if ((base === 'vector' || base === 'stack' || base === 'queue') && this.eat('<')) {
      targs.push(this.parseTypeWithPtr())
      // handle '>>' closing nested templates
      if (this.peek().v === '>>') { this.toks[this.pos] = { k: 'op', v: '>', line: this.peek().line } }
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
          this.eat('&')
          const name = this.next()
          if (name.k === 'id' && this.eat(':')) {
            const iter = this.parseExpr()
            this.expect(')')
            return { k: 'forRange', type: { ...ty, ptr }, name: name.v, iter, body: this.parseStatement(), line }
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
        this.eat('&')
        const nameTok = this.next()
        if (nameTok.k !== 'id') throw new ParseError(`Expected a variable name, found '${nameTok.v}'`, nameTok.line)
        const d: Declarator = { name: nameTok.v, ptr, arrDims: [] }
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
        // consume whatever's inside
        let depth = 1
        while (depth > 0 && this.peek().k !== 'eof') {
          if (this.at('(')) depth++
          if (this.at(')')) depth--
          if (depth > 0) this.next()
        }
        this.expect(')')
      }
      return { k: 'sizeof', line: t.line }
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
    case 'sizeof': return 'sizeof(…)'
  }
}

// ── Runtime model ───────────────────────────────────────────────────────────

type Cell =
  | { t: 'num'; v: number; ct: string }
  | { t: 'bool'; v: boolean }
  | { t: 'char'; v: string }
  | { t: 'str'; v: string }
  | { t: 'ptr'; v: number; pt: string } // v === 0 → nullptr
  | { t: 'arr'; elems: number[]; et: string; dyn: boolean; ctag?: 'vector' | 'stack' | 'queue' }
  | { t: 'obj'; type: string; fields: Record<string, number> }

type Val =
  | { t: 'num'; v: number; ct: string }
  | { t: 'bool'; v: boolean }
  | { t: 'char'; v: string }
  | { t: 'str'; v: string }
  | { t: 'ptr'; v: number; pt: string }
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

  constructor(prog: Program) {
    this.prog = prog
    this.globalFrame = this.pushFrame('globals', '', '_root')
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
    const type = c.t === 'num' ? c.ct : c.t === 'ptr' ? `${c.pt}*` : c.t === 'str' ? 'string' : c.t
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

  // ── construction of storage from types ──
  defaultCell(t: TypeRef, line: number): Cell {
    if (t.ptr > 0) return { t: 'ptr', v: 0, pt: t.base }
    switch (t.base) {
      case 'int': case 'long': case 'short': case 'size_t': case 'auto': return { t: 'num', v: 0, ct: t.base === 'auto' ? 'int' : t.base }
      case 'float': case 'double': return { t: 'num', v: 0, ct: t.base }
      case 'bool': return { t: 'bool', v: false }
      case 'char': return { t: 'char', v: '\0' }
      case 'string': return { t: 'str', v: '' }
      case 'vector': case 'stack': case 'queue':
        return { t: 'arr', elems: [], et: t.targs[0]?.base ?? 'int', dyn: true, ctag: t.base }
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

  asNum(v: Val, line: number): number {
    if (v.t === 'num') return v.v
    if (v.t === 'bool') return v.v ? 1 : 0
    if (v.t === 'char') return v.v.charCodeAt(0)
    if (v.t === 'ptr') return v.v
    throw new RuntimeError('Expected a numeric value', line)
  }

  // ── declaration execution ──
  execDecl(s: Extract<Stmt, { k: 'decl' }>) {
    for (const d of s.decls) {
      const t: TypeRef = { ...s.type, ptr: s.type.ptr + d.ptr }
      let addr: number
      let descVal = ''
      if (d.arrDims.length > 0) {
        addr = this.allocArray(t, d.arrDims, d.init, s.line)
        const c = this.mem.get(addr)
        descVal = c?.t === 'arr' ? fmtArrShort(c, this.mem) : ''
      } else if (d.init && d.init.k === 'initlist' && (t.base === 'vector' || t.base === 'stack' || t.base === 'queue')) {
        const et: TypeRef = t.targs[0] ?? { base: 'int', targs: [], ptr: 0, ref: false }
        const elems = d.init.items.map((it) => {
          const ec = this.defaultCell(et, s.line)
          const a = this.alloc(ec)
          this.write(a, this.evalR(it), s.line)
          return a
        })
        addr = this.alloc({ t: 'arr', elems, et: et.base, dyn: true, ctag: t.base as 'vector' })
        descVal = `{${d.init.items.map(pe).join(', ')}}`
      } else {
        const cell = this.defaultCell(t, s.line)
        addr = this.alloc(cell)
        if (d.init) {
          const v = this.evalR(d.init)
          this.write(addr, v, s.line)
          descVal = fmtVal(v)
        } else if (d.ctorArgs && cell.t === 'obj') {
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
      this.emit('decl', s.line, descVal ? `${tn} ${d.name} = ${descVal}` : `${tn} ${d.name}`)
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
        const kind: StepKind = isIO ? 'io' : s.e.k === 'assign' || s.e.k === 'un' ? 'assign' : 'flow'
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
        const varAddr = this.alloc(this.defaultCell(s.type, s.line))
        this.declare(s.name, varAddr)
        try {
          for (const ea of [...cell.elems]) {
            this.counters.iterations++
            const v = this.readCell(ea, s.line)
            this.write(varAddr, v, s.line)
            this.emit('assign', s.line, `${s.name} = ${fmtVal(v)}`)
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
          if (p.t !== 'ptr') throw new RuntimeError(`'${pe(e.base)}' is not a pointer`, e.line)
          if (p.v === 0) throw new RuntimeError(`Null pointer dereference: '${pe(e.base)}' is nullptr`, e.line)
          objAddr = p.v
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
      case 'sizeof': return { t: 'num', v: 4, ct: 'int' }
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
        if (e.name === 'cin') throw new RuntimeError('cin is not supported — assign values in the code instead', e.line)
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
    }
  }

  evalUnary(e: Extract<Expr, { k: 'un' }>): Val {
    if (e.op === '++' || e.op === '--') {
      const addr = this.addrOf(e.e)
      const cur = this.readCell(addr, e.line)
      const delta = e.op === '++' ? 1 : -1
      let next: Val
      if (cur.t === 'ptr') next = { t: 'ptr', v: cur.v + delta, pt: cur.pt }
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
      if (l.t === 'stream') throw new RuntimeError('cin is not supported — assign values in the code instead', e.line)
      const r = this.evalR(e.r)
      return this.numericBinop('>>', l, r, e.line)
    }
    const l = this.evalR(e.l)
    const r = this.evalR(e.r)
    if (['==', '!=', '<', '>', '<=', '>='].includes(e.op)) {
      this.counters.comparisons++
      let res: boolean
      if (l.t === 'str' || r.t === 'str') {
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

    const fn = this.prog.funcs.get(name)
    if (fn) {
      const args = e.args.map((a, i) => {
        const p = fn.params[i]
        if (p?.type.ref) {
          const addr = this.addrOf(e.args[i])
          return { t: 'ptr', v: addr, pt: '&ref' } as Val
        }
        return this.evalR(a)
      })
      return this.callFunction(fn, args, e.line, null, e.args.map((a) => this.fmtArg(a)).join(', '))
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
      throw new RuntimeError(`string::${m.name} is not supported`, line)
    }

    // container methods
    if (recvAddr !== null && cell?.t === 'arr') {
      const argVals = args.map((a) => this.evalR(a))
      const c = cell
      switch (m.name) {
        case 'size': case 'length': return { t: 'num', v: c.elems.length, ct: 'int' }
        case 'empty': return { t: 'bool', v: c.elems.length === 0 }
        case 'push_back': case 'push': {
          const a = this.alloc(this.defaultCell({ base: c.et, targs: [], ptr: 0, ref: false }, line))
          this.write(a, argVals[0] ?? { t: 'num', v: 0, ct: 'int' }, line)
          this.mem.set(recvAddr, { ...c, elems: [...c.elems, a] })
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
        case 'pop': {
          // stack pops back; queue pops front
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
          return this.readCell(a, line)
        }
        case 'front': {
          const a = c.elems[0]
          if (a === undefined) throw new RuntimeError('front() on empty container', line)
          return this.readCell(a, line)
        }
        case 'at': {
          const i = this.asNum(argVals[0] ?? { t: 'num', v: 0, ct: 'int' }, line) | 0
          if (i < 0 || i >= c.elems.length) throw new RuntimeError(`at(${i}) out of range (size ${c.elems.length})`, line)
          this.counters.arrayAccesses++
          return this.readCell(c.elems[i], line)
        }
        case 'clear': {
          for (const a of c.elems) this.mem.delete(a)
          this.mem.set(recvAddr, { ...c, elems: [] })
          this.curChanged.push(recvAddr)
          return { t: 'void' }
        }
        case 'resize': {
          const n = Math.max(0, this.asNum(argVals[0] ?? { t: 'num', v: 0, ct: 'int' }, line) | 0)
          let elems = [...c.elems]
          while (elems.length > n) {
            const victim = elems.pop()
            if (victim !== undefined) this.mem.delete(victim)
          }
          while (elems.length < n) elems.push(this.alloc(this.defaultCell({ base: c.et, targs: [], ptr: 0, ref: false }, line)))
          this.mem.set(recvAddr, { ...c, elems })
          this.curChanged.push(recvAddr)
          return { t: 'void' }
        }
      }
      throw new RuntimeError(`Container method '${m.name}' is not supported`, line)
    }

    // user-defined method
    if (recvAddr !== null && cell?.t === 'obj') {
      const td = this.prog.types.get(cell.type)
      const fn = td?.methods.get(m.name)
      if (!fn) throw new RuntimeError(`No method '${m.name}' on '${cell.type}'`, line)
      const argVals = args.map((a, i) => {
        const p = fn.params[i]
        if (p?.type.ref) return { t: 'ptr', v: this.addrOf(args[i]), pt: '&ref' } as Val
        return this.evalR(a)
      })
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

export function runCpp(source: string): TraceResult {
  const base: TraceResult = {
    steps: [],
    callNodes: {},
    rootCalls: [],
    counters: emptyCounters(),
    invocations: [],
    output: '',
    truncated: false,
  }
  let prog: Program
  try {
    prog = new Parser(lex(source)).parseProgram()
  } catch (err) {
    const line = err instanceof ParseError ? err.line : 0
    const message = err instanceof Error ? err.message : String(err)
    return { ...base, error: { line, message } }
  }
  const interp = new Interp(prog)
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
  }
}
