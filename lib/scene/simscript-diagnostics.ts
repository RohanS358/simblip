// SimScript editor brains — line-accurate diagnostics + a tiny tokenizer for
// syntax highlighting. Pure module (no store, no DOM): used live by the
// SimScript IDE (components/objects/code.tsx) on every edit, and by the
// training-pipeline linter (lib/ai/simscript-lint.ts) so both agree on what
// "valid SimScript" means.
//
// Diagnostics are deliberately human: instead of V8's bare "Unexpected
// token '='" they say *which line* and *why* — reserved variable names
// (`var switch = …`), unknown create() kinds with a "did you mean", unclosed
// brackets pointing at the opener, unterminated strings, connect() arity.

import { KNOWN_KINDS } from '@/lib/ai/simscript-corpus'

// ─── diagnostics ─────────────────────────────────────────────────────────────

export interface Diagnostic {
  line: number // 1-based; 0 = whole script
  message: string
  severity: 'error' | 'warning'
}

// Words JS refuses as variable names — the #1 real-world failure is
// `var switch = create("switch")`.
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'yield', 'let', 'static', 'await', 'implements', 'interface',
  'package', 'private', 'protected', 'public',
])

const GENERIC_OK = new Set(['rect', 'circle', 'line', 'polygon'])

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

interface MaskResult {
  text: string // same length as source: string contents & comments → spaces
  open: 'template' | 'comment' | null // still inside one at EOF
  openLine: number
  unterminatedLines: number[] // '…' / "…" strings that hit a newline
}

// Blank out string contents and comments while keeping every newline and all
// structural characters (quotes, commas, brackets) in place, so positional
// checks can run without being fooled by text inside strings.
function maskSource(source: string): MaskResult {
  const chars = source.split('')
  const unterminatedLines: number[] = []
  let open: MaskResult['open'] = null
  let openLine = 1
  let line = 1
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\n') { line++; i++; continue }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { chars[i] = ' '; i++ }
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      openLine = line
      chars[i] = ' '; chars[i + 1] = ' '
      i += 2
      let closed = false
      while (i < source.length) {
        if (source[i] === '*' && source[i + 1] === '/') { chars[i] = ' '; chars[i + 1] = ' '; i += 2; closed = true; break }
        if (source[i] === '\n') line++
        else chars[i] = ' '
        i++
      }
      if (!closed) open = 'comment'
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      openLine = line
      i++
      let closed = false
      while (i < source.length) {
        if (source[i] === '\\') {
          chars[i] = ' '
          if (i + 1 < source.length && source[i + 1] !== '\n') chars[i + 1] = ' '
          i += 2
          continue
        }
        if (source[i] === ch) { i++; closed = true; break }
        if (source[i] === '\n') {
          if (ch !== '`') { unterminatedLines.push(line); break } // recover, keep scanning
          line++; i++
          continue
        }
        chars[i] = ' '
        i++
      }
      if (!closed && ch === '`' && i >= source.length) open = 'template'
      continue
    }
    i++
  }
  return { text: chars.join(''), open, openLine, unterminatedLines }
}

function transpile(source: string): string {
  // Same rewrite the runtime applies so declarations land on the sandbox.
  return source.replace(/\b(var|let|const)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/g, '$2')
}

function compiles(source: string): string | null {
  try {
    // eslint-disable-next-line no-new-func
    new Function('sandbox', `with(sandbox) { ${transpile(source)} }`)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// The closing brackets a well-formed continuation of this masked prefix needs.
function closersNeeded(masked: string): string {
  const stack: string[] = []
  for (const ch of masked) {
    if (OPENERS[ch]) stack.push(OPENERS[ch])
    else if (CLOSERS[ch] && stack[stack.length - 1] === ch) stack.pop()
  }
  return stack.reverse().join('')
}

// When the whole script fails to parse and no targeted check explained why,
// find the offending line: compile ever-longer prefixes (auto-closing open
// brackets) and take the start of the trailing run of failures. Continuation
// lines fail transiently and then recover, so they don't pin the blame.
function syntaxErrorLine(source: string, lineCount: number): number {
  const lines = source.split('\n')
  const fails: boolean[] = new Array(lines.length).fill(false)
  for (let i = 0; i < lines.length; i++) {
    const prefix = lines.slice(0, i + 1).join('\n')
    const m = maskSource(prefix)
    if (m.open) continue // mid-comment/template: not judgeable yet
    fails[i] = compiles(prefix + '\n' + closersNeeded(m.text)) !== null
  }
  if (!fails[lines.length - 1]) return lineCount
  let first = lines.length - 1
  while (first > 0 && fails[first - 1]) first--
  return first + 1
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i)
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= a.length; i++) {
      const cur = dp[i]
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return dp[a.length]
}

function nearestKind(kind: string): string | null {
  let best: string | null = null
  let bestD = 3 // suggest only close misses
  for (const k of KNOWN_KINDS) {
    const d = editDistance(kind, k)
    if (d < bestD) { bestD = d; best = k }
  }
  return best
}

export function diagnoseSimScript(source: string): Diagnostic[] {
  const errors: Diagnostic[] = []
  const warnings: Diagnostic[] = []
  const lines = source.split('\n')
  const mask = maskSource(source)
  const maskedLines = mask.text.split('\n')

  // line number of a character offset in `source`
  const lineOf = (index: number) => source.slice(0, index).split('\n').length

  // 1. Markdown fences — pasted straight from a chat model.
  const fenceAt = source.indexOf('```')
  if (fenceAt !== -1) {
    errors.push({ line: lineOf(fenceAt), message: 'Markdown fences (```) are not SimScript — paste the bare code only.', severity: 'error' })
  }

  // 2. Unterminated strings / comments.
  for (const l of mask.unterminatedLines) {
    errors.push({ line: l, message: 'This string never closes — add the missing quote.', severity: 'error' })
  }
  if (mask.open === 'comment') {
    errors.push({ line: mask.openLine, message: 'This /* comment never closes — add */.', severity: 'error' })
  }
  if (mask.open === 'template') {
    errors.push({ line: mask.openLine, message: 'This `template string` never closes — add the closing backtick.', severity: 'error' })
  }

  // 3. Reserved words used as variable names — `var switch = …` is the
  // single most common real failure ("Unexpected token '='").
  maskedLines.forEach((ml, i) => {
    const declRe = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g
    let m: RegExpExecArray | null
    while ((m = declRe.exec(ml)) !== null) {
      if (RESERVED.has(m[1])) {
        errors.push({
          line: i + 1,
          message: `'${m[1]}' is a reserved JavaScript word and can't be a variable name — rename it (e.g. ${m[1]}1).`,
          severity: 'error',
        })
      }
    }
    // bare assignment to a reserved word: `switch = create(…)`
    const bare = /(^|[^.\w$])(break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|finally|for|function|if|import|in|instanceof|new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|let|static|await)\s*=(?!=)/.exec(ml)
    if (bare) {
      errors.push({
        line: i + 1,
        message: `'${bare[2]}' is a reserved JavaScript word and can't be a variable name — rename it (e.g. ${bare[2]}1).`,
        severity: 'error',
      })
    }
  })

  // 4. Bracket balance on the masked source (first mismatch only).
  {
    const stack: { ch: string; line: number }[] = []
    let line = 1
    let broken = false
    for (const ch of mask.text) {
      if (ch === '\n') { line++; continue }
      if (OPENERS[ch]) stack.push({ ch, line })
      else if (CLOSERS[ch]) {
        const top = stack[stack.length - 1]
        if (!top || top.ch !== CLOSERS[ch]) {
          errors.push({ line, message: top ? `Found '${ch}' but the last open bracket is '${top.ch}' (line ${top.line}).` : `'${ch}' has no matching '${CLOSERS[ch]}'.`, severity: 'error' })
          broken = true
          break
        }
        stack.pop()
      }
    }
    if (!broken && stack.length > 0) {
      const top = stack[stack.length - 1]
      errors.push({ line: top.line, message: `'${top.ch}' opened here is never closed — add the matching '${OPENERS[top.ch]}'.`, severity: 'error' })
    }
  }

  // 5. create() kinds (on the original source — needs the string contents).
  const createRe = /create\s*\(\s*(['"])([^'"]+)\1/g
  let cm: RegExpExecArray | null
  while ((cm = createRe.exec(source)) !== null) {
    const kind = cm[2].toLowerCase()
    const line = lineOf(cm.index)
    if (kind === 'graph') {
      errors.push({ line, message: 'create("graph") is wrong — use graph.plot(obj.channel) instead.', severity: 'error' })
    } else if (kind === 'symbol') {
      errors.push({ line, message: 'create("symbol", …) is wrong — create the component kind directly, e.g. create("resistor").', severity: 'error' })
    } else if (!KNOWN_KINDS.has(kind) && !GENERIC_OK.has(kind)) {
      const near = nearestKind(kind)
      errors.push({ line, message: `Unknown kind "${cm[2]}"${near ? ` — did you mean "${near}"?` : ' — not a SimScript component.'}`, severity: 'error' })
    }
  }

  // 6. connect() arity — a lone argument silently does nothing at runtime.
  const connectRe = /connect\s*\(([^()]*)\)/g
  while ((cm = connectRe.exec(mask.text)) !== null) {
    const args = cm[1].split(',').map((s) => s.trim()).filter(Boolean)
    if (args.length < 2) {
      errors.push({ line: lineOf(cm.index), message: 'connect() needs two anchors, e.g. connect(battery.positive, bulb.a).', severity: 'error' })
    }
  }

  // 7. Anything the targeted checks missed: locate the generic syntax error.
  if (errors.length === 0) {
    const msg = compiles(source)
    if (msg !== null) {
      errors.push({ line: syntaxErrorLine(source, lines.length), message: msg, severity: 'error' })
    }
  }

  // 8. Soft signals (once each).
  const warnAt = (re: RegExp, message: string) => {
    for (let i = 0; i < maskedLines.length; i++) {
      if (re.test(maskedLines[i])) { warnings.push({ line: i + 1, message, severity: 'warning' }); return }
    }
  }
  warnAt(/\basync\b|\bawait\b/, 'SimScript is synchronous — async/await does nothing.')
  warnAt(/\bdocument\.|\bwindow\./, 'DOM access does nothing inside SimScript.')

  errors.sort((a, b) => a.line - b.line)
  warnings.sort((a, b) => a.line - b.line)
  return [...errors, ...warnings]
}

// ─── tokenizer (syntax highlighting) ─────────────────────────────────────────

export type TokType = 'kw' | 'api' | 'str' | 'num' | 'com' | 'prop' | 'id' | 'punc'
export interface Tok { text: string; type: TokType }

const KEYWORDS = new Set([
  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'new', 'true', 'false', 'null', 'undefined', 'typeof', 'in', 'of',
  'break', 'continue', 'switch', 'case', 'default', 'try', 'catch', 'throw',
])
// SimScript's own API — the words that should pop.
const API_GLOBALS = new Set(['create', 'connect', 'addproperty', 'graph', 'page', 'Math'])
const API_METHODS = new Set(['plot', 'set'])

// Tokenize the whole source into per-line token runs (strings and block
// comments can span lines, so this scans the source, not each line).
export function tokenizeSimScript(source: string): Tok[][] {
  const out: Tok[][] = [[]]
  const push = (text: string, type: TokType) => {
    const parts = text.split('\n')
    parts.forEach((p, k) => {
      if (k > 0) out.push([])
      if (p) out[out.length - 1].push({ text: p, type })
    })
  }
  let i = 0
  let prev = '' // last significant (non-space) char seen, for `.prop` detection
  while (i < source.length) {
    const ch = source[i]
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i)
      const j = nl === -1 ? source.length : nl
      push(source.slice(i, j), 'com')
      i = j
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const j = end === -1 ? source.length : end + 2
      push(source.slice(i, j), 'com')
      i = j
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < source.length) {
        if (source[j] === '\\') { j += 2; continue }
        if (source[j] === ch) { j++; break }
        if (ch !== '`' && source[j] === '\n') break
        j++
      }
      push(source.slice(i, j), 'str')
      prev = ch
      i = j
      continue
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1
      while (j < source.length && /[\w.]/.test(source[j])) j++
      push(source.slice(i, j), 'num')
      prev = '0'
      i = j
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1
      while (j < source.length && /[\w$]/.test(source[j])) j++
      const word = source.slice(i, j)
      const type: TokType =
        prev === '.' ? (API_METHODS.has(word) ? 'api' : 'prop')
        : KEYWORDS.has(word) ? 'kw'
        : API_GLOBALS.has(word) ? 'api'
        : 'id'
      push(word, type)
      prev = 'a'
      i = j
      continue
    }
    // run of punctuation / whitespace / newlines
    let j = i + 1
    while (j < source.length && /[^A-Za-z0-9_$"'`/]/.test(source[j])) j++
    const text = source.slice(i, j)
    const sig = text.replace(/\s+/g, '')
    if (sig) prev = sig[sig.length - 1]
    push(text, 'punc')
    i = j
  }
  return out
}
