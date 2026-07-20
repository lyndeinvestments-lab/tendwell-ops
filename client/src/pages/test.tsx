import { usePageTitle } from '@/hooks/use-page-title'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { FlaskConical } from 'lucide-react'

// Admin-only sandbox (the /test route). Used to stage redesign proposals
// before applying them to a real page. Currently empty — the last proposal
// (Property List) has shipped.
export default function TestPage() {
  usePageTitle('Test')
  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title="Test"
        subtitle="Admin-only sandbox for staging redesign proposals"
      />
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={FlaskConical}
          title="Nothing staged"
          description="This route is where in-progress redesign previews go before they're applied to a real page. It's currently empty - the last proposal (Property List) has shipped."
        />
      </div>
    </PageContainer>
  )
}
