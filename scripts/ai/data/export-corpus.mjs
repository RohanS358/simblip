// Dump the existing hand-written corpus as JSONL ({name, prompt, script}).
import { bundle } from '../../test/bundle.mjs'
import { writeFileSync } from 'node:fs'
const m = await bundle(`export { buildSamples } from '@/lib/ai/simscript-corpus'`, 'corpus')
const rows = m.buildSamples().map((s, i) => ({ name: `corpus-${i}`, prompt: s.prompt, script: s.script.trim() }))
writeFileSync(process.argv[2] ?? '.cache/corpus.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
console.log(rows.length, 'samples')
process.exit(0)
