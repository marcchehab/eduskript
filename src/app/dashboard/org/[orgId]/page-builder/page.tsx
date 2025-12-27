'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, use } from 'react'
import { PageBuilderInterface } from '@/components/dashboard/page-builder-interface'
import { Building2 } from 'lucide-react'

interface Organization {
  id: string
  name: string
  slug: string
}

export default function OrgPageBuilderPage({
  params,
}: {
  params: Promise<{ orgId: string }>
}) {
  const { orgId } = use(params)
  const { data: session, status } = useSession()
  const router = useRouter()
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchOrg = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/organizations/${orgId}`)
        const data = await response.json()

        if (!response.ok) {
          if (response.status === 403) {
            router.push('/dashboard')
            return
          }
          throw new Error(data.error || 'Failed to fetch organization')
        }

        setOrganization(data.organization)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    if (session) {
      fetchOrg()
    }
  }, [session, orgId, router])

  if (status === 'loading' || loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p>Loading page builder...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  if (!organization) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p>Organization not found</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Building2 className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-3xl font-bold">{organization.name} Page Builder</h1>
      </div>

      <PageBuilderInterface
        context={{
          type: 'organization',
          organizationId: orgId,
        }}
      />
    </div>
  )
}
