import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { siteHasOrHadSlug } from '@/lib/site-slugs'
import { PluginEditor } from '@/components/dashboard/plugin-editor'

export default async function EditPluginPage({ params }: { params: Promise<{ ownerSlug: string; pluginSlug: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  if (session.user.accountType === 'student') redirect('/dashboard/profile')
  const { ownerSlug, pluginSlug } = await params

  const plugin = await prisma.plugin.findFirst({
    where: { slug: pluginSlug, author: { sites: { some: siteHasOrHadSlug(ownerSlug) } } },
    select: {
      id: true, slug: true, name: true, description: true, entryHtml: true,
      author: { select: { id: true, name: true, sites: { where: siteHasOrHadSlug(ownerSlug), take: 1, select: { slug: true, pageName: true } } } },
    },
  })
  if (!plugin) notFound()

  return (
    <PluginEditor
      key={plugin.id}
      userId={session.user.id}
      ownerSlug={session.user.pageSlug || ''}
      plugin={{
        id: plugin.id,
        slug: plugin.slug,
        name: plugin.name,
        description: plugin.description,
        entryHtml: plugin.entryHtml,
        author: {
          id: plugin.author.id,
          name: plugin.author.name,
          pageSlug: plugin.author.sites[0]?.slug ?? ownerSlug,
          pageName: plugin.author.sites[0]?.pageName ?? null,
        },
      }}
    />
  )
}
