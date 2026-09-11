'use client'

// Where a lesson's text lives.
//
// A CourseDoc is authored offline, lint-gated, and imported — it is never
// generated at runtime and never edited in the app. So it is stored as ONE
// JSON blob on the page rather than as SceneObjects: there is no editor to
// round-trip through, and a lesson that arrived as objects would be a lesson
// the reader could accidentally drag apart.
//
// It rides in the page's `flow` field, which already exists for exactly this
// shape of payload (doc pages keep their body text there) and is already
// carried by bundlePage() — so shares, assignments and sync move a lesson
// with no transport changes at all.

import { useDocStore } from '@/lib/store/document'
import * as archive from '@/lib/store/page-archive'
import type { CourseDoc } from './course'

/** Read the lesson on a course page, or null if it has none yet. */
export function readCourse(pageId: string): CourseDoc | null {
  const page = useDocStore.getState().pages[pageId] ?? archive.readPage(pageId)
  const raw = page?.flow
  if (!raw || typeof raw !== 'string') return null
  try {
    const doc = JSON.parse(raw) as CourseDoc
    return Array.isArray(doc?.sections) ? doc : null
  } catch {
    // A malformed lesson shows the empty state rather than throwing during
    // render. Authoring is where this is caught — see the course-author skill.
    return null
  }
}

/** Write a lesson onto a course page. Used by import, not by the reader. */
export function writeCourse(pageId: string, doc: CourseDoc): void {
  useDocStore.getState().ensurePage(pageId)
  useDocStore.setState((s) => ({
    pages: { ...s.pages, [pageId]: { ...s.pages[pageId], flow: JSON.stringify(doc) } },
  }))
}
