// Node ESM loader for running server route handlers in plain node tests:
// resolves the `@/` path alias (tsconfig) and extensionless TypeScript
// imports. Used with --experimental-strip-types:
//
//   node --experimental-strip-types --import ./scripts/test/register.mjs <test>

import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EXTS = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts']

function probe(base) {
  for (const ext of EXTS) {
    const p = base + ext
    if (existsSync(p) && !p.endsWith('/')) {
      try {
        if (ext === '' && !/\.[cm]?[jt]sx?$/.test(p)) continue
      } catch {}
      return pathToFileURL(p).href
    }
  }
  return null
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const hit = probe(path.join(ROOT, specifier.slice(2)))
    if (hit) return next(hit, context)
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    if (!/\.[cm]?[jt]sx?$/.test(base)) {
      const hit = probe(base)
      if (hit) return next(hit, context)
    }
  }
  // `next/server` has no ESM export map entry; point at the CJS file.
  if (specifier === 'next/server') return next(pathToFileURL(path.join(ROOT, 'node_modules/next/server.js')).href, context)
  return next(specifier, context)
}
