// /api/train/simscript — the SimScript → local-LLM training pipeline.
//
// Every sample in the corpus is linted before it is served, so the dataset
// can never teach a model code the runtime would reject.
//
//   GET /api/train/simscript                → dataset as chat JSONL (fine-tuning)
//   GET /api/train/simscript?format=modelfile → Ollama Modelfile (prompt-baked model)
//   GET /api/train/simscript?format=prompt  → bare system prompt
//   GET /api/train/simscript?format=check   → lint report over the whole corpus
//
// Typical loop:
//   curl -o simscript.jsonl  http://localhost:3000/api/train/simscript
//   curl -o Modelfile        "http://localhost:3000/api/train/simscript?format=modelfile"
//   ollama create simblip-simscript -f Modelfile        # prompt-only model, or
//   fine-tune on simscript.jsonl (unsloth / llama-factory / mlx) then serve it.

import { buildDataset, buildModelfile, buildSamples, SIMSCRIPT_SYSTEM_PROMPT } from '@/lib/ai/simscript-corpus'
import { lintSimScript } from '@/lib/ai/simscript-lint'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const format = url.searchParams.get('format') ?? 'jsonl'

  if (format === 'prompt') {
    return new Response(SIMSCRIPT_SYSTEM_PROMPT, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  if (format === 'modelfile') {
    const base = url.searchParams.get('base') ?? 'qwen2.5-coder:7b'
    return new Response(buildModelfile(base), {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': 'attachment; filename="Modelfile"',
      },
    })
  }

  if (format === 'check') {
    const report = buildSamples().map((s) => ({ prompt: s.prompt, ...lintSimScript(s.script) }))
    const bad = report.filter((r) => !r.ok)
    return Response.json({
      samples: report.length,
      passing: report.length - bad.length,
      failing: bad,
    })
  }

  // default: chat-format JSONL, lint-gated
  const dataset = buildDataset().filter((d) => lintSimScript(d.messages[2].content).ok)
  const jsonl = dataset.map((d) => JSON.stringify(d)).join('\n') + '\n'
  return new Response(jsonl, {
    headers: {
      'content-type': 'application/jsonl; charset=utf-8',
      'content-disposition': 'attachment; filename="simscript-dataset.jsonl"',
      'x-sample-count': String(dataset.length),
    },
  })
}
