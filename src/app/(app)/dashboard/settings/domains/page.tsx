import { TeacherDomainsManager } from '@/components/dashboard/teacher-domains-manager'

// Legacy account-level entry point. No siteId → the domains API falls back to
// the primary site (and surfaces legacy null-site domains). Per-site domains
// are managed at /dashboard/site/[siteId]/domains.
export default function TeacherDomainsPage() {
  return <TeacherDomainsManager backUrl="/dashboard/settings" />
}
