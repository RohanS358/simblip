// SimScript linter — pure, runs on the server and in the browser. Used by
// the training pipeline to guarantee every dataset sample is executable, and
// available to a generate→lint→repair loop around a local model.
//
// It cannot fully execute a script (that needs the document store), but it
// catches what actually breaks scripts in practice: JS syntax errors, unknown
// create() kinds, and the create("graph") / create("symbol") anti-patterns.

import { KNOWN_KINDS } from './simscript-corpus'

export interface LintResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

const GENERIC_OK = new Set(['rect', 'circle', 'line', 'polygon'])

export function lintSimScript(source: string): LintResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. Syntax — same transpile the runtime applies before executing.
  const transpiled = source.replace(/\b(var|let|const)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/g, '$2')
  try {
    // eslint-disable-next-line no-new-func
    new Function('sandbox', `with(sandbox) { ${transpiled} }`)
  } catch (e) {
    errors.push(`syntax: ${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, errors, warnings }
  }

  // 2. Markdown fences — models love them, the runtime chokes on them.
  if (/```/.test(source)) errors.push('output: markdown fences are not SimScript — emit bare code')

  // 3. create() kinds.
  const createRe = /create\s*\(\s*(['"])([^'"]+)\1/g
  let m: RegExpExecArray | null
  while ((m = createRe.exec(source)) !== null) {
    const kind = m[2].toLowerCase()
    if (kind === 'graph') {
      errors.push('create("graph") is wrong — use graph.plot(obj.channel) instead')
      continue
    }
    if (kind === 'symbol') {
      errors.push('create("symbol", …) is wrong — create the component kind directly, e.g. create("resistor")')
      continue
    }
    if (!KNOWN_KINDS.has(kind) && !GENERIC_OK.has(kind)) {
      errors.push(`unknown kind "${m[2]}" — not a SimScript component`)
    }
  }

  // 4. connect() arity — a lone argument silently does nothing at runtime.
  const connectRe = /connect\s*\(([^()]*)\)/g
  while ((m = connectRe.exec(source)) !== null) {
    const args = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    if (args.length < 2) errors.push(`connect(${m[1].trim()}) needs two anchors`)
  }

  // 5. Soft signals.
  if (/\bawait\b|\basync\b/.test(source)) warnings.push('SimScript is synchronous — async/await does nothing')
  if (/document\.|window\./.test(source)) warnings.push('DOM access does nothing inside SimScript')

  return { ok: errors.length === 0, errors, warnings }
}
