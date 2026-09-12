// The shape a CourseDoc must have to be storable.
//
// Shared by the save route (app/api/courses/lesson) and its test, so the rules
// cannot drift apart — a second copy is how a route starts accepting something
// the test still calls invalid.
//
// This is NOT the real gate. Everything that makes a lesson worth shipping is
// checked offline by .claude/skills/course-author/lint-course.mjs, which runs
// the actual SimScript linter over every figure. This is the narrow check: a
// malformed doc must not reach the table and break the reader for everyone.
//
// Plain .mjs so the Next route and `node --test` can both import it without a
// build step.

/** @returns a human-readable reason, or null when the doc is storable. */
export function invalidCourseDoc(doc) {
  if (!doc || typeof doc !== 'object') return 'doc must be an object'
  if (typeof doc.title !== 'string' || !doc.title.trim()) return 'doc needs a title'
  if (!Array.isArray(doc.sections) || doc.sections.length === 0) {
    return 'doc has no sections — is this a CourseDoc?'
  }

  const seen = new Set()
  for (const [i, s] of doc.sections.entries()) {
    if (!s || typeof s !== 'object') return `section ${i + 1} is not an object`
    if (typeof s.id !== 'string' || !s.id) return `section ${i + 1} needs an id`
    // Ids key the outline, the scroll spy and the answer store, so a duplicate
    // silently merges two sections' progress.
    if (seen.has(s.id)) return `duplicate section id "${s.id}"`
    seen.add(s.id)
    if (typeof s.title !== 'string' || !s.title.trim()) {
      return `section "${s.id}" needs a title`
    }

    if (s.figures !== undefined) {
      if (!Array.isArray(s.figures)) return `section "${s.id}": figures must be a list`
      for (const f of s.figures) {
        if (!f || typeof f.id !== 'string' || !f.id) {
          return `section "${s.id}" has a figure with no id`
        }
        // The figure IS its script; without one the block renders nothing.
        if (typeof f.script !== 'string') return `figure "${f.id}" needs a script`
      }
    }

    if (s.question !== undefined && s.question !== null) {
      const q = s.question
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        return `section "${s.id}": a question needs at least two choices`
      }
      // A response per choice is what makes a wrong answer teach instead of
      // score (lib/store/course.ts) — a missing one renders an empty panel.
      if (!Array.isArray(q.responses) || q.responses.length !== q.choices.length) {
        return `section "${s.id}": one response per choice is required`
      }
    }
  }
  return null
}
