// Which anchor clicks arm the global route loader. The trap is the two ends:
// arming on links that never navigate (hash, mailto, download, new tab,
// same URL) strands a full-screen overlay over a page that never changed;
// missing a real navigation is the "it just gets stuck" bug this fixes.
//
// Run directly:  node components/route-loader.test.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The component is TSX; lift the pure helper out rather than build it.
const src = readFileSync(new URL('./route-loader.tsx', import.meta.url), 'utf8')
const body = src.slice(src.indexOf('export function isRouteNav('))
const js = body
  .slice(0, body.indexOf('\n}\n') + 3)
  .replace('export function isRouteNav(', 'function isRouteNav(')
  .replace(/: string \| null \| undefined/, '')
  .replace(/: string,\n/, ',\n')
  .replace(/: \{ target\?: string; download\?: boolean \} = \{\}/, ' = {}')
  .replace(/\): boolean \{/, ') {')
  .replace(/\n  let url: URL/, '\n  let url')
const isRouteNav = new Function(`${js}; return isRouteNav`)()

const HERE = 'https://simblip.app/notebook'

// real navigations
assert.equal(isRouteNav('/assignments', HERE), true)
assert.equal(isRouteNav('https://simblip.app/board', HERE), true)
assert.equal(isRouteNav('/notebook?page=2', HERE), true)
assert.equal(isRouteNav('/assignments', HERE, { target: '_self' }), true)

// non-navigations
assert.equal(isRouteNav('/notebook', HERE), false, 'same URL')
assert.equal(isRouteNav('#section', HERE), false, 'hash')
assert.equal(isRouteNav('mailto:a@b.c', HERE), false, 'mailto')
assert.equal(isRouteNav('tel:+9779800000000', HERE), false, 'tel')
assert.equal(isRouteNav('https://example.com/x', HERE), false, 'external')
assert.equal(isRouteNav('/export.pdf', HERE, { download: true }), false, 'download')
assert.equal(isRouteNav('/assignments', HERE, { target: '_blank' }), false, 'new tab')
assert.equal(isRouteNav(null, HERE), false)
assert.equal(isRouteNav('', HERE), false)
assert.equal(isRouteNav('blob:https://simblip.app/abc', HERE), false, 'blob')

console.log('route-loader: 14 assertions passed')
