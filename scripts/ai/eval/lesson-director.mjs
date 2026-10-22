// Run the lesson Director headlessly against the REAL AI server and the REAL engine, and
// print what it planned, what it drew, what it measured, and what it dropped (and why).
//   OLLAMA_API_KEY=... node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/eval/lesson-director.mjs "projectile motion" [--host http://127.0.0.1:8787]
import { bundle } from '../../test/bundle.mjs'
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1] }
const topic = process.argv[2] ?? 'ohms law'
const host = arg('host', 'http://127.0.0.1:8787')
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` }

const m = await bundle(`
export { planTopic, directLesson } from '@/lib/lesson/director'
export { makeRunner } from '@/lib/lesson/runner'
export { PLAN_JSON_SCHEMA } from '@/lib/lesson/plan'
export { lintSimScript } from '@/lib/ai/simscript-lint'
export { lintStoryboard } from '@/lib/lesson/storyboard'
`, 'lesson-director')

const chat = async (model, system, user, format) => {
  const r = await fetch(`${host}/api/chat`, { method: 'POST', headers, body: JSON.stringify({ model, stream: false, think: false, ...(format ? { format } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: user }], options: { temperature: 0.3, num_ctx: 4096, num_predict: 1500 } }) })
  return (await r.json()).message?.content ?? ''
}
const llm = {
  complete: async (system, user, o) => { const t = await chat('simblip-explain', system, user, o?.jsonSchema); if (process.env.DEBUG_RAW) console.log('RAW>>', t.slice(0, 700), '\n<<'); return t },
  async script(request) {
    let note = ''
    for (let i = 0; i < 3; i++) {
      const out = await chat('simblip-script', 'x', request + note) // the alias swaps in the real short prompt
      const l = m.lintSimScript(out)
      if (l.ok) return l.cleaned
      note = `\n(Previous attempt failed: ${l.errors[0]})`
    }
    throw new Error('scene never passed lint')
  },
}
const t0 = Date.now()
const plan = await m.planTopic(llm, topic, 'basic', m.PLAN_JSON_SCHEMA)
console.log(`PLAN (${Math.round((Date.now() - t0) / 1000)}s): "${plan.title}"`)
for (const s of plan.steps) console.log(`  · ${s.heading}${s.scene ? `\n      scene: ${s.scene}` : ''}${s.experiment ? `\n      experiment: ${s.experiment}` : ''}${s.equation ? `\n      eq: ${s.equation}` : ''}`)
try {
  const real = m.makeRunner()
  const runner = process.env.DEBUG_GROUND ? { ...real, async ground(sc) { const g = await real.ground(sc); console.log('GROUND', g.ok, g.error ?? '', JSON.stringify(g.objects.map((o) => [o.name, o.kind, o.params, o.channels])), JSON.stringify(g.readings)); if (process.env.DEBUG_GROUND === '2') console.log(sc); return g } } : real
  const { storyboard, warnings } = await m.directLesson(topic, plan, { llm, runner, level: 'basic', onProgress: (x) => console.log('  …', x) })
  console.log(`FILM (${Math.round((Date.now() - t0) / 1000)}s): ${storyboard.beats.length} beats`)
  console.log('  ', Object.entries(storyboard.beats.reduce((a, b) => ((a[b.t] = (a[b.t] ?? 0) + 1), a), {})).map(([t, n]) => `${t}×${n}`).join(' '))
  for (const b of storyboard.beats.filter((b) => b.t === 'predict')) console.log(`  PREDICT: ${b.prompt}\n     answer: ${b.choices[b.correct]} — ${b.responses[b.correct]}`)
  for (const b of storyboard.beats.filter((b) => b.t === 'say' && /reads|reading/.test(b.text))) console.log(`  MEASURED: ${b.text}`)
  console.log('  warnings:', warnings.length ? warnings : 'none')
} catch (e) { console.log('FAILED:', e.message) }
process.exit(0)
