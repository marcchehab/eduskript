import { prisma } from '@/lib/prisma'
import { SignInForm } from '@/components/auth/signin-form'

interface SignInPageProps {
  searchParams: Promise<{ from?: string; callbackUrl?: string }>
}

/**
 * Server component that fetches branding data based on the 'from' param:
 * - "org/<slug>" → fetch Organization by slug → org-page layout
 * - "<pageSlug>" → fetch User by pageSlug → teacher-page layout
 * - (none) → default eduskript branding → org-page layout
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { from, callbackUrl } = await searchParams

  let context: {
    type: 'teacher-page' | 'org-page'
    slug: string
    name: string
    icon?: string | null
  }

  if (from?.startsWith('org/')) {
    // Org page context — resolve via the org's Site (URL slug + display).
    const orgSlug = from.substring(4)
    const site = await prisma.site.findUnique({
      where: { slug: orgSlug },
      select: {
        slug: true,
        pageIcon: true,
        organization: { select: { name: true } },
      },
    })

    context = {
      type: 'org-page',
      slug: orgSlug,
      name: site?.organization?.name || 'Eduskript',
      icon: site?.pageIcon || null,
    }
  } else if (from) {
    // Teacher page context — resolve via the teacher's Site.
    const site = await prisma.site.findUnique({
      where: { slug: from },
      select: {
        slug: true,
        pageName: true,
        pageIcon: true,
        user: { select: { name: true } },
      },
    })

    context = {
      type: 'teacher-page',
      slug: from,
      name: site?.pageName || site?.user?.name || from,
      icon: site?.pageIcon || null,
    }
  } else {
    // No context — default to eduskript org-page layout. Pull the slug +
    // icon from the org's Site (the org with the earliest createdAt).
    const defaultOrg = await prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: {
        name: true,
        site: { select: { slug: true, pageIcon: true } },
      },
    })

    context = {
      type: 'org-page',
      slug: defaultOrg?.site?.slug || 'eduskript',
      name: defaultOrg?.name || 'Eduskript',
      icon: defaultOrg?.site?.pageIcon || null,
    }
  }

  return <SignInForm context={context} callbackUrl={callbackUrl || '/dashboard'} />
}
