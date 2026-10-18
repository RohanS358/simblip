// execFileSync that works on Windows for the tests' `npx esbuild …` bundling.
// npx is a .cmd shim there, which Node will only run through a shell — and a
// shell needs its arguments quoted (esbuild's --define:K="v" carries quotes).
import { execFileSync as raw } from 'node:child_process'

const quote = (a) => (/[\s"&|<>^%]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a)

export function execFileSync(cmd, args, opts = {}) {
  if (process.platform === 'win32' && cmd === 'npx') {
    return raw([cmd, ...args].map(quote).join(' '), [], { ...opts, shell: true })
  }
  return raw(cmd, args, opts)
}
