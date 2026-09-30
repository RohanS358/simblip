# Adding another engineering field

The curriculum is **data**, not code. One file per programme:

```
content/curriculum/computer.mjs      ← Bachelor in Computer Engineering (active)
content/curriculum/<civil>.mjs       ← drop another file in, same shape
```

Each file exports `program = { id, title, body, status, source, subjects[] }` and adds subjects with `S(code, title, semester, kind, chapters[])`. A chapter row is

```
[title, hours, tags, how]        tags:  sim=<engines> diag=<flow|seq|uml|block> reuse=<components> enh=<enhanced> neu=<new engines> short=0
```

which answers the six questions for that chapter (short? simulation? diagram? reuse? enhance? new?). Then:

```bash
node scripts/build-curriculum.mjs      # docs/curriculum/<id>.md + content/curriculum/index.json
```

The build **fails if a row names an engine that does not exist**, so the matrix can never promise coverage the app cannot deliver, and it marks each subject with whether chapter notes exist (`content/courses/<id>/`).

## Adding the notes for a subject

1. `content/courses-src/<course-id>/course.mjs` — `{ id, code, title, subject, semester, program, description, order, lessons }`. Put the programme id in `program` (`'computer'`, later `'civil'` …); the code (`ENCT 302`) is what the matrix links on.
2. One module per lesson (`01-intro.mjs` …) exporting `default ({ lab, dia, cpp, scr, q, pr, step, sec, term, run }) => lesson({ … })`. Read `.claude/skills/course-author/SKILL.md`; each lesson needs 6+ sections, a worked example, questions with per-choice feedback, and every number from `run()`.
3. `node scripts/build-courses.mjs <course-id>` — writes the JSON and runs the lint gate.
4. Publishing (`publish-course.mjs`) and granting a course to an institution are separate, operator-only steps.

## Needs a new engine?

Only if no existing Step Lab engine, circuit, mechanics or diagram covers the topic — see [../steplab.md](../steplab.md#adding-an-engine--40-lines). Fields likely to need few or none: civil/mechanics (existing mechanics, fields, graph, table), electrical/electronics (existing circuits, waves, `blocks`), geomatics (`transform2d`, `project3d`).
