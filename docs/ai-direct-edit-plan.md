# AI direct page editing — plan

**Status:** proposed, not started. Written 2026-08-19 against the tree at `2fab9db`.

## What is being asked for

Two joined things:

1. **Context attachment** — the AI should know what I am working on. The current page, the current slide, the objects I have selected, or another page I explicitly pass in. Shown as a removable chip above the composer (like the reference screenshot's `generate.ts:97-99`), so it is visible and revocable rather than magic.
2. **Direct editing** — the AI should change that page itself, not hand back a script that builds a new scene beside it. Move this, recolour that, fix the third bullet, add a graph bound to the existing mass. After my confirmation.

The second is the real change. The first is what makes it possible.

## Why SimScript cannot do this

SimScript is a **create-only** language. Reading `lib/scene/simscript.ts`, `create()` mints a `uid()` and appends; there is no verb that addresses an object that already exists. `set()` operates only on handles returned by `create()` **within the same run**. Nothing resolves an existing object id.

So "make the pendulum bob heavier" has no expressible form. The model's only move is to re-emit the whole scene, which is exactly the duplication failure already recorded in `simblip-ai-pipeline` memory (109 objects for one prompt). The pipeline was rebuilt around this constraint — `placeAnswerAndScene`, `viewportBounds`, the whole placement layer in `lib/ai/placement.ts` — all of it exists to drop a NEW scene somewhere it will not collide with old ones.

**But SimScript should not be deleted.** It stays the right tool for "build me a half-wave rectifier from nothing": one line yields a wired circuit with auto-layout that a JSON patch would need thirty objects to express. The corpus, the lint gate and ~90 few-shots are real assets. This plan **adds a second verb set**, it does not replace the first.

## What the architecture already gives us

This is the part that makes the change tractable rather than a rewrite.

### One object model for every page kind

`lib/scene/types.ts`: a page is `PageDoc { objects: Record<id, SceneObject>, variables }`. A `SceneObject` is geometry + behaviors + parameters. Critically:

- a **board** is a PageDoc
- a **doc sheet** is a PageDoc (`PageNode.docPages[]` holds content-page ids)
- a **pptx slide** is a PageDoc (same `docPages` array — see the comment at `workspace.ts:171`)

So one edit format covers board, doc and presentation with no per-kind branching. `pdf` and `image` pages carry annotation PageDocs (`annotPages[]`) and work the same way. Only `xlsx` is genuinely different (`xlsxContent`, x-data-spreadsheet's own format) and is **out of scope for phase 1**.

### A complete mutation API, already history-aware

`lib/store/document.ts` exports exactly the verbs needed, and they already handle undo:

| Need | Existing action |
|---|---|
| add | `addObject(pageId, obj, {history})` |
| modify | `updateObject(pageId, id, patch, {history})` |
| delete | `removeObjects(pageId, ids)` |
| content | `setParam` / `setStringParam` / `updateObjectParameter` |
| physics | `addBehavior` / `removeBehavior` / `setBehaviorParam` |
| variables | `upsertVariable` (by name, no history — the script path) |
| undo | `pushHistory(pageId)` then `undo(pageId)` |

**Nothing new is needed in the store.** An AI edit is the same mutation a user's drag or inspector edit performs, which also means it syncs, persists and undoes for free.

### A component registry

`lib/scene/factory.ts` exports `COMPONENTS: ComponentDef[]` and `componentById(id)`, each with `create(position) => SceneObject`. The AI never has to synthesise a valid `SceneObject` by hand for a known component — it names a component id and a position. This is the same registry `lib/ai/tools.ts` already enumerated for the old tool-calling agent, so the naming is proven.

### Selection and page context are already in the stores

- `useDocStore().selection: string[]` — what is selected right now
- `sidebar.tsx:163` already resolves `contentPageId` correctly per page kind (active sheet for doc/pptx, page for board), and passes it to `<AiPanel pageId=…>`

The panel therefore already knows the right page. It just never tells the model anything except `variables` and `objectCount` (`app/api/ai/route.ts` `systemPrompt()`).

## Design

### The edit format: a JSON patch, not a script

The model returns an ordered list of operations against the **current** page:

```jsonc
{
  "ops": [
    { "op": "update", "id": "obj_7", "position": { "x": 320, "y": 180 } },
    { "op": "setParam", "id": "obj_7", "name": "mass", "expr": "5" },
    { "op": "addBehavior", "id": "obj_7", "type": "rigidBody" },
    { "op": "add", "component": "graph", "position": { "x": 600, "y": 100 } },
    { "op": "remove", "ids": ["obj_3"] }
  ],
  "summary": "Made the bob 5 kg and added a graph."
}
```

Why JSON over a mutating dialect of SimScript:

- **It is verifiable before it runs.** Every id can be checked against the real page, every component id against `COMPONENTS`, every behavior type against `BehaviorType`. A bad op is rejected with a reason the model can repair — the same generate→lint→repair loop `lib/ai/generate.ts` already runs, reusing `MAX_REPAIRS`.
- **It is diffable.** A preview showing "3 changes: move, add graph, delete note" is mechanical. Diffing two SimScript programs is not.
- **It is a closed vocabulary.** Six ops map 1:1 onto store actions. A scripting language is an open surface where the model invents `create("shape")` — a failure already recorded in `route-intent.ts`'s own header comment.
- **Small models emit JSON far more reliably than a novel DSL.** This matters: the whole pipeline is local-model-bounded.

### Confirmation, and the undo guarantee

The user asked for confirmation before edits land. Two layers:

1. **Preview.** The turn renders the op list in plain language before anything is applied. Apply / Discard. In Auto mode, apply immediately — matching the existing `auto` behaviour for scripts, which is already gated on a verifier.
2. **One undo step.** `pushHistory(pageId)` once before the batch, then every op with `{ history: false }`. The entire AI edit becomes a **single** Ctrl+Z. This is the safety property that makes direct editing acceptable at all, and the store already supports it — it is why `updateObject` takes an options bag.

### Context attachment

A `PageContext` assembled in the panel and sent with the request:

```ts
type ContextRef =
  | { kind: 'page';      pageId: string }       // whole current page/sheet
  | { kind: 'selection'; ids: string[] }        // just what is selected
  | { kind: 'otherPage'; pageId: string }       // a page picked from the tree
```

Rendered as chips above the composer, each removable — the screenshot's model. Default: when something is selected, a **selection** chip appears automatically; otherwise a **page** chip. Auto-attached but visible and removable, so the AI is never secretly reading something.

**Serialisation is the load-bearing detail.** A raw PageDoc is far too large — a 40-object board dwarfs the ~1k-token prompt budget the whole pipeline was rebuilt to protect (`app/api/ai/route.ts` header). So send a **digest**, not the document:

- per object: `id`, `name`, geometry kind, position, size, and only *meaningful* parameters (a note's text, a formula's latex, a symbol's kind) — never the full `ParamValue` records with their cached `value`/`error`
- behaviors as bare type names
- truncate long text to ~200 chars per object
- cap the whole digest (~4k chars, same discipline as `MAX_EXTRACT_CHARS` in `lib/ai/attachments.ts`), preferring selected objects and then z-order

The ids in the digest are the real page ids, which is what lets the model address existing objects.

### Routing

`classifyIntent` gains a third destination. An **edit** is distinguishable by two signals that compose:

- an imperative aimed at existing things: *change, move, make … bigger, recolour, delete, rename, fix, align, replace, add a … to the*
- **a non-empty context attachment**

Both matter. "Add a graph" with nothing selected on an empty board is a build (SimScript). "Add a graph" with a mass selected is an edit (`add` + bind to `obj_7`). Without context, edit intent should not fire — that is the conservative direction, and it keeps every existing routing test valid.

## Phases

Each ships independently and leaves the product working.

**A — Context plumbing (no model changes).**
`lib/ai/page-context.ts`: `buildDigest(pageId, ref)`. Chips UI in the panel, auto-attach from selection. Send the digest with the request; the explain and simulate lanes simply have more context. Immediately useful: "explain what is on this page" starts working. Tests: digest shape, truncation, selection preference, and that an empty page yields an empty digest rather than noise.

**B — The edit lane, preview only.**
`lib/ai/edit-ops.ts` (types + `verifyOps` against a real page) and `lib/ai/apply-ops.ts` (the store-action mapping, single history entry). Route intent extension. Panel renders the op list with Apply/Discard. **Verification is where the tests go**: unknown id, unknown component, unknown behavior, out-of-bounds position, empty op list, an op referencing an object deleted earlier in the same batch.

**C — Corpus and prompt.**
An `EDIT_SYSTEM_PROMPT` and few-shots, built the same way `simscript-corpus.ts` is — including per-kind coverage so every op form appears at least once. This is the phase that decides quality; budget accordingly. Measure on a fixed set of edit prompts against real pages, the way the 100-question sweep was run.

**D — Auto mode + polish.**
Apply-on-arrival under the existing `auto` flag, toast with an Undo action, and the failure paths (page changed under the model between generation and apply → re-verify and refuse rather than apply stale ops).

**E — Out of scope for now, listed so it is not forgotten.**
`xlsx` pages (different content model entirely); multi-page edits in one turn; edits to a page that is not open.

## Risks

- **Stale ids.** The page can change between generation and apply. Mitigation: `verifyOps` runs again at apply time, not only at generation; any unknown id aborts the whole batch. Never apply half a patch.
- **Model quality.** This is a local 7B. JSON is easier than a DSL, but a wrong id is a wrong edit rather than a wrong new scene. The preview is the backstop, which is why phase B ships preview-only and Auto waits for D.
- **Prompt budget.** The digest competes with the system prompt, the few-shots and now the conversation history from `b025f69`. Cap the digest hard, prefer selection, and measure the total prompt size in a test rather than trusting it.
- **Scope confusion with SimScript.** Two lanes that both "make things" will drift without a clear rule. The rule: **no context attached → build (SimScript). Context attached + imperative → edit (ops).**

## What I recommend

Build A and B first and stop. A alone makes the assistant page-aware, which is most of the perceived value and carries almost no risk. B makes editing real but keeps a human in the loop on every change. Only once the op vocabulary has survived contact with actual use is C worth the corpus investment — writing few-shots for ops that turn out to be wrong is the expensive mistake here.
