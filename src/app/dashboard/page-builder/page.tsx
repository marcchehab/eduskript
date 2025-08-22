import { PageBuilderInterface } from '@/components/dashboard/page-builder-interface'

export default function PageBuilderPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">
          Page Builder
        </h1>
        <p className="text-muted-foreground mt-2">
          Build your personal page by dragging content from your library
        </p>
      </div>

      <PageBuilderInterface />
    </div>
  )
}