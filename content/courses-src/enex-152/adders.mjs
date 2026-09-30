// The hand-authored Adders lesson is kept as-is; this module re-emits it so the builder's
// course.json keeps listing it alongside the generated lessons.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
export default () => JSON.parse(readFileSync(join(import.meta.dirname, '../../courses/enex-152/adders.json'), 'utf8'))
