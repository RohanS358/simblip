// Generate with an Ollama-compatible endpoint (incl. ai-server/) for the bake-off.
//   node scripts/ai/eval/ollama-generate.mjs --model qwen3:8b --prompts novel-prompts.jsonl --out out.jsonl [--system-file .cache/system-full.txt]
import { readFileSync, writeFileSync } from 'node:fs'
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1] }
const host = arg('host', 'http://127.0.0.1:11434'), model = arg('model')
const system = readFileSync(arg('system-file', '.cache/system-full.txt'), 'utf8')
const rows = readFileSync(arg('prompts'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const headers = { 'Content-Type': 'application/json', ...(process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {}) }
let toks = 0, ms = 0
const out = []
for (const r of rows) {
  const prompt = r.prompt ?? r.messages[1].content
  const t = Date.now()
  const res = await fetch(`${host}/api/chat`, { method: 'POST', headers, body: JSON.stringify({ model, stream: false, think: false, keep_alive: '10m', messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], options: { temperature: 0.2, num_ctx: 4096, num_predict: 900 } }) })
  const j = await res.json()
  ms += Date.now() - t; toks += j.eval_count ?? 0
  out.push(JSON.stringify({ prompt, recipe: r.recipe, script: (j.message?.content ?? '').trim() }))
}
writeFileSync(arg('out'), out.join('\n') + '\n')
console.log(`${model}: ${rows.length} prompts, ${(toks / (ms / 1000)).toFixed(0)} tok/s, ${(ms / rows.length / 1000).toFixed(1)} s/prompt`)
