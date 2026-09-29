// Writes public/third-party-licenses.txt: the copyright notice and license
// text of every production dependency, plus the files vendored by hand into
// public/. MIT, BSD, ISC, Apache and OFL all require their notice to travel
// with the code, and the browser bundle is that code. Runs before every build.
//
// Fails the build on a copyleft license outside ALLOWED_COPYLEFT so a new GPL
// dependency can't slip in unreviewed.

import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Reviewed: sharp's libvips is LGPL, dynamically linked, server-only (Next
// image optimizer). jszip is dual MIT/GPL — used under MIT. dompurify is dual
// MPL/Apache — used under Apache. @vercel/analytics is MPL-2.0, unmodified.
const ALLOWED_COPYLEFT = new Set(['@img/sharp-libvips-linux-x64', '@img/sharp-libvips-linuxmusl-x64', '@img/sharp-libvips-darwin-arm64', '@img/sharp-libvips-darwin-x64', '@img/sharp-libvips-win32-x64', 'jszip', 'dompurify', '@vercel/analytics'])
const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|CDDL|SSPL|CC-BY-SA|CC-BY-NC)/i

const VENDORED = [
  {
    name: 'x-data-spreadsheet (public/vendor/x-data-spreadsheet)',
    license: 'MIT',
    text: 'Copyright (c) 2019 myliang\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
  },
  {
    name: 'Plus Jakarta Sans (public/fonts)',
    license: 'OFL-1.1',
    text: 'Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans)\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1. The full license text is available at https://openfontlicense.org/open-font-license-official-text/',
  },
]

const root = process.cwd()
const dirs = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 })
  .trim()
  .split('\n')
  .filter((d) => d !== root)

const seen = new Map()
const bad = []
for (const dir of dirs) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  const id = `${pkg.name}@${pkg.version}`
  if (!pkg.name || seen.has(id)) continue
  let license = pkg.license ?? pkg.licenses?.map((l) => l.type ?? l).join(' OR ') ?? 'UNKNOWN'
  if (typeof license === 'object') license = license.type
  if (COPYLEFT.test(license) && !ALLOWED_COPYLEFT.has(pkg.name)) bad.push(`${id} (${license})`)
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)/i.test(f))
  const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${license}`
  seen.set(id, { name: id, license, text })
}

if (bad.length) {
  console.error(`Unreviewed copyleft dependencies:\n  ${bad.join('\n  ')}\nReview, then add to ALLOWED_COPYLEFT in scripts/third-party-licenses.mjs.`)
  process.exit(1)
}

const entries = [...VENDORED, ...[...seen.values()].sort((a, b) => a.name.localeCompare(b.name))]
const out =
  `SIMBLIP — third-party software notices\nGenerated ${new Date().toISOString().slice(0, 10)}. ${entries.length} components.\n\n` +
  entries.map((e) => `${'='.repeat(78)}\n${e.name} — ${e.license}\n${'='.repeat(78)}\n${e.text}\n`).join('\n')

writeFileSync(join(root, 'public/third-party-licenses.txt'), out)
console.log(`third-party-licenses.txt: ${entries.length} components`)
