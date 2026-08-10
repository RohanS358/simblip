import { redirect } from 'next/navigation'

// Assignments moved into the notebook nav — the sidebar's Assignments
// section on desktop/tablet, the Assignments tab on mobile. This route
// only exists so old links/bookmarks don't 404.
export default function AssignmentsPage() {
  redirect('/notebook')
}
