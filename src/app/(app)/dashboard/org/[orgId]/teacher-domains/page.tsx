import { redirect } from 'next/navigation'

// Redirect to unified domains page
export default async function OrgTeacherDomainsPage({
  params,
}: {
  params: Promise<{ orgId: string }>
}) {
  const { orgId } = await params
  redirect(`/dashboard/org/${orgId}/domains`)
}
