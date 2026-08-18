# SimScript AI Pipeline

**Date:** 2026-08-18
**Status:** approved, ready for implementation

Replace the 103-tool function-calling agent behind `/api/ai` with a one-pass
SimScript generator, verified statically before it ever reaches the canvas.

---

## Why

Two AI paths exist today. The slow one runs; the fast one was built and left
idle.

Measured on an RTX 4060 8GB (this machine), same prompt for both:

| | SimScript (idle) | Tool-calling (live) |
|---|---|---|
| System prompt | **1,021 tok** | **17,981 tok** |
| Warm, one round | **2.2–2.9 s** | **11.9 s** |
| Rounds per request | 1 | up to 24 |
| Realistic total | **~2.5 s** | **~35–60 s** |
| Cold start | +8.7 s | +11.1 s |

The tool catalog is 17.6× more prompt and is re-sent on *every* step of the
loop. Tool-call JSON is also ~5× more verbose per emitted object than
`create("bulb", {R:20});`. SimScript is simply a denser representation of the
same thing.

**Speed is not the only reason.** The tool path carries its own copy of what
is placeable (`lib/ai/tools.ts`) and `schema.ts` carries a third copy that
supports only 9 of the ~22 geometry kinds. That is the same drift that made
`create()` silently produce blank rects for six real kinds. One path removes
the drift by construction.

### The catch, measured

The fast path is fast but currently **unreliable**. Its first benchmark
output did not run:

```javascript
var switch = create("switch", …);     // JS reserved word → SyntaxError
connect(switch.b, bulb);              // missing anchor → wires to nothing
addproperty(battery, "rigidBody", …); // physics on a battery
graph.plot(bulb.channel);             // `.channel` is not a real channel
```

…wrapped in markdown fences, which the runtime rejects.

`lintSimScript` was measured against exactly these. It catches **2 of 4**:

| failure | caught today? |
|---|---|
| markdown fences | yes |
| reserved word (`var switch`) | yes (as a syntax error) |
| unknown kind | yes |
| **`connect` missing an anchor** | **no** |
| **bogus `graph.plot` channel** | **no** |
| **nonsensical `addproperty`** | **no** |

The three misses are the dangerous ones: they produce a scene that *looks*
built but is not wired. Closing them is load-bearing, not polish.

---

## Architecture

```
prompt ─▶ [1] generate ─▶ [2] verify ─▶ ok? ─▶ execute ─▶ canvas
              (~2.2s)      (<1ms)       │
                              ▲         └─no─▶ [3] repair (≤2, ~2.2s each)
                              └──────────────────────┘
```

The economics: **verification is free, generation is not.** The common case
pays nothing for safety; only actual failures cost a round.

### [1] Generate

One completion, SimScript out, ~1k-token prompt. No loop.

Behind a `SimScriptGenerator` interface so the backend is swappable:

```ts
interface SimScriptGenerator {
  generate(system: string, user: string): Promise<string>
}
```

Two implementations, identical prompt and output format:

- **`OllamaGenerator`** — local, free, offline, used when reachable.
- **`openRouterGenerator`** — OpenRouter (`openrouter/free` by default). It is
  OpenAI-compatible, so this is a plain `fetch` rather than another SDK, and
  the free tier costs nothing. The only path that works for deployed users,
  who cannot run Ollama at all. Model is overridable via `OPENROUTER_MODEL`.

Selection: local when `OLLAMA_HOST` answers (probed with a 400ms timeout so a
missing local server costs ~0.4s, not a full request timeout), hosted
otherwise. `AI_BACKEND=ollama|openrouter` forces one. The ~1k-token prompt is
what makes the hosted per-request cost trivial — the representation choice is
what makes the hosted option affordable.

### [2] Verify — `lib/ai/simscript-lint.ts`

Pure, synchronous, no model. Four additions:

**(a) Var→kind tracking.** One regex pass over `var X = create("KIND", …)`
builds `{b: "bulb", t: "battery"}`. The enabling primitive for (b)–(d).

**(b) Anchor checking** against `ANCHOR_INDEX` (`lib/scene/simscript.ts`).
Catches `connect(sw.b, bulb)` — no anchor — and `connect(r.gate, …)` — a
resistor has no gate. Highest-value check: a bad anchor yields a scene that
looks built but is not connected.

**(c) Channel checking** against `BY_SYMBOL`/`VIP`/`BODY`
(`lib/scene/channels.ts`). Catches `graph.plot(bulb.channel)`. Channels are
derivable from the *kind* alone, so no execution is needed. The error names
the legal channels, which makes repair near-deterministic.

**(d) Behavior sanity** via `specsForGeometry` — `addproperty(battery,
"rigidBody")` is nonsense.

**Fences are stripped, not errored.** Every local model emits them; erroring
costs a full ~2s round to fix what a `.replace()` handles for free. The corpus
rule discouraging them stays, but no model round is ever spent on it.

**Every error string is written as a repair instruction, not a diagnosis:**

> ``connect(sw.b, bulb) — "bulb" needs an anchor; use bulb.a or bulb.b``

Small models follow "fix exactly this" far better than open-ended retry.

### [3] Repair

On failure, resend script + error strings with a fix-only instruction. **Max 2
retries**, then surface the error honestly rather than pushing a broken scene.

---

## Latency work

- **Pre-warm.** Cold start is **8.7 s** — nearly 4× the warm generation itself,
  and the single largest latency component. A 1-token request at server boot
  plus `keep_alive: '30m'` removes it. Free.
- **Context size.** `Modelfile` declares `num_ctx 8192`; `ollama.ts` overrides
  to `32768`. With a ~1k prompt neither is needed — smaller context means less
  KV cache and faster prefill on an 8 GB card.
- **Stream the output.** ~2.1 s of the 2.2 s is token generation. Streaming
  does not reduce it but makes it *feel* instant. Best perceived-speed gain
  per unit of work.

---

## Deletions

Deliberate, approved. All recoverable from git history.

| file | fate | why |
|---|---|---|
| `lib/ai/tools.ts` (607 ln) | **delete** | 103 tool schemas; the 17.6× prompt cost |
| `lib/ai/ollama.ts` `runAgent` | **replace** | 24-step loop → one completion |
| `lib/ai/schema.ts` payload types | **trim** | superseded; supported only 9 of ~22 kinds |
| `lib/ai/import.ts` | **delete** | `executeSimScript` is now the import path |

`AiResponse` stays as the client contract, gaining a `script` field.

**Not retraining the model.** Every measured error is mechanically checkable.
Lint+repair fixes them today, deterministically, and works on hosted models
that cannot be retrained. Retraining is the slow path to the same place.

---

## Data flow

The client contract is preserved: **the model never touches the canvas.**
`/api/ai` returns verified script text; the user's "Add to canvas" still
executes it, now via `executeSimScript` instead of `importSimulation`. Same
undo semantics — `executeSimScript` goes through the same store actions.

Showing the generated SimScript in the bubble is a bonus of this design: the
draft becomes readable and editable, not an opaque blob.

---

## Testing

- **Verifier** — one case per failure mode, asserted against the *real*
  benchmark output that failed. Each new check must be shown to catch its
  target and to pass a valid script (no false positives).
- **Corpus** — all 243 generated rows must still lint clean.
- **End-to-end** — a generated script must execute against a real doc store
  and produce the expected objects.

The verifier is pure, so it is directly unit-testable with no store or network.

---

## Risks

| risk | mitigation |
|---|---|
| Repair loop never converges | Hard cap of 2; fail honestly |
| Verifier false positives block valid scripts | Every check tested against a known-good script |
| Local model quality stays poor | Hosted adapter is the escape hatch; same prompt |
| Deleting the tool path loses a fallback | Recoverable from git; the fallback was the 12 s path anyway |

## Out of scope

Multi-page/slide/deck generation. SimScript cannot create pages or slides
today, and long multi-page generations fight the latency goal. Revisit once
the single-page path is fast and correct.

---

## Implementation notes

Built and verified 2026-08-18. Live end-to-end results (RTX 4060, local 7B):

| prompt | time | passes | result |
|---|---|---|---|
| battery → switch → bulb | 8.9 s | 3 | 7 objects, 3 connections |
| mass on a spring, plot vy | 3.0 s | 1 | 4 objects, 2 connections |
| voltage divider + probe | 8.0 s | 2 | 9 objects, 4 connections |

All three generate, verify **and execute** on a real doc store. A clean first
pass is ~3 s; repairs cost ~3 s each, which is why the cap matters.

### Bugs the end-to-end run exposed

Static checks were not enough — each of these passed lint but broke in
practice, and none would have been found without executing real model output:

1. **Trailing `// comment` threw `Unexpected token ')'`.** The `with(sandbox)
   { … }` wrapper put the body on one line, so a final comment swallowed the
   closing brace. Present in **both** the linter and `executeSimScript`, so
   fixing only the linter produced scripts that verified and then threw. Fixed
   at both sites. This was a pre-existing runtime bug, not a new one.
2. **A prose preamble ("Here is the script:") failed.** Now stripped like
   fences — a ~2 s model round is far too expensive to spend on chit-chat.
   Guarded so an all-prose reply still fails loudly rather than silently
   becoming an empty "valid" script.
3. **Commented-out code was still flagged.** The model's most common way to
   obey "drop this line" is to comment it out; re-flagging it made the repair
   loop unwinnable and burned all three attempts. Comments are now blanked
   (preserving offsets) before the semantic scans.

Lesson worth keeping: the verifier and the runtime must agree on what parses.
Any future syntax handling belongs in one place, or they will drift again.
