# AI decision log (append, never rewrite)

Format: date · decision · evidence · what would change it.

- 2026-10-18 · Learning engine (Phase 3) is model-free: FSRS-4.5 hand-rolled in `lib/learning/fsrs.ts` (no `ts-fsrs` dependency), hint ladder / mastery / card lint are deterministic code; the model only words content. · 10 tests in `lib/learning/learning.test.mjs` (intervals grow, Easy>Good>Hard, R=0.9 at one stability). · Swap to `ts-fsrs` if the parameters need per-user optimisation.
- 2026-10-18 · Retrieval is BM25 over lesson sections (`lib/learning/bm25.ts`), no embedding model; only the 3 best lessons by title are downloaded per query (`lib/tools/course-corpus.ts`). · 0 MB model RAM, honours course grants because it reads `/api/courses`. · Add embeddings only if BM25 recall measures insufficient.
- 2026-10-18 · Learner state lives in its own persisted store `simblip-learner`, never in the chat store, and never leaves the device unless page-sync is on. · Plan D9 (minors' data). · A teacher view needs an explicit class-consent flow first (Phase 6).
- 2026-10-18 · Cards are records, not a new `PageKind`. · Plan §6.5: PageKind already has 8 kinds, each touching routing/export/sync. · Revisit if printable deck pages become a core flow.
- 2026-10-18 · Mode is an explicit Learn/Answer toggle (`RecallStrip`), never inferred. · Plan §6.3.
