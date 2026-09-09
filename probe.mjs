import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(),'probe-'))
writeFileSync(join(dir,'e.ts'), `export { mapDocxDocument } from '@/lib/store/docx-map'\n`)
execFileSync('npx',['esbuild',join(dir,'e.ts'),'--bundle','--format=esm',`--outfile=${join(dir,'m.mjs')}`,`--alias:@=${process.cwd()}`],{stdio:'pipe'})
const { mapDocxDocument } = await import(join(dir,'m.mjs'))
const zip = await JSZip.loadAsync(readFileSync(process.argv[2]))
console.log('parts:', Object.keys(zip.files).filter(f=>f.startsWith('word/')).join(' '))
const p = new DOMParser()
const r = mapDocxDocument({
  document: await zip.files['word/document.xml'].async('text'),
  numbering: await zip.files['word/numbering.xml']?.async('text'),
}, { parse: (x)=>p.parseFromString(x,'text/xml'), image: (id)=>({src:'opfs:'+id}) })
const sum=(n,d=0)=>{const pad='  '.repeat(d);const t=(n.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('').slice(0,60);console.log(`${pad}${n.type}${n.attrs?' '+JSON.stringify(n.attrs).slice(0,80):''}${t?' | '+t:''}`);for(const c of n.content??[])if(c.type!=='text')sum(c,d+1)}
r.doc.content.forEach(n=>sum(n))
console.log('blocks:', r.doc.content.length, 'section', JSON.stringify(r.section))
writeFileSync(process.argv[3] ?? '/dev/null', JSON.stringify(r.doc))
