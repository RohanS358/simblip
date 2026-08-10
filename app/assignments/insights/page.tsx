'use client'

import { RequireAuth } from '@/components/auth/require-auth'
import { PageShell } from '@/components/platform/page-shell'
import { InsightsDashboard } from '@/components/workspace/insights-dashboard'

export default function AssignmentInsightsPage() {
  return (
    <RequireAuth allow={['teacher', 'admin', 'super_admin']}>
      <PageShell title="Assignment Insights" backHref="/notebook">
        <InsightsDashboard />
      </PageShell>
    </RequireAuth>
  )
}
