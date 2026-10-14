import { bundle } from '../../test/bundle.mjs'
import { writeFileSync } from 'node:fs'
const m = await bundle(`export { SIMSCRIPT_SYSTEM_PROMPT } from '@/lib/ai/simscript-corpus'`, 'sys')
writeFileSync(process.argv[2] ?? '.cache/system-full.txt', m.SIMSCRIPT_SYSTEM_PROMPT)
console.log(m.SIMSCRIPT_SYSTEM_PROMPT.length, 'chars')
process.exit(0)
